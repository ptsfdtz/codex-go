package dev.agentdeck.app

import java.time.Instant
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class TaskNotificationsTest {
    private val now=Instant.parse("2026-10-21T12:00:00Z")
    private fun event(action:String,payload:JsonElement=JsonNull)=DeckEvent(eventId="42",seq=1,sessionId="session",turnId="turn",action=action,payload=payload,ts=now.toString())
    private fun native(status:JsonElement,id:JsonElement=JsonPrimitive("native-turn"))=event("upstream.turn.completed",buildJsonObject{put("status",status);put("upstreamTurnId",id);put("error","private diagnostic")})
    private val approval=Approval("approval","session","turn","command","pending",expiresAt="2026-10-21T12:01:00Z")
    private fun approvalEvent(value:Approval=approval)=event("approval.requested",wire.encodeToJsonElement(Approval.serializer(),value))

    @Test fun nativeCompletionUsesActualTerminalState(){
        for((status,title) in mapOf("completed" to "Codex 任务已完成","failed" to "Codex 任务失败","interrupted" to "Codex 任务已中断")){
            assertEquals(title,taskNotificationTitle(native(JsonPrimitive(status)),now))
        }
        assertEquals("Codex 任务失败",taskNotificationTitle(event("turn.failed"),now))
    }

    @Test fun malformedOrUnknownNativeEventsNeverClaimSuccess(){
        for(status in listOf(JsonNull,JsonPrimitive(1),JsonPrimitive("running"),JsonPrimitive("unknown"))){
            assertNull(taskNotificationTitle(native(status),now))
        }
        assertNull(taskNotificationTitle(native(JsonPrimitive("completed"),JsonPrimitive("")),now))
        assertNull(taskNotificationTitle(native(JsonPrimitive("completed"),JsonPrimitive(1)),now))
        assertNull(taskNotificationTitle(event("upstream.turn.completed",JsonArray(emptyList())),now))
        assertNull(taskNotificationTitle(event("upstream.progress"),now))
    }

    @Test fun approvalsRequireMatchingIdentityAndActionableUnexpiredState(){
        assertEquals("Codex 请求人工审批",taskNotificationTitle(approvalEvent(),now))
        for(invalid in listOf(approval.copy(sessionId="other"),approval.copy(turnId="other"),approval.copy(approvalId=""),approval.copy(status="sending"),approval.copy(status="approved"),approval.copy(expiresAt=now.toString()),approval.copy(expiresAt="invalid"))){
            assertNull(taskNotificationTitle(approvalEvent(invalid),now))
        }
    }

    @Test fun snapshotReconciliationRetainsOnlyPendingFutureApprovals(){
        assertTrue(notificationApprovalActive(approval,now))
        assertFalse(notificationApprovalActive(approval,Instant.parse(approval.expiresAt)))
        assertFalse(notificationApprovalActive(approval.copy(status="expired"),now))
        assertFalse(notificationApprovalActive(approval.copy(status="sending"),now))
    }
}
