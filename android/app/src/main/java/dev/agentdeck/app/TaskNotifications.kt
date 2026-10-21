package dev.agentdeck.app

import java.time.Instant
import kotlinx.serialization.json.*

internal fun pendingNotificationApproval(event:DeckEvent,now:Instant):Approval? {
    if(event.action!="approval.requested")return null
    val approval=runCatching{wire.decodeFromJsonElement(Approval.serializer(),event.payload)}.getOrNull()?:return null
    return approval.takeIf{it.approvalId.isNotBlank()&&it.sessionId==event.sessionId&&it.turnId==event.turnId&&notificationApprovalActive(it,now)}
}

internal fun notificationApprovalActive(approval:Approval,now:Instant)=
    approval.status=="pending"&&runCatching{Instant.parse(approval.expiresAt).isAfter(now)}.getOrDefault(false)

internal fun taskNotificationTitle(event:DeckEvent,now:Instant=Instant.now()):String?=when(event.action){
    "approval.requested"->if(pendingNotificationApproval(event,now)!=null)"Codex 请求人工审批" else null
    "turn.completed"->"Codex 任务已完成"
    "turn.failed"->"Codex 任务失败"
    "turn.interrupted"->"Codex 任务已中断"
    "upstream.turn.completed"->{
        val payload=event.payload as? JsonObject
        val id=payload?.get("upstreamTurnId") as? JsonPrimitive
        val status=payload?.get("status") as? JsonPrimitive
        if(id?.isString!=true||id.content.isBlank()||status?.isString!=true)null
        else when(status.content){"completed"->"Codex 任务已完成";"failed"->"Codex 任务失败";"interrupted"->"Codex 任务已中断";else->null}
    }
    else->null
}
