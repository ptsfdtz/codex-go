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
    private val mutable=MutableStateFlow(DeckState(preferences=preferences.read()))
    val state:StateFlow<DeckState> = mutable.asStateFlow()
    private var connectionJob:Job?=null
    private var selectionJob:Job?=null
    private var pairingJob:Job?=null
    private var snapshotJob:Job?=null
    private var transport:DeckTransport?=null
    private var cursor="0"
    private val cacheMutex=Mutex()
    private val actionMutex=Mutex()
    private val connectivity=context.getSystemService(ConnectivityManager::class.java)
    private val callback=object:ConnectivityManager.NetworkCallback(){override fun onAvailable(network:Network){val host=mutable.value.host;if(host!=null&&mutable.value.connection!="已连接")startConnection(host)}}
    init {
        connectivity.registerDefaultNetworkCallback(callback)
        scope.launch{try{val host=vault.read();if(host!=null){mutable.update{it.copy(host=host,connection="正在连接",stale=true)};dao.host(host.hostId)?.let{cached->cursor=cached.cursor;mutable.update{it.copy(snapshot=wire.decodeFromString(Snapshot.serializer(),cached.snapshot),lastSynced=cached.syncedAt)}};restoreLastSession(mutable.value.snapshot);startConnection(host)}}catch(e:Exception){mutable.update{it.copy(error="本机凭据不可读取，请重新配对",connection="需要重新配对")}}}
    }
    private fun startConnection(host:Host){synchronized(this){connectionJob?.cancel();transport?.close();connectionJob=scope.launch{
        var attempt=0
        while(isActive){
            val current=DeckTransport(host);transport=current
            try{
                mutable.update{it.copy(connection=if(attempt==0)"正在连接" else "重新连接中",stale=true)}
                current.connect();current.request("system.hello",buildJsonObject{put("client","AgentDeck Android/0.1.0");put("version",1)})
                val cache=dao.host(host.hostId)
                if(cache==null){val snap=current.request("snapshot.get");val snapshot=wire.decodeFromJsonElement(Snapshot.serializer(),snap);cursor=snapshot.cursor;updateSnapshot(snapshot)}
                else {cursor=cache.cursor;try{replay(current)}catch(e:DeckException){if(e.code!="REPLAY_GAP")throw e;val snapshot=wire.decodeFromJsonElement(Snapshot.serializer(),current.request("snapshot.get"));cursor=snapshot.cursor;updateSnapshot(snapshot);mutable.update{it.copy(error="部分历史已过保留期，已恢复可信快照")}};refreshSnapshot(current)}
                val retention=wire.decodeFromJsonElement(Retention.serializer(),current.request("settings.get").getValue("retention"))
                mutable.update{it.copy(connection="已连接",stale=false,retention=retention)};attempt=0
                restoreLastSession(mutable.value.snapshot)
                mutable.value.selectedSession?.let{refreshSession(it)}
                for(packet in current.events){val event=wire.decodeFromJsonElement(DeckEvent.serializer(),packet);val id=event.eventId.toLong();if(id<=cursor.toLong())continue;if(id>cursor.toLong()+1)replay(current);if(id>cursor.toLong()){applyEvent(event);notifications.publish(event,mutable.value.preferences.notifications)};scheduleSnapshot(current)}
                throw java.io.IOException("Bridge 连接已结束")
            }catch(e:CancellationException){throw e}catch(e:Exception){mutable.update{it.copy(connection="重新连接中",stale=true,busy=false,error=errorMessage(e))};attempt++;delay(min(30000L,500L*(1L shl min(attempt,6)))+Random.nextLong(250))}
            finally{current.close()}
        }
    }}}
    private fun errorMessage(e:Throwable):String=when(e){is DeckException->"${e.code}: ${e.message}";is java.security.cert.CertificateException,is javax.net.ssl.SSLPeerUnverifiedException,is javax.net.ssl.SSLHandshakeException->"证书校验失败。请在 Windows 核对指纹后重新配对。";is TimeoutCancellationException->"请求超时，操作结果可能未知，请先核对会话状态。";else->"连接暂不可用：${e.message?.take(180)?:"网络错误"}"}
    private suspend fun replay(current:DeckTransport){do{val result=current.request("events.replay",buildJsonObject{put("cursor",cursor);put("limit",500)});val events=result["events"]?.jsonArray?:JsonArray(emptyList());for(element in events){val event=wire.decodeFromJsonElement(DeckEvent.serializer(),element);if(event.eventId.toLong()>cursor.toLong())applyEvent(event)};val more=result["more"]?.jsonPrimitive?.boolean==true}while(more)}
    private suspend fun applyEvent(event:DeckEvent){cacheMutex.withLock{val host=mutable.value.host?:return;val id=event.eventId.toLong();if(id<=cursor.toLong())return;db.withTransaction{dao.saveEvents(listOf(CachedEvent(host.hostId,id,event.sessionId,wire.encodeToString(DeckEvent.serializer(),event))));cursor=event.eventId;dao.saveHost(CachedHost(host.hostId,wire.encodeToString(Snapshot.serializer(),mutable.value.snapshot),cursor,Instant.now().toString()))};if(id%100L==0L)dao.trim(host.hostId)};if(event.action=="git.changed"&&mutable.value.git!=null)refreshGit()}
    private suspend fun updateSnapshot(snapshot:Snapshot){cacheMutex.withLock{val host=mutable.value.host?:return;require(snapshot.host?.hostId==host.hostId){"Bridge identity mismatch"};val at=Instant.now().toString();dao.saveHost(CachedHost(host.hostId,wire.encodeToString(Snapshot.serializer(),snapshot),cursor,at));mutable.update{old->old.copy(snapshot=snapshot,lastSynced=at,selectedProject=old.selectedProject?.takeIf{id->snapshot.projects.any{it.projectId==id}}?:snapshot.projects.firstOrNull()?.projectId)}}}
    private fun restoreLastSession(snapshot:Snapshot){
        if(!restoreNavigation||snapshot.sessions.isEmpty())return
        restoreNavigation=false
        val remembered=navigation.getString("${mutable.value.host?.hostId}:session",null)
        val latest=snapshot.sessions.find{it.sessionId==remembered}?:snapshot.sessions.maxByOrNull{it.updatedAt}
        latest?.let{selectSession(it.sessionId)}
    }
    private suspend fun refreshSnapshot(current:DeckTransport?=transport){val connection=current?:return;updateSnapshot(wire.decodeFromJsonElement(Snapshot.serializer(),connection.request("snapshot.get")));restoreLastSession(mutable.value.snapshot)}
    private fun scheduleSnapshot(current:DeckTransport){if(snapshotJob?.isActive==true)return;snapshotJob=scope.launch{delay(250);try{refreshSnapshot(current)}catch(_:Exception){}}}
    private fun rpc():DeckTransport {check(mutable.value.connection=="已连接"&&!mutable.value.stale){"离线时不能执行操作"};return transport?:error("Bridge 未连接")}
    private fun action(block:suspend()->Unit){scope.launch{if(!actionMutex.tryLock())return@launch;mutable.update{it.copy(busy=true,error=null)};try{block()}catch(e:Exception){mutable.update{it.copy(error=errorMessage(e))}}finally{mutable.update{it.copy(busy=false)};actionMutex.unlock()}}}
    fun beginPair(raw:String){pairingJob?.cancel();pairingJob=scope.launch{mutable.update{it.copy(busy=true,error=null)};var client:okhttp3.OkHttpClient?=null;try{
        val qr=wire.decodeFromString(PairQr.serializer(),raw).validated();client=pinnedClient(qr.fingerprint)
        val nonce=ByteArray(32).also{SecureRandom().nextBytes(it)};val result=post(client,qr.endpoint.trimEnd('/')+"/api/v1/pair/request",buildJsonObject{put("token",qr.token);put("displayName","${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".take(80));put("nonce",Base64.encodeToString(nonce,Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP))})
        val requestId=result.getValue("requestId").jsonPrimitive.content;val claim=result.getValue("claimToken").jsonPrimitive.content
        mutable.update{it.copy(pairingCode=result.getValue("code").jsonPrimitive.content,pairingName=qr.endpoint)}
        var host:Host?=null
        while(Instant.now().isBefore(Instant.parse(qr.expiresAt))){val claimed=post(client,qr.endpoint.trimEnd('/')+"/api/v1/pair/claim",payload("requestId" to requestId,"claimToken" to claim));when(claimed["status"]?.jsonPrimitive?.content){"approved"->{host=Host(qr.endpoint.trimEnd('/'),qr.fingerprint,qr.hostId,claimed.getValue("deviceId").jsonPrimitive.content,claimed.getValue("credential").jsonPrimitive.content);break};"rejected"->throw DeckException("PAIRING_REJECTED","Windows 已拒绝此设备")};delay(1200)}
        requireNotNull(host){"配对已过期，请重新生成二维码"};require(Regex("[A-Za-z0-9_-]{43}").matches(host.credential)){"设备凭据无效"};vault.save(host);cursor="0";mutable.update{it.copy(host=host,pairingCode=null,pairingName=null,connection="正在连接",snapshot=Snapshot(),events=emptyList(),selectedSession=null,selectedProject=null,diagnostics=null,retention=Retention())};startConnection(host)
    }catch(e:CancellationException){throw e}catch(e:Exception){mutable.update{it.copy(error=errorMessage(e),pairingCode=null)}}finally{client?.dispatcher?.executorService?.shutdown();client?.connectionPool?.evictAll();mutable.update{it.copy(busy=false)}}}}
    fun cancelPair(){pairingJob?.cancel();mutable.update{it.copy(pairingCode=null,pairingName=null,busy=false)}}
    fun selectProject(id:String){restoreNavigation=false;selectionJob?.cancel();navigation.edit().remove("${mutable.value.host?.hostId}:session").apply();mutable.update{it.copy(selectedProject=id,selectedSession=null,events=emptyList(),git=null,diff=null)}}
    fun selectSession(id:String){val host=mutable.value.host?:return;restoreNavigation=false;navigation.edit().putString("${host.hostId}:session",id).apply();val session=mutable.value.snapshot.sessions.find{it.sessionId==id}?:return;mutable.update{it.copy(selectedSession=id,selectedProject=session.projectId,events=emptyList(),git=if(it.selectedProject==session.projectId)it.git else null,diff=if(it.selectedProject==session.projectId)it.diff else null)};selectionJob?.cancel();selectionJob=scope.launch{launch{try{if(!mutable.value.stale)refreshSession(id)}catch(e:Exception){mutable.update{it.copy(error=errorMessage(e))}}};dao.events(host.hostId,id).collect{rows->val events=rows.asReversed().mapNotNull{runCatching{wire.decodeFromString(DeckEvent.serializer(),it.json)}.getOrNull()};mutable.update{if(it.selectedSession==id)it.copy(events=events)else it}}}}
    private suspend fun refreshSession(id:String,before:String?=null){val host=mutable.value.host?:return;val result=rpc().request("sessions.detail",buildJsonObject{put("sessionId",id);put("limit",500);if(before!=null)put("before",before)});val events=result["events"]?.jsonArray?.map{wire.decodeFromJsonElement(DeckEvent.serializer(),it)}?:emptyList();dao.saveEvents(events.map{CachedEvent(host.hostId,it.eventId.toLong(),it.sessionId,wire.encodeToString(DeckEvent.serializer(),it))})}
    fun olderEvents(){action{val id=mutable.value.selectedSession?:return@action;refreshSession(id,mutable.value.events.firstOrNull()?.eventId)}}
    fun newTask(text:String,onAccepted:()->Unit={}){action{val project=mutable.value.selectedProject?:error("请先选择本机授权项目");val created=rpc().request("sessions.create",payload("projectId" to project,"title" to text.take(100)));val session=wire.decodeFromJsonElement(Session.serializer(),created.getValue("session"));refreshSnapshot();rpc().request("turn.start",payload("sessionId" to session.sessionId,"text" to text));selectSession(session.sessionId);withContext(Dispatchers.Main){onAccepted()};refreshSnapshot()}}
    fun continueTask(text:String,onAccepted:()->Unit={}){action{val id=mutable.value.selectedSession?:error("请选择会话");rpc().request("turn.start",payload("sessionId" to id,"text" to text));withContext(Dispatchers.Main){onAccepted()};refreshSnapshot()}}
    fun interrupt(){action{val id=mutable.value.selectedSession?:return@action;val turn=mutable.value.snapshot.turns.lastOrNull{it.sessionId==id&&it.status in listOf("running","waitingApproval","unknown")}?:error("没有活动回合");rpc().request("turn.interrupt",payload("sessionId" to id,"turnId" to turn.turnId));refreshSnapshot()}}
    fun decide(approval:Approval,decision:String){action{require(Instant.parse(approval.expiresAt).isAfter(Instant.now())){"审批已过期"};rpc().request("approvals.decide",payload("sessionId" to approval.sessionId,"turnId" to approval.turnId,"approvalId" to approval.approvalId,"decision" to decision));refreshSnapshot()}}
    fun addProject(){action{rpc().request("projects.add");mutable.update{it.copy(error="请在 Windows 管理窗选择并确认目录")}}}
    fun refresh(){action{refreshSnapshot();mutable.value.selectedSession?.let{refreshSession(it)}}}
    fun refreshGit(){scope.launch{try{val id=mutable.value.selectedProject?:return@launch;val git=wire.decodeFromJsonElement(GitStatus.serializer(),rpc().request("git.status",payload("projectId" to id)));mutable.update{if(it.selectedProject==id)it.copy(git=git)else it}}catch(e:Exception){mutable.update{it.copy(error=errorMessage(e))}}}}
    fun selectFile(file:GitFile){action{val id=mutable.value.selectedProject?:return@action;val hostId=mutable.value.host?.hostId;val diff=wire.decodeFromJsonElement(Diff.serializer(),rpc().request("git.diff",payload("projectId" to id,"fileId" to file.fileId)));mutable.update{if(it.selectedProject==id&&it.host?.hostId==hostId)it.copy(diff=diff)else it}}}
    fun forgetHost(){action{val host=mutable.value.host;try{if(!mutable.value.stale)rpc().request("devices.revokeSelf")}finally{connectionJob?.cancel();transport?.close();selectionJob?.cancel();vault.clear();if(host!=null){dao.removeHost(host.hostId);dao.removeEvents(host.hostId)};mutable.value=DeckState(preferences=preferences.read());cursor="0"}}}
    fun clearError(){mutable.update{it.copy(error=null)}}
    fun reconnect(){mutable.value.host?.let{startConnection(it)}}
    fun setTheme(theme:String){require(theme in listOf("system","light","dark"));val next=mutable.value.preferences.copy(theme=theme);preferences.save(next);mutable.update{it.copy(preferences=next)}}
    fun setNotifications(enabled:Boolean){val permitted=enabled&&notifications.permitted();val next=mutable.value.preferences.copy(notifications=permitted);preferences.save(next);mutable.update{it.copy(preferences=next,error=if(enabled&&!permitted)"通知权限未授予，前台任务与审批仍可使用" else it.error)}}
    fun updateRetention(value:Retention){require(value.days in 1..365&&value.maxMiB in 16..1024);action{val result=rpc().request("settings.update",buildJsonObject{put("days",value.days);put("maxMiB",value.maxMiB)});mutable.update{it.copy(retention=wire.decodeFromJsonElement(Retention.serializer(),result.getValue("retention")))}}}
    fun fetchDiagnostics(){action{val result=rpc().request("system.diagnostics");mutable.update{it.copy(diagnostics=result)}}}
    fun setDisplayMask(value:String){require(value.isEmpty()||value.length in 3..256);mutable.update{it.copy(displayMask=value)}}
    fun showMessage(message:String){mutable.update{it.copy(error=message)}}
}
