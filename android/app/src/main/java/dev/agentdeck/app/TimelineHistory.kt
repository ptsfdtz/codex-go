package dev.agentdeck.app

import kotlinx.serialization.json.*

data class TimelineHistory(val sessionId:String?=null,val entries:List<JsonObject> = emptyList(),val nextCursor:String?=null,val loaded:Boolean=false,val loading:Boolean=false,val error:String?=null,val usedCursors:Set<String> = emptySet())

private fun JsonObject.timelineString(key:String)=(get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()

/** Native persisted items are content, never fabricated journal events. */
internal fun persistedChatEntry(sessionId:String,entry:JsonObject):ChatEntry {
    val turn=entry.timelineString("turnId")
    val item=entry["item"] as? JsonObject?:error("历史内容缺少原始记录")
    val itemId=item.timelineString("id")
    require(turn.isNotBlank()&&itemId.isNotBlank()){"历史内容身份无效"}
    val id="$sessionId:upstream:$turn:$itemId"
    val type=item.timelineString("type")
    val text=when(type){
        "agentMessage","plan"->item.timelineString("text")
        "userMessage"->(item["content"] as? JsonArray).orEmpty().joinToString("\n"){part->val content=part as? JsonObject;if(content?.timelineString("type")=="text")content.timelineString("text") else "[${content?.timelineString("type")?:"附件"}]"}
        "commandExecution"->item.timelineString("aggregatedOutput")
        "fileChange"->(item["changes"] as? JsonArray).orEmpty().joinToString("\n"){(it as? JsonObject)?.timelineString("path").orEmpty()}
        else->item.toString()
    }
    val kind=when(type){"agentMessage"->"assistant";"plan"->"plan";"userMessage"->"user";else->"tool"}
    val title=when(type){"commandExecution"->item.timelineString("command");"fileChange"->"修改文件";else->type}
    // Persistence alone does not establish that an active item or turn finished.
    return ChatEntry(id,kind,text.take(128000),title,status=item.timelineString("status").ifBlank{"saved"},detail=item.toString(),truncated=text.length>128000,sourceTurn=turn,sourceItem=itemId)
}

internal fun conversationTimeline(sessionId:String,events:List<DeckEvent>,history:List<JsonObject>,turns:List<Turn>):List<ChatEntry> {
    val groups=linkedMapOf<String,LinkedHashMap<String,ChatEntry>>()
    val sourceUsers=hashSetOf<String>()
    val saved=history.map{persistedChatEntry(sessionId,it)}
    val live=conversationEntries(events.filter{it.sessionId==sessionId},turns.filter{it.sessionId==sessionId})
    for(row in saved+live)if(row.kind=="user"&&row.sourceItem!=null)row.sourceTurn?.let{sourceUsers.add(it)}
    for(row in saved){groups.getOrPut(row.sourceTurn!!){linkedMapOf()}[row.id]=row}
    for(row in live){
        // The first native user item replaces Bridge's optimistic initial input.
        if(row.kind=="user"&&row.sourceItem==null&&row.sourceTurn in sourceUsers&&row.id.endsWith(":user"))continue
        val group=groups.getOrPut(row.sourceTurn?:"journal:${row.id}"){linkedMapOf()}
        val persisted=group[row.id]
        // Delta boundaries and history snapshots are not a shared cursor. Never
        // concatenate a persisted prefix with possibly overlapping streamed text.
        if(persisted==null||row.status=="completed")group[row.id]=row
    }
    val order=saved.mapNotNull{it.sourceTurn}.distinct().toMutableList()
    val liveOrder=live.map{it.sourceTurn?:"journal:${it.id}"}.distinct()
    for((index,key) in liveOrder.withIndex())if(key !in order){val following=liveOrder.drop(index+1).firstOrNull{it in order};if(following==null)order.add(key)else order.add(order.indexOf(following),key)}
    return order.flatMap{groups[it]?.values.orEmpty()}.filter{it.kind=="tool"||it.text.isNotBlank()}
}

internal fun mergeHistoryPage(current:List<JsonObject>,descending:List<JsonObject>,older:Boolean):List<JsonObject> {
    val ordered=descending.asReversed()
    val result=linkedMapOf<Pair<String,String>,JsonObject>()
    for(entry in if(older)ordered+current else ordered){
        val item=entry["item"] as? JsonObject?:error("历史内容身份无效")
        val key=entry.timelineString("turnId") to item.timelineString("id")
        require(key.first.isNotBlank()&&key.second.isNotBlank()){"历史内容身份无效"}
        result[key]=entry
    }
    require(result.values.sumOf{it.toString().toByteArray(Charsets.UTF_8).size.toLong()}<=16L*1024*1024){"会话内容较大，请使用历史分页查看更早内容"}
    return result.values.toList()
}

internal fun historyPageLoaded(current:TimelineHistory,page:UpstreamHistoryPage,older:Boolean):TimelineHistory {
    val used=if(older)current.usedCursors+listOfNotNull(current.nextCursor) else emptySet()
    require(page.nextCursor==null||page.nextCursor !in used){"历史游标重复，请刷新会话"}
    return TimelineHistory(current.sessionId,mergeHistoryPage(current.entries,page.entries,older),page.nextCursor,loaded=true,usedCursors=used)
}
