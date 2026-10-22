package dev.agentdeck.app

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class LatestTurnTest {
    private val session=Session("s","p","native","task","idle")
    private fun response(thread:String="idle",turn:String="t",status:String="completed")=buildJsonObject{
        put("contractVersion",1);put("sessionId","s");put("upstreamThreadId","native");put("threadStatus",thread)
        put("turn",buildJsonObject{put("upstreamTurnId",turn);put("status",status)})
    }
    private val event=DeckEvent(eventId="1",seq=1,sessionId="s",action="upstream.turn.completed",payload=buildJsonObject{put("upstreamTurnId","t");put("status","completed")},ts="2026-10-21T12:00:00Z")

    @Test fun onlySameIdleTerminalCanConfirmReplay(){
        assertTrue(decodeLatestTurn(response(),session).confirms(event))
        assertFalse(decodeLatestTurn(response(thread="active"),session).confirms(event))
        assertFalse(decodeLatestTurn(response(turn="new"),session).confirms(event))
        assertFalse(decodeLatestTurn(response(status="inProgress"),session).confirms(event))
        assertFalse(decodeLatestTurn(response(status="failed"),session).confirms(event))
    }
    @Test fun changedIdentityVersionAndMissingOrUnknownFieldsFailClosed(){
        val valid=response()
        for(changes in listOf(mapOf("contractVersion" to JsonPrimitive(2)),mapOf("sessionId" to JsonPrimitive("other")),mapOf("upstreamThreadId" to JsonPrimitive("other")),mapOf("threadStatus" to JsonPrimitive("future")),mapOf("turn" to JsonPrimitive(1)))){
            try{decodeLatestTurn(JsonObject(valid+changes),session);fail("Invalid response accepted")}catch(_:IllegalArgumentException){}catch(_:IllegalStateException){}
        }
        try{decodeLatestTurn(JsonObject(valid.filterKeys{it!="turn"}),session);fail("Missing turn accepted")}catch(_:IllegalArgumentException){}
    }
    @Test fun emptyHistoryDoesNotMeanCompletion(){
        val empty=decodeLatestTurn(JsonObject(response()+mapOf("turn" to JsonNull)),session)
        assertNull(empty.turnId);assertFalse(empty.confirms(event))
    }
    @Test fun nativeReplayIsOptInAndDropsErrorContent(){
        val snapshot=Snapshot(host=HostState("h","ready","test"),sessions=listOf(session))
        val replay=NotificationReplay()
        replay.observe(event.copy(payload=JsonObject(event.payload.jsonObject+mapOf("error" to JsonPrimitive("private")))))
        val candidate=replay.drain("h",snapshot,includeNative=true).single()
        assertFalse(candidate.payload.toString().contains("private"))
        assertTrue(decodeLatestTurn(response(),session).confirms(candidate))
    }
}
