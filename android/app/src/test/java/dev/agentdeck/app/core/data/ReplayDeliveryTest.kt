package dev.agentdeck.app

import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ReplayDeliveryTest {
    private val original=Session("s","p","native","task","idle")
    private fun event(id:Int=1)=DeckEvent(eventId=id.toString(),seq=id.toLong(),sessionId="s",action="upstream.turn.completed",payload=buildJsonObject{put("upstreamTurnId","t");put("status","completed")},ts="2026-10-21T12:00:00Z")
    private val latest=LatestTurn("idle","t","completed")

    @Test fun connectionSwitchDuringReadStopsAllDelivery()=runTest{
        var current=true
        val delayed=CompletableDeferred<LatestTurn>()
        val sent=mutableListOf<DeckEvent>()
        val job=launch{deliverReplayNotifications(listOf(event(),event(2)),{current},{true},{original},{delayed.await()},{sent.add(it)})}
        runCurrent();current=false;delayed.complete(latest);job.join()
        assertTrue(sent.isEmpty())
    }
    @Test fun changedProjectOrNativeThreadDuringReadCannotPublish()=runTest{
        for(replacement in listOf(original.copy(projectId="revoked"),original.copy(upstreamThreadId="other"))){
            var current=original
            deliverReplayNotifications(listOf(event()),{true},{true},{current},{current=replacement;latest},{fail("Changed mapping published")})
        }
    }
    @Test fun timedOutCandidateDoesNotPreventFollowingNotification()=runTest{
        val sent=mutableListOf<String>()
        var reads=0
        deliverReplayNotifications(listOf(event(),event(2)),{true},{true},{original},{if(reads++==0)delay(5000);latest},{sent.add(it.eventId)})
        assertEquals(listOf("2"),sent)
        assertEquals(4000L,currentTime)
    }
    @Test fun parentCancellationPropagatesAndNeverPublishes()=runTest{
        val job=launch{deliverReplayNotifications(listOf(event()),{true},{true},{original},{awaitCancellation()},{fail("Cancelled read published")})}
        runCurrent();job.cancelAndJoin();assertTrue(job.isCancelled)
    }
    @Test fun limitsAndCapabilityGateBoundAuthorityRequests()=runTest{
        var reads=0;var sent=0
        deliverReplayNotifications((1..12).map(::event),{true},{true},{original},{reads++;latest},{sent++})
        assertEquals(8,reads);assertEquals(8,sent)
        deliverReplayNotifications(listOf(event()),{true},{false},{original},{fail("Unsupported request");latest},{fail("Unsupported event")})
    }
    @Test fun readFailureAndNewerTurnSkipOnlyThatCandidate()=runTest{
        var reads=0
        val sent=mutableListOf<String>()
        deliverReplayNotifications((1..3).map(::event),{true},{true},{original},{when(reads++){0->error("read failed");1->latest.copy(turnId="new");else->latest}},{sent.add(it.eventId)})
        assertEquals(listOf("3"),sent)
    }

    @Test fun approvalResolvedDuringEarlierNativeReadIsNotPublished()=runTest{
        val now=java.time.Instant.parse("2026-10-21T12:00:00Z")
        val approval=Approval("a","s","local-turn","command","pending",expiresAt="2026-10-21T12:01:00Z")
        val request=event(2).copy(action="approval.requested",turnId="local-turn",payload=wire.encodeToJsonElement(Approval.serializer(),approval))
        var state=Snapshot(host=HostState("h","ready","test"),sessions=listOf(original),approvals=listOf(approval))
        val delayed=CompletableDeferred<LatestTurn>()
        val sent=mutableListOf<String>()
        val job=launch{deliverReplayNotifications(listOf(event(),request),{true},{true},{original},{delayed.await()},{sent.add(it.eventId)},refresh={refreshReplayNotification(it,state,now,true)})}
        runCurrent();state=state.copy(approvals=emptyList());delayed.complete(latest);job.join()
        assertEquals(listOf("1"),sent)
    }

    @Test fun terminalSupersededWhileWaitingIsNotPublished()=runTest{
        val terminal=event(2).copy(action="turn.completed",turnId="local-turn")
        var state=Snapshot(sessions=listOf(original.copy(status="completed")),turns=listOf(Turn("local-turn","s",status="completed")))
        val sent=mutableListOf<String>()
        deliverReplayNotifications(listOf(event(),terminal),{true},{true},{original},{state=state.copy(sessions=listOf(original.copy(status="running")));latest},{sent.add(it.eventId)},refresh={refreshReplayNotification(it,state,includeNative=true)})
        assertEquals(listOf("1"),sent)
    }

    @Test fun publishingRefreshUsesNewApprovalExpiryAndDropsUnknownActions()=runTest{
        val now=java.time.Instant.parse("2026-10-21T12:00:00Z")
        val old=Approval("a","s","local-turn","command","pending",expiresAt="2026-10-21T12:01:00Z")
        val current=old.copy(expiresAt="2026-10-21T12:00:30Z")
        val request=event().copy(action="approval.requested",turnId="local-turn",payload=wire.encodeToJsonElement(Approval.serializer(),old))
        val state=Snapshot(sessions=listOf(original),approvals=listOf(current))
        val updated=refreshReplayNotification(request,state,now)!!
        assertEquals(current.expiresAt,wire.decodeFromJsonElement(Approval.serializer(),updated.payload).expiresAt)
        assertNull(refreshReplayNotification(request,state,java.time.Instant.parse(current.expiresAt)))
        assertNull(refreshReplayNotification(event().copy(action="future.event"),state,now))
    }
}
