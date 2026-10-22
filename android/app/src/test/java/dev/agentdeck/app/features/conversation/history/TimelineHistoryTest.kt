package dev.agentdeck.app

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class TimelineHistoryTest {
    private fun item(turn:String,id:String,text:String,type:String="agentMessage")=buildJsonObject {
        put("turnId",turn);put("item",buildJsonObject {
            put("type",type);put("id",id)
            if(type=="userMessage")put("content",buildJsonArray{add(buildJsonObject{put("type","text");put("text",text)})})else put("text",text)
        })
    }
    private fun event(id:Int,turn:String,text:String,completed:Boolean=false)=DeckEvent(eventId="$id",seq=id.toLong(),sessionId="s",action="upstream.progress",ts="now",payload=buildJsonObject {
        put("upstreamTurnId",turn)
        if(completed){put("method","item/completed");put("item",item(turn,"a",text).getValue("item"))}
        else{put("method","item/agentMessage/delta");put("itemId","a");put("delta",text)}
    })
    @Test fun reconnectRecoversSavedAnswerWithoutConcatenatingOverlappingDelta(){
        val rows=conversationTimeline("s",listOf(event(1,"t","Hello")),listOf(item("t","a","Hello world")),emptyList())
        assertEquals(1,rows.size);assertEquals("Hello world",rows.single().text)
        assertNotEquals("completed",rows.single().status)
        val complete=conversationTimeline("s",listOf(event(1,"t","Hello"),event(2,"t","Hello world!",true),event(3,"t","late")),listOf(item("t","a","Hello world")),emptyList())
        assertEquals(1,complete.size);assertEquals("Hello world!",complete.single().text)
        assertEquals("completed",complete.single().status)
    }
    @Test fun originalLocalInputAndAssistantUseTheSameNativeIdentityAsSavedHistory(){
        val turns=listOf(Turn("local","s","native","completed"))
        val input=DeckEvent(eventId="1",seq=1,sessionId="s",turnId="local",action="turn.queued",ts="now",payload=payload("text" to "Question"))
        val live=event(2,"native","Answer",true).copy(turnId="local",action="turn.progress")
        val saved=listOf(item("native","u","Question","userMessage"),item("native","a","Answer"))
        val rows=conversationTimeline("s",listOf(input,live),saved,turns)
        assertEquals(listOf("Question","Answer"),rows.map{it.text})
        assertEquals(2,rows.map{it.id}.distinct().size)
    }
    @Test fun sourceIdentityNeverMergesTwoTurnsAndOlderJournalKeepsItsPosition(){
        val rows=conversationTimeline("s",listOf(event(1,"old","Old",true),event(2,"recent","Recent",true),event(3,"new","New")),listOf(item("recent","a","Recent")),emptyList())
        assertEquals(listOf("Old","Recent","New"),rows.map{it.text})
        assertEquals(3,rows.map{it.id}.distinct().size)
    }
    @Test fun descendingPagesPrependChronologicallyAndRefreshReplacesPriorSnapshot(){
        val first=historyPageLoaded(TimelineHistory(sessionId="s"),UpstreamHistoryPage(listOf(item("b","a","B")),"older"),false)
        val older=historyPageLoaded(first,UpstreamHistoryPage(listOf(item("a","a","A")),null),true)
        assertEquals(listOf("A","B"),conversationTimeline("s",emptyList(),older.entries,emptyList()).map{it.text})
        val refreshed=historyPageLoaded(older,UpstreamHistoryPage(listOf(item("c","a","C")),null),false)
        assertEquals(listOf("C"),conversationTimeline("s",emptyList(),refreshed.entries,emptyList()).map{it.text})
        assertTrue(refreshed.usedCursors.isEmpty())
    }
    @Test fun pagingCycleAndMissingNativeIdentityAreRejected(){
        val state=TimelineHistory(sessionId="s",nextCursor="b",loaded=true,usedCursors=setOf("a"))
        assertThrows(IllegalArgumentException::class.java){historyPageLoaded(state,UpstreamHistoryPage(emptyList(),"a"),true)}
        assertThrows(IllegalArgumentException::class.java){mergeHistoryPage(emptyList(),listOf(item("","a","Invalid")),false)}
        assertEquals("b",state.nextCursor)
    }
    @Test fun savedOutputDoesNotInventCompletion(){
        val row=persistedChatEntry("s",item("t","a","Saved incomplete output"))
        assertEquals("saved",row.status);assertEquals("assistant",row.kind)
    }
}
