package dev.agentdeck.app

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import java.net.Inet4Address
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/** Untrusted discovery hints are accepted only for already pinned computers. */
internal class LanDiscovery(context:Context,private val scope:CoroutineScope){
    private val manager=context.getSystemService(NsdManager::class.java)
    private val resolutions=Channel<NsdServiceInfo>(32)
    private var listener:NsdManager.DiscoveryListener?=null
    private var known:Map<String,String> = emptyMap()
    private var sources:Map<String,String> = emptyMap()
    val endpoints=MutableStateFlow<Map<String,String>>(emptyMap())
    init{scope.launch{for(service in resolutions){resolve(service)?.let{accept(it)}}}}
    @Synchronized fun hosts(hosts:List<Host>){known=hosts.filter{it.tlsServerName=="127.0.0.1"}.associate{it.hostId to it.fingerprint};endpoints.value=endpoints.value.filterKeys{it in known};if(known.isNotEmpty())start()else stop()}
    @Synchronized private fun start(){
        if(listener!=null)return
        val current=object:NsdManager.DiscoveryListener{
            override fun onDiscoveryStarted(serviceType:String){}
            override fun onDiscoveryStopped(serviceType:String){}
            override fun onStartDiscoveryFailed(serviceType:String,errorCode:Int){synchronized(this@LanDiscovery){if(listener===this)listener=null}}
            override fun onStopDiscoveryFailed(serviceType:String,errorCode:Int){}
            override fun onServiceFound(service:NsdServiceInfo){if(service.serviceType.startsWith("_agentdeck._tcp"))resolutions.trySend(service)}
            override fun onServiceLost(service:NsdServiceInfo){synchronized(this@LanDiscovery){val host=sources[service.serviceName]?:return;sources=sources-service.serviceName;if(host !in sources.values)endpoints.value=endpoints.value-host}}
        }
        listener=current
        try{manager.discoverServices("_agentdeck._tcp.",NsdManager.PROTOCOL_DNS_SD,current)}catch(_:Exception){listener=null}
    }
    @Synchronized private fun stop(){listener?.let{runCatching{manager.stopServiceDiscovery(it)}};listener=null;endpoints.value=emptyMap();sources=emptyMap()}
    @Synchronized fun refresh(){if(known.isNotEmpty()){stop();start()}}
    @Synchronized fun route(host:Host):Host=endpoints.value[host.hostId]?.let{host.copy(endpoint=it)}?:host
    @Suppress("DEPRECATION") private suspend fun resolve(service:NsdServiceInfo):NsdServiceInfo?=withTimeoutOrNull(5_000){suspendCancellableCoroutine{continuation->
        val resolver=object:NsdManager.ResolveListener{
            override fun onResolveFailed(serviceInfo:NsdServiceInfo,errorCode:Int){if(continuation.isActive)continuation.resume(null)}
            override fun onServiceResolved(serviceInfo:NsdServiceInfo){if(continuation.isActive)continuation.resume(serviceInfo)}
        }
        continuation.invokeOnCancellation{if(android.os.Build.VERSION.SDK_INT>=34)runCatching{manager.stopServiceResolution(resolver)}}
        try{manager.resolveService(service,resolver)}catch(_:Exception){if(continuation.isActive)continuation.resume(null)}
    }}
    @Suppress("DEPRECATION") @Synchronized private fun accept(service:NsdServiceInfo){
        fun text(name:String)=service.attributes[name]?.takeIf{it.size<=160}?.toString(Charsets.UTF_8)
        val host=text("id")?:return
        if(known[host]==null||known[host]!=text("fp")||text("tls")!="127.0.0.1"||text("v")!="1")return
        val address=service.host?.takeIf{it is Inet4Address&&it.isSiteLocalAddress}?.hostAddress?:return
        if(service.port !in 1025..65535)return
        endpoints.value=endpoints.value+(host to "https://$address:${service.port}")
        sources=sources+(service.serviceName to host)
    }
}
