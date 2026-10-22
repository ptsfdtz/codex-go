package dev.agentdeck.app

import kotlinx.serialization.json.*

data class ChatEntry(val id:String,val kind:String,val text:String,val title:String="",val status:String="",val detail:String="",val truncated:Boolean=false,val sourceTurn:String?=null,val sourceItem:String?=null)

/** Project durable bridge events into messages; completed items replace their streamed preview. */
fun conversationEntries(events:List<DeckEvent>,turns:List<Turn> = emptyList()):List<ChatEntry> {
    val nativeTurns=turns.filter{!it.upstreamTurnId.isNullOrBlank()}.associate{it.turnId to it.upstreamTurnId!!}.toMutableMap()
    for(e in events){val p=e.payload as? JsonObject?:continue;val t=p["turn"] as? JsonObject;val native=(t?.get("upstreamTurnId") as? JsonPrimitive)?.contentOrNull?:if((p["method"] as? JsonPrimitive)?.contentOrNull=="turn/started")(t?.get("id") as? JsonPrimitive)?.contentOrNull else null;if(e.turnId!=null&&!native.isNullOrBlank())nativeTurns[e.turnId]=native}
    val identities=mutableMapOf<String,Pair<String?,String?>>()
    val rows=linkedMapOf<String,ChatEntry>()
    val seen=hashSetOf<String>()
    val reasoningParts=mutableMapOf<String,MutableMap<Pair<Boolean,Int>,String>>()
    for(e in events){
        if(!seen.add(e.eventId))continue
        val p=e.payload as? JsonObject?:continue
        fun JsonObject.string(key:String)=(get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()
        val native=p.string("upstreamTurnId").ifBlank{nativeTurns[e.turnId].orEmpty()}
        val prefix=if(native.isNotBlank())"${e.sessionId}:upstream:$native:" else "${e.sessionId}:${e.turnId}:"
        if((p["truncated"] as? JsonPrimitive)?.booleanOrNull==true)rows[prefix+"truncated:"+e.eventId]=ChatEntry(prefix+"truncated:"+e.eventId,"status","部分执行内容超过保留上限，预览已截断。完整内容请在 Windows 工作区核对。")
        if(e.action=="turn.queued"){
            val files=(p["attachments"] as? JsonArray).orEmpty().mapNotNull{(it as? JsonPrimitive)?.contentOrNull}
            val skills=(p["skills"] as? JsonArray).orEmpty().mapNotNull{(it as? JsonPrimitive)?.contentOrNull}
            val text=p.string("text")+(if(files.isEmpty())"" else "\n\n附件："+files.joinToString("、"))+(if(skills.isEmpty())"" else "\n\n技能："+skills.joinToString("、"))
            identities[prefix+"user"]=native.ifBlank{null} to null
            if(text.isNotBlank())rows[prefix+"user"]=ChatEntry(prefix+"user","user",text)
            continue
        }
        if(e.action=="turn.steered"){
            identities[prefix+"steer:"+e.eventId]=native.ifBlank{null} to null
            rows[prefix+"steer:"+e.eventId]=ChatEntry(prefix+"steer:"+e.eventId,"user",p.string("text"),title="已追加")
            continue
        }
        if(e.action in listOf("turn.interruptRequested","upstream.turn.completed")){
            val native=p.string("upstreamTurnId")
            if(native.isNotBlank()){
                val key="${e.sessionId}:upstream:$native:result"
                identities[key]=native to null
                if(e.action=="upstream.turn.completed"){
                    val status=p.string("status")
                    if(status in listOf("completed","failed","interrupted"))rows[key]=ChatEntry(key,"status",statusLabel(status),status=status,detail=p.string("error"))
                }else if(rows[key]?.status !in listOf("completed","failed","interrupted"))rows[key]=ChatEntry(key,"status","已请求停止，等待 Codex 确认",status="stopping")
                continue
            }
        }
        if(e.action in listOf("turn.completed","turn.failed","turn.interrupted")){
            val turn=p["turn"] as? JsonObject
            val status=turn?.string("status")?.ifBlank{null}?:e.action.substringAfter('.')
            identities[prefix+"result"]=native.ifBlank{null} to null
            rows[prefix+"result"]=ChatEntry(prefix+"result","status",statusLabel(status),status=status,detail=turn?.string("error").orEmpty())
            continue
        }
        val method=p.string("method")
        if(method=="turn/plan/updated"){
            val key=prefix+"plan-progress"
            val steps=(p["plan"] as? JsonArray).orEmpty().mapNotNull{it as? JsonObject}
            val body=steps.joinToString("\n"){step->val marker=when(step.string("status")){"completed"->"✓";"inProgress"->"→";else->"○"};"$marker ${step.string("step")}"}
            val explanation=p.string("explanation")
            val text=listOf(explanation,body).filter{it.isNotBlank()}.joinToString("\n\n")
            identities[key]=native.ifBlank{null} to null
            rows[key]=ChatEntry(key,"tool",text.take(128000),"计划进度 · ${steps.count{it.string("status")=="completed"}}/${steps.size}",if(steps.isNotEmpty()&&steps.all{it.string("status")=="completed"})"completed" else "inProgress",p.toString(),text.length>128000)
            continue
        }
        if(method=="turn/diff/updated"){
            val key=prefix+"turn-diff"
            val diff=p.string("diff")
            identities[key]=native.ifBlank{null} to null
            rows[key]=ChatEntry(key,"tool",diff.take(128000),"本轮累计改动","",p.toString(),diff.length>128000)
            continue
        }
        val item=p["item"] as? JsonObject
        val id=prefix+(item?.string("id")?.ifBlank{null}?:p.string("itemId").ifBlank{e.eventId})
        identities[id]=native.ifBlank{null} to (item?.string("id")?.ifBlank{null}?:p.string("itemId").ifBlank{null})
        val old=rows[id]
        if(method.startsWith("item/reasoning/")&&method in listOf("item/reasoning/summaryTextDelta","item/reasoning/textDelta","item/reasoning/summaryPartAdded")){
            if(old?.status=="completed")continue
            val summary=method!="item/reasoning/textDelta"
            val index=(p[if(summary)"summaryIndex" else "contentIndex"] as? JsonPrimitive)?.intOrNull?:continue
            if(index !in 0..1023)continue
            val parts=reasoningParts.getOrPut(id){mutableMapOf()}
            val part=summary to index
            if(part !in parts&&parts.size>=128)continue
            val delta=if(method.endsWith("summaryPartAdded"))"" else p.string("delta")
            val budget=(128000-parts.values.sumOf{it.length}).coerceAtLeast(0)
            parts[part]=parts[part].orEmpty()+delta.take(budget)
            val ordered=parts.entries.sortedWith(compareBy({!it.key.first},{it.key.second}))
            val body=ordered.joinToString("\n\n"){it.value}
            val detail=buildJsonObject{put("type","reasoning");put("id",p.string("itemId"));put("summary",JsonArray(ordered.filter{it.key.first}.map{JsonPrimitive(it.value)}));put("content",JsonArray(ordered.filter{!it.key.first}.map{JsonPrimitive(it.value)}))}
            rows[id]=ChatEntry(id,"tool",body.take(128000),"思考过程","inProgress",detail.toString(),old?.truncated==true||delta.length>budget||body.length>128000)
        }else if(method=="item/mcpToolCall/progress"){
            if(old?.status=="completed")continue
            val message=p.string("message")
            if(message.isNotBlank()){
                val combined=listOf(old?.text.orEmpty(),message).filter{it.isNotBlank()}.joinToString("\n")
                rows[id]=(old?:ChatEntry(id,"tool","","工具进度",status="inProgress")).copy(text=combined.take(128000),truncated=old?.truncated==true||combined.length>128000)
            }
        }else if(method.endsWith("/delta")||method.endsWith("/outputDelta")){
            val kind=when(method){"item/agentMessage/delta"->"assistant";"item/plan/delta"->"plan";else->"tool"}
            val delta=p.string("delta")
            // Late deltas must not duplicate the authoritative completed item.
            if(old?.status!="completed"&&delta.isNotEmpty()){
                val combined=old?.text.orEmpty()+if(old?.truncated==true)"" else delta
                rows[id]=(old?:ChatEntry(id,kind,"",if(method.startsWith("item/reasoning/"))"思考过程" else if(kind=="tool")"执行命令" else "")).copy(text=combined.take(128000),truncated=old?.truncated==true||combined.length>128000)
            }
        }else if(item!=null&&method in listOf("item/started","item/completed")){
            val type=item.string("type")
            val completed=method=="item/completed"
            val status=if(completed)"completed" else item.string("status")
            when(type){
                "agentMessage","plan"->{val text=item.string("text").ifEmpty{old?.text.orEmpty()};rows[id]=nativeItemEntry(id,item,status).copy(text=text.take(128000),status=status,truncated=text.length>128000||(item.string("text").isEmpty()&&old?.truncated==true))}
                // turn.queued owns user messages, avoiding an echo from item/userMessage.
                "userMessage"->if(e.action=="upstream.progress")rows[id]=nativeItemEntry(id,item,status)
                else->{
                    val presented=nativeItemEntry(id,item,if(completed)"completed" else "inProgress")
                    rows[id]=if(type=="commandExecution"&&presented.text.isEmpty()&&old!=null)presented.copy(text=old.text,truncated=old.truncated) else presented
                }
            }
        }else if(method=="error"){
            rows[id]=ChatEntry(id,"status","执行遇到错误",status="failed",detail=p.toString())
        }
    }
    return rows.values.filter(::hasVisibleMessageContent).map{row->identities[row.id]?.let{row.copy(sourceTurn=it.first,sourceItem=it.second)}?:row}
}
