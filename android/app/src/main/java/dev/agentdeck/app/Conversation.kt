package dev.agentdeck.app

import kotlinx.serialization.json.*

data class ChatEntry(val id:String,val kind:String,val text:String,val title:String="",val status:String="",val detail:String="",val truncated:Boolean=false)

/** Project durable bridge events into messages; completed items replace their streamed preview. */
fun conversationEntries(events:List<DeckEvent>):List<ChatEntry> {
    val rows=linkedMapOf<String,ChatEntry>()
    val seen=hashSetOf<String>()
    for(e in events){
        if(!seen.add(e.eventId))continue
        val p=e.payload as? JsonObject?:continue
        fun JsonObject.string(key:String)=(get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()
        val prefix="${e.sessionId}:${e.turnId}:"
        if((p["truncated"] as? JsonPrimitive)?.booleanOrNull==true)rows[prefix+"truncated:"+e.eventId]=ChatEntry(prefix+"truncated:"+e.eventId,"status","部分执行内容超过保留上限，预览已截断。完整内容请在 Windows 工作区核对。")
        if(e.action=="turn.queued"){
            val files=(p["attachments"] as? JsonArray).orEmpty().mapNotNull{(it as? JsonPrimitive)?.contentOrNull}
            val text=p.string("text")+if(files.isEmpty())"" else "\n\n附件："+files.joinToString("、")
            if(text.isNotBlank())rows[prefix+"user"]=ChatEntry(prefix+"user","user",text)
            continue
        }
        if(e.action=="turn.steered"){
            rows[prefix+"steer:"+e.eventId]=ChatEntry(prefix+"steer:"+e.eventId,"user",p.string("text"),title="已追加")
            continue
        }
        if(e.action in listOf("turn.interruptRequested","upstream.turn.completed")){
            val native=p.string("upstreamTurnId")
            if(native.isNotBlank()){
                val key="${e.sessionId}:upstream:$native:result"
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
            rows[prefix+"result"]=ChatEntry(prefix+"result","status",statusLabel(status),status=status,detail=turn?.string("error").orEmpty())
            continue
        }
        val method=p.string("method")
        val item=p["item"] as? JsonObject
        val id=prefix+(item?.string("id")?.ifBlank{null}?:p.string("itemId").ifBlank{e.eventId})
        val old=rows[id]
        if(method.endsWith("/delta")||method.endsWith("/outputDelta")){
            val kind=when(method){"item/agentMessage/delta"->"assistant";"item/plan/delta"->"plan";else->"tool"}
            val delta=p.string("delta")
            // Late deltas must not duplicate the authoritative completed item.
            if(old?.status!="completed"&&delta.isNotEmpty()){
                val combined=old?.text.orEmpty()+if(old?.truncated==true)"" else delta
                rows[id]=(old?:ChatEntry(id,kind,"",if(kind=="tool")"执行命令" else "")).copy(text=combined.take(128000),truncated=old?.truncated==true||combined.length>128000)
            }
        }else if(item!=null&&method in listOf("item/started","item/completed")){
            val type=item.string("type")
            val completed=method=="item/completed"
            val status=if(completed)"completed" else item.string("status")
            when(type){
                "agentMessage","plan"->{val text=item.string("text").ifEmpty{old?.text.orEmpty()};rows[id]=ChatEntry(id,if(type=="agentMessage")"assistant" else "plan",text.take(128000),status=status,truncated=text.length>128000||(item.string("text").isEmpty()&&old?.truncated==true))}
                // turn.queued owns user messages, avoiding an echo from item/userMessage.
                "userMessage"->Unit
                "reasoning"->Unit
                else->{
                    val title=when(type){"commandExecution"->item.string("command");"fileChange"->"修改文件";"mcpToolCall"->item.string("tool");else->"执行步骤"}
                    val output=if(type=="commandExecution")item.string("aggregatedOutput").ifEmpty{old?.text.orEmpty()} else (item["changes"] as? JsonArray)?.joinToString("\n"){(it as? JsonObject)?.string("path").orEmpty()}.orEmpty()
                    rows[id]=ChatEntry(id,"tool",output,title,item.string("status").ifBlank{if(completed)"completed" else "inProgress"},item.toString())
                }
            }
        }else if(method=="error"){
            rows[id]=ChatEntry(id,"status","执行遇到错误",status="failed",detail=p.toString())
        }
    }
    return rows.values.filter{it.kind=="tool"||it.text.isNotBlank()}.toList()
}
