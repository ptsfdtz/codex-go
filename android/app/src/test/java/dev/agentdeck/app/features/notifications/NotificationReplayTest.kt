package dev.agentdeck.app

import java.time.Instant
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class NotificationReplayTest {
    private val now=Instant.parse("2026-10-21T12:00:00Z")
    private val session=Session("session","grant","native","task","completed")
    private val turn=Turn("turn","session",status="completed")
    private val approval=Approval("approval","session","turn","command","pending",context=buildJsonObject{put("private","output")},expiresAt="2026-10-21T12:01:00Z")
    private val snapshot=Snapshot(host=HostState("host","ready","test"),sessions=listOf(session),turns=listOf(turn),approvals=listOf(approval))
    private fun event(id:String="42",action:String="turn.completed",payload:JsonElement=JsonNull)=DeckEvent(eventId=id,seq=1,sessionId="session",turnId="turn",action=action,payload=payload,ts=now.toString())
    private fun requested(id:String="41")=event(id,"approval.requested",wire.encodeToJsonElement(Approval.serializer(),approval))

    @Test fun committedReplayCandidatesDrainOnceInEventOrderWithoutPrivatePayload(){
        val replay=NotificationReplay()
        replay.observe(event(payload=buildJsonObject{put("private","large output")}),now)
        replay.observe(requested(),now)
        val ready=replay.drain("host",snapshot,now)
        assertEquals(listOf("41","42"),ready.map{it.eventId})
        assertFalse(ready.toString().contains("large output"))
        assertFalse(ready.toString().contains("private"))
        assertTrue(replay.drain("host",snapshot,now).isEmpty())
    }

    @Test fun wrongHostDeletedSessionAndSupersedingTaskDoNotNotify(){
        for(state in listOf(snapshot.copy(host=HostState("other","ready","test")),snapshot.copy(sessions=emptyList()),snapshot.copy(sessions=listOf(session.copy(status="running"))),snapshot.copy(turns=emptyList()))){
            val replay=NotificationReplay();replay.observe(event(),now)
            assertTrue(replay.drain("host",state,now).isEmpty())
        }
        val replay=NotificationReplay();replay.observe(event(),now);replay.observe(event("43","turn.started"),now)
        assertTrue(replay.drain("host",snapshot,now).isEmpty())
    }

    @Test fun resolvedSendingAndExpiredApprovalsAreNotReplayed(){
        val replay=NotificationReplay();replay.observe(requested(),now)
        replay.observe(event("42","approval.resolved",buildJsonObject{put("approvalId","approval")}),now)
        assertTrue(replay.drain("host",snapshot,now).isEmpty())
        for(approvals in listOf(emptyList(),listOf(approval.copy(status="sending")),listOf(approval.copy(expiresAt=now.toString())))){
            replay.observe(requested(),now)
            assertTrue(replay.drain("host",snapshot.copy(approvals=approvals),now).isEmpty())
        }
    }

    @Test fun replayUsesCurrentApprovalExpiryAndKeepsNoContext(){
        val replay=NotificationReplay();replay.observe(requested(),now)
        val current=approval.copy(expiresAt="2026-10-21T12:00:30Z")
        val result=replay.drain("host",snapshot.copy(approvals=listOf(current)),now).single()
        val decoded=wire.decodeFromJsonElement(Approval.serializer(),result.payload)
        assertEquals(current.expiresAt,decoded.expiresAt)
        assertTrue(decoded.context.isEmpty())
    }

    @Test fun boundedBufferEvictsOldestAndGapClearsAllCandidates(){
        val replay=NotificationReplay(1);replay.observe(requested(),now);replay.observe(event(),now)
        assertEquals(listOf("42"),replay.drain("host",snapshot,now).map{it.eventId})
        replay.observe(event(),now);replay.clear()
        assertTrue(replay.drain("host",snapshot,now).isEmpty())
        replay.observe(event().copy(ts="x".repeat(4097)),now)
        assertTrue(replay.drain("host",snapshot,now).isEmpty())
    }

    @Test fun nativeCompletionDoesNotUseLocalTurnIdentityAsProof(){
        val replay=NotificationReplay();replay.observe(event(),now)
        replay.observe(event("43","upstream.turn.completed",buildJsonObject{put("upstreamTurnId","native-turn");put("status","completed")}),now)
        assertTrue(replay.drain("host",snapshot,now).isEmpty())
    }
}
