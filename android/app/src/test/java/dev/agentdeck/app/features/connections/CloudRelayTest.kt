package dev.agentdeck.app

import java.net.Socket
import java.net.ServerSocket
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.mockwebserver.*
import okhttp3.mockwebserver.Dispatcher
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.junit.Assert.*
import org.junit.Test

class CloudRelayTest {
    @Test fun relayCarriesPinnedInnerTlsThroughAuthenticatedOuterWebSocket()=runBlocking {
        val cloudCert=HeldCertificate.Builder().commonName("cloud").addSubjectAlternativeName("localhost").addSubjectAlternativeName("127.0.0.1").build()
        val cloudTls=HandshakeCertificates.Builder().heldCertificate(cloudCert).build()
        val trustedCloud=HandshakeCertificates.Builder().addTrustedCertificate(cloudCert.certificate).build()
        val pcCert=HeldCertificate.Builder().commonName("computer").addSubjectAlternativeName("127.0.0.1").build()
        val pcTls=HandshakeCertificates.Builder().heldCertificate(pcCert).build()
        val cloudServer=MockWebServer().apply{useHttps(cloudTls.sslSocketFactory(),false)}
        val pc=MockWebServer().apply{useHttps(pcTls.sslSocketFactory(),false)}
        val executor=Executors.newCachedThreadPool()
        val sockets=CopyOnWriteArrayList<Socket>()
        val encrypted=CopyOnWriteArrayList<ByteString>()
        val access=connectionToken();val refresh=connectionToken();val ticket=connectionToken()
        val innerCredential=connectionToken()
        val replies=CopyOnWriteArrayList<String>()
        val waitingTurn=AtomicReference<Pair<WebSocket,JsonElement>?>()
        val outerClient=OkHttpClient.Builder().sslSocketFactory(trustedCloud.sslSocketFactory(),trustedCloud.trustManager).pingInterval(20,TimeUnit.SECONDS).build()
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
        pc.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse {
            if(request.path!="/api/v1/ws"||request.getHeader("Authorization")!="Bearer $innerCredential")return MockResponse().setResponseCode(401)
            return MockResponse().withWebSocketUpgrade(object:WebSocketListener(){
                override fun onMessage(webSocket:WebSocket,text:String){
                    val request=wire.parseToJsonElement(text).jsonObject;val action=request.getValue("action").jsonPrimitive.content;replies+=action
                    if(action=="turn.start"){waitingTurn.set(webSocket to request.getValue("id"));return}
                    val result=when(action){
                        "system.capabilities"->buildJsonObject{put("protocolVersion",1)}
                        "snapshot.get"->wire.encodeToJsonElement(Snapshot.serializer(),Snapshot(host=HostState("pinned-computer","ready","fixture")))
                        "settings.get"->buildJsonObject{put("retention",wire.encodeToJsonElement(Retention.serializer(),Retention()))}
                        "events.replay"->buildJsonObject{put("events",JsonArray(emptyList()));put("more",false)}
                        else->buildJsonObject{put("hostId","pinned-computer")}
                    }
                    webSocket.send(buildJsonObject{put("v",1);put("type","response");put("id",request.getValue("id"));put("payload",result)}.toString())
                }
                override fun onClosing(webSocket:WebSocket,code:Int,reason:String){webSocket.close(code,null)}
            })
        }}
        pc.start()
        cloudServer.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse=when(request.path){
            "/api/v1/auth/login"->MockResponse().setBody(buildJsonObject{put("accessToken",access);put("refreshToken",refresh);put("accessExpiresIn",600);put("accountId","account-a");put("username","alice");put("cloudDeviceId","mobile-a");put("mustChangePassword",false)}.toString())
            "/api/v1/hosts"->if(request.getHeader("Authorization")=="Bearer $access")MockResponse().setBody("{\"hosts\":[]}")else MockResponse().setResponseCode(401)
            "/api/v1/auth/logout"->MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)
            "/api/v1/relay/tunnels"->{
                assertEquals("Bearer $access",request.getHeader("Authorization"))
                assertEquals("pinned-computer",wire.parseToJsonElement(request.body.readUtf8()).jsonObject["hostId"]?.jsonPrimitive?.content)
                MockResponse().setBody(buildJsonObject{put("version",1);put("tunnelId","00000000-0000-4000-8000-000000000001");put("clientTicket",ticket);put("expiresAt",java.time.Instant.now().plusSeconds(30).toString())}.toString())
            }
            "/api/v1/relay/tunnels/00000000-0000-4000-8000-000000000001/client"->{
                assertEquals("Bearer $access",request.getHeader("Authorization"));assertEquals(ticket,request.getHeader("X-Tunnel-Ticket"))
                MockResponse().withWebSocketUpgrade(object:WebSocketListener(){
                    private lateinit var stream:Socket
                    override fun onOpen(webSocket:WebSocket,response:Response){
                        stream=Socket("127.0.0.1",pc.port);sockets+=stream
                        executor.submit{try{val input=stream.getInputStream();val buffer=ByteArray(32*1024);while(true){val count=input.read(buffer);if(count<0)break;if(!webSocket.send(buffer.toByteString(0,count)))break}}catch(_:Exception){}finally{webSocket.close(1000,null)}}
                    }
                    override fun onMessage(webSocket:WebSocket,bytes:ByteString){encrypted+=bytes;stream.getOutputStream().write(bytes.toByteArray());stream.getOutputStream().flush()}
                    override fun onClosing(webSocket:WebSocket,code:Int,reason:String){stream.close();webSocket.close(code,null)}
                    override fun onFailure(webSocket:WebSocket,t:Throwable,response:Response?){if(::stream.isInitialized)stream.close()}
                })
            }
            else->MockResponse().setResponseCode(404)
        }}
        cloudServer.start()
        var transport:DeckTransport?=null
        try{
            var protected:String?=null
            val account=CloudAccount({protected},{protected=it},scope,{connectionToken()},outerClient)
            val origin=cloudOrigin(cloudServer.url("/").toString())
            account.login(origin,"alice","valid-test-password")
            val binding=CloudBinding(origin,"account-a")
            val pin=MessageDigest.getInstance("SHA-256").digest(pcCert.certificate.encoded).joinToString(""){"%02x".format(it)}
            val host=Host("https://192.0.2.7:${pc.port}",pin,"pinned-computer","device",innerCredential,tlsServerName="127.0.0.1",cloud=binding)
            transport=DeckTransport(host,45_000,routeFactory=RelaySocketFactory(account,binding,host.hostId))
            transport.connect()
            assertEquals("pinned-computer",transport.request("system.hello")["hostId"]?.jsonPrimitive?.content)
            assertEquals(listOf("system.hello"),replies.toList())
            assertTrue(encrypted.isNotEmpty())
            assertTrue(encrypted.none{it.utf8().contains(innerCredential)||it.utf8().contains("system.hello")})
            assertNotNull(protected)
            try{account.tunnel(CloudBinding(origin,"account-b"),host.hostId);fail("Cross-account tunnel was accepted")}catch(error:DeckException){assertEquals("CLOUD_IDENTITY_MISMATCH",error.code)}
            transport.close();transport=null
            val unavailable=ServerSocket(0).use{"https://127.0.0.1:${it.localPort}"}
            val lanAddress=AtomicReference(unavailable)
            var cached:CachedHost?=null
            val journal=object:ComputerJournal{
                override suspend fun host(hostId:String)=cached
                override suspend fun snapshot(hostId:String,snapshot:Snapshot,cursor:String,at:String,reset:Boolean,removed:List<String>){cached=CachedHost(hostId,wire.encodeToString(Snapshot.serializer(),snapshot),cursor,at)}
                override suspend fun event(hostId:String,snapshot:Snapshot?,event:DeckEvent,at:String){}
                override suspend fun trim(hostId:String){}
            }
            val manager=ComputerConnections(scope,journal,{_,_->},{_,_->},account,{it.copy(endpoint=lanAddress.get())})
            try{withTimeout(20_000){
                // An unavailable LAN falls back to the real TLS-through-WSS adapter.
                manager.reconcile(listOf(host))
                manager.states.first{it[host.hostId]?.let{view->view.online&&view.route=="云端"}==true}
                val connection=manager.get(host.hostId)!!
                val cloudTransport=connection.transport!!
                val sending=async{cloudTransport.request("turn.start")}
                while(waitingTurn.get()==null)delay(10)
                lanAddress.set("https://127.0.0.1:${pc.port}")
                val helloCount=replies.count{it=="system.hello"}
                manager.check()
                while(replies.count{it=="system.hello"}==helloCount)delay(10)
                assertNull(withTimeoutOrNull(250){manager.states.first{it[host.hostId]?.route=="局域网"}})
                assertSame(cloudTransport,connection.transport)
                val waiting=waitingTurn.getAndSet(null)!!
                waiting.first.send(buildJsonObject{put("v",1);put("type","response");put("id",waiting.second);put("payload",buildJsonObject{put("accepted",true)})}.toString())
                assertTrue(sending.await().getValue("accepted").jsonPrimitive.boolean)
                while(manager.states.value[host.hostId]?.let{it.online&&it.route=="局域网"}!=true){manager.check();delay(25)}
                assertEquals(1,replies.count{it=="turn.start"})
                // Losing LAN returns to cloud without resubmitting the mutation.
                lanAddress.set(unavailable)
                connection.transport!!.disconnect(java.io.IOException("LAN unavailable"))
                manager.states.first{it[host.hostId]?.let{view->view.online&&view.route=="云端"}==true}
                assertEquals(1,replies.count{it=="turn.start"})
                // A reachable LAN with the wrong pin must not silently fall back.
                lanAddress.set("https://127.0.0.1:${pc.port}")
                val before=cloudServer.requestCount
                manager.reconcile(listOf(host.copy(fingerprint="0".repeat(64))))
                manager.states.first{it[host.hostId]?.error!=null}
                assertEquals("局域网",manager.states.value.getValue(host.hostId).route)
                assertEquals(before,cloudServer.requestCount)
                // Explicit cloud-only policy bypasses a working LAN.
                manager.reconcile(listOf(host.copy(routePolicy="cloud")))
                manager.states.first{it[host.hostId]?.let{view->view.online&&view.route=="云端"}==true}
                assertEquals(1,replies.count{it=="turn.start"})
            }}finally{manager.reconcile(emptyList())}
            withTimeout(1000){account.logout()}
            assertFalse(account.state.value.signedIn)
            assertNull(protected)
            try{account.tunnel(binding,host.hostId);fail("Signed-out account was accepted")}catch(error:DeckException){assertEquals("CLOUD_LOGIN_REQUIRED",error.code)}
        }finally{
            transport?.close();sockets.forEach{runCatching{it.close()}};scope.cancel()
            outerClient.dispatcher.executorService.shutdown();outerClient.connectionPool.evictAll();executor.shutdownNow()
            pc.close();cloudServer.close()
        }
    }

    @Test fun savedRemoteComputersAreVisibleOnlyToTheirIssuerAndAccount(){
        val a=CloudBinding("https://a.example.com","alice")
        val b=CloudBinding("https://a.example.com","bob")
        val local=Host("https://192.168.1.5:49321","a".repeat(64),"lan","d","c")
        val remote=local.copy(hostId="remote",cloud=a)
        val book=HostBook(listOf(local,remote),"remote")
        assertEquals(listOf("lan"),book.visible(null).hosts.map{it.hostId})
        assertEquals(listOf("lan"),book.visible(b).hosts.map{it.hostId})
        assertEquals(2,book.visible(a).hosts.size)
        assertEquals("lan",book.visible(CloudBinding("https://other.example.com","alice")).active?.hostId)
    }

    @Test fun cloudQrRequiresStableTlsAndExplicitAccountScope(){
        val qr=PairQr(3,"https://127.0.0.1:49321","a".repeat(64),connectionToken(),java.time.Instant.now().plusSeconds(60).toString(),"host",tlsServerName="127.0.0.1",cloud=CloudBinding("https://a.example.com","alice"))
        assertEquals(qr,qr.validated())
        for(invalid in listOf(qr.copy(cloud=null),qr.copy(v=2),qr.copy(tlsServerName=null),qr.copy(cloud=CloudBinding("http://a.example.com","alice")))){
            assertTrue(runCatching{invalid.validated()}.isFailure)
        }
        assertTrue(connectionSecurityFailure(java.io.IOException("wrapped",javax.net.ssl.SSLPeerUnverifiedException("pin mismatch"))))
    }
}
