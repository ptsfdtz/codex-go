package dev.agentdeck.app

import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketAddress
import java.net.URI
import javax.net.SocketFactory

/** The pinned computer certificate authenticates the service; LAN addresses only select a route. */
internal fun serviceOrigin(endpoint:String,tlsServerName:String?):String {
    if(tlsServerName==null)return endpoint.trimEnd('/')
    require(tlsServerName=="127.0.0.1"){"不支持的 TLS 服务身份"}
    val uri=URI(endpoint)
    require(uri.scheme=="https"&&uri.host!=null&&uri.userInfo==null&&uri.query==null&&uri.fragment==null&&(uri.path.isNullOrEmpty()||uri.path=="/")){"无效的电脑连接地址"}
    return "https://127.0.0.1:${if(uri.port<0)443 else uri.port}"
}

/** Keep JSSE/OkHttp hostname verification intact while dialing a discovered address. */
internal class ServiceSocketFactory(endpoint:String):SocketFactory(){
    private val address=URI(endpoint).let{InetSocketAddress(it.host,if(it.port<0)443 else it.port)}
    override fun createSocket():Socket=object:Socket(){
        override fun connect(endpoint:SocketAddress){connect(endpoint,0)}
        override fun connect(endpoint:SocketAddress,timeout:Int){super.connect(address,timeout)}
    }
    override fun createSocket(host:String,port:Int):Socket=createSocket().apply{connect(address)}
    override fun createSocket(host:InetAddress,port:Int):Socket=createSocket().apply{connect(address)}
    override fun createSocket(host:String,port:Int,localHost:InetAddress,localPort:Int):Socket=createSocket().apply{bind(InetSocketAddress(localHost,localPort));connect(address)}
    override fun createSocket(host:InetAddress,port:Int,localHost:InetAddress,localPort:Int):Socket=createSocket().apply{bind(InetSocketAddress(localHost,localPort));connect(address)}
}
