package dev.agentdeck.app

import org.junit.Assert.*
import org.junit.Test

class NotificationTargetTest {
    private val host=Host("https://example.test","pin","computer-one","device","credential")
    private val session=Session("same-id","grant","native-thread","task","completed")
    private val ready=DeckState(host=host,stale=false,snapshot=Snapshot(host=HostState(host.hostId,"ready","test"),sessions=listOf(session)))

    @Test fun identicalSessionIdsOnDifferentComputersNeverMatch(){
        val target=NotificationTarget("computer-two",session.sessionId)
        assertNull(target.session(ready))
        assertNull(target.session(ready.copy(host=host.copy(hostId="computer-two"))))
        assertEquals(session,NotificationTarget(host.hostId,session.sessionId).session(ready))
    }

    @Test fun offlineCacheAndDeletedOrUnauthorizedSessionDoNotOpen(){
        val target=NotificationTarget(host.hostId,session.sessionId)
        assertNull(target.session(ready.copy(stale=true)))
        assertNull(target.session(ready.copy(snapshot=ready.snapshot.copy(sessions=emptyList()))))
        assertNull(target.session(ready.copy(snapshot=ready.snapshot.copy(host=null))))
    }

    @Test fun malformedOrIncompleteDestinationIsRejected(){
        assertNull(NotificationTarget.parse(null,"task"))
        assertNull(NotificationTarget.parse("host"," "))
        assertNull(NotificationTarget.parse("x".repeat(513),"task"))
        assertEquals(NotificationTarget("host","task"),NotificationTarget.parse("host","task"))
    }
}
