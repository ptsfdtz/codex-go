package dev.agentdeck.app

import kotlinx.serialization.json.*

/** A stale running UI must recover without turning a steer into a new submission. */
internal suspend fun steerActiveTurn(
    sessionId:String,
    text:String,
    request:suspend(String,JsonObject)->JsonObject,
    refresh:suspend()->Unit,
    onAccepted:suspend()->Unit,
) {
    try {
        val active=request("turn.active",payload("sessionId" to sessionId))
        require(active["sessionId"]?.jsonPrimitive?.content==sessionId){"会话身份不匹配"}
        require(active.containsKey("upstreamTurnId")){"缺少活动轮次状态"}
        if(active["upstreamTurnId"]==JsonNull)throw DeckException("TURN_FINISHED","当前任务已经结束")
        val expected=(active["upstreamTurnId"] as? JsonPrimitive)?.takeIf{it.isString}?.content?.takeIf{it.isNotBlank()}?:error("活动轮次身份无效")
        val result=request("turn.steer",payload("sessionId" to sessionId,"expectedTurnId" to expected,"text" to text))
        require(result["sessionId"]?.jsonPrimitive?.content==sessionId&&result["upstreamTurnId"]?.jsonPrimitive?.content==expected&&result["accepted"]?.jsonPrimitive?.booleanOrNull==true){"追加结果需要核实，请勿重复发送"}
        onAccepted()
    } catch(e:DeckException) {
        if(e.code in listOf("TURN_FINISHED","TURN_CHANGED"))refresh()
        throw e
    }
    refresh()
}
