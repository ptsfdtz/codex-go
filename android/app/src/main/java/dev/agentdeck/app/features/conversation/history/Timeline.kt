package dev.agentdeck.app

import kotlinx.serialization.json.*

/** UI projection only: durable event IDs and cursors remain unchanged in Room. */
fun timelineEvents(events:List<DeckEvent>):List<DeckEvent> {
    val result=ArrayList<DeckEvent>()
    for(event in events){
        val data=event.payload as? JsonObject
        val method=data?.get("method")?.jsonPrimitive?.contentOrNull
        val previous=result.lastOrNull()
        val old=previous?.payload as? JsonObject
        val delta=data?.get("delta")?.jsonPrimitive?.contentOrNull
        val oldDelta=old?.get("delta")?.jsonPrimitive?.contentOrNull
        if(method in listOf("item/agentMessage/delta","item/commandExecution/outputDelta","item/plan/delta") && delta!=null && oldDelta!=null && old?.get("method")==data["method"] && old["itemId"]==data["itemId"] && previous.turnId==event.turnId && oldDelta.length+delta.length<=16000){
            result[result.lastIndex]=previous.copy(payload=JsonObject(old+mapOf("delta" to JsonPrimitive(oldDelta+delta))))
        }else result.add(event)
    }
    return result
}

fun eventText(event:DeckEvent):String {
    val failureAction=event.action.contains("error",true)||event.action.endsWith(".failed")
    val p=event.payload as? JsonObject?:return if(failureAction)userFacingError(raw=event.payload.toString()) else event.payload.toString()
    if(event.action=="turn.failed"){
        val (detail,code)=turnFailure(p)
        return "任务失败\n"+userFacingError(code,detail)
    }
    if(failureAction||(p["method"] as? JsonPrimitive)?.contentOrNull=="error"||p.containsKey("error")){
        val error=p["error"] as? JsonObject
        val message=error?.codexErrorMessage(false).orEmpty().ifBlank{(p["message"] as? JsonPrimitive)?.contentOrNull?: (p["error"] as? JsonPrimitive)?.contentOrNull?:p.toString()}
        return userFacingError(error?.codexErrorCode() ?: (p["code"] as? JsonPrimitive)?.contentOrNull,message)
    }
    for(key in listOf("delta","text","message"))p[key]?.jsonPrimitive?.contentOrNull?.let{return it}
    val item=p["item"] as? JsonObject
    if(item!=null){
        if(item["status"]?.jsonPrimitive?.contentOrNull=="failed")return userFacingError(raw=item["aggregatedOutput"]?.jsonPrimitive?.contentOrNull)
        val text=item["text"]?.jsonPrimitive?.contentOrNull
        if(text!=null)return text
        val command=item["command"]?.jsonPrimitive?.contentOrNull
        if(command!=null)return command+"\n"+(item["aggregatedOutput"]?.jsonPrimitive?.contentOrNull?:item["status"]?.jsonPrimitive?.contentOrNull?:"")
    }
    if(event.action in listOf("turn.completed","turn.failed","turn.interrupted")){
        val turn=p["turn"] as? JsonObject
        return statusLabel(turn?.get("status")?.jsonPrimitive?.contentOrNull?:event.action.substringAfter('.'))
    }
    return event.payload.toString()
}
