package dev.agentdeck.app

import java.io.IOException
import java.time.Instant
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*

internal data class ComputerConnectionState(
    val connection:String="正在连接",
    val snapshot:Snapshot?=null,
    val capabilities:BridgeCapabilities?=null,
    val retention:Retention=Retention(),
    val syncedAt:String?=null,
    val error:String?=null,
    val generation:Long=0,
    val route:String="",
) {
    val online get()=connection=="已连接"
}

/** Owns network lifetimes independently of the currently displayed computer. */
internal class ComputerConnections(
    private val scope:CoroutineScope,
    private val journal:ComputerJournal,
    private val publishNotification:(String,DeckEvent)->Unit,
    private val reconcileNotifications:(String,Snapshot)->Unit,
    private val cloud:CloudAccount?=null,
    private val lanRoute:(Host)->Host={it},
) {
    private val sessions=linkedMapOf<String,ComputerConnection>()
    private val mutable=MutableStateFlow<Map<String,ComputerConnectionState>>(emptyMap())
    val states:StateFlow<Map<String,ComputerConnectionState>> = mutable.asStateFlow()
    @Synchronized fun get(hostId:String?)=sessions[hostId]
    /** Account revocation must not wait for a pending UI mutation or network timeout. */
    @Synchronized fun restrictTo(hosts:List<Host>){
        val removed=sessions.values.filter{session->hosts.none{it.hostId==session.host.hostId&&it.cloud==session.host.cloud}}
        removed.forEach{sessions.remove(it.host.hostId);it.stop()}
        publishStates()
    }

    suspend fun reconcile(hosts:List<Host>) {
        val removed=synchronized(this){
            val stale=sessions.values.filter{session->hosts.none{it.hostId==session.host.hostId&&it.copy(name="")==session.host.copy(name="")}}
            stale.forEach{sessions.remove(it.host.hostId)}
            stale
        }
        removed.forEach{it.close()}
        synchronized(this){
            hosts.forEach{host->if(host.hostId !in sessions){
                val session=ComputerConnection(host,scope,journal,publishNotification,reconcileNotifications,cloud,lanRoute){publishStates()}
                sessions[host.hostId]=session
                session.start()
            }}
            publishStates()
        }
    }
    @Synchronized private fun publishStates(){mutable.value=sessions.mapValues{it.value.state.value}}
    @Synchronized fun check(){sessions.values.forEach{it.check()}}
    @Synchronized fun reconnect(hostId:String){sessions[hostId]?.reconnect()}
}

internal class ComputerConnection(
    val host:Host,
    private val scope:CoroutineScope,
    private val journal:ComputerJournal,
    private val publishNotification:(String,DeckEvent)->Unit,
    private val reconcileNotifications:(String,Snapshot)->Unit,
    private val cloud:CloudAccount?=null,
    private val lanRoute:(Host)->Host={it},
    private val changed:()->Unit,
) {
    private val mutable=MutableStateFlow(ComputerConnectionState())
    val state:StateFlow<ComputerConnectionState> = mutable.asStateFlow()
    private val updates=MutableSharedFlow<DeckEvent>(extraBufferCapacity=256)
    val events:SharedFlow<DeckEvent> = updates.asSharedFlow()
    private val checkpoint=EventCheckpoint()
    private val cacheLock=Mutex()
    private val refreshLock=Mutex()
    private val refreshRequests=Channel<Unit>(Channel.CONFLATED)
    private val recovery=ConnectionRecovery()
    private var job:Job?=null
    private var probe:Job?=null
    @Volatile var transport:DeckTransport?=null
        private set

    private fun update(block:(ComputerConnectionState)->ComputerConnectionState){mutable.update(block);changed()}
    fun start(){if(job?.isActive!=true)job=scope.launch{run()}}
    fun stop(){job?.cancel();probe?.cancel();transport?.close()}
    suspend fun close(){job?.cancelAndJoin();probe?.cancelAndJoin();transport?.close();transport=null}
    fun reconnect(){transport?.disconnect(IOException("重新连接"));recovery.wake();start()}
    fun check(){
        if(job?.isActive!=true){start();return}
        if(!state.value.online){recovery.wake();return}
        if(probe?.isActive==true)return
        val current=transport?:return
        probe=scope.launch{try{current.probe()
            if(host.cloud!=null&&host.routePolicy=="auto"&&state.value.route=="云端"&&!current.hasPendingRequests){
                val candidate=DeckTransport(lanRoute(host),connectTimeoutMillis=4_000)
                try{candidate.connect();candidate.hello();val snapshot=wire.decodeFromJsonElement(Snapshot.serializer(),candidate.request("snapshot.get"));require(snapshot.host?.hostId==host.hostId){"电脑身份不匹配"}
                    if(transport===current)current.disconnectIfIdle(IOException("局域网连接已恢复"))
                }catch(e:CancellationException){throw e}catch(_:Exception){}finally{candidate.close()}
            }
        }catch(e:CancellationException){throw e}catch(_:DeckException){}
            catch(e:Exception){if(transport===current)current.disconnect(e)}}
    }

    suspend fun refreshSnapshot(current:DeckTransport=checkNotNull(transport),reset:Boolean=false):Snapshot=refreshLock.withLock{
        val snapshot=wire.decodeFromJsonElement(Snapshot.serializer(),current.request("snapshot.get"))
        require(snapshot.host?.hostId==host.hostId){"Bridge identity mismatch"}
        cacheLock.withLock{
            check(transport===current){"电脑连接已变更"}
            val at=Instant.now().toString()
            val previous=state.value.snapshot
            journal.snapshot(host.hostId,snapshot,if(reset)snapshot.cursor else checkpoint.value,at,reset,
                previous?.sessions?.filter{old->snapshot.sessions.none{it.sessionId==old.sessionId}}?.map{it.sessionId}.orEmpty())
            if(reset)checkpoint.reset(snapshot.cursor)
            reconcileNotifications(host.hostId,snapshot)
            update{it.copy(snapshot=snapshot,syncedAt=at,generation=it.generation+if(reset)1 else 0)}
        }
        snapshot
    }

    private suspend fun accept(event:DeckEvent):Boolean=cacheLock.withLock{
        val accepted=checkpoint.commit(event.eventId){
            journal.event(host.hostId,state.value.snapshot,event,Instant.now().toString())
        }
        if(accepted){
            if(event.eventId.toLong()%100L==0L)journal.trim(host.hostId)
            // Slow UI collectors recover from the persisted snapshot/journal.
            if(!updates.tryEmit(event))updates.emit(event)
        }
        accepted
    }

    private suspend fun replay(current:DeckTransport,hints:NotificationReplay){
        do{
            val before=checkpoint.value
            val result=current.request("events.replay",buildJsonObject{put("cursor",before);put("limit",500)})
            for(element in result["events"]?.jsonArray?:JsonArray(emptyList())){
                val event=wire.decodeFromJsonElement(DeckEvent.serializer(),element)
                if(accept(event))hints.observe(event)
            }
            val more=result["more"]?.jsonPrimitive?.boolean==true
            check(!more||checkpoint.value.toLong()>before.toLong()){"事件重放没有推进"}
        }while(more)
    }

    private suspend fun deliver(current:DeckTransport,hints:NotificationReplay){
        fun valid()=transport===current&&state.value.online
        val snapshot=state.value.snapshot?:return
        deliverReplayNotifications(hints.drain(host.hostId,snapshot,includeNative=true),
            isCurrent=::valid,
            nativeSupported={state.value.capabilities?.supports("latestUpstreamTurn")==true},
            session={id->state.value.snapshot?.sessions?.find{it.sessionId==id}},
            readLatest={session->decodeLatestTurn(current.request("turn.latest",buildJsonObject{put("sessionId",session.sessionId);put("contractVersion",1)}),session)},
            publish={publishNotification(host.hostId,it)},
            refresh={event->state.value.snapshot?.let{refreshReplayNotification(event,it,includeNative=true)}},
        )
    }

    private suspend fun run(){
        var attempt=0
        var fallback=false
        var blockedRoute:Boolean?=null
        while(currentCoroutineContext().isActive){
            val remote=host.cloud!=null&&host.routePolicy!="lan"&&(host.routePolicy=="cloud"||(blockedRoute?:fallback))
            val factory=if(remote&&cloud!=null)RelaySocketFactory(cloud,requireNotNull(host.cloud),host.hostId)else null
            val current=DeckTransport(if(remote)host else lanRoute(host),connectTimeoutMillis=if(remote)45_000 else 12_000,routeFactory=factory)
            transport=current
            val hints=NotificationReplay()
            var connectedAt:Long?=null
            try{
                if(remote&&cloud==null)throw DeckException("CLOUD_LOGIN_REQUIRED","当前云端账户不可用")
                update{it.copy(connection=if(attempt==0)"正在连接" else "正在尝试重连",error=null,route=if(remote)"云端"else"局域网")}
                current.connect()
                current.hello()
                val capabilities=wire.decodeFromJsonElement(BridgeCapabilities.serializer(),current.request("system.capabilities"))
                if(capabilities.protocolVersion!=1)throw DeckException("PROTOCOL_VERSION","电脑端协议不兼容，请更新客户端")
                val cache=journal.host(host.hostId)
                if(cache!=null){
                    val cached=wire.decodeFromString(Snapshot.serializer(),cache.snapshot)
                    require(cached.host?.hostId==host.hostId){"缓存电脑身份不匹配"}
                    checkpoint.reset(cache.cursor)
                    update{it.copy(snapshot=cached,syncedAt=cache.syncedAt)}
                    try{replay(current,hints);refreshSnapshot(current)}
                    catch(e:DeckException){if(e.code!="REPLAY_GAP")throw e;hints.clear();refreshSnapshot(current,reset=true)}
                }else refreshSnapshot(current,reset=true)
                val retention=wire.decodeFromJsonElement(Retention.serializer(),current.request("settings.get").getValue("retention"))
                update{it.copy(connection="已连接",capabilities=capabilities,retention=retention,error=null)}
                blockedRoute=null
                recovery.connected();connectedAt=System.nanoTime()
                ConnectionDiagnostics.record("connected host=${host.hostId.takeLast(6)} route=${if(remote)"cloud" else "lan"}")
                deliver(current,hints)
                coroutineScope{
                    val refreshJob=launch{
                        for(ignored in refreshRequests){delay(250);refreshSnapshot(current)}
                    }
                    try{
                        for(packet in current.events){
                            val event=wire.decodeFromJsonElement(DeckEvent.serializer(),packet)
                            if(event.eventId.toLong()<=checkpoint.value.toLong())continue
                            if(event.eventId.toLong()>checkpoint.value.toLong()+1){
                                try{replay(current,hints)}catch(e:DeckException){if(e.code!="REPLAY_GAP")throw e;hints.clear();refreshSnapshot(current,reset=true)}
                                refreshSnapshot(current);deliver(current,hints)
                            }
                            if(accept(event))publishNotification(host.hostId,event)
                            refreshRequests.trySend(Unit)
                        }
                        throw IOException("Bridge 连接已结束")
                    }finally{refreshJob.cancel()}
                }
            }catch(e:CancellationException){throw e}
            catch(e:Exception){
                ConnectionDiagnostics.record("reconnect host=${host.hostId.takeLast(6)} route=${if(remote)"cloud" else "lan"} online_ms=${connectedAt?.let{(System.nanoTime()-it)/1_000_000}?:0}",e)
                val transient=e is IOException&&!connectionSecurityFailure(e)&&e !is java.net.ProtocolException
                if(!transient)blockedRoute=remote
                // Security/protocol failures never silently downgrade to another route.
                fallback=host.cloud!=null&&host.routePolicy=="auto"&&transient&&!remote
                update{it.copy(connection="正在尝试重连",error=if(transient)null else computerConnectionError(e))}
                if(connectedAt?.let{System.nanoTime()-it>=30_000_000_000L}==true)attempt=0
                attempt++
            }finally{current.close();if(transport===current)transport=null}
            recovery.pause(attempt)
        }
    }
}

internal fun connectionSecurityFailure(error:Throwable):Boolean=generateSequence(error){it.cause}.take(12).any{it is javax.net.ssl.SSLException||it is java.security.cert.CertificateException||it is DeckException}

internal fun computerConnectionError(error:Throwable):String=when(error){
    is DeckException->userFacingError(error.code,error.message)
    is java.security.cert.CertificateException,is javax.net.ssl.SSLException->userFacingError("TLS",error.message)
    is IOException->userFacingError("NETWORK",error.message)
    else->userFacingError(null,error.message)
}
