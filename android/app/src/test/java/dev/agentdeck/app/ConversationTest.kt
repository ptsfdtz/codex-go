package dev.agentdeck.app

import org.junit.Assert.*
import org.junit.Test
import kotlinx.serialization.json.*

class ConversationTest {
    @Test fun externalStopWaitsForAuthorityAndLateRequestDoesNotOverwriteTerminal(){
        val pending=event(1,"""{"upstreamTurnId":"native"}""",action="turn.interruptRequested")
        val terminal=event(2,"""{"upstreamTurnId":"native","status":"interrupted"}""",action="upstream.turn.completed")
        assertEquals("stopping",conversationEntries(listOf(pending)).single().status)
        assertEquals("interrupted",conversationEntries(listOf(pending,terminal)).single().status)
        assertEquals("interrupted",conversationEntries(listOf(terminal,pending,terminal)).single().status)
    }
    @Test fun appendedInstructionsPreserveOriginalMessageAndReplayDoesNotDuplicate(){
        val original=event(1,"""{"text":"Original"}""",action="turn.queued")
        val appended=event(2,"""{"text":"Additional","upstreamTurnId":"native-turn"}""",action="turn.steered")
        val rows=conversationEntries(listOf(original,appended,appended))
        assertEquals(listOf("Original","Additional"),rows.map{it.text})
        assertEquals(listOf("user","user"),rows.map{it.kind})
    }
    private fun event(id:Int,payload:String,turn:String="t",action:String="turn.progress")=DeckEvent(eventId="$id",seq=id.toLong(),sessionId="s",turnId=turn,action=action,payload=wire.parseToJsonElement(payload),ts="now")
    @Test fun streamIsReplacedByCompleteMessageAndReplayIsDeduplicated(){
        val a=event(1,"""{"method":"item/agentMessage/delta","itemId":"a","delta":"Hello"}""")
        val rows=conversationEntries(listOf(a,a,event(2,"""{"method":"item/agentMessage/delta","itemId":"a","delta":" world"}"""),event(3,"""{"method":"item/completed","item":{"id":"a","type":"agentMessage","text":"Hello world!"}}"""),event(4,"""{"method":"item/agentMessage/delta","itemId":"a","delta":"late"}""")))
        assertEquals(1,rows.size);assertEquals("Hello world!",rows.single().text)
    }
    @Test fun userEchoAndProtocolNoiseDoNotBecomeMessages(){
        val rows=conversationEntries(listOf(event(1,"""{"text":"Fix this"}""",action="turn.queued"),event(2,"""{"method":"item/started","item":{"id":"u","type":"userMessage","content":[]}}"""),event(3,"""{"method":"turn/started","turn":{"status":"inProgress"}}""")))
        assertEquals(listOf("user"),rows.map{it.kind});assertEquals("Fix this",rows.single().text)
    }
    @Test fun toolLifecycleUpdatesOneRowEvenWithInterleavedAssistant(){
        val rows=conversationEntries(listOf(event(1,"""{"method":"item/started","item":{"id":"c","type":"commandExecution","command":"git status","status":"inProgress"}}"""),event(2,"""{"method":"item/agentMessage/delta","itemId":"a","delta":"Checking"}"""),event(3,"""{"method":"item/commandExecution/outputDelta","itemId":"c","delta":"partial"}"""),event(4,"""{"method":"item/completed","item":{"id":"c","type":"commandExecution","command":"git status","status":"completed","aggregatedOutput":"clean","exitCode":0}}""")))
        assertEquals(2,rows.size);assertEquals("clean",rows.first().text);assertEquals("completed",rows.first().status);assertEquals("Checking",rows.last().text)
    }
    @Test fun sameItemIdInDifferentTurnsNeverMergesAndStartIsNotCompletion(){
        val rows=conversationEntries(listOf(event(1,"""{"method":"item/agentMessage/delta","itemId":"a","delta":"one"}"""),event(2,"""{"method":"item/agentMessage/delta","itemId":"a","delta":"two"}""","t2"),event(3,"""{"method":"turn/started","turn":{"status":"inProgress"}}""","t2")))
        assertEquals(listOf("one","two"),rows.map{it.text});assertFalse(rows.any{it.kind=="status"})
    }
    @Test fun authoritativeFailureIsSeparateFromCommandSuccess(){
        val rows=conversationEntries(listOf(event(1,"""{"turn":{"status":"failed","error":"upstream failed"}}""",action="turn.failed")))
        assertEquals("failed",rows.single().status);assertEquals("upstream failed",rows.single().detail)
    }
    @Test fun retainedPayloadTruncationRemainsVisibleWithoutInventingCompletion(){
        val rows=conversationEntries(listOf(event(1,"""{"method":"item/completed","truncated":true,"originalBytes":999999}""")))
        assertTrue(rows.single().text.contains("截断"));assertFalse(rows.any{it.status=="completed"})
    }
    @Test fun longMessageKeepsBeginningAndMarksPreviewThenUsesAuthoritativeText(){
        val long=buildJsonObject{put("method","item/agentMessage/delta");put("itemId","a");put("delta","START"+"x".repeat(128000))}.toString()
        val first=event(1,long)
        val preview=conversationEntries(listOf(first)).single()
        assertTrue(preview.truncated);assertTrue(preview.text.startsWith("START"));assertEquals(128000,preview.text.length)
        val final=conversationEntries(listOf(first,event(2,"""{"method":"item/completed","item":{"id":"a","type":"agentMessage","text":"Authoritative"}}"""))).single()
        assertFalse(final.truncated);assertEquals("Authoritative",final.text)
    }
}
