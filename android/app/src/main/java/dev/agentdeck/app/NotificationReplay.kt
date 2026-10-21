package dev.agentdeck.app

import java.time.Instant
import kotlinx.serialization.json.*

/** Bounded notification hints, never a second event journal. Recheck against a fresh snapshot. */
internal class NotificationReplay(private val limit:Int=128) {
    init { require(limit in 1..128) }
    private val candidates=linkedMapOf<String,DeckEvent>()

    fun observe(event:DeckEvent,now:Instant=Instant.now()) {
        val session=event.sessionId?:return
        when(event.action){
            "approval.requested"->{
                val approval=pendingNotificationApproval(event,now)?:return
                val safe=approval.copy(context=JsonObject(emptyMap()),allowedDecisions=emptyList())
                put("approval:${approval.approvalId}",event.copy(payload=wire.encodeToJsonElement(Approval.serializer(),safe)))
            }
            "approval.resolved"->{
                val id=((event.payload as? JsonObject)?.get("approvalId") as? JsonPrimitive)?.contentOrNull
                if(id!=null)candidates.remove("approval:$id")
            }
            "turn.completed","turn.failed","turn.interrupted"->{
                if(event.turnId!=null)put("terminal:$session",event.copy(payload=JsonNull))
            }
            "turn.started","upstream.turn.completed"->candidates.remove("terminal:$session")
            "upstream.progress"->{
                if(((event.payload as? JsonObject)?.get("method") as? JsonPrimitive)?.contentOrNull=="turn/started")candidates.remove("terminal:$session")
            }
        }
    }

    private fun put(key:String,event:DeckEvent){
        if(wire.encodeToString(DeckEvent.serializer(),event).length>4096)return
        candidates.remove(key);candidates[key]=event
        while(candidates.size>limit)candidates.remove(candidates.keys.first())
    }

    fun clear(){candidates.clear()}

    fun drain(hostId:String,snapshot:Snapshot,now:Instant=Instant.now()):List<DeckEvent> {
        val buffered=candidates.values.toList();clear()
        if(snapshot.host?.hostId!=hostId)return emptyList()
        return buffered.mapNotNull{event->
            val session=snapshot.sessions.find{it.sessionId==event.sessionId}?:return@mapNotNull null
            if(event.action=="approval.requested"){
                val prior=pendingNotificationApproval(event,now)?:return@mapNotNull null
                val current=snapshot.approvals.find{it.approvalId==prior.approvalId&&it.sessionId==event.sessionId&&it.turnId==event.turnId&&notificationApprovalActive(it,now)}?:return@mapNotNull null
                event.copy(payload=wire.encodeToJsonElement(Approval.serializer(),current.copy(context=JsonObject(emptyMap()),allowedDecisions=emptyList())))
            }else{
                val status=event.action.removePrefix("turn.")
                event.takeIf{session.status==status&&snapshot.turns.any{it.turnId==event.turnId&&it.sessionId==session.sessionId&&it.status==status}}
            }
        }.sortedBy{it.eventId.toLong()}
    }
}
