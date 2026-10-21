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
import kotlin.math.min
import kotlin.random.Random

class DeckApplication:Application(){
    var foreground=false;private set
    val apiRepository:ApiRepository by lazy{ApiRepository(this)}
    val repository:DeckRepository by lazy{DeckRepository(this)}
    override fun onCreate(){super.onCreate();registerActivityLifecycleCallbacks(object:ActivityLifecycleCallbacks{
        override fun onActivityResumed(activity:android.app.Activity){foreground=true}
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
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private val navigation=context.getSharedPreferences("agentdeck_navigation",Context.MODE_PRIVATE)
    private var restoreNavigation=true
    private val vault=Vault(context)
    private val db=Room.databaseBuilder(context,DeckDatabase::class.java,"agentdeck-cache.db").build()
    private val dao=db.cache()
    private val preferences=PreferenceStore(context)
    private val notifications=DeckNotifications(context.applicationContext as DeckApplication)
    private val mutable=MutableStateFlow(DeckState(preferences=preferences.read(),fullAccess=navigation.getBoolean("fullAccess",true)))
    val state:StateFlow<DeckState> = mutable.asStateFlow()
    private var connectionJob:Job?=null
    private var selectionJob:Job?=null
    private var pairingJob:Job?=null
    private var pairGeneration=0L
    private var credentialsUnreadable=false
    private var snapshotJob:Job?=null
    private var transport:DeckTransport?=null
    private var cursor="0"
    private val cacheMutex=Mutex()
    private val actionMutex=Mutex()
    private val connectionMutex=Mutex()
    @Volatile private var switchingHost=false
    @Volatile private var hostEpoch=0L
    private val connectivity=context.getSystemService(ConnectivityManager::class.java)
    private val callback=object:ConnectivityManager.NetworkCallback(){override fun onAvailable(network:Network){val host=mutable.value.host;if(host!=null&&mutable.value.connection!="已连接")startConnection(host)}}
    init {
        connectivity.registerDefaultNetworkCallback(callback)
        scope.launch{actionMutex.withLock{
            val book=try{vault.readBook()}catch(e:CancellationException){throw e}catch(_:Exception){credentialsUnreadable=true;mutable.update{it.copy(error="已保存的电脑凭据无法读取，请重新配对所需电脑",connection="需要重新配对")};return@withLock}
            try{activateBook(book)}catch(e:CancellationException){throw e}catch(e:Exception){mutable.update{it.copy(error=errorMessage(e))}}
        }}
    }
    private fun startConnection(host:Host){synchronized(this){if(switchingHost||mutable.value.host!=host)return;connectionJob?.cancel();transport?.close();connectionJob=scope.launch{connectionMutex.withLock{
        var attempt=0
        while(isActive){
            val current=DeckTransport(host);transport=current
            try{
                mutable.update{it.copy(connection=if(attempt==0)"正在连接" else "重新连接中",stale=true)}
                current.connect();current.request("system.hello",buildJsonObject{put("client","AgentDeck Android/${BuildConfig.VERSION_NAME}");put("version",1)})
                val capabilities=wire.decodeFromJsonElement(BridgeCapabilities.serializer(),current.request("system.capabilities"))
                if(capabilities.protocolVersion!=1)throw DeckException("PROTOCOL_VERSION","电脑端协议不兼容，请更新客户端")
                mutable.update{it.copy(capabilities=capabilities)}
                val cache=dao.host(host.hostId)
                if(cache==null){val snap=current.request("snapshot.get");val snapshot=wire.decodeFromJsonElement(Snapshot.serializer(),snap);cursor=snapshot.cursor;updateSnapshot(snapshot)}
                else {cursor=cache.cursor;try{replay(current)}catch(e:DeckException){if(e.code!="REPLAY_GAP")throw e;val snapshot=wire.decodeFromJsonElement(Snapshot.serializer(),current.request("snapshot.get"));cursor=snapshot.cursor;updateSnapshot(snapshot);mutable.update{it.copy(error="部分历史已过保留期，已恢复可信快照")}};refreshSnapshot(current)}
                val retention=wire.decodeFromJsonElement(Retention.serializer(),current.request("settings.get").getValue("retention"))
                mutable.update{it.copy(connection="已连接",stale=false,retention=retention)};attempt=0
                loadModels()
                restoreLastSession(mutable.value.snapshot)
                mutable.value.selectedSession?.let{refreshSession(it)}
                for(packet in current.events){val event=wire.decodeFromJsonElement(DeckEvent.serializer(),packet);val id=event.eventId.toLong();if(id<=cursor.toLong())continue;if(id>cursor.toLong()+1)replay(current);if(id>cursor.toLong()){applyEvent(event);notifications.publish(event,mutable.value.preferences.notifications)};scheduleSnapshot(current)}
                throw java.io.IOException("Bridge 连接已结束")
            }catch(e:CancellationException){throw e}catch(e:Exception){mutable.update{it.copy(connection="重新连接中",stale=true,error=errorMessage(e))};attempt++;delay(min(30000L,500L*(1L shl min(attempt,6)))+Random.nextLong(250))}
            finally{current.close()}
        }
    }}}}
    // Called under actionMutex: complete/cancel old work before publishing the new host.
    private suspend fun activateBook(book:HostBook){
        synchronized(this){switchingHost=true;hostEpoch++;connectionJob?.cancel();transport?.close()}
        try{
            connectionJob?.cancelAndJoin();connectionMutex.withLock{};snapshotJob?.cancelAndJoin();selectionJob?.cancelAndJoin()
            connectionJob=null;snapshotJob=null;selectionJob=null;transport=null
            cacheMutex.withLock{cursor="0";restoreNavigation=true;mutable.value=mutable.value.forHost(book)}
            book.active?.let{host->
                dao.host(host.hostId)?.let{cached->
                    try{val snapshot=wire.decodeFromString(Snapshot.serializer(),cached.snapshot);require(snapshot.host?.hostId==host.hostId);cursor=cached.cursor;mutable.update{it.copy(snapshot=snapshot,selectedProject=snapshot.projects.firstOrNull()?.projectId,lastSynced=cached.syncedAt)}}
                    catch(e:CancellationException){throw e}catch(_:Exception){dao.removeHost(host.hostId)}
                }
                restoreLastSession(mutable.value.snapshot)
            }
        }finally{synchronized(this){switchingHost=false}}
        book.active?.let{startConnection(it)}
    }
    fun selectHost(id:String){action{val book=vault.readBook();if(book.active?.hostId!=id){val next=book.selected(id);vault.saveBook(next);activateBook(next)}}}
    fun renameHost(id:String,name:String){action{val book=vault.readBook().renamed(id,name);vault.saveBook(book);mutable.update{it.copy(hosts=book.hosts,host=book.active)}}}
    private fun errorMessage(e:Throwable):String=when(e){is DeckException->userFacingError(e.code,e.message);is java.security.cert.CertificateException,is javax.net.ssl.SSLPeerUnverifiedException,is javax.net.ssl.SSLHandshakeException->userFacingError("TLS",e.message);is TimeoutCancellationException->userFacingError("TIMEOUT",e.message);is java.io.IOException->userFacingError("NETWORK",e.message);else->userFacingError(null,e.message)}
    private suspend fun replay(current:DeckTransport){do{val result=current.request("events.replay",buildJsonObject{put("cursor",cursor);put("limit",500)});val events=result["events"]?.jsonArray?:JsonArray(emptyList());for(element in events){val event=wire.decodeFromJsonElement(DeckEvent.serializer(),element);if(event.eventId.toLong()>cursor.toLong())applyEvent(event)};val more=result["more"]?.jsonPrimitive?.boolean==true}while(more)}
    private suspend fun applyEvent(event:DeckEvent){cacheMutex.withLock{val host=mutable.value.host?:return;val id=event.eventId.toLong();if(id<=cursor.toLong())return;db.withTransaction{dao.saveEvents(listOf(CachedEvent(host.hostId,id,event.sessionId,wire.encodeToString(DeckEvent.serializer(),event))));cursor=event.eventId;dao.saveHost(CachedHost(host.hostId,wire.encodeToString(Snapshot.serializer(),mutable.value.snapshot),cursor,Instant.now().toString()))};if(id%100L==0L)dao.trim(host.hostId)};if(event.action=="git.changed"&&mutable.value.git!=null)refreshGit()}
    private suspend fun updateSnapshot(snapshot:Snapshot){cacheMutex.withLock{
        val host=mutable.value.host?:return
        require(snapshot.host?.hostId==host.hostId){"Bridge identity mismatch"}
        val removed=mutable.value.snapshot.sessions.filter{old->snapshot.sessions.none{it.sessionId==old.sessionId}}
        val at=Instant.now().toString()
        db.withTransaction{
            removed.forEach{dao.removeSession(host.hostId,it.sessionId)}
            dao.saveHost(CachedHost(host.hostId,wire.encodeToString(Snapshot.serializer(),snapshot),cursor,at))
        }
        val selected=mutable.value.selectedSession
        if(selected!=null&&snapshot.sessions.none{it.sessionId==selected})selectionJob?.cancel()
        mutable.update{old->val vanished=old.selectedSession!=null&&snapshot.sessions.none{it.sessionId==old.selectedSession};old.copy(snapshot=snapshot,lastSynced=at,selectedSession=if(vanished)null else old.selectedSession,events=if(vanished)emptyList() else old.events,selectedProject=old.selectedProject?.takeIf{id->snapshot.projects.any{it.projectId==id}}?:snapshot.projects.firstOrNull()?.projectId)}
    }}
    private fun restoreLastSession(snapshot:Snapshot){
        if(!restoreNavigation||snapshot.sessions.isEmpty())return
        restoreNavigation=false
        val remembered=navigation.getString("${mutable.value.host?.hostId}:session",null)
        val latest=snapshot.sessions.find{it.sessionId==remembered&&it.archived==0}?:snapshot.sessions.filter{it.archived==0}.maxByOrNull{it.updatedAt}
        latest?.let{selectSession(it.sessionId)}
    }
    private suspend fun refreshSnapshot(current:DeckTransport?=transport){val connection=current?:return;updateSnapshot(wire.decodeFromJsonElement(Snapshot.serializer(),connection.request("snapshot.get")));restoreLastSession(mutable.value.snapshot)}
    private fun scheduleSnapshot(current:DeckTransport){if(snapshotJob?.isActive==true)return;snapshotJob=scope.launch{delay(250);try{refreshSnapshot(current)}catch(_:Exception){}}}
    private fun rpc():DeckTransport {check(mutable.value.connection=="已连接"&&!mutable.value.stale){"离线时不能执行操作"};return transport?:error("Bridge 未连接")}
    private fun action(block:suspend()->Unit){val epoch=hostEpoch;scope.launch{if(!actionMutex.tryLock())return@launch;if(epoch!=hostEpoch){actionMutex.unlock();return@launch};mutable.update{it.copy(busy=true,error=null)};try{block()}catch(e:Exception){mutable.update{it.copy(error=errorMessage(e))}}finally{mutable.update{it.copy(busy=false)};actionMutex.unlock()}}}
    fun beginPair(raw:String){val generation=++pairGeneration;pairingJob?.cancel();pairingJob=scope.launch{mutable.update{it.copy(busy=true,error=null)};var client:okhttp3.OkHttpClient?=null;try{
        val qr=wire.decodeFromString(PairQr.serializer(),raw).validated();client=pinnedClient(qr.fingerprint)
        val nonce=ByteArray(32).also{SecureRandom().nextBytes(it)};val result=post(client,qr.endpoint.trimEnd('/')+"/api/v1/pair/request",buildJsonObject{put("token",qr.token);put("displayName","${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".take(80));put("nonce",Base64.encodeToString(nonce,Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP))})
        val requestId=result.getValue("requestId").jsonPrimitive.content;val claim=result.getValue("claimToken").jsonPrimitive.content
        mutable.update{it.copy(pairingCode=result.getValue("code").jsonPrimitive.content,pairingName=qr.endpoint)}
        var host:Host?=null
        while(Instant.now().isBefore(Instant.parse(qr.expiresAt))){val claimed=post(client,qr.endpoint.trimEnd('/')+"/api/v1/pair/claim",payload("requestId" to requestId,"claimToken" to claim));when(claimed["status"]?.jsonPrimitive?.content){"approved"->{host=Host(qr.endpoint.trimEnd('/'),qr.fingerprint,qr.hostId,claimed.getValue("deviceId").jsonPrimitive.content,claimed.getValue("credential").jsonPrimitive.content);break};"rejected"->throw DeckException("PAIRING_REJECTED","Windows 已拒绝此设备")};delay(1200)}
        val pairedHost=requireNotNull(host){"配对已过期，请重新生成二维码"};require(Regex("[A-Za-z0-9_-]{43}").matches(pairedHost.credential)){"设备凭据无效"};actionMutex.withLock{ensureActive();withContext(NonCancellable){val book=(if(credentialsUnreadable)HostBook()else vault.readBook()).paired(pairedHost);vault.saveBook(book);credentialsUnreadable=false;activateBook(book)}}
    }catch(e:CancellationException){throw e}catch(e:Exception){if(generation==pairGeneration)mutable.update{it.copy(error=errorMessage(e),pairingCode=null)}}finally{client?.dispatcher?.executorService?.shutdown();client?.connectionPool?.evictAll();if(generation==pairGeneration)mutable.update{it.copy(busy=false)}}}}
    fun cancelPair(){pairGeneration++;pairingJob?.cancel();mutable.update{it.copy(pairingCode=null,pairingName=null,busy=false)}}
    fun selectProject(id:String){restoreNavigation=false;selectionJob?.cancel();navigation.edit().remove("${mutable.value.host?.hostId}:session").apply();mutable.update{it.copy(selectedProject=id,selectedSession=null,events=emptyList(),git=null,diff=null)}}
    fun selectSession(id:String){val host=mutable.value.host?:return;restoreNavigation=false;navigation.edit().putString("${host.hostId}:session",id).apply();val session=mutable.value.snapshot.sessions.find{it.sessionId==id}?:return;mutable.update{it.copy(selectedSession=id,selectedModel=session.model,selectedEffort=session.effort,selectedProject=session.projectId,events=emptyList(),git=if(it.selectedProject==session.projectId)it.git else null,diff=if(it.selectedProject==session.projectId)it.diff else null)};selectionJob?.cancel();selectionJob=scope.launch{launch{try{if(!mutable.value.stale)refreshSession(id)}catch(e:Exception){mutable.update{it.copy(error=errorMessage(e))}}};dao.events(host.hostId,id).collect{rows->val events=rows.asReversed().mapNotNull{runCatching{wire.decodeFromString(DeckEvent.serializer(),it.json)}.getOrNull()};mutable.update{if(it.host?.hostId==host.hostId&&it.selectedSession==id)it.copy(events=events)else it}}}}
    private suspend fun refreshSession(id:String,before:String?=null){val host=mutable.value.host?:return;val result=rpc().request("sessions.detail",buildJsonObject{put("sessionId",id);put("limit",500);if(before!=null)put("before",before)});val events=result["events"]?.jsonArray?.map{wire.decodeFromJsonElement(DeckEvent.serializer(),it)}?:emptyList();dao.saveEvents(events.map{CachedEvent(host.hostId,it.eventId.toLong(),it.sessionId,wire.encodeToString(DeckEvent.serializer(),it))})}
    internal suspend fun readUpstreamHistory(id:String,cursor:String?):UpstreamHistoryPage {
        val epoch=hostEpoch
        require(mutable.value.capabilities?.supports("upstreamHistoryPages")==true){"电脑端需要升级才能读取已保存历史"}
        val connection=rpc()
        fun params()=buildJsonObject{put("sessionId",id);cursor?.let{put("cursor",it)}}
        val result=connection.request("sessions.history",params())
        require(result["sessionId"]?.jsonPrimitive?.content==id){"会话身份不匹配"}
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
                val chunk=connection.request("sessions.historyContent",buildJsonObject{put("sessionId",id);cursor?.let{put("cursor",it)};put("sha256",hash);put("offset",offset)})
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
        return UpstreamHistoryPage(entries,(result["nextCursor"] as? JsonPrimitive)?.contentOrNull)
    }
    private fun turnPayload(id:String,text:String,mode:String,attachments:List<ChatAttachment>)=buildJsonObject{put("mode",mode);put("attachments",buildJsonArray{attachments.forEach{file->add(buildJsonObject{put("name",file.name);put("data",file.data)})}});put("sessionId",id);put("text",text);put("permissionMode",if(mutable.value.fullAccess)"full" else "workspace");mutable.value.selectedModel.takeIf{it.isNotBlank()}?.let{put("model",it);mutable.value.selectedEffort.takeIf{it.isNotBlank()}?.let{effort->put("effort",effort)}}}
    private suspend fun loadModels(){try{val list=rpc().request("models.list")["models"]?.jsonArray?.map{wire.decodeFromJsonElement(CodexModel.serializer(),it)}?:emptyList();mutable.update{it.copy(models=list)}}catch(_:Exception){mutable.update{it.copy(models=emptyList())}}}
    fun refreshModels(){action{loadModels();if(mutable.value.models.isEmpty())error("模型列表暂不可用，请更新并连接 Windows Bridge")}}
    fun selectModel(model:CodexModel){mutable.update{it.copy(selectedModel=model.model,selectedEffort=model.defaultReasoningEffort)}}
    fun setFullAccess(enabled:Boolean){navigation.edit().putBoolean("fullAccess",enabled).apply();mutable.update{it.copy(fullAccess=enabled)}}
    fun selectEffort(effort:String){val model=mutable.value.models.find{it.model==mutable.value.selectedModel}?:mutable.value.models.firstOrNull{it.isDefault};require(effort.isEmpty()||model?.supportedReasoningEfforts?.any{it.reasoningEffort==effort}==true);mutable.update{it.copy(selectedModel=model?.model?:it.selectedModel,selectedEffort=effort)}}
    fun manageSession(session:Session,operation:String,title:String=""){require(operation in listOf("rename","archive","restore","delete","pin"));action{rpc().request("sessions.$operation",buildJsonObject{put("sessionId",session.sessionId);if(operation=="rename")put("title",title.trim());if(operation=="pin")put("pinned",session.pinned==0)});if(operation=="delete")mutable.value.host?.let{dao.removeSession(it.hostId,session.sessionId)};refreshSnapshot()}}
    fun olderEvents(){action{val id=mutable.value.selectedSession?:return@action;refreshSession(id,mutable.value.events.firstOrNull()?.eventId)}}
    fun newTask(text:String,mode:String="default",attachments:List<ChatAttachment> = emptyList(),onAccepted:()->Unit={}){action{val project=mutable.value.selectedProject?:error("请先选择本机授权项目");val options=turnPayload("",text,mode,attachments);val created=rpc().request("sessions.create",payload("projectId" to project,"title" to text.take(100)));val session=wire.decodeFromJsonElement(Session.serializer(),created.getValue("session"));refreshSnapshot();rpc().request("turn.start",JsonObject(options+mapOf("sessionId" to JsonPrimitive(session.sessionId))));refreshSnapshot();selectSession(session.sessionId);withContext(Dispatchers.Main){onAccepted()};refreshSnapshot()}}
    fun continueTask(text:String,mode:String="default",attachments:List<ChatAttachment> = emptyList(),onAccepted:()->Unit={}){action{val id=mutable.value.selectedSession?:error("请选择会话");rpc().request("turn.start",turnPayload(id,text,mode,attachments));withContext(Dispatchers.Main){onAccepted()};refreshSnapshot()}}
    fun steerTask(text:String,onAccepted:()->Unit={}){action{
        require(mutable.value.capabilities?.supports("activeTurnSteering")==true){"电脑端需要升级才能追加指令"}
        val id=mutable.value.selectedSession?:error("请选择会话")
        val connection=rpc()
        val active=connection.request("turn.active",payload("sessionId" to id))
        require(active["sessionId"]?.jsonPrimitive?.content==id){"会话身份不匹配"}
        val expected=(active["upstreamTurnId"] as? JsonPrimitive)?.contentOrNull?:error("当前任务已经结束，请刷新后发送新消息")
        val result=connection.request("turn.steer",payload("sessionId" to id,"expectedTurnId" to expected,"text" to text))
        require(result["sessionId"]?.jsonPrimitive?.content==id&&result["upstreamTurnId"]?.jsonPrimitive?.content==expected&&result["accepted"]?.jsonPrimitive?.booleanOrNull==true){"追加结果需要核实，请勿重复发送"}
        withContext(Dispatchers.Main){onAccepted()};refreshSnapshot()
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
            val expected=(active["upstreamTurnId"] as? JsonPrimitive)?.contentOrNull?:error("当前没有活动轮次，请刷新任务状态")
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
    fun refresh(){action{refreshSnapshot();mutable.value.selectedSession?.let{refreshSession(it)}}}
    fun refreshGit(){val epoch=hostEpoch;scope.launch{try{if(epoch!=hostEpoch)return@launch;val id=mutable.value.selectedProject?:return@launch;val git=wire.decodeFromJsonElement(GitStatus.serializer(),rpc().request("git.status",payload("projectId" to id)));mutable.update{if(epoch==hostEpoch&&it.selectedProject==id)it.copy(git=git)else it}}catch(e:CancellationException){throw e}catch(e:Exception){mutable.update{if(epoch==hostEpoch)it.copy(error=errorMessage(e))else it}}}}
    fun selectFile(file:GitFile){action{val id=mutable.value.selectedProject?:return@action;val hostId=mutable.value.host?.hostId;val diff=wire.decodeFromJsonElement(Diff.serializer(),rpc().request("git.diff",payload("projectId" to id,"fileId" to file.fileId)));mutable.update{if(it.selectedProject==id&&it.host?.hostId==hostId)it.copy(diff=diff)else it}}}
    fun forgetHost(){action{
        val host=mutable.value.host?:return@action
        var revoked=false
        try{if(!mutable.value.stale){rpc().request("devices.revokeSelf");revoked=true}}
        catch(e:CancellationException){throw e}catch(_:Exception){}
        val remaining=vault.readBook().removed(host.hostId);vault.saveBook(remaining)
        activateBook(remaining)
        dao.removeHost(host.hostId);dao.removeEvents(host.hostId)
        navigation.edit().remove("${host.hostId}:session").apply()
        if(!revoked)mutable.update{it.copy(error="已从平板移除此电脑，请在该 Windows 电脑撤销设备凭据")}
    }}
    fun clearError(){mutable.update{it.copy(error=null)}}
    fun reconnect(){mutable.value.host?.let{startConnection(it)}}
    fun setTheme(theme:String){require(theme in listOf("system","light","dark"));val next=mutable.value.preferences.copy(theme=theme);preferences.save(next);mutable.update{it.copy(preferences=next)}}
    fun setNotifications(enabled:Boolean){val permitted=enabled&&notifications.permitted();val next=mutable.value.preferences.copy(notifications=permitted);preferences.save(next);mutable.update{it.copy(preferences=next,error=if(enabled&&!permitted)"通知权限未授予，前台任务与审批仍可使用" else it.error)}}
    fun updateRetention(value:Retention){require(value.days in 1..365&&value.maxMiB in 16..1024);action{val result=rpc().request("settings.update",buildJsonObject{put("days",value.days);put("maxMiB",value.maxMiB)});mutable.update{it.copy(retention=wire.decodeFromJsonElement(Retention.serializer(),result.getValue("retention")))}}}
    fun fetchDiagnostics(){action{val result=rpc().request("system.diagnostics");mutable.update{it.copy(diagnostics=result)}}}
    fun setDisplayMask(value:String){require(value.isEmpty()||value.length in 3..256);mutable.update{it.copy(displayMask=value)}}
    fun showMessage(message:String){mutable.update{it.copy(error=userFacingError(raw=message))}}
}
