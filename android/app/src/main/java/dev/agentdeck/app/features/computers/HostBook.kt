package dev.agentdeck.app

import kotlinx.serialization.Serializable

/** Credentials and the last selected computer are encrypted together by Vault. */
@Serializable
data class HostBook(val hosts:List<Host> = emptyList(),val activeHostId:String?=null){
    val active:Host? get()=hosts.find{it.hostId==activeHostId}?:hosts.firstOrNull()
    fun paired(host:Host)=copy(hosts=hosts.filterNot{it.hostId==host.hostId}+host.copy(name=hosts.find{it.hostId==host.hostId}?.name?:host.name),activeHostId=host.hostId)
    fun selected(id:String):HostBook{require(hosts.any{it.hostId==id}){"电脑尚未配对"};return copy(activeHostId=id)}
    fun removed(id:String):HostBook{val remaining=hosts.filterNot{it.hostId==id};return HostBook(remaining,activeHostId?.takeIf{selected->remaining.any{it.hostId==selected}}?:remaining.firstOrNull()?.hostId)}
    fun renamed(id:String,name:String):HostBook{require(name.trim().length in 1..80);return copy(hosts=hosts.map{if(it.hostId==id)it.copy(name=name.trim())else it})}
}

val Host.label:String get()=name.ifBlank{"电脑 · ${hostId.take(6)}"}

/** A host change clears every piece of transient data belonging to the old computer. */
fun DeckState.forHost(book:HostBook)=DeckState(host=book.active,hosts=book.hosts,connection=if(book.active==null)"未配对" else "正在连接",preferences=preferences,busy=busy)
