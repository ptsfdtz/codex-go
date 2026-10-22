package dev.agentdeck.app

import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.*
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HeldCertificate
import okhttp3.tls.HandshakeCertificates
import org.junit.Assert.*
import org.junit.Test

/** Real pinned TLS/WebSocket and Android transport; server content is a controlled fixture. */
class ReplayWebSocketTest {
    @Test fun nativeReplayChecksOriginalIdentityOverPinnedWebSocket()=runBlocking { verify(false) }
    @Test fun changedOriginalThreadOverWebSocketCannotPublish()=runBlocking { verify(true) }
    private suspend fun verify(wrongIdentity:Boolean) {
        val cert=HeldCertificate.Builder().commonName("localhost").addSubjectAlternativeName("localhost").addSubjectAlternativeName("127.0.0.1").build()
        val tls=HandshakeCertificates.Builder().heldCertificate(cert).build()
        val server=MockWebServer()
        server.useHttps(tls.sslSocketFactory(),false)
        val requests=mutableListOf<String>()
        server.enqueue(MockResponse().withWebSocketUpgrade(object:WebSocketListener(){
            override fun onMessage(webSocket:WebSocket,text:String){
                val request=wire.parseToJsonElement(text).jsonObject
                val action=request.getValue("action").jsonPrimitive.content
                synchronized(requests){requests.add(action)}
                val result=when(action){
                    "system.hello"->buildJsonObject{put("ok",true)}
                    "events.replay"->buildJsonObject{
                        put("more",false);put("cursor","42")
                        put("events",JsonArray(listOf(wire.encodeToJsonElement(DeckEvent.serializer(),nativeEvent()))))
                    }
                    "turn.latest"->{
                        val params=request.getValue("payload").jsonObject
                        check(params["contractVersion"]?.jsonPrimitive?.int==1&&params["sessionId"]?.jsonPrimitive?.content=="session")
                        buildJsonObject{
                            put("contractVersion",1);put("sessionId","session");put("upstreamThreadId",if(wrongIdentity)"different-thread" else "original-thread");put("threadStatus","idle")
                            put("turn",buildJsonObject{put("upstreamTurnId","original-turn");put("status","completed")})
                        }
                    }
                    else->error("Unexpected action $action")
                }
                webSocket.send(buildJsonObject{put("v",1);put("type","response");put("id",request.getValue("id"));put("payload",result)}.toString())
            }
        }))
        server.start()
        val pin=MessageDigest.getInstance("SHA-256").digest(cert.certificate.encoded).joinToString(""){"%02x".format(it)}
        val transport=DeckTransport(Host(server.url("/").toString().trimEnd('/'),pin,"computer","device","synthetic-test-credential"))
        try{
            withTimeout(10000){
                transport.connect();transport.request("system.hello")
                val page=transport.request("events.replay",buildJsonObject{put("cursor","41");put("limit",500)})
                val replay=NotificationReplay()
                page.getValue("events").jsonArray.forEach{replay.observe(wire.decodeFromJsonElement(DeckEvent.serializer(),it))}
                val session=Session("session","grant","original-thread","task","idle")
                val snapshot=Snapshot(host=HostState("computer","ready","fixture"),sessions=listOf(session))
                val delivered=mutableListOf<DeckEvent>()
                deliverReplayNotifications(replay.drain("computer",snapshot,includeNative=true),{true},{true},{session},{expected->
                    decodeLatestTurn(transport.request("turn.latest",buildJsonObject{put("sessionId",expected.sessionId);put("contractVersion",1)}),expected)
                },{delivered.add(it)})
                if(wrongIdentity)assertTrue(delivered.isEmpty()) else {
                    assertEquals(listOf("42"),delivered.map{it.eventId})
                    assertEquals("original-turn",delivered.single().payload.jsonObject["upstreamTurnId"]?.jsonPrimitive?.content)
                }
            }
            val handshake=server.takeRequest(2,TimeUnit.SECONDS)!!
            assertEquals("Bearer synthetic-test-credential",handshake.getHeader("Authorization"))
            assertEquals(listOf("system.hello","events.replay","turn.latest"),synchronized(requests){requests.toList()})
        }finally{transport.close();server.shutdown()}
    }
    private fun nativeEvent()=DeckEvent(eventId="42",seq=1,sessionId="session",action="upstream.turn.completed",payload=buildJsonObject{put("upstreamTurnId","original-turn");put("status","completed")},ts="2026-10-21T12:00:00Z")
}
