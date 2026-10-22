package dev.agentdeck.app

import kotlinx.serialization.json.*

internal data class LatestTurn(val threadStatus:String,val turnId:String?,val status:String?) {
    fun confirms(event:DeckEvent):Boolean {
        val payload=event.payload as? JsonObject?:return false
        return threadStatus=="idle"&&turnId!=null&&turnId==(payload["upstreamTurnId"] as? JsonPrimitive)?.contentOrNull&&
            status in listOf("completed","failed","interrupted")&&status==(payload["status"] as? JsonPrimitive)?.contentOrNull
    }
}

internal fun decodeLatestTurn(value:JsonObject,session:Session):LatestTurn {
    fun text(obj:JsonObject,key:String)= (obj[key] as? JsonPrimitive)?.takeIf{it.isString}?.content?.takeIf{it.isNotBlank()}
    require((value["contractVersion"] as? JsonPrimitive)?.intOrNull==1&&text(value,"sessionId")==session.sessionId&&text(value,"upstreamThreadId")==session.upstreamThreadId){"轮次来源身份不匹配"}
    val threadStatus=requireNotNull(text(value,"threadStatus"))
    require(threadStatus in listOf("idle","active","notLoaded","systemError")){"未知线程状态"}
    require(value.containsKey("turn")){"缺少轮次状态"}
    if(value["turn"]==JsonNull)return LatestTurn(threadStatus,null,null)
    val turn=value["turn"] as? JsonObject?:error("无效轮次状态")
    val id=requireNotNull(text(turn,"upstreamTurnId"))
    val status=requireNotNull(text(turn,"status"))
    require(status in listOf("inProgress","completed","failed","interrupted")){"未知轮次状态"}
    return LatestTurn(threadStatus,id,status)
}
