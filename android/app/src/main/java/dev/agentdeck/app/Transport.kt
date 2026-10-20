package dev.agentdeck.app

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class PinnedTrust(private val fingerprint:String):X509TrustManager {
    override fun getAcceptedIssuers():Array<X509Certificate> = emptyArray()
    override fun checkClientTrusted(chain:Array<X509Certificate>,authType:String){throw CertificateException("Client trust is unsupported")}
    override fun checkServerTrusted(chain:Array<X509Certificate>,authType:String){
        if(chain.isEmpty())throw CertificateException("Missing certificate")
        val leaf=chain[0];leaf.checkValidity()
        val actual=MessageDigest.getInstance("SHA-256").digest(leaf.encoded)
        val expected=runCatching{fingerprint.chunked(2).map{it.toInt(16).toByte()}.toByteArray()}.getOrElse{throw CertificateException("Invalid certificate pin")}
        if(expected.size!=32||!MessageDigest.isEqual(actual,expected))throw CertificateException("Bridge certificate fingerprint changed")
        // The locally generated certificate is self-signed; verify it after the exact out-of-band pin matches.
        leaf.verify(leaf.publicKey)
    }
}
fun pinnedClient(fingerprint:String):OkHttpClient {
    val trust=PinnedTrust(fingerprint);val context=SSLContext.getInstance("TLS").apply{init(null,arrayOf(trust),null)}
    return OkHttpClient.Builder().sslSocketFactory(context.socketFactory,trust).connectTimeout(10,TimeUnit.SECONDS).readTimeout(20,TimeUnit.SECONDS).callTimeout(25,TimeUnit.SECONDS).pingInterval(15,TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build()
}
suspend fun post(client:OkHttpClient,url:String,value:JsonObject):JsonObject=suspendCancellableCoroutine{continuation->
    val call=client.newCall(Request.Builder().url(url).post(value.toString().toRequestBody("application/json".toMediaType())).build())
    continuation.invokeOnCancellation{call.cancel()}
    call.enqueue(object:Callback{
        override fun onFailure(call:Call,e:IOException){if(continuation.isActive)continuation.resumeWithException(e)}
        override fun onResponse(call:Call,response:Response){response.use{try{val text=it.body?.source()?.let{source->source.request(65537);require(source.buffer.size<=65536){"Bridge response too large"};source.buffer.readUtf8()}?:"{}";val result=wire.parseToJsonElement(text).jsonObject;if(!it.isSuccessful)throw DeckException(result["code"]?.jsonPrimitive?.content?:"PAIRING_FAILED",result["message"]?.jsonPrimitive?.content?:"配对失败");if(continuation.isActive)continuation.resume(result)}catch(e:Exception){if(continuation.isActive)continuation.resumeWithException(e)}}}
    })
}
class DeckTransport(private val host:Host){
    val events=Channel<JsonObject>(256)
    private val client=pinnedClient(host.fingerprint)
    private val pending=ConcurrentHashMap<String,CompletableDeferred<JsonObject>>()
    private var socket:WebSocket?=null
    private val opened=CompletableDeferred<Unit>()
    suspend fun connect(){
        socket=client.newWebSocket(Request.Builder().url(host.endpoint.trimEnd('/').replaceFirst("https://","wss://")+"/api/v1/ws").header("Authorization","Bearer ${host.credential}").build(),object:WebSocketListener(){
            override fun onOpen(webSocket:WebSocket,response:Response){opened.complete(Unit)}
            override fun onMessage(webSocket:WebSocket,text:String){try{
                require(text.length<=1024*1024){"Message too large"};val p=wire.parseToJsonElement(text).jsonObject;require(p["v"]?.jsonPrimitive?.int==1){"Unsupported protocol version"}
                when(p["type"]?.jsonPrimitive?.content){
                    "response","error"->{val id=p["id"]?.jsonPrimitive?.content;if(id!=null)pending.remove(id)?.let{if(p["type"]?.jsonPrimitive?.content=="error")it.completeExceptionally(DeckException(p["code"]?.jsonPrimitive?.content?:"ERROR",p["message"]?.jsonPrimitive?.content?:"Bridge 请求失败"))else it.complete(p["payload"]?.jsonObject?:JsonObject(emptyMap()))}}
                    "event"->{if(!events.trySend(p).isSuccess){webSocket.close(1013,"Replay required");fail(IOException("事件过快，正在重新同步"))}}
                    else->throw IOException("Invalid message type")
                }
            }catch(e:Exception){webSocket.close(1002,"Protocol error");fail(e)}}
            override fun onFailure(webSocket:WebSocket,t:Throwable,response:Response?){fail(t)}
            override fun onClosed(webSocket:WebSocket,code:Int,reason:String){fail(IOException("Bridge 已断开 ($code)"))}
            override fun onClosing(webSocket:WebSocket,code:Int,reason:String){webSocket.close(code,reason)}
        })
        withTimeout(12000){opened.await()}
    }
    private fun fail(error:Throwable){opened.completeExceptionally(error);pending.values.forEach{it.completeExceptionally(error)};pending.clear();events.close(error)}
    suspend fun request(action:String,payload:JsonObject=JsonObject(emptyMap())):JsonObject {
        val id=UUID.randomUUID().toString();val result=CompletableDeferred<JsonObject>();pending[id]=result
        try{check(socket?.send(buildJsonObject{put("v",1);put("type","request");put("id",id);put("action",action);put("payload",payload)}.toString())==true){"Bridge 连接不可用"};return withTimeout(45000){result.await()}}finally{pending.remove(id)}
    }
    fun close(){socket?.cancel();fail(CancellationException("Connection closed"));client.dispatcher.executorService.shutdown();client.connectionPool.evictAll()}
}
