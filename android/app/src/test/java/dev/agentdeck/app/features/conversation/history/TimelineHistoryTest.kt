package dev.agentdeck.app

import kotlinx.serialization.json.*
import kotlinx.coroutines.runBlocking
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
    @Test fun descendingPagesPrependChronologicallyAndRefreshPreservesLoadedRange(){
        val first=historyPageLoaded(TimelineHistory(sessionId="s"),UpstreamHistoryPage(listOf(item("b","a","B")),"older"),false)
        val older=historyPageLoaded(first,UpstreamHistoryPage(listOf(item("a","a","A")),null),true)
        assertEquals(listOf("A","B"),conversationTimeline("s",emptyList(),older.entries,emptyList()).map{it.text})
        val refreshed=historyPageLoaded(older,UpstreamHistoryPage(listOf(item("c","a","C"),item("b","a","B updated")),"head-next"),false)
        assertEquals(listOf("A","B updated","C"),conversationTimeline("s",emptyList(),refreshed.entries,emptyList()).map{it.text})
        assertNull(refreshed.nextCursor)
        assertEquals(older.usedCursors,refreshed.usedCursors)
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
    private fun user(id:Int,text:String)=DeckEvent(eventId="$id",seq=id.toLong(),sessionId="s",action="upstream.progress",ts="now",payload=buildJsonObject{
        put("upstreamTurnId","t");put("method","item/completed");put("item",item("t","u",text,"userMessage").getValue("item"))
    })
    @Test fun partialSavedTurnKeepsLiveQuestionBeforeItsAnswer(){
        val events=listOf(user(1,"Question"),event(2,"t","Answer",true))
        val partial=listOf(item("t","a","Answer"))
        assertEquals(listOf("Question","Answer"),conversationTimeline("s",events,partial,emptyList()).map{it.text})
        val older=mergeHistoryPage(partial,listOf(item("t","u","Question","userMessage")),true)
        assertEquals(listOf("Question","Answer"),conversationTimeline("s",events,older,emptyList()).map{it.text})
    }
    @Test fun localQuestionAndSteeringStayBeforeTheirFollowingNativeItems(){
        val turns=listOf(Turn("local","s","t","running"))
        val queued=DeckEvent(eventId="1",seq=1,sessionId="s",turnId="local",action="turn.queued",ts="now",payload=payload("text" to "Question"))
        val first=event(2,"t","First",true)
        val steer=DeckEvent(eventId="3",seq=3,sessionId="s",turnId="local",action="turn.steered",ts="now",payload=payload("text" to "Follow up","upstreamTurnId" to "t"))
        val second=event(4,"t","Second",true).let{it.copy(payload=JsonObject(it.payload.jsonObject+mapOf("item" to item("t","b","Second").getValue("item"))))}
        val saved=listOf(item("t","a","First"),item("t","b","Second"))
        assertEquals(listOf("Question","First","Follow up","Second"),conversationTimeline("s",listOf(queued,first,steer,second),saved,turns).map{it.text})
    }
    @Test fun emptyOrOlderSavedPreviewDoesNotEraseVisibleStreamingText(){
        val stream=listOf(event(1,"t","Hello world"))
        for(saved in listOf("","Hello"))assertEquals("Hello world",conversationTimeline("s",stream,listOf(item("t","a",saved)),emptyList()).single().text)
        val queued=DeckEvent(eventId="1",seq=1,sessionId="s",turnId="local",action="turn.queued",ts="now",payload=payload("text" to "Question"))
        val rows=conversationTimeline("s",listOf(queued),listOf(item("t","u","","userMessage")),listOf(Turn("local","s","t","running")))
        assertEquals(listOf("Question"),rows.map{it.text})
    }
    @Test fun refreshBridgesNewHeadToLoadedPagesAndPreservesOldestCursor()=runBlocking{
        val current=TimelineHistory("s",listOf(item("a","a","A"),item("b","a","B")),"older",loaded=true,usedCursors=setOf("used"))
        val requested=mutableListOf<String?>()
        val refreshed=refreshTimelineHistory(current){cursor->
            requested.add(cursor)
            when(cursor){null->UpstreamHistoryPage(listOf(item("d","a","D")),"gap");"gap"->UpstreamHistoryPage(listOf(item("c","a","C"),item("b","a","B updated")),"unused");else->error("Unexpected request")}
        }
        assertEquals(listOf(null,"gap"),requested)
        assertEquals(listOf("A","B updated","C","D"),conversationTimeline("s",emptyList(),refreshed.entries,emptyList()).map{it.text})
        assertEquals("older",refreshed.nextCursor);assertEquals(setOf("used"),refreshed.usedCursors)
        val paged=historyPageLoaded(refreshed,UpstreamHistoryPage(listOf(item("a","a","Stale A"),item("zero","a","Earlier")),null),true)
        assertEquals(listOf("Earlier","A","B updated","C","D"),conversationTimeline("s",emptyList(),paged.entries,emptyList()).map{it.text})
    }
    @Test fun exhaustedRefreshReplacesRemovedSourceAndCursorCyclesAreRejected()=runBlocking{
        val current=TimelineHistory("s",listOf(item("old","a","Removed")),"older",loaded=true)
        val replaced=refreshTimelineHistory(current){UpstreamHistoryPage(listOf(item("new","a","Replacement")),null)}
        assertEquals(listOf("Replacement"),conversationTimeline("s",emptyList(),replaced.entries,emptyList()).map{it.text})
        var failed=false
        try{refreshTimelineHistory(current){UpstreamHistoryPage(listOf(item("new","a","New")),"same")}}catch(_:IllegalArgumentException){failed=true}
        assertTrue(failed)
    }
    @Test fun liveNativeIdentityKeepsQuestionWithAnswerWithoutSnapshotTurn(){
        val queued=DeckEvent(eventId="1",seq=1,sessionId="s",turnId="local",action="turn.queued",ts="now",payload=payload("text" to "Question"))
        val answer=event(2,"t","Answer",true).copy(turnId="local",action="turn.progress")
        val events=listOf(queued,answer)
        val partial=listOf(item("t","a","Answer"))
        assertEquals(listOf("Question","Answer"),conversationTimeline("s",events,partial,emptyList()).map{it.text})
        val older=mergeHistoryPage(partial,listOf(item("t","u","Question","userMessage")),true)
        val rows=conversationTimeline("s",events,older,emptyList())
        assertEquals(listOf("Question","Answer"),rows.map{it.text})
        assertEquals(listOf("t","t"),rows.map{it.sourceTurn})
    }
    @Test fun disjointHeadRefreshAppendsWhileOlderPagePrepends(){
        val current=listOf(item("b","a","B"))
        val refreshed=mergeHistoryPage(current,listOf(item("c","a","C")),false)
        assertEquals(listOf("B","C"),refreshed.map{persistedChatEntry("s",it).text})
        val older=mergeHistoryPage(refreshed,listOf(item("a","a","A")),true)
        assertEquals(listOf("A","B","C"),older.map{persistedChatEntry("s",it).text})
    }

    @Test fun disjointSavedSuffixUsesRecordedTimesToKeepEarlierLiveMessagesFirst(){
        fun timedEvent(n:Int,text:String)=event(n,"t",text,true).let{e->
            e.copy(ts="2026-10-23T00:00:0${n}Z",payload=JsonObject(e.payload.jsonObject+mapOf("item" to item("t","m$n",text).getValue("item"))))
        }
        fun timedItem(n:Int,text:String)=JsonObject(item("t","m$n",text)+mapOf("startedAtMs" to JsonPrimitive(java.time.Instant.parse("2026-10-23T00:00:0${n}Z").toEpochMilli())))
        val events=listOf(timedEvent(1,"First"),timedEvent(2,"Second"),timedEvent(5,"Latest"))
        val suffix=listOf(timedItem(3,"Third"),timedItem(4,"Fourth"))
        val expected=listOf("First","Second","Third","Fourth","Latest")
        assertEquals(expected,conversationTimeline("s",events,suffix,emptyList()).map{it.text})
        val older=mergeHistoryPage(suffix,listOf(timedItem(2,"Second"),timedItem(1,"First")),true)
        assertEquals(expected,conversationTimeline("s",events,older,emptyList()).map{it.text})
    }

}
