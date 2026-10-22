package dev.agentdeck.app

import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.Assert.*
import org.junit.Test
import java.net.SocketTimeoutException
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArrayList

class TransportRecoveryTest {
    private fun server():Pair<MockWebServer,Host> {
        val cert=HeldCertificate.Builder().commonName("localhost").addSubjectAlternativeName("localhost").addSubjectAlternativeName("127.0.0.1").build()
        val tls=HandshakeCertificates.Builder().heldCertificate(cert).build()
        val server=MockWebServer().apply{useHttps(tls.sslSocketFactory(),false);start()}
        val pin=MessageDigest.getInstance("SHA-256").digest(cert.certificate.encoded).joinToString(""){"%02x".format(it)}
        return server to Host(server.url("/").toString().trimEnd('/'),pin,"computer","device","test-credential")
    }
    private fun replyToHello(actions:MutableList<String>)=object:WebSocketListener(){
        override fun onMessage(webSocket:WebSocket,text:String){
            val request=wire.parseToJsonElement(text).jsonObject
            val action=request.getValue("action").jsonPrimitive.content
            actions.add(action)
            if(action=="system.hello")webSocket.send(buildJsonObject{
                put("v",1);put("type","response");put("id",request.getValue("id"))
                put("payload",buildJsonObject{put("hostId","computer")})
            }.toString())
        }
    }

    @Test fun requestTimeoutKeepsOwnerAliveAndDoesNotResendMutation() = runBlocking {
        val (server,host)=server();val actions=CopyOnWriteArrayList<String>()
        server.enqueue(MockResponse().withWebSocketUpgrade(replyToHello(actions)))
        val transport=DeckTransport(host,requestTimeoutMillis=100)
        try{withTimeout(5000){
            transport.connect()
            try{transport.request("messages.send");fail("Expected timeout")}
            catch(_:SocketTimeoutException){}
            ensureActive()
            transport.probe()
            assertEquals(listOf("messages.send","system.hello"),actions.toList())
            val cancelled=launch { transport.request("messages.send",timeoutMillis=10000) }
            yield();cancelled.cancelAndJoin()
            transport.probe()
            assertEquals(2,actions.count{it=="messages.send"})
        }}finally{transport.close();server.shutdown()}
    }

    @Test fun handshakeTimeoutCanBeRetriedWithoutCancellingReconnectLoop() = runBlocking {
        val (server,host)=server();val actions=CopyOnWriteArrayList<String>()
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        server.enqueue(MockResponse().withWebSocketUpgrade(replyToHello(actions)))
        val first=DeckTransport(host,connectTimeoutMillis=2000)
        val second=DeckTransport(host)
        try{withTimeout(10000){
            try{first.connect();fail("Expected handshake timeout")}
            catch(_:SocketTimeoutException){}
            ensureActive();first.close()
            second.connect();second.probe()
            assertEquals(listOf("system.hello"),actions.toList())
        }}finally{first.close();second.close();server.shutdown()}
    }
}
