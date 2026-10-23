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
            "upstream.turn.completed"->{
                candidates.remove("terminal:$session")
                if(taskNotificationTitle(event,now)!=null){
                    val payload=event.payload as JsonObject
                    put("terminal:$session",event.copy(payload=buildJsonObject{put("upstreamTurnId",payload.getValue("upstreamTurnId"));put("status",payload.getValue("status"))}))
                }
            }
            "turn.started"->candidates.remove("terminal:$session")
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

    fun drain(hostId:String,snapshot:Snapshot,now:Instant=Instant.now(),includeNative:Boolean=false):List<DeckEvent> {
        val buffered=candidates.values.toList();clear()
        if(snapshot.host?.hostId!=hostId)return emptyList()
        return buffered.mapNotNull{refreshReplayNotification(it,snapshot,now,includeNative)}.sortedBy{it.eventId.toLong()}
    }
}

/** Revalidate again immediately before publishing: earlier native reads may have suspended. */
internal fun refreshReplayNotification(event:DeckEvent,snapshot:Snapshot,now:Instant=Instant.now(),includeNative:Boolean=false):DeckEvent? {
    val session=snapshot.sessions.find{it.sessionId==event.sessionId}?:return null
    return when(event.action){
        "approval.requested"->{
            val prior=pendingNotificationApproval(event,now)?:return null
            val current=snapshot.approvals.find{it.approvalId==prior.approvalId&&it.sessionId==event.sessionId&&it.turnId==event.turnId&&notificationApprovalActive(it,now)}?:return null
            event.copy(payload=wire.encodeToJsonElement(Approval.serializer(),current.copy(context=JsonObject(emptyMap()),allowedDecisions=emptyList())))
        }
        "upstream.turn.completed"->event.takeIf{includeNative&&taskNotificationTitle(it,now)!=null}
        "turn.completed","turn.failed","turn.interrupted"->{
            val status=event.action.removePrefix("turn.")
            event.takeIf{session.status==status&&snapshot.turns.any{it.turnId==event.turnId&&it.sessionId==session.sessionId&&it.status==status}}
        }
        else->null
    }
}
