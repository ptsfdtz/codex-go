package dev.agentdeck.app

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class QuestionRepliesTest {
    @Test fun nativeHistoryReconcilesOnlyMatchingQuestionIdentityAndSession(){
        val question=ChatEntry("e","assistant","",detail="""{"id":"call","questions":[{"title":"First"},{"title":"Second"}]}""")
        val answer=ChatEntry("user","user",questionAnswerText(question,mapOf("1" to "B")),sourceItem="native-user")
        val key=QuestionKey("pc","s","e");var saved=""
        val replies=QuestionReplies(save={saved=it})
        replies.edit(key,"1","B");replies.claim(key)
        val restored=QuestionReplies(saved)
        restored.reconcile("pc","other",listOf(question,answer))
        assertEquals(ReplyPhase.Unknown,restored.state.value[key]?.phase)
        restored.reconcile("pc","s",listOf(question))
        assertEquals(ReplyPhase.Unknown,restored.state.value[key]?.phase)
        restored.reconcile("pc","s",listOf(question,answer.copy(kind="assistant")))
        assertEquals(ReplyPhase.Unknown,restored.state.value[key]?.phase)
        restored.reconcile("pc","s",listOf(question,answer.copy(sourceItem=null)))
        assertEquals(ReplyPhase.Unknown,restored.state.value[key]?.phase)
        restored.reconcile("pc","s",listOf(question,answer))
        assertEquals(ReplyPhase.Editing,restored.state.value[key]?.phase)
        assertEquals(setOf("1"),restored.state.value[key]?.submittedIds)
        restored.reconcile("pc","s",listOf(question,answer,ChatEntry("other","user",questionAnswerText(question,mapOf("0" to "A")),sourceItem="other-native")))
        assertEquals(ReplyPhase.Sent,restored.state.value[key]?.phase)
        assertNull(restored.claim(key))
        assertTrue(restored.state.value[key]!!.answers.isEmpty())
    }
    @Test fun partialSubmissionLeavesRemainingQuestionsEditable(){
        var saved="";val key=QuestionKey("pc","s","q");val replies=QuestionReplies(save={saved=it})
        replies.edit(key,"0","A");replies.claim(key);replies.accepted(key,setOf("0"),setOf("0","1"))
        assertEquals(ReplyPhase.Editing,replies.state.value[key]?.phase)
        replies.edit(key,"0","cannot resend")
        assertTrue(replies.state.value.getValue(key).answers.isEmpty())
        val restored=QuestionReplies(saved)
        restored.edit(key,"1","B");assertEquals(mapOf("1" to "B"),restored.claim(key)?.answers)
        restored.accepted(key,setOf("1"),setOf("0","1"))
        assertEquals(ReplyPhase.Sent,restored.state.value[key]?.phase)
    }
    @Test fun processRestartRetainsReceiptsButNeverAnswers(){
        var saved=""
        val replies=QuestionReplies(save={saved=it});val key=QuestionKey("pc","s","q")
        replies.edit(key,"a","private answer");replies.claim(key)
        assertFalse(saved.contains("private answer"))
        val restored=QuestionReplies(saved)
        assertEquals(ReplyPhase.Unknown,restored.state.value[key]?.phase)
        assertNull(restored.claim(key))
        replies.finish(key,ReplyPhase.Sent)
        assertEquals(ReplyPhase.Sent,QuestionReplies(saved).state.value[key]?.phase)
    }
    @Test fun claimIsImmediateAndIndependentOfOtherQuestions(){
        val replies=QuestionReplies()
        val first=QuestionKey("pc1","s1","q")
        val other=QuestionKey("pc2","s1","q")
        replies.edit(first,"a","one")
        assertEquals("one",replies.claim(first)?.answers?.get("a"))
        assertNull(replies.claim(first))
        replies.edit(first,"a","changed while sending")
        replies.edit(other,"a","two")
        assertEquals("two",replies.claim(other)?.answers?.get("a"))
        replies.finish(first,ReplyPhase.Sent)
        assertTrue(replies.state.value.getValue(first).answers.isEmpty())
        assertNull(replies.claim(first))
        assertEquals(ReplyPhase.Sending,replies.state.value.getValue(other).phase)
    }
    @Test fun unknownCannotBeResubmittedAndRejectedReplyKeepsAnswers(){
        val replies=QuestionReplies();val key=QuestionKey("pc","s","q")
        replies.edit(key,"a","keep this")
        replies.claim(key);replies.finish(key,ReplyPhase.Editing,"offline")
        assertEquals("keep this",replies.claim(key)?.answers?.get("a"))
        replies.finish(key,ReplyPhase.Unknown,"check")
        assertNull(replies.claim(key))
        replies.retainHosts(setOf("pc"),emptySet())
        assertEquals(ReplyPhase.Unknown,replies.state.value[key]?.phase)
        assertTrue(replies.state.value.getValue(key).answers.isEmpty())
        replies.retainHosts(setOf("pc"))
        assertNull(replies.claim(key))
        replies.retainHosts(emptySet())
        assertTrue(replies.state.value.isEmpty())
    }
    @Test fun runningAnswerSteersOriginalSessionAndExpectedTurn()=runTest{
        val calls=mutableListOf<Pair<String,JsonObject>>()
        deliverMessageAnswer("original","answer",payload("sessionId" to "original","text" to "answer")){method,params->
            calls+=method to params
            if(method=="turn.active")buildJsonObject{put("sessionId","original");put("upstreamTurnId","native-turn")}
            else buildJsonObject{put("sessionId","original");put("upstreamTurnId","native-turn");put("accepted",true)}
        }
        assertEquals(listOf("turn.active","turn.steer"),calls.map{it.first})
        assertEquals("native-turn",calls.last().second["expectedTurnId"]?.jsonPrimitive?.content)
    }
    @Test fun endedAnswerStartsOnceAndSteerRaceNeverStartsNewTurn()=runTest{
        val methods=mutableListOf<String>()
        deliverMessageAnswer("s","answer",payload("sessionId" to "s","text" to "answer")){method,_->
            methods+=method
            if(method=="turn.active")buildJsonObject{put("sessionId","s");put("upstreamTurnId",JsonNull)}
            else buildJsonObject{put("turn",buildJsonObject{put("sessionId","s")})}
        }
        assertEquals(listOf("turn.active","turn.start"),methods)
        methods.clear()
        try{
            deliverMessageAnswer("s","answer",payload("sessionId" to "s")){method,_->
                methods+=method
                if(method=="turn.active")payload("sessionId" to "s","upstreamTurnId" to "old")
                else throw DeckException("TURN_CHANGED","changed")
            }
            fail("steer race must remain rejected")
        }catch(e:DeckException){assertEquals("TURN_CHANGED",e.code)}
        assertEquals(listOf("turn.active","turn.steer"),methods)
    }
    @Test fun partialAnswersPreserveQuestionOrderAndDoNotIncludeUnanswered(){
        val entry=ChatEntry("e","assistant","",detail="""{"id":"call_1","questions":[{"title":"First"},{"title":"Second"},{"title":"Third"}]}""")
        val text=questionAnswerText(entry,mapOf("2" to "C\n\"quoted\"","0" to "A","1" to " "))
        val answers=wire.parseToJsonElement(text.substringAfter('\n').substringBeforeLast('\n')).jsonArray
        assertEquals(2,answers.size)
        assertEquals("First",answers[0].jsonObject["question"]?.jsonPrimitive?.content)
        assertEquals("[\"request_user_input_async\",\"call_1\",2]",answers[1].jsonObject["questionItemId"]?.jsonPrimitive?.content)
        assertEquals("C\n\"quoted\"",answers[1].jsonObject["answer"]?.jsonPrimitive?.content)
        assertEquals("First\nA\n\nThird\nC\n\"quoted\"",questionReplyDisplayText(text))
        assertEquals("normal message",questionReplyDisplayText("normal message"))
    }
}
