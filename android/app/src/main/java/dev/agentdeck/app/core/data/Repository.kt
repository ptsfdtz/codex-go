package dev.agentdeck.app

import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import androidx.lifecycle.AndroidViewModel
import androidx.room.Room
import androidx.room.withTransaction
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import java.security.SecureRandom
import android.util.Base64
import java.time.Instant

class DeckApplication:Application(){
    var foreground=false;private set
    val repository:DeckRepository by lazy{DeckRepository(this)}
    override fun onCreate(){super.onCreate();registerActivityLifecycleCallbacks(object:ActivityLifecycleCallbacks{
        override fun onActivityResumed(activity:android.app.Activity){foreground=true;repository.checkConnection();repository.startBackgroundConnectionsIfEnabled()}
        override fun onActivityPaused(activity:android.app.Activity){foreground=false}
        override fun onActivityCreated(activity:android.app.Activity,state:android.os.Bundle?){}
        override fun onActivityStarted(activity:android.app.Activity){}
        override fun onActivityStopped(activity:android.app.Activity){}
        override fun onActivitySaveInstanceState(activity:android.app.Activity,state:android.os.Bundle){}
        override fun onActivityDestroyed(activity:android.app.Activity){}
    })}
}
class DeckViewModel(application:Application):AndroidViewModel(application){val repository=(application as DeckApplication).repository;val state=repository.state}

class DeckRepository(context:Context){
    private val applicationContext=context.applicationContext
    internal val workspaceNavigation=WorkspaceNavigation()
    internal val composerDrafts=ComposerDrafts()
    internal val conversationViewports=ConversationViewports()
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private val navigation=context.getSharedPreferences("agentdeck_navigation",Context.MODE_PRIVATE)
    private var restoreNavigation=true
    private val vault=Vault(context)
    private val cloud=CloudAccount(vault::readCloud,vault::saveCloud,scope,vault::cloudInstallation)
    private val discovery=LanDiscovery(context,scope)
    private val db=Room.databaseBuilder(context,DeckDatabase::class.java,"agentdeck-cache.db").build()
    private val dao=db.cache()
    private val preferences=PreferenceStore(context)
    private val notifications=DeckNotifications(context.applicationContext as DeckApplication)
    private val mutable=MutableStateFlow(DeckState(preferences=preferences.read(),fullAccess=navigation.getBoolean("fullAccess",true)))
    val state:StateFlow<DeckState> = mutable.asStateFlow()
    private val initialized=CompletableDeferred<Unit>()
    private var notificationJob:Job?=null
    private var connectionJob:Job?=null
    @Volatile private var connectionError:String?=null
    private var selectionJob:Job?=null
    private var pairingJob:Job?=null
    private var pairGeneration=0L
    private var credentialsUnreadable=false
    private var snapshotJob:Job?=null
    private var timelineJob:Job?=null
    private var timelineRefreshJob:Job?=null
    private val historyRevision=java.util.concurrent.atomic.AtomicLong()
    private val timelineRevision=java.util.concurrent.atomic.AtomicLong()
    private val connections=ComputerConnections(scope,RoomComputerJournal(db),{id,event->notifications.publish(id,event,mutable.value.preferences.notifications)},notifications::reconcileApprovals,cloud,discovery::route)
    private val transport:DeckTransport? get()=connections.get(mutable.value.host?.hostId)?.transport
    private val snapshotReads=SnapshotReads()
    private val cacheMutex=Mutex()
    private val actionMutex=Mutex()
    @Volatile private var switchingHost=false
    @Volatile private var hostEpoch=0L
    private val connectivity=context.getSystemService(ConnectivityManager::class.java)
    private val callback=object:ConnectivityManager.NetworkCallback(){
        override fun onAvailable(network:Network){discovery.refresh();checkConnection()}
        override fun onLost(network:Network){discovery.refresh();checkConnection()}
    }
    init {
        scope.launch{discovery.endpoints.collect{connections.check()}}
        scope.launch{while(isActive){delay(30_000);connections.check()}}
        scope.launch{initialized.await();var previous=cloud.state.value.binding
            cloud.state.collect{value->
                mutable.update{it.copy(cloud=value)}
                if(previous!=value.binding){
                    previous=value.binding;cancelPair()
                    val visible=HostBook(mutable.value.hosts,mutable.value.host?.hostId).visible(value.binding)
                    // Invalidate old callbacks and clear private UI before waiting for an in-flight action.
                    hostEpoch++
                    connectionJob?.cancel();snapshotJob?.cancel();selectionJob?.cancel();timelineJob?.cancel();timelineRefreshJob?.cancel()
                    notifications.visibleHosts(visible.hosts.map{it.hostId}.toSet())
                    connections.restrictTo(visible.hosts)
                    mutable.update{it.forHost(visible).copy(host=null)}
                    actionMutex.withLock{activateBook(vault.readBook())}
                }
            }
        }
        scope.launch{connections.states.collect{views->mutable.update{it.copy(computerConnections=views.mapValues{entry->ComputerStatus(entry.value.connection,entry.value.error,entry.value.route)})}}}
        connectivity.registerDefaultNetworkCallback(callback)
        scope.launch{try{actionMutex.withLock{
            cloud.load();mutable.update{it.copy(cloud=cloud.state.value)}
            val book=try{vault.readBook()}catch(e:CancellationException){throw e}catch(_:Exception){credentialsUnreadable=true;mutable.update{it.copy(error="已保存的电脑凭据无法读取，请重新配对所需电脑",connection="需要重新配对")};return@withLock}
            try{activateBook(book)}catch(e:CancellationException){throw e}catch(e:Exception){mutable.update{it.copy(error=errorMessage(e))}}
        }}finally{initialized.complete(Unit)}}
    }
    // UI selection observes a session; it never owns or closes its network connection.
    private suspend fun activateBook(savedBook:HostBook){
        val book=savedBook.visible(cloud.state.value.binding)
        discovery.hosts(book.hosts)
        notifications.visibleHosts(book.hosts.map{it.hostId}.toSet())
        switchingHost=true;hostEpoch++
        try{
            connectionJob?.cancelAndJoin();snapshotJob?.cancelAndJoin();selectionJob?.cancelAndJoin()
            timelineJob?.cancelAndJoin();timelineRefreshJob?.cancelAndJoin();timelineRevision.incrementAndGet()
            connectionJob=null;snapshotJob=null;selectionJob=null;connectionError=null
            restoreNavigation=true
            mutable.value=mutable.value.forHost(book)
            connections.reconcile(book.hosts)
            val host=book.active?:return
            val session=connections.get(host.hostId)?:return
            val epoch=hostEpoch
            dao.host(host.hostId)?.let{cached->
                try{val snapshot=wire.decodeFromString(Snapshot.serializer(),cached.snapshot);require(snapshot.host?.hostId==host.hostId)
                    mutable.update{it.copy(snapshot=snapshot,selectedProject=snapshot.projects.firstOrNull()?.projectId,lastSynced=cached.syncedAt)}}
                catch(e:CancellationException){throw e}catch(_:Exception){dao.removeHost(host.hostId)}
            }
            connectionJob=scope.launch{
                launch{
                    var previousOnline=false
                    var previousGeneration=-1L
                    session.state.collect{view->
                        if(epoch!=hostEpoch)return@collect
                        val isCurrent={epoch==hostEpoch&&mutable.value.host?.hostId==host.hostId}
                        view.snapshot?.let{updateSnapshot(it,isCurrent,previousGeneration>=0&&view.generation!=previousGeneration)}
                        previousGeneration=view.generation
                        val priorError=connectionError
                        connectionError=view.error
                        mutable.update{it.copy(connection=view.connection,stale=!view.online,capabilities=view.capabilities,retention=view.retention,lastSynced=view.syncedAt,
                            error=if(it.error==null||it.error==priorError)view.error else it.error)}
                        if(view.online&&!previousOnline){
                            restoreLastSession(mutable.value.snapshot)
                            launch{
                                try{
                                    if(!isCurrent())return@launch
                                    if(view.capabilities?.supports("threadIndexRefresh")==true)refreshNativeProjectSessions()
                                    if(!isCurrent())return@launch
                                    loadModels()
                                    if(isCurrent())mutable.value.selectedSession?.let{refreshSession(it)}
                                }catch(e:CancellationException){throw e}catch(e:Exception){if(isCurrent())mutable.update{it.copy(error=errorMessage(e))}}
                            }
                        }
                        previousOnline=view.online
                    }
                }
                session.events.collect{event->if(epoch==hostEpoch)applyEvent(event)}
            }
        }finally{switchingHost=false}
    }
    internal fun openNotification(target:NotificationTarget){
        notificationJob?.cancel()
        notificationJob=scope.launch{
            initialized.await()
            var epoch=hostEpoch
            try{
                actionMutex.withLock{
                    val book=vault.readBook()
                    require(book.visible(cloud.state.value.binding).hosts.any{it.hostId==target.hostId}){"通知对应的电脑已移除或不属于当前账户"}
                    if(book.active?.hostId!=target.hostId){
                        val next=book.selected(target.hostId)
                        withContext(NonCancellable){vault.saveBook(next);activateBook(next)}
                    }
                    epoch=hostEpoch
                }
                val ready=withTimeout(60000){state.first{hostEpoch!=epoch||it.host?.hostId!=target.hostId||!it.stale&&it.connection=="已连接"}}
                if(epoch!=hostEpoch||ready.host?.hostId!=target.hostId)return@launch
                actionMutex.withLock{
                    if(epoch!=hostEpoch||mutable.value.host?.hostId!=target.hostId)return@withLock
                    refreshSnapshot(rpc())
                    requireNotNull(target.session(mutable.value)){"通知对应的会话已删除或当前无权访问"}
                    selectSession(target.sessionId)
                    mutable.update{it.copy(notificationNavigation=java.util.UUID.randomUUID().toString())}
                }
            }catch(e:CancellationException){
                if(e is TimeoutCancellationException&&epoch==hostEpoch)mutable.update{it.copy(error="无法连接通知对应的电脑，请连接后重试通知")}
                throw e
            }catch(e:Exception){if(epoch==hostEpoch)mutable.update{it.copy(error=errorMessage(e))}}
        }
    }
    fun selectHost(id:String){action{val book=vault.readBook();require(book.visible(cloud.state.value.binding).hosts.any{it.hostId==id}){"电脑不属于当前账户"};if(mutable.value.host?.hostId!=id){val next=book.selected(id);vault.saveBook(next);activateBook(next)}}}
    fun renameHost(id:String,name:String){action{val book=vault.readBook().renamed(id,name);vault.saveBook(book);val visible=book.visible(cloud.state.value.binding);mutable.update{it.copy(hosts=visible.hosts,host=visible.active)}}}
    fun cloudLogin(origin:String,username:String,password:String){action{cloud.login(origin,username,password)}}
    fun cloudLogout(){action{cloud.logout()}}
    fun cloudPassword(old:String,new:String){action{cloud.changePassword(old,new)}}
    fun cloudRefresh(){action{cloud.refreshDirectory()}}
    fun setRoutePolicy(hostId:String,policy:String){action{require(policy in listOf("auto","lan","cloud"));val book=vault.readBook();val host=book.visible(cloud.state.value.binding).hosts.single{it.hostId==hostId};require(policy!="cloud"||host.cloud!=null){"请重新扫描公网配对码后使用云端连接"};val next=book.copy(hosts=book.hosts.map{if(it.hostId==hostId)it.copy(routePolicy=policy)else it});vault.saveBook(next);activateBook(next)}}
    private fun errorMessage(e:Throwable):String=when(e){is DeckException->userFacingError(e.code,e.message);is java.security.cert.CertificateException,is javax.net.ssl.SSLPeerUnverifiedException,is javax.net.ssl.SSLHandshakeException->userFacingError("TLS",e.message);is TimeoutCancellationException->userFacingError("TIMEOUT",e.message);is java.io.IOException->userFacingError("NETWORK",e.message);else->userFacingError(null,e.message)}
    private suspend fun applyEvent(event:DeckEvent){
        if(event.action=="session.historyChanged")historyRevision.incrementAndGet()
        if(event.action=="session.historyChanged"&&event.sessionId==mutable.value.selectedSession){
            cancelTimelineRequests()
            mutable.update{it.copy(historyGeneration=historyRevision.get(),events=emptyList(),timelineHistory=TimelineHistory(sessionId=event.sessionId))}
            scheduleTimelineHistory()
        }
        if(event.action=="session.observed")mutable.update{if(it.observationPendingSession==event.sessionId)it.copy(observationPendingSession=null)else it}
        if(event.action in listOf("upstream.turn.completed","turn.completed","turn.failed","turn.interrupted","session.observed","host.status")&&(event.sessionId==null||event.sessionId==mutable.value.selectedSession))scheduleTimelineHistory()
        if(event.action=="git.changed"&&mutable.value.git!=null)refreshGit()
    }
    private suspend fun updateSnapshot(snapshot:Snapshot,isCurrent:()->Boolean,resetCursor:Boolean=false){cacheMutex.withLock{
        if(!isCurrent())throw CancellationException("Snapshot connection replaced")
        val host=mutable.value.host?:return
        require(snapshot.host?.hostId==host.hostId){"Bridge identity mismatch"}
        val at=Instant.now().toString()
        if(resetCursor){historyRevision.incrementAndGet();cancelTimelineRequests()}
        val selected=mutable.value.selectedSession
        val previousSession=mutable.value.snapshot.sessions.find{it.sessionId==selected}
        val refreshedSession=snapshot.sessions.find{it.sessionId==selected}
        val sourceHistoryChanged=previousSession!=null&&refreshedSession!=null&&previousSession.updatedAt!=refreshedSession.updatedAt
        if(selected!=null&&snapshot.sessions.none{it.sessionId==selected})selectionJob?.cancel()
        mutable.update{old->val vanished=old.selectedSession!=null&&snapshot.sessions.none{it.sessionId==old.selectedSession};old.copy(historyGeneration=historyRevision.get(),snapshot=snapshot,lastSynced=at,selectedSession=if(vanished)null else old.selectedSession,timelineHistory=if(vanished||resetCursor)TimelineHistory(sessionId=if(vanished)null else old.selectedSession) else old.timelineHistory,events=if(vanished||resetCursor)emptyList() else old.events,selectedProject=old.selectedProject?.takeIf{id->snapshot.projects.any{it.projectId==id}}?:snapshot.projects.firstOrNull()?.projectId)}
        if(sourceHistoryChanged)scheduleTimelineHistory()
    }}
    private fun restoreLastSession(snapshot:Snapshot){
        if(!restoreNavigation||snapshot.sessions.isEmpty())return
        restoreNavigation=false
        val remembered=navigation.getString("${mutable.value.host?.hostId}:session",null)
        val latest=snapshot.sessions.find{it.sessionId==remembered&&it.archived==0}?:snapshot.sessions.filter{it.archived==0}.maxByOrNull{it.updatedAt}
        latest?.let{selectSession(it.sessionId)}
    }
    private suspend fun refreshSnapshot(current:DeckTransport?=transport,resetCursor:Boolean=false){
        val connection=current?:return
        val epoch=hostEpoch
        val hostId=mutable.value.host?.hostId
        val isCurrent={epoch==hostEpoch&&connection===transport&&!switchingHost&&mutable.value.host?.hostId==hostId}
        snapshotReads.refresh(isCurrent,
            read={connections.get(hostId)?.refreshSnapshot(connection,resetCursor)?:throw CancellationException("电脑已移除")},
            apply={snapshot->updateSnapshot(snapshot,isCurrent,resetCursor);restoreLastSession(mutable.value.snapshot)})
    }
    private fun scheduleSnapshot(current:DeckTransport){if(snapshotJob?.isActive==true)return;snapshotJob=scope.launch{delay(250);try{refreshSnapshot(current)}catch(e:CancellationException){throw e}catch(_:Exception){}}}
    private fun rpc():DeckTransport {
        val session=connections.get(mutable.value.host?.hostId)?:error("Bridge 未连接")
        check(mutable.value.connection=="已连接"&&!mutable.value.stale&&session.state.value.online){"离线时不能执行操作"}
        return session.transport?:error("Bridge 未连接")
    }
    private fun action(block:suspend()->Unit){val epoch=hostEpoch;scope.launch{if(!actionMutex.tryLock())return@launch;if(epoch!=hostEpoch){actionMutex.unlock();return@launch};mutable.update{it.copy(busy=true,error=null)};try{block()}catch(e:CancellationException){throw e}catch(e:Exception){if(epoch==hostEpoch){connectionError=null;mutable.update{it.copy(error=errorMessage(e))}}}finally{mutable.update{it.copy(busy=false)};actionMutex.unlock()}}}
    fun beginPair(raw:String){val generation=++pairGeneration;pairingJob?.cancel();pairingJob=scope.launch{mutable.update{it.copy(busy=true,error=null)};var client:okhttp3.OkHttpClient?=null;try{
        val qr=wire.decodeFromString(PairQr.serializer(),raw).validated()
        val route=qr.cloud?.let{binding->require(binding==cloud.state.value.binding){"请先登录二维码对应的服务器和账户"};RelaySocketFactory(cloud,binding,qr.hostId)}
        client=pinnedClient(qr.fingerprint,qr.endpoint,qr.tlsServerName,route);val origin=serviceOrigin(qr.endpoint,qr.tlsServerName)
        val nonce=ByteArray(32).also{SecureRandom().nextBytes(it)};val result=post(client,origin+"/api/v1/pair/request",buildJsonObject{put("token",qr.token);put("displayName","${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".take(80));put("nonce",Base64.encodeToString(nonce,Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP))})
        val requestId=result.getValue("requestId").jsonPrimitive.content;val claim=result.getValue("claimToken").jsonPrimitive.content
        mutable.update{it.copy(pairingCode=result.getValue("code").jsonPrimitive.content,pairingName=qr.endpoint)}
        var host:Host?=null
        while(Instant.now().isBefore(Instant.parse(qr.expiresAt))){val claimed=post(client,origin+"/api/v1/pair/claim",payload("requestId" to requestId,"claimToken" to claim));when(claimed["status"]?.jsonPrimitive?.content){"approved"->{require(claimed["hostId"]?.jsonPrimitive?.content==qr.hostId){"配对电脑身份不匹配"};host=Host(qr.endpoint.trimEnd('/'),qr.fingerprint,qr.hostId,claimed.getValue("deviceId").jsonPrimitive.content,claimed.getValue("credential").jsonPrimitive.content,tlsServerName=qr.tlsServerName,cloud=qr.cloud);break};"rejected"->throw DeckException("PAIRING_REJECTED","Windows 已拒绝此设备")};delay(1200)}
        require(qr.cloud==null||qr.cloud==cloud.state.value.binding){"配对期间账户已改变，请重新扫码"};val pairedHost=requireNotNull(host){"配对已过期，请重新生成二维码"};require(Regex("[A-Za-z0-9_-]{43}").matches(pairedHost.credential)){"设备凭据无效"};actionMutex.withLock{ensureActive();withContext(NonCancellable){val book=(if(credentialsUnreadable)HostBook()else vault.readBook()).paired(pairedHost);vault.saveBook(book);credentialsUnreadable=false;activateBook(book)}}
    }catch(e:CancellationException){throw e}catch(e:Exception){if(generation==pairGeneration)mutable.update{it.copy(error=errorMessage(e),pairingCode=null)}}finally{client?.dispatcher?.executorService?.shutdown();client?.connectionPool?.evictAll();if(generation==pairGeneration)mutable.update{it.copy(busy=false)}}}}
    fun cancelPair(){pairGeneration++;pairingJob?.cancel();mutable.update{it.copy(pairingCode=null,pairingName=null,busy=false)}}
    private fun recordNavigation(target:WorkspaceDestination){
        val state=mutable.value;val host=state.host?:return
        val current=state.snapshot.sessions.find{it.sessionId==state.selectedSession}
        val previous=current?.let{WorkspaceDestination(it.projectId,it.sessionId,it.upstreamThreadId)}?:state.selectedProject?.let{WorkspaceDestination(it)}
        previous?.let{workspaceNavigation.visit(host.hostId,it)}
        workspaceNavigation.visit(host.hostId,target)
    }
    internal fun navigateWorkspace(direction:Int):Boolean{
        require(direction==-1||direction==1)
        val state=mutable.value;val host=state.host?:return false
        if(state.busy)return false
        val target=workspaceNavigation.move(host.hostId,direction,state.snapshot)?:return false
        if(target.sessionId!=null)selectSessionInternal(target.sessionId,false)else selectProjectInternal(target.projectId,false)
        return true
    }
    fun selectProject(id:String){selectProjectInternal(id,true)}
    private fun selectProjectInternal(id:String,record:Boolean){
        val state=mutable.value;val host=state.host?:return
        if(state.snapshot.projects.none{it.projectId==id&&it.enabled})return
        if(record)recordNavigation(WorkspaceDestination(id))
        cancelTimelineRequests();restoreNavigation=false;selectionJob?.cancel();navigation.edit().remove("${mutable.value.host?.hostId}:session").apply();mutable.update{it.copy(selectedProject=id,selectedSession=null,events=emptyList(),timelineHistory=TimelineHistory(),git=null,diff=null)}}
    fun selectSession(id:String){selectSessionInternal(id,true)}
    private suspend fun watchSessionTurn(id:String){
        while(currentCoroutineContext().isActive){
            delay(5000)
            val state=mutable.value
            val session=state.snapshot.sessions.find{it.sessionId==id}?:return
            if(state.selectedSession!=id)return
            if(state.stale||state.busy||state.capabilities?.supports("latestUpstreamTurn")!=true||session.status !in listOf("running","waitingApproval","unknown"))continue
            try{readLatestSessionTurn(session);refreshSnapshot()}
            catch(e:CancellationException){throw e}
            catch(_:Exception){/* Keep unknown state until the authority can be read. */}
        }
    }
    private fun selectSessionInternal(id:String,record:Boolean){
        val state=mutable.value;val host=state.host?:return
        val session=state.snapshot.sessions.find{it.sessionId==id}?:return
        if(state.snapshot.projects.none{it.projectId==session.projectId&&it.enabled})return
        if(record)recordNavigation(WorkspaceDestination(session.projectId,id,session.upstreamThreadId))
        cancelTimelineRequests();restoreNavigation=false;navigation.edit().putString("${host.hostId}:session",id).apply();mutable.update{it.copy(selectedSession=id,timelineHistory=TimelineHistory(sessionId=id),selectedModel=session.model,selectedEffort=session.effort,selectedProject=session.projectId,events=emptyList(),git=if(it.selectedProject==session.projectId)it.git else null,diff=if(it.selectedProject==session.projectId)it.diff else null)};selectionJob?.cancel();selectionJob=scope.launch{launch{watchSessionTurn(id)};launch{try{if(!mutable.value.stale)refreshSession(id)}catch(e:Exception){mutable.update{it.copy(error=errorMessage(e))}}};dao.events(host.hostId,id).collect{rows->val events=rows.asReversed().mapNotNull{runCatching{wire.decodeFromString(DeckEvent.serializer(),it.json)}.getOrNull()};mutable.update{if(it.host?.hostId==host.hostId&&it.selectedSession==id)it.copy(events=events)else it}}}}
    private suspend fun refreshSession(id:String,before:String?=null){
        val host=mutable.value.host?:return
        val epoch=hostEpoch
        val connection=rpc()
        if(before==null&&mutable.value.capabilities?.supports("externalThreadObservation")==true){
            try{
                val observed=connection.request("sessions.observe",payload("sessionId" to id))
                require(observed["sessionId"]?.jsonPrimitive?.content==id&&observed["observing"]?.jsonPrimitive?.booleanOrNull!=null){"会话订阅身份不匹配"}
                mutable.update{if(epoch==hostEpoch&&it.selectedSession==id)it.copy(observationPendingSession=if(observed["observing"]?.jsonPrimitive?.booleanOrNull==true)null else id)else it}
            }catch(e:CancellationException){throw e}catch(e:Exception){
                // A failed live join must not prevent authorized persisted reads.
                mutable.update{if(epoch==hostEpoch&&it.selectedSession==id)it.copy(observationPendingSession=id,error=errorMessage(e))else it}
            }
        }
        val historyVersion=historyRevision.get()
        val result=connection.request("sessions.detail",buildJsonObject{put("sessionId",id);put("limit",500);if(before!=null)put("before",before)})
        require(epoch==hostEpoch&&mutable.value.host?.hostId==host.hostId){"电脑连接已切换"}
        require(result["session"]?.jsonObject?.get("sessionId")?.jsonPrimitive?.content==id){"会话身份不匹配"}
        val events=result["events"]?.jsonArray?.map{wire.decodeFromJsonElement(DeckEvent.serializer(),it)}?:emptyList()
        require(events.all{it.sessionId==id}){"会话消息身份不匹配"}
        cacheMutex.withLock{if(historyVersion==historyRevision.get()&&epoch==hostEpoch)dao.saveEvents(events.map{CachedEvent(host.hostId,it.eventId.toLong(),it.sessionId,wire.encodeToString(DeckEvent.serializer(),it))})}
        if(before==null&&mutable.value.selectedSession==id)loadTimelineHistory()
        if(before==null&&mutable.value.capabilities?.supports("latestUpstreamTurn")==true){
            mutable.value.snapshot.sessions.find{it.sessionId==id}?.let{readLatestSessionTurn(it);refreshSnapshot(connection)}
        }
    }
    internal suspend fun refreshNativeProjectSessions(){
        val epoch=hostEpoch
        val connection=rpc()
        require(!mutable.value.stale&&mutable.value.capabilities?.supports("threadIndexRefresh")==true){"电脑端需要升级或重新连接才能同步会话"}
        val result=refreshExistingSessionIndex { connection.request("sessions.refreshIndex",buildJsonObject{put("contractVersion",1)}) }
        require(result["contractVersion"]?.jsonPrimitive?.intOrNull==1){"不支持的会话同步版本"}
        require(epoch==hostEpoch&&connection===transport&&!mutable.value.stale){"连接已变更，请重试同步"}
        refreshSnapshot(connection)
    }
    internal fun openNativeProjectSession(expectedHost:String?,entry:JsonObject,id:String):Boolean {
        val current=mutable.value
        if(current.host?.hostId!=expectedHost||expectedHost==null||current.stale||current.busy||current.capabilities?.supports("nativeProjectReadViews")!=true)return false
        if(nativeProjectSessions(entry,current.snapshot.sessions).none{it.sessionId==id})return false
        selectSession(id)
        return true
    }
    internal suspend fun readNativeProjects(cursor:String?):NativeProjectPage {
        val host=mutable.value.host?.hostId
        val current=rpc()
        check(!mutable.value.stale&&mutable.value.capabilities?.supports("nativeProjectReadViews")==true){"此电脑尚不支持 Codex 项目读取"}
        val result=current.request("projects.nativePage",buildJsonObject{put("contractVersion",1);put("limit",50);cursor?.let{put("cursor",it)}})
        check(current===transport&&host==mutable.value.host?.hostId&&!mutable.value.stale){"连接已变更，请重新读取"}
        return decodeNativeProjectPage(result)
    }
    internal suspend fun readSessionImage(sessionId:String,turnId:String,itemId:String,contentIndex:Int):ByteArray {
        require(mutable.value.capabilities?.supports("sessionImages")==true){"电脑需要升级才能读取图片"}
        val epoch=hostEpoch
        val connection=rpc()
        val native=mutable.value.snapshot.sessions.find{it.sessionId==sessionId}?.upstreamThreadId?:error("会话已移除")
        val output=java.io.ByteArrayOutputStream()
        var offset=0
        var hash:String?=null
        var total:Int?=null
        do {
            currentCoroutineContext().ensureActive()
            require(epoch==hostEpoch&&connection===transport&&!mutable.value.stale){"电脑连接已切换"}
            val chunk=connection.request("sessions.image",buildJsonObject{put("sessionId",sessionId);put("turnId",turnId);put("itemId",itemId);put("contentIndex",contentIndex);put("offset",offset);hash?.let{put("sha256",it)}})
            require(chunk["sessionId"]?.jsonPrimitive?.content==sessionId&&chunk["upstreamThreadId"]?.jsonPrimitive?.content==native&&chunk["turnId"]?.jsonPrimitive?.content==turnId&&chunk["itemId"]?.jsonPrimitive?.content==itemId&&chunk["contentIndex"]?.jsonPrimitive?.int==contentIndex&&chunk["offset"]?.jsonPrimitive?.int==offset){"图片来源身份不匹配"}
            val digest=chunk.getValue("sha256").jsonPrimitive.content
            val size=chunk.getValue("totalBytes").jsonPrimitive.int
            require(Regex("[a-f0-9]{64}").matches(digest)&&size in 1..8*1024*1024&&(hash==null||hash==digest)&&(total==null||total==size)){"图片内容已变更"}
            require(chunk["mime"]?.jsonPrimitive?.content in listOf("image/png","image/jpeg","image/gif","image/webp")){"不支持的图片格式"}
            hash=digest;total=size
            val bytes=Base64.decode(chunk.getValue("data").jsonPrimitive.content,Base64.DEFAULT)
            require(bytes.isNotEmpty()&&bytes.size<=48*1024&&offset+bytes.size<=size){"图片分块无效"}
            output.write(bytes);offset+=bytes.size
            require((chunk["nextOffset"] as? JsonPrimitive)?.intOrNull==if(offset<size)offset else null){"图片分块游标无效"}
        }while(offset<total!!)
        require(epoch==hostEpoch&&connection===transport&&!mutable.value.stale){"电脑连接已切换"}
        val bytes=output.toByteArray()
        require(java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt() and 255)}==hash){"图片校验失败"}
        return bytes
    }
    internal suspend fun readUpstreamHistory(id:String,cursor:String?,sortDirection:String="asc"):UpstreamHistoryPage {
        val historyVersion=historyRevision.get()
        val epoch=hostEpoch
        require(sortDirection in listOf("asc","desc")){"无效历史顺序"}
        if(sortDirection=="desc")require(mutable.value.capabilities?.supports("upstreamHistoryOrdering")==true){"电脑端需要升级才能读取最近历史"}
        require(mutable.value.capabilities?.supports("upstreamHistoryPages")==true){"电脑端需要升级才能读取已保存历史"}
        val connection=rpc()
        fun params()=buildJsonObject{put("sessionId",id);cursor?.let{put("cursor",it)};if(sortDirection!="asc")put("sortDirection",sortDirection)}
        val result=connection.request("sessions.history",params())
        require(result["sessionId"]?.jsonPrimitive?.content==id){"会话身份不匹配"}
        if(sortDirection!="asc")require((result["sortDirection"] as? JsonPrimitive)?.contentOrNull==sortDirection){"历史顺序不匹配"}
        val entries=result["data"]?.jsonArray.orEmpty().map{it.jsonObject}.toMutableList()
        val resource=result["resource"] as? JsonObject
        if(resource!=null){
            require(entries.isEmpty()&&(resource["cursor"] as? JsonPrimitive)?.contentOrNull==cursor){"历史资源游标无效"}
            require(mutable.value.capabilities?.supports("upstreamHistoryContent")==true){"电脑端不支持完整内容读取"}
            val total=resource.getValue("bytes").jsonPrimitive.int
            require(total in 1..8*1024*1024){"历史资源大小超出支持范围"}
            val hash=resource.getValue("sha256").jsonPrimitive.content
            val output=java.io.ByteArrayOutputStream(total)
            var offset=0
            while(offset<total){
                currentCoroutineContext().ensureActive()
                require(epoch==hostEpoch){"电脑连接已切换"}
                val chunk=connection.request("sessions.historyContent",buildJsonObject{put("sessionId",id);cursor?.let{put("cursor",it)};put("sha256",hash);put("offset",offset);if(sortDirection!="asc")put("sortDirection",sortDirection)})
                require(chunk["sessionId"]?.jsonPrimitive?.content==id&&chunk["sha256"]?.jsonPrimitive?.content==hash&&chunk["offset"]?.jsonPrimitive?.int==offset&&chunk["totalBytes"]?.jsonPrimitive?.int==total){"历史内容身份不匹配"}
                val bytes=Base64.decode(chunk.getValue("data").jsonPrimitive.content,Base64.DEFAULT)
                require(bytes.isNotEmpty()&&bytes.size<=48*1024&&offset+bytes.size<=total){"历史分块大小无效"}
                output.write(bytes);offset+=bytes.size
                val next=(chunk["nextOffset"] as? JsonPrimitive)?.intOrNull
                require(next==if(offset<total)offset else null){"历史分块游标无效"}
            }
            val bytes=output.toByteArray()
            val actual=java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt() and 255)}
            require(actual==hash){"历史内容校验失败，请重新加载"}
            val entry=wire.parseToJsonElement(bytes.toString(Charsets.UTF_8)).jsonObject
            require(entry["turnId"]==resource["turnId"]&&entry["item"]?.jsonObject?.get("id")==resource["itemId"]){"历史条目身份不匹配"}
            entries.add(entry)
        }
        require(epoch==hostEpoch){"电脑连接已切换"}
        require(historyVersion==historyRevision.get()){"会话历史已变化，请重新读取"}
        return UpstreamHistoryPage(entries,(result["nextCursor"] as? JsonPrimitive)?.contentOrNull)
    }
    private fun cancelTimelineRequests(){synchronized(this){timelineRevision.incrementAndGet();timelineJob?.cancel();timelineRefreshJob?.cancel()}}
    private fun scheduleTimelineHistory(){synchronized(this){timelineRefreshJob?.cancel();timelineRefreshJob=scope.launch{
        delay(250)
        // Let an in-flight older page commit before extending the head. A turn
        // finishing must not cancel the user's pagination request.
        val pending=synchronized(this@DeckRepository){timelineJob}
        pending?.join()
        loadTimelineHistory()
    }}}
    fun olderHistory(){loadTimelineHistory(older=true)}
    private fun loadTimelineHistory(older:Boolean=false){synchronized(this){
        val state=mutable.value
        val id=state.selectedSession?:return
        if(state.stale||state.capabilities?.supports("upstreamHistoryOrdering")!=true)return
        val existing=state.timelineHistory.takeIf{it.sessionId==id}?:TimelineHistory(sessionId=id)
        if(older&&(existing.loading||!existing.loaded||existing.nextCursor==null))return
        val target=if(older)existing.nextCursor else null
        val epoch=hostEpoch
        val revision=timelineRevision.incrementAndGet()
        timelineJob?.cancel()
        fun current(s:DeckState)=epoch==hostEpoch&&revision==timelineRevision.get()&&s.selectedSession==id
        mutable.update{if(current(it))it.copy(timelineHistory=existing.copy(loading=true,error=null))else it}
        timelineJob=scope.launch{
            try{
                val loaded=if(older)historyPageLoaded(existing,readUpstreamHistory(id,target,"desc"),true)
                    else refreshTimelineHistory(existing){cursor->readUpstreamHistory(id,cursor,"desc")}
                mutable.update{if(current(it))it.copy(timelineHistory=loaded)else it}
            }catch(e:CancellationException){throw e}catch(e:Exception){mutable.update{if(current(it))it.copy(timelineHistory=existing.copy(loading=false,error=errorMessage(e)))else it}}
        }
    }}
    private fun turnPayload(id:String,text:String,mode:String,attachments:List<ChatAttachment>,skills:List<ComposerSkill> = emptyList())=buildJsonObject{if(skills.isNotEmpty()){require(mutable.value.capabilities?.supports("composerSkills")==true){"电脑尚不支持技能引用"};put("skills",buildJsonArray{skills.forEach{add(JsonPrimitive(it.id))}})};put("mode",mode);put("attachments",buildJsonArray{attachments.forEach{file->add(buildJsonObject{put("name",file.name);put("data",file.data)})}});put("sessionId",id);put("text",text);put("permissionMode",if(mutable.value.fullAccess)"full" else "workspace");mutable.value.selectedModel.takeIf{it.isNotBlank()}?.let{put("model",it);mutable.value.selectedEffort.takeIf{it.isNotBlank()}?.let{effort->put("effort",effort)}}}
    private suspend fun loadModels(){
        val epoch=hostEpoch
        try{val list=rpc().request("models.list")["models"]?.jsonArray?.map{wire.decodeFromJsonElement(CodexModel.serializer(),it)}?:emptyList();mutable.update{if(epoch==hostEpoch)it.copy(models=list)else it}}
        catch(e:CancellationException){throw e}catch(_:Exception){mutable.update{if(epoch==hostEpoch)it.copy(models=emptyList())else it}}
    }
    fun refreshModels(){action{loadModels();if(mutable.value.models.isEmpty())error("模型列表暂不可用，请更新并连接 Windows Bridge")}}
    fun selectModel(model:CodexModel){mutable.update{it.copy(selectedModel=model.model,selectedEffort=model.defaultReasoningEffort)}}
    fun setFullAccess(enabled:Boolean){navigation.edit().putBoolean("fullAccess",enabled).apply();mutable.update{it.copy(fullAccess=enabled)}}
    fun selectEffort(effort:String){val model=mutable.value.models.find{it.model==mutable.value.selectedModel}?:mutable.value.models.firstOrNull{it.isDefault};require(effort.isEmpty()||model?.supportedReasoningEfforts?.any{it.reasoningEffort==effort}==true);mutable.update{it.copy(selectedModel=model?.model?:it.selectedModel,selectedEffort=effort)}}
    internal suspend fun readSkillCatalog(projectId:String):JsonObject {
        val epoch=hostEpoch
        val connection=rpc()
        require(mutable.value.capabilities?.supports("projectSkillCatalog")==true){"电脑尚不支持技能目录"}
        val result=connection.request("skills.catalog",payload("projectId" to projectId))
        require(epoch==hostEpoch&&connection===transport){"电脑连接已切换"}
        require((result["projectId"] as? JsonPrimitive)?.contentOrNull==projectId){"技能目录项目身份不匹配"}
        return result
    }
    internal suspend fun listProjectFiles(projectId:String,directory:String):JsonObject {
        val epoch=hostEpoch;val connection=rpc()
        require(mutable.value.capabilities?.supports("projectFileBrowser")==true){"电脑尚不支持项目文件浏览"}
        val result=connection.request("files.list",payload("projectId" to projectId,"directory" to directory))
        require(epoch==hostEpoch&&connection===transport){"电脑连接已切换"}
        require(result["projectId"]?.jsonPrimitive?.content==projectId&&result["directory"]?.jsonPrimitive?.content==directory){"文件目录来源不匹配"}
        return result
    }
    internal suspend fun readProjectText(projectId:String,path:String):JsonObject {
        val epoch=hostEpoch;val connection=rpc()
        require(mutable.value.capabilities?.supports("projectTextPreview")==true){"电脑尚不支持文件正文预览"}
        val result=connection.request("files.readText",payload("projectId" to projectId,"path" to path))
        require(epoch==hostEpoch&&connection===transport){"电脑连接已切换"}
        require(result["projectId"]?.jsonPrimitive?.content==projectId&&result["path"]?.jsonPrimitive?.content==path){"文件来源身份不匹配"}
        require(result["text"]?.jsonPrimitive?.content?.toByteArray(Charsets.UTF_8)?.size?:Int.MAX_VALUE<=256*1024){"文件预览超过限制"}
        return result
    }
    internal suspend fun projectFileReference(projectId:String,path:String):String {
        val epoch=hostEpoch;val connection=rpc()
        require(mutable.value.capabilities?.supports("projectFileReference")==true){"电脑尚不支持文件引用"}
        val result=connection.request("files.reference",payload("projectId" to projectId,"path" to path))
        require(epoch==hostEpoch&&connection===transport){"电脑连接已切换"}
        require(result["projectId"]?.jsonPrimitive?.content==projectId&&result["path"]?.jsonPrimitive?.content==path){"文件引用来源不匹配"}
        return result["referenceText"]?.jsonPrimitive?.content?.takeIf{it.isNotBlank()&&it.length<=16000}?:error("文件引用无效")
    }
    internal suspend fun nativeQueue(sessionId:String,operation:String,extra:JsonObject=JsonObject(emptyMap())):JsonObject{
        require(operation in listOf("list","add","update","delete","reorder","start"))
        require(mutable.value.capabilities?.supports("nativeQueue")==true){"电脑端尚不支持原生队列"}
        require(operation!="start"||mutable.value.capabilities?.supports("nativeQueueStart")==true){"电脑端尚不支持启动队列消息"}
        val epoch=hostEpoch;val connection=rpc()
        val native=mutable.value.snapshot.sessions.find{it.sessionId==sessionId}?.upstreamThreadId?:error("会话已移除")
        val result=connection.request("queue.$operation",JsonObject(extra+mapOf("sessionId" to JsonPrimitive(sessionId))))
        require(epoch==hostEpoch&&connection===transport&&!mutable.value.stale){"连接已变更，请刷新队列核实结果"}
        require(result["sessionId"]?.jsonPrimitive?.content==sessionId&&result["upstreamThreadId"]?.jsonPrimitive?.content==native){"队列来源身份不匹配，请勿重复操作"}
        return result
    }
    internal fun enqueueTask(text:String,attachments:List<ChatAttachment> = emptyList(),skills:List<ComposerSkill> = emptyList(),onAccepted:()->Unit={}){val id=mutable.value.selectedSession?:return;action{
        require(attachments.isEmpty()||mutable.value.capabilities?.supports("nativeQueueAttachments")==true){"电脑端尚不支持队列附件"}
        require(skills.isEmpty()||mutable.value.capabilities?.supports("nativeQueueSkills")==true){"电脑端尚不支持队列技能"}
        nativeQueue(id,"add",buildJsonObject{put("text",text);if(skills.isNotEmpty())put("skills",buildJsonArray{skills.forEach{add(JsonPrimitive(it.id))}});if(attachments.isNotEmpty())put("attachments",buildJsonArray{attachments.forEach{file->add(buildJsonObject{put("name",file.name);put("data",file.data)})}})})
        withContext(Dispatchers.Main){onAccepted()};refreshSnapshot()
    }}
    internal fun reviseTurn(session:Session,beforeTurnId:String,expectedLastTurnId:String,text:String,sourceItemId:String?=null,onProgress:(HistoryRevisionPhase)->Unit={},onAccepted:()->Unit={}){action{
        var sendConfirmed=false
        try{
        require(text.isNotBlank()){"请输入消息"}
        require(mutable.value.capabilities?.supports("sessionHistoryRevert")==true){"电脑尚不支持历史回退"}
        val epoch=hostEpoch
        val connection=rpc()
        val options=turnPayload(session.sessionId,text,session.mode,emptyList())
        fun checkSource(){val current=mutable.value.snapshot.sessions.find{it.sessionId==session.sessionId};require(epoch==hostEpoch&&connection===transport&&current?.upstreamThreadId==session.upstreamThreadId&&current?.projectId==session.projectId){"电脑或会话身份已变化"}}
        checkSource()
        withContext(Dispatchers.Main){onProgress(HistoryRevisionPhase.Reverting)}
        if(sourceItemId!=null){
            require(mutable.value.capabilities?.supports("sessionResourceRevision")==true){"电脑尚不支持资源修订"}
            val payload=JsonObject(options.filterKeys{it!="attachments"}+buildJsonObject{put("beforeTurnId",beforeTurnId);put("expectedLastTurnId",expectedLastTurnId);put("itemId",sourceItemId)})
            val result=connection.request("sessions.revise",payload)
            require(result["sessionId"]?.jsonPrimitive?.content==session.sessionId&&result["upstreamThreadId"]?.jsonPrimitive?.content==session.upstreamThreadId){"修订结果身份不匹配，请刷新核对"}
            sendConfirmed=true
            withContext(Dispatchers.Main){onProgress(HistoryRevisionPhase.Accepted);onAccepted()}
            refreshSnapshot();if(mutable.value.selectedSession==session.sessionId)refreshSession(session.sessionId)
            return@action
        }
        connection.request("sessions.revert",buildJsonObject{put("sessionId",session.sessionId);put("beforeTurnId",beforeTurnId);put("expectedLastTurnId",expectedLastTurnId)})
        withContext(Dispatchers.Main){onProgress(HistoryRevisionPhase.Reverted)}
        checkSource()
        cancelTimelineRequests()
        cacheMutex.withLock{historyRevision.incrementAndGet();mutable.value.host?.let{dao.removeSession(it.hostId,session.sessionId)}}
        mutable.update{if(it.selectedSession==session.sessionId)it.copy(historyGeneration=historyRevision.get(),events=emptyList(),timelineHistory=TimelineHistory(sessionId=session.sessionId))else it}
        withContext(Dispatchers.Main){onProgress(HistoryRevisionPhase.Sending)}
        try{connection.request("turn.start",options)}catch(e:CancellationException){throw e}catch(e:Exception){scheduleTimelineHistory();throw IllegalStateException("历史已回退，重新发送未获确认；请刷新核对，勿重复执行。 "+errorMessage(e))}
        sendConfirmed=true
        withContext(Dispatchers.Main){onProgress(HistoryRevisionPhase.Accepted);onAccepted()}
        refreshSnapshot();if(mutable.value.selectedSession==session.sessionId)refreshSession(session.sessionId)
        }catch(e:Exception){if(!sendConfirmed)withContext(NonCancellable+Dispatchers.Main){onProgress(HistoryRevisionPhase.Uncertain)};throw e}
    }}
    internal suspend fun resumeSessionGoal(session:Session,revision:String):JsonObject{
        require(mutable.value.capabilities?.supports("sessionGoalResume")==true){"电脑尚不支持恢复目标"}
        val epoch=hostEpoch;val connection=rpc()
        val response=connection.request("sessions.goal.resume",buildJsonObject{put("sessionId",session.sessionId);put("expectedGoalRevision",revision)})
        require(epoch==hostEpoch&&connection===transport&&response["sessionId"]?.jsonPrimitive?.content==session.sessionId&&response["upstreamTurnId"]?.jsonPrimitive?.contentOrNull?.isNotBlank()==true){"目标恢复结果来源已变化，请刷新核对，勿重复执行"}
        scheduleSnapshot(connection)
        return response
    }
    internal suspend fun clearSessionGoal(session:Session,revision:String):JsonObject{
        require(mutable.value.capabilities?.supports("sessionGoalClear")==true){"电脑尚不支持删除目标"}
        val epoch=hostEpoch;val connection=rpc()
        val response=connection.request("sessions.goal.clear",buildJsonObject{put("sessionId",session.sessionId);put("expectedGoalRevision",revision)})
        require(epoch==hostEpoch&&connection===transport&&response["sessionId"]?.jsonPrimitive?.content==session.sessionId&&response["upstreamThreadId"]?.jsonPrimitive?.content==session.upstreamThreadId&&response["goal"]==JsonNull){"目标删除结果来源已变化，请刷新核对"}
        return response
    }
    internal suspend fun editSessionGoal(session:Session,objective:String,budget:Long?,revision:String):JsonObject{
        require(mutable.value.capabilities?.supports("sessionGoalEdit")==true){"电脑尚不支持目标编辑"}
        val epoch=hostEpoch;val connection=rpc()
        val response=connection.request("sessions.goal.edit",buildJsonObject{put("sessionId",session.sessionId);put("objective",objective);put("expectedGoalRevision",revision);budget?.let{put("tokenBudget",it)}})
        require(epoch==hostEpoch&&connection===transport&&response["sessionId"]?.jsonPrimitive?.content==session.sessionId&&response["upstreamThreadId"]?.jsonPrimitive?.content==session.upstreamThreadId){"目标修改结果来源已变化，请刷新核对"}
        return response
    }
    internal suspend fun compactSession(session:Session,lastTurnId:String):JsonObject{
        require(mutable.value.capabilities?.supports("sessionCompaction")==true){"电脑尚不支持压缩上下文"}
        val epoch=hostEpoch;val connection=rpc()
        val result=connection.request("sessions.compact",buildJsonObject{put("sessionId",session.sessionId);put("expectedLastTurnId",lastTurnId)})
        require(epoch==hostEpoch&&connection===transport&&result["sessionId"]?.jsonPrimitive?.content==session.sessionId&&result["upstreamThreadId"]?.jsonPrimitive?.content==session.upstreamThreadId&&result["accepted"]?.jsonPrimitive?.booleanOrNull==true&&result["completed"]?.jsonPrimitive?.booleanOrNull==false){"压缩受理结果未确认，请核对，不要重复操作"}
        scheduleSnapshot(connection)
        return result
    }
    internal suspend fun readLatestSessionTurn(session:Session):LatestTurn{
        require(mutable.value.capabilities?.supports("latestUpstreamTurn")==true){"电脑尚不支持原生状态读取"}
        val epoch=hostEpoch;val connection=rpc()
        val result=connection.request("turn.latest",buildJsonObject{put("sessionId",session.sessionId);put("contractVersion",1)})
        val now=mutable.value
        val current=now.snapshot.sessions.find{it.sessionId==session.sessionId}
        require(epoch==hostEpoch&&connection===transport&&!now.stale&&current?.upstreamThreadId==session.upstreamThreadId&&current?.projectId==session.projectId&&now.snapshot.projects.any{it.projectId==session.projectId&&it.enabled}){"状态来源已变化，请重新打开"}
        return decodeLatestTurn(result,session)
    }
    internal suspend fun readSessionGoal(session:Session):JsonObject{
        require(mutable.value.capabilities?.supports("sessionGoalView")==true){"电脑尚不支持目标详情"}
        val epoch=hostEpoch;val connection=rpc()
        val result=connection.request("sessions.goal",payload("sessionId" to session.sessionId))
        require(epoch==hostEpoch&&connection===transport&&result["sessionId"]?.jsonPrimitive?.content==session.sessionId&&result["upstreamThreadId"]?.jsonPrimitive?.content==session.upstreamThreadId){"目标来源已变化，请刷新"}
        return result
    }
    fun forkSession(session:Session,lastTurnId:String?=null){action{
        check(mutable.value.capabilities?.supports("sessionFork")==true){"电脑尚不支持分叉会话"}
        check(lastTurnId==null||mutable.value.capabilities?.supports("sessionForkAtTurn")==true){"电脑尚不支持指定轮次分叉"}
        val response=rpc().request("sessions.fork",buildJsonObject{put("sessionId",session.sessionId);lastTurnId?.let{put("lastTurnId",it)}})
        val forked=wire.decodeFromJsonElement(Session.serializer(),response.getValue("session"))
        refreshSnapshot();selectSession(forked.sessionId)
    }}
    fun manageSession(session:Session,operation:String,title:String=""){require(operation in listOf("rename","archive","restore","delete","pin"));action{rpc().request("sessions.$operation",buildJsonObject{put("sessionId",session.sessionId);if(operation=="rename")put("title",title.trim());if(operation=="pin")put("pinned",session.pinned==0)});if(operation=="delete")mutable.value.host?.let{dao.removeSession(it.hostId,session.sessionId)};refreshSnapshot()}}
    fun olderEvents(){action{val id=mutable.value.selectedSession?:return@action;refreshSession(id,mutable.value.events.firstOrNull()?.eventId)}}
    internal fun newTask(text:String,mode:String="default",attachments:List<ChatAttachment> = emptyList(),onAccepted:()->Unit={},skills:List<ComposerSkill> = emptyList()){action{val project=mutable.value.selectedProject?:error("请先选择本机授权项目");val options=turnPayload("",text,mode,attachments,skills);val created=rpc().request("sessions.create",payload("projectId" to project,"title" to text.take(100)));val session=wire.decodeFromJsonElement(Session.serializer(),created.getValue("session"));refreshSnapshot();rpc().request("turn.start",JsonObject(options+mapOf("sessionId" to JsonPrimitive(session.sessionId))));refreshSnapshot();selectSession(session.sessionId);withContext(Dispatchers.Main){onAccepted()};refreshSnapshot()}}
    internal fun continueTask(text:String,mode:String="default",attachments:List<ChatAttachment> = emptyList(),onAccepted:()->Unit={},skills:List<ComposerSkill> = emptyList()){action{val id=mutable.value.selectedSession?:error("请选择会话");rpc().request("turn.start",turnPayload(id,text,mode,attachments,skills));withContext(Dispatchers.Main){onAccepted()};refreshSnapshot()}}
    fun steerTask(text:String,onAccepted:()->Unit={}){action{
        require(mutable.value.capabilities?.supports("activeTurnSteering")==true){"电脑端需要升级才能追加指令"}
        val id=mutable.value.selectedSession?:error("请选择会话")
        val connection=rpc()
        steerActiveTurn(id,text,{method,params->connection.request(method,params)},refresh={refreshSnapshot(connection)},onAccepted={withContext(Dispatchers.Main){onAccepted()}})
    }}
    fun interrupt(){action{
        val id=mutable.value.selectedSession?:return@action
        val turn=mutable.value.snapshot.turns.lastOrNull{it.sessionId==id&&it.status in listOf("running","waitingApproval","unknown")}
        val connection=rpc()
        if(turn!=null)connection.request("turn.interrupt",payload("sessionId" to id,"turnId" to turn.turnId))
        else {
            require(mutable.value.capabilities?.supports("activeTurnInterruption")==true){"电脑端需要升级才能停止外部任务"}
            val active=connection.request("turn.active",payload("sessionId" to id))
            require(active["sessionId"]?.jsonPrimitive?.content==id){"会话身份不匹配"}
            require(active.containsKey("upstreamTurnId")){"缺少活动轮次状态"}
            if(active["upstreamTurnId"]==JsonNull){refreshSnapshot(connection);return@action}
            val expected=(active["upstreamTurnId"] as? JsonPrimitive)?.contentOrNull?:error("活动轮次身份无效")
            val result=connection.request("turn.interruptActive",payload("sessionId" to id,"expectedTurnId" to expected))
            require(result["sessionId"]?.jsonPrimitive?.content==id&&result["upstreamTurnId"]?.jsonPrimitive?.content==expected&&result["requested"]?.jsonPrimitive?.booleanOrNull==true){"停止结果需要核实，请勿重复操作"}
        }
        refreshSnapshot()
    }}
    fun decide(approval:Approval,decision:String){action{require(Instant.parse(approval.expiresAt).isAfter(Instant.now())){"审批已过期"};rpc().request("approvals.decide",payload("sessionId" to approval.sessionId,"turnId" to approval.turnId,"approvalId" to approval.approvalId,"decision" to decision));refreshSnapshot()}}
    fun answerQuestions(approval:Approval,answers:Map<String,String>){action{rpc().request("approvals.decide",buildJsonObject{
        put("sessionId",approval.sessionId);put("turnId",approval.turnId);put("approvalId",approval.approvalId);put("decision","approve")
        put("answers",buildJsonObject{answers.forEach{(id,value)->put(id,buildJsonObject{put("answers",buildJsonArray{add(value)})})}})
    });refreshSnapshot()}}
    fun addProject(){action{rpc().request("projects.add");mutable.update{it.copy(error="请在 Windows 管理窗选择并确认目录")}}}
    fun refresh(){action{if(mutable.value.capabilities?.supports("threadIndexRefresh")==true)refreshNativeProjectSessions() else refreshSnapshot();mutable.value.selectedSession?.let{refreshSession(it)}}}
    fun refreshGit(){val epoch=hostEpoch;scope.launch{try{if(epoch!=hostEpoch)return@launch;val id=mutable.value.selectedProject?:return@launch;val git=wire.decodeFromJsonElement(GitStatus.serializer(),rpc().request("git.status",payload("projectId" to id)));mutable.update{if(epoch==hostEpoch&&it.selectedProject==id)it.copy(git=git)else it}}catch(e:CancellationException){throw e}catch(e:Exception){mutable.update{if(epoch==hostEpoch)it.copy(error=errorMessage(e))else it}}}}
    fun selectFile(file:GitFile){action{val id=mutable.value.selectedProject?:return@action;val hostId=mutable.value.host?.hostId;val diff=wire.decodeFromJsonElement(Diff.serializer(),rpc().request("git.diff",payload("projectId" to id,"fileId" to file.fileId)));mutable.update{if(it.selectedProject==id&&it.host?.hostId==hostId)it.copy(diff=diff)else it}}}
    fun forgetHost(){action{
        val host=mutable.value.host?:return@action
        var revoked=false
        try{if(!mutable.value.stale){rpc().request("devices.revokeSelf");revoked=true}}
        catch(e:CancellationException){throw e}catch(_:Exception){}
        val remaining=vault.readBook().removed(host.hostId);vault.saveBook(remaining)
        activateBook(remaining)
        withContext(Dispatchers.Main){composerDrafts.forget(host.hostId);conversationViewports.forget(host.hostId);workspaceNavigation.forget(host.hostId)}
        dao.removeHost(host.hostId);dao.removeEvents(host.hostId)
        navigation.edit().remove("${host.hostId}:session").apply()
        if(!revoked)mutable.update{it.copy(error="已从平板移除此电脑，请在该 Windows 电脑撤销设备凭据")}
    }}
    fun clearError(){mutable.update{it.copy(error=null)}}
    fun checkConnection(){if(!switchingHost)connections.check()}
    fun reconnect(){mutable.value.host?.let{connections.reconnect(it.hostId)}}
    fun setTheme(theme:String){require(theme in listOf("system","light","dark"));val next=mutable.value.preferences.copy(theme=theme);preferences.save(next);mutable.update{it.copy(preferences=next)}}
    fun setNotifications(enabled:Boolean){val permitted=enabled&&notifications.permitted();val next=mutable.value.preferences.copy(notifications=permitted);preferences.save(next);mutable.update{it.copy(preferences=next,error=if(enabled&&!permitted)"通知权限未授予，前台任务与审批仍可使用" else it.error)}}
    fun setBackgroundConnections(enabled:Boolean){
        val next=mutable.value.preferences.copy(backgroundConnections=enabled);preferences.save(next);mutable.update{it.copy(preferences=next)}
        if(enabled)startBackgroundConnectionsIfEnabled()else applicationContext.stopService(android.content.Intent(applicationContext,ConnectionService::class.java))
    }
    fun startBackgroundConnectionsIfEnabled(){if(mutable.value.preferences.backgroundConnections)try{
        androidx.core.content.ContextCompat.startForegroundService(applicationContext,android.content.Intent(applicationContext,ConnectionService::class.java))
    }catch(_:Exception){mutable.update{it.copy(error="系统暂时不允许保持后台连接，请回到应用后重试")}}}
    fun updateRetention(value:Retention){require(value.days in 1..365&&value.maxMiB in 16..1024);action{val result=rpc().request("settings.update",buildJsonObject{put("days",value.days);put("maxMiB",value.maxMiB)});mutable.update{it.copy(retention=wire.decodeFromJsonElement(Retention.serializer(),result.getValue("retention")))}}}
    fun fetchDiagnostics(){action{val result=rpc().request("system.diagnostics");mutable.update{it.copy(diagnostics=result)}}}
    fun setDisplayMask(value:String){require(value.isEmpty()||value.length in 3..256);mutable.update{it.copy(displayMask=value)}}
    fun showMessage(message:String){mutable.update{it.copy(error=userFacingError(raw=message))}}
}
