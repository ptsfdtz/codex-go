package dev.agentdeck.app

import kotlinx.serialization.json.*

data class TimelineHistory(val sessionId:String?=null,val entries:List<JsonObject> = emptyList(),val nextCursor:String?=null,val loaded:Boolean=false,val loading:Boolean=false,val error:String?=null,val usedCursors:Set<String> = emptySet())

private fun JsonObject.timelineString(key:String)=(get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()

/** Insert missing observations beside their next shared anchor, never after the entire turn. */
private fun <T> timelineOrder(primary:List<T>,secondary:List<T>):List<T>{
    val result=primary.distinct().toMutableList()
    val present=result.toHashSet()
    val pending=mutableListOf<T>()
    for(key in secondary.distinct()){
        if(key in present){
            if(pending.isNotEmpty()){result.addAll(result.indexOf(key),pending);present.addAll(pending);pending.clear()}
        }else pending.add(key)
    }
    result.addAll(pending)
    return result
}

/** Unknown timestamps stay beside the next dated anchor instead of using invented dates. */
private fun <T> timelineChronology(order:List<T>,times:Map<T,Long>):List<T>{
    var next=Long.MAX_VALUE
    val positions=mutableMapOf<T,Long>()
    for(key in order.asReversed()){
        times[key]?.let{next=it}
        positions[key]=next
    }
    return order.sortedBy{positions.getValue(it)}
}

/** Native persisted items are content, never fabricated journal events. */
internal fun persistedChatEntry(sessionId:String,entry:JsonObject):ChatEntry {
    val turn=entry.timelineString("turnId")
    val item=entry["item"] as? JsonObject?:error("历史内容缺少原始记录")
    val itemId=item.timelineString("id")
    require(turn.isNotBlank()&&itemId.isNotBlank()){"历史内容身份无效"}
    val id="$sessionId:upstream:$turn:$itemId"
    return nativeItemEntry(id,item).copy(sourceTurn=turn,sourceItem=itemId,startedAtMs=(entry["startedAtMs"] as? JsonPrimitive)?.longOrNull?.takeIf{it>=0})
}

internal fun conversationTimeline(sessionId:String,events:List<DeckEvent>,history:List<JsonObject>,turns:List<Turn>):List<ChatEntry> {
    val groups=linkedMapOf<String,LinkedHashMap<String,ChatEntry>>()
    val sourceUsers=hashSetOf<String>()
    val saved=history.map{persistedChatEntry(sessionId,it)}
    val live=conversationEntries(events.filter{it.sessionId==sessionId},turns.filter{it.sessionId==sessionId})
    for(row in saved+live)if(row.kind=="user"&&row.sourceItem!=null&&hasVisibleMessageContent(row))row.sourceTurn?.let{sourceUsers.add(it)}
    for(row in saved){groups.getOrPut(row.sourceTurn!!){linkedMapOf()}[row.id]=row}
    for(row in live){
        // The first native user item replaces Bridge's optimistic initial input.
        if(row.kind=="user"&&row.sourceItem==null&&row.sourceTurn in sourceUsers&&row.id.endsWith(":user"))continue
        val group=groups.getOrPut(row.sourceTurn?:"journal:${row.id}"){linkedMapOf()}
        val persisted=group[row.id]
        // Delta boundaries and history snapshots are not a shared cursor. Never
        // concatenate a persisted prefix with possibly overlapping streamed text.
        if(persisted==null||!hasVisibleMessageContent(persisted)||row.status=="completed"||
            (row.text.length>persisted.text.length&&row.text.startsWith(persisted.text)))group[row.id]=row
    }
    val order=saved.mapNotNull{it.sourceTurn}.distinct()
    val liveOrder=live.map{it.sourceTurn?:"journal:${it.id}"}.distinct()
    val savedItems=saved.groupBy{it.sourceTurn}
    val liveItems=live.groupBy{it.sourceTurn?:"journal:${it.id}"}
    // Persisted time is authoritative; journal time supplies positions for items
    // outside the loaded page. Without either, retain the neighboring anchor.
    val times=(live+saved).filter{it.startedAtMs!=null}.associate{it.id to it.startedAtMs!!}
    return timelineOrder(order,liveOrder).flatMap{turn->
        val group=groups[turn].orEmpty()
        timelineChronology(timelineOrder(savedItems[turn].orEmpty().map{it.id},liveItems[turn].orEmpty().map{it.id}),times)
            .mapNotNull{group[it]}
    }.filter(::hasVisibleMessageContent)
}

private fun historyIdentity(entry:JsonObject):Pair<String,String>{
    val item=entry["item"] as? JsonObject?:error("历史内容身份无效")
    return (entry.timelineString("turnId") to item.timelineString("id")).also{
        require(it.first.isNotBlank()&&it.second.isNotBlank()){"历史内容身份无效"}
    }
}

internal fun mergeHistoryPage(current:List<JsonObject>,descending:List<JsonObject>,older:Boolean):List<JsonObject> {
    val ordered=descending.asReversed()
    val result=linkedMapOf<Pair<String,String>,JsonObject>()
    val primary=if(older)ordered else current
    val secondary=if(older)current else ordered
    for(entry in primary+secondary)result[historyIdentity(entry)]=entry
    require(result.values.sumOf{it.toString().toByteArray(Charsets.UTF_8).size.toLong()}<=16L*1024*1024){"会话内容较大，请使用历史分页查看更早内容"}
    return timelineOrder(primary.map(::historyIdentity),secondary.map(::historyIdentity)).map{result.getValue(it)}
}

internal fun historyPageLoaded(current:TimelineHistory,page:UpstreamHistoryPage,older:Boolean):TimelineHistory {
    val used=if(older)current.usedCursors+listOfNotNull(current.nextCursor) else emptySet()
    require(page.nextCursor==null||page.nextCursor !in used){"历史游标重复，请刷新会话"}
    // A refresh extends the newest end, while paging extends the oldest end.
    // Keep the oldest cursor unless the refreshed range actually reaches it.
    val reachesOldest=current.entries.firstOrNull()?.let{old->page.entries.any{historyIdentity(it)==historyIdentity(old)}}==true
    val keepCursor=!older&&current.loaded&&current.entries.isNotEmpty()&&!reachesOldest
    return TimelineHistory(current.sessionId,mergeHistoryPage(current.entries,page.entries,older),if(keepCursor)current.nextCursor else page.nextCursor,loaded=true,usedCursors=if(keepCursor)current.usedCursors else used)
}

/** Fetch through the gap before publishing a new head; retained pages stay contiguous. */
internal suspend fun refreshTimelineHistory(current:TimelineHistory,read:suspend (String?)->UpstreamHistoryPage):TimelineHistory{
    val known=current.entries.map(::historyIdentity).toHashSet()
    val descending=mutableListOf<JsonObject>()
    val cursors=hashSetOf<String>()
    var cursor:String?=null
    var bytes=0L
    while(true){
        val page=read(cursor)
        for(entry in page.entries){historyIdentity(entry);bytes+=entry.toString().toByteArray(Charsets.UTF_8).size}
        require(bytes<=16L*1024*1024){"会话内容较大，请使用历史分页查看更早内容"}
        descending.addAll(page.entries)
        val overlap=page.entries.any{historyIdentity(it) in known}
        if(known.isEmpty()||overlap||page.nextCursor==null){
            // No shared identity after exhausting native history means the source
            // was replaced; do not resurrect entries removed by that source.
            val base=if(known.isNotEmpty()&&!overlap&&page.nextCursor==null)current.copy(entries=emptyList(),usedCursors=emptySet()) else current
            return historyPageLoaded(base,UpstreamHistoryPage(descending,page.nextCursor),false)
        }
        require(cursors.add(page.nextCursor)){"历史游标重复，请刷新会话"}
        cursor=page.nextCursor
    }
}
