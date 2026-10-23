package dev.agentdeck.app

import java.security.MessageDigest
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.mockwebserver.*
import okhttp3.tls.*
import org.junit.Assert.*
import org.junit.Test

class ComputerConnectionsTest {
    private class Journal:ComputerJournal {
        val hosts=ConcurrentHashMap<String,CachedHost>()
        val events=ConcurrentHashMap<Pair<String,String>,DeckEvent>()
        override suspend fun host(hostId:String)=hosts[hostId]
        override suspend fun snapshot(hostId:String,snapshot:Snapshot,cursor:String,at:String,reset:Boolean,removed:List<String>){
            if(reset)events.keys.removeAll{it.first==hostId}
            hosts[hostId]=CachedHost(hostId,wire.encodeToString(Snapshot.serializer(),snapshot),cursor,at)
        }
        override suspend fun event(hostId:String,snapshot:Snapshot?,event:DeckEvent,at:String){
            events[hostId to event.eventId]=event
            if(snapshot!=null)hosts[hostId]=CachedHost(hostId,wire.encodeToString(Snapshot.serializer(),snapshot),event.eventId,at)
        }
        override suspend fun trim(hostId:String){}
    }
    private class Peer(id:String,reportedHostId:String=id):AutoCloseable {
        private val cert=HeldCertificate.Builder().commonName("computer").addSubjectAlternativeName("127.0.0.1").build()
        val server=MockWebServer()
        val socket=AtomicReference<WebSocket?>()
        val requests=CopyOnWriteArrayList<String>()
        val host:Host
        init{
            server.useHttps(HandshakeCertificates.Builder().heldCertificate(cert).build().sslSocketFactory(),false)
            val listener=object:WebSocketListener(){
                override fun onOpen(webSocket:WebSocket,response:Response){socket.set(webSocket)}
                override fun onMessage(webSocket:WebSocket,text:String){
                    val request=wire.parseToJsonElement(text).jsonObject
                    val action=request.getValue("action").jsonPrimitive.content
                    requests.add(action)
                    if(action=="turn.create")return // Accepted transport write, unknown authority outcome.
                    val result=when(action){
                        "system.capabilities"->buildJsonObject{put("protocolVersion",1)}
                        "snapshot.get"->wire.encodeToJsonElement(Snapshot.serializer(),Snapshot(host=HostState(reportedHostId,"ready","fixture")))
                        "settings.get"->buildJsonObject{put("retention",buildJsonObject{put("days",30);put("maxMiB",256)})}
                        "events.replay"->buildJsonObject{put("events",JsonArray(emptyList()));put("more",false)}
                        else->JsonObject(emptyMap())
                    }
                    webSocket.send(buildJsonObject{put("v",1);put("type","response");put("id",request.getValue("id"));put("payload",result)}.toString())
                }
                override fun onClosing(webSocket:WebSocket,code:Int,reason:String){webSocket.close(code,reason)}
            }
            server.dispatcher=object:okhttp3.mockwebserver.Dispatcher(){override fun dispatch(request:RecordedRequest)=MockResponse().withWebSocketUpgrade(listener)}
            server.start()
            val pin=MessageDigest.getInstance("SHA-256").digest(cert.certificate.encoded).joinToString(""){"%02x".format(it)}
            // No "localhost" SAN: success proves that the stable verification name is used.
            host=Host("https://localhost:${server.port}",pin,id,"device-$id","credential-$id",tlsServerName="127.0.0.1")
        }
        fun event(id:String){checkNotNull(socket.get()).send(wire.encodeToString(DeckEvent.serializer(),DeckEvent(eventId=id,seq=id.toLong(),sessionId="shared-session",action="turn.completed",ts=Instant.now().toString())))}
        override fun close(){socket.get()?.close(1000,"Test finished");server.shutdown()}
    }

    @Test fun selectionAndRenameKeepBothConnectionsAndIndependentCheckpoints()=runBlocking{
        Peer("first").use{first->Peer("second").use{second->
            val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
            val journal=Journal()
            val notices=CopyOnWriteArrayList<Pair<String,String>>()
            val manager=ComputerConnections(scope,journal,{id,event->notices.add(id to event.eventId)},{_,_->})
            try{withTimeout(10000){
                manager.reconcile(listOf(first.host,second.host))
                manager.states.first{it.size==2&&it.values.all{view->view.online}}
                val firstSession=manager.get(first.host.hostId)
                val firstTransport=firstSession?.transport
                val secondTransport=manager.get(second.host.hostId)?.transport
                manager.reconcile(listOf(first.host.copy(name="Renamed"),second.host))
                assertSame(firstSession,manager.get(first.host.hostId))
                assertSame(firstTransport,manager.get(first.host.hostId)?.transport)
                assertSame(secondTransport,manager.get(second.host.hostId)?.transport)
                first.event("1");second.event("1")
                while(notices.size<2)delay(10)
                assertEquals(setOf("first" to "1","second" to "1"),notices.toSet())
                assertEquals("1",journal.hosts["first"]?.cursor)
                assertEquals("1",journal.hosts["second"]?.cursor)
                manager.reconcile(listOf(second.host))
                assertNull(manager.get("first"))
                assertSame(secondTransport,manager.get("second")?.transport)
                second.event("2")
                while(journal.hosts["second"]?.cursor!="2")delay(10)
                assertEquals("1",journal.hosts["first"]?.cursor)
                assertEquals(1,first.server.requestCount)
                assertEquals(1,second.server.requestCount)
            }}finally{manager.reconcile(emptyList());scope.cancel()}
        }}
    }

    @Test fun certificatePinDoesNotPermitADifferentComputerIdentity()=runBlocking{
        Peer("expected","impostor").use{peer->
            val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
            val journal=Journal()
            val manager=ComputerConnections(scope,journal,{_,_->},{_,_->})
            try{withTimeout(10000){
                manager.reconcile(listOf(peer.host))
                manager.states.first{it["expected"]?.error!=null}
                assertFalse(manager.states.value.getValue("expected").online)
                assertNull(journal.hosts["expected"])
            }}finally{manager.reconcile(emptyList());scope.cancel()}
        }
    }

    @Test fun accountRestrictionClosesPendingRequestWithoutTouchingStandaloneLanOrResending()=runBlocking{
        Peer("remote").use{remote->Peer("local").use{local->
            val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
            val manager=ComputerConnections(scope,Journal(),{_,_->},{_,_->})
            val binding=CloudBinding("https://cloud.example.com","alice")
            val host=remote.host.copy(cloud=binding,routePolicy="lan")
            try{withTimeout(10000){
                manager.reconcile(listOf(host,local.host))
                manager.states.first{it.size==2&&it.values.all{view->view.online}}
                val localTransport=manager.get("local")?.transport
                val pending=async{runCatching{manager.get("remote")!!.transport!!.request("turn.create")}}
                while(remote.requests.none{it=="turn.create"})delay(10)
                assertFalse(manager.get("remote")!!.transport!!.disconnectIfIdle(java.io.IOException("LAN restored")))
                manager.restrictTo(listOf(local.host))
                assertNull(manager.get("remote"))
                assertFalse(manager.states.value.containsKey("remote"))
                assertSame(localTransport,manager.get("local")?.transport)
                assertTrue(withTimeout(1000){pending.await()}.isFailure)
                manager.reconcile(listOf(host,local.host))
                manager.states.first{it["remote"]?.online==true}
                assertEquals(1,remote.requests.count{it=="turn.create"})
            }}finally{manager.reconcile(emptyList());scope.cancel()}
        }}
    }

    @Test fun routeHandoverRacingMutationEitherWaitsOrRejectsBeforeSending()=runBlocking{
        Peer("racing").use{peer->withTimeout(15000){
            repeat(12){
                val transport=DeckTransport(peer.host)
                try{
                    transport.connect()
                    val before=peer.requests.count{it=="turn.create"}
                    val start=CompletableDeferred<Unit>()
                    val mutation=async(Dispatchers.IO){start.await();runCatching{transport.request("turn.create")}}
                    val handover=async(Dispatchers.Default){start.await();transport.disconnectIfIdle(java.io.IOException("LAN restored"))}
                    start.complete(Unit)
                    if(handover.await()){
                        assertTrue(mutation.await().isFailure)
                        assertEquals(before,peer.requests.count{it=="turn.create"})
                    }else{
                        while(peer.requests.count{it=="turn.create"}==before)delay(5)
                        assertEquals(before+1,peer.requests.count{it=="turn.create"})
                        transport.close()
                        assertTrue(mutation.await().isFailure)
                    }
                }finally{transport.close()}
            }
        }}
    }
}
