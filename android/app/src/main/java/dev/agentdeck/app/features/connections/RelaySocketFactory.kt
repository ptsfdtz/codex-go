package dev.agentdeck.app

import java.io.IOException
import java.net.*
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.SocketFactory
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import okhttp3.*
import okio.ByteString
import okio.ByteString.Companion.toByteString

/** A real loopback socket keeps Android's standard JSSE/Conscrypt TLS stack intact.
 * The local adapter forwards encrypted TLS records only. It cannot terminate TLS.
 */
internal class RelaySocketFactory(
    private val account:CloudAccount,private val binding:CloudBinding,private val hostId:String,
):SocketFactory(){
    override fun createSocket():Socket=RelaySocket()
    override fun createSocket(host:String,port:Int):Socket=createSocket().apply{connect(InetSocketAddress(host,port))}
    override fun createSocket(host:InetAddress,port:Int):Socket=createSocket().apply{connect(InetSocketAddress(host,port))}
    override fun createSocket(host:String,port:Int,localHost:InetAddress,localPort:Int):Socket=createSocket().apply{bind(InetSocketAddress(localHost,localPort));connect(InetSocketAddress(host,port))}
    override fun createSocket(host:InetAddress,port:Int,localHost:InetAddress,localPort:Int):Socket=createSocket().apply{bind(InetSocketAddress(localHost,localPort));connect(InetSocketAddress(host,port))}

    private inner class RelaySocket:Socket(){
        private val closed=AtomicBoolean(false)
        private var bridge:RelayBridge?=null
        override fun connect(endpoint:SocketAddress){connect(endpoint,15_000)}
        override fun connect(endpoint:SocketAddress,timeout:Int){
            check(!isConnected&&!closed.get()){"Relay socket already connected or closed"}
            var accepted:Socket?=null
            try{
                // Dial and accept our own socket synchronously before exposing the
                // local endpoint to an asynchronous worker.
                ServerSocket(0,1,InetAddress.getLoopbackAddress()).use{listener->
                    super.connect(listener.localSocketAddress,timeout.coerceAtLeast(1))
                    listener.soTimeout=5_000
                    accepted=listener.accept()
                }
                val offer=runBlocking{withTimeout(30_000){account.tunnel(binding,hostId)}}
                if(closed.get())throw IOException("Cloud connection cancelled")
                bridge=RelayBridge(requireNotNull(accepted),account.client,offer).also{it.open()}
                if(closed.get())throw IOException("Cloud connection cancelled")
            }catch(error:Exception){accepted?.close();close();throw IOException("云端连接未建立",error)}
        }
        override fun close(){if(closed.compareAndSet(false,true)){bridge?.close();super.close()}}
    }
}

internal class RelayBridge(private val socket:Socket,private val client:OkHttpClient,private val offer:CloudTunnel){
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private val inbound=Channel<ByteString>(16)
    private val opened=CompletableFuture<Unit>()
    private val closed=AtomicBoolean(false)
    private var webSocket:WebSocket?=null
    fun open(){
        val request=Request.Builder().url(offer.url).header("Authorization","Bearer ${offer.access}").header("X-Tunnel-Ticket",offer.ticket).build()
        webSocket=client.newWebSocket(request,object:WebSocketListener(){
            override fun onOpen(webSocket:WebSocket,response:Response){opened.complete(Unit)}
            override fun onMessage(webSocket:WebSocket,bytes:ByteString){
                if(bytes.size>64*1024){fail(IOException("云端转发帧过大"));return}
                // Keep one bounded reader callback pending while the local TLS
                // socket drains. A normal history burst must not close the tunnel.
                try{runBlocking{withTimeout(10_000){inbound.send(bytes)}}}
                catch(_:Exception){fail(IOException("云端转发持续阻塞"))}
            }
            override fun onMessage(webSocket:WebSocket,text:String){fail(IOException("云端转发格式无效"))}
            override fun onFailure(webSocket:WebSocket,t:Throwable,response:Response?){fail(IOException("云端转发中断",t))}
            override fun onClosing(webSocket:WebSocket,code:Int,reason:String){ConnectionDiagnostics.record("relay_closing code=$code");webSocket.close(code,null);fail(IOException("云端转发已关闭"))}
            override fun onClosed(webSocket:WebSocket,code:Int,reason:String){ConnectionDiagnostics.record("relay_closed code=$code");fail(IOException("云端转发已关闭"))}
        })
        try{opened.get(15,TimeUnit.SECONDS)}catch(error:Exception){close();throw IOException("云端转发握手未完成",error)}
        scope.launch{try{val output=socket.getOutputStream();for(bytes in inbound){output.write(bytes.toByteArray());output.flush()}}catch(e:Exception){if(!closed.get())ConnectionDiagnostics.record("relay_local_write_failed",e)}finally{close()}}
        scope.launch{try{
            val input=socket.getInputStream();val buffer=ByteArray(32*1024)
            while(isActive){val count=input.read(buffer);if(count<0)break
                val remote=webSocket?:break
                withTimeout(10_000){while(remote.queueSize()>256*1024){if(closed.get())throw IOException("云端转发已关闭");delay(10)}}
                if(!remote.send(buffer.toByteString(0,count)))throw IOException("云端转发已关闭")
            }
        }catch(e:Exception){if(!closed.get())ConnectionDiagnostics.record("relay_local_read_or_send_failed",e)}finally{close()}}
    }
    private fun fail(error:IOException){if(!closed.get())ConnectionDiagnostics.record("relay_failure",error);opened.completeExceptionally(error);close()}
    fun close(){if(closed.compareAndSet(false,true)){opened.completeExceptionally(IOException("云端转发已关闭"));inbound.close();runCatching{socket.close()};webSocket?.cancel();scope.cancel()}}
}
