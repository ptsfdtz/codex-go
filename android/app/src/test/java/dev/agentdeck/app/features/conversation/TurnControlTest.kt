package dev.agentdeck.app

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class TurnControlTest {
    @Test fun finishedTurnRefreshesWithoutSendingOrConsumingDraft()=runBlocking {
        val calls=mutableListOf<String>()
        var refreshed=false
        var accepted=false
        try {
            steerActiveTurn("s","继续",{action,_->calls+=action;buildJsonObject{put("sessionId","s");put("upstreamTurnId",JsonNull)}},{refreshed=true},{accepted=true})
            fail("Finished turn accepted")
        } catch(e:DeckException){assertEquals("TURN_FINISHED",e.code)}
        assertEquals(listOf("turn.active"),calls)
        assertTrue(refreshed)
        assertFalse(accepted)
    }

    @Test fun completionRaceRefreshesAndNeverFallsBackToStart()=runBlocking {
        val calls=mutableListOf<String>()
        var refreshed=false
        try {
            steerActiveTurn("s","继续",{action,_->
                calls+=action
                if(action=="turn.steer")throw DeckException("TURN_CHANGED","changed")
                payload("sessionId" to "s","upstreamTurnId" to "native")
            },{refreshed=true},{fail("Rejected steer consumed draft")})
            fail("Changed turn accepted")
        }catch(e:DeckException){assertEquals("TURN_CHANGED",e.code)}
        assertEquals(listOf("turn.active","turn.steer"),calls)
        assertTrue(refreshed)
    }

    @Test fun unknownOutcomeDoesNotResendOrConsumeDraft()=runBlocking {
        val calls=mutableListOf<String>()
        try {
            steerActiveTurn("s","继续",{action,_->
                calls+=action
                if(action=="turn.steer")throw DeckException("OUTCOME_UNKNOWN","unknown")
                payload("sessionId" to "s","upstreamTurnId" to "native")
            },{fail("Unknown outcome treated as finished")},{fail("Unknown send consumed draft")})
            fail("Unknown send accepted")
        }catch(e:DeckException){assertEquals("OUTCOME_UNKNOWN",e.code)}
        assertEquals(listOf("turn.active","turn.steer"),calls)
    }
}
