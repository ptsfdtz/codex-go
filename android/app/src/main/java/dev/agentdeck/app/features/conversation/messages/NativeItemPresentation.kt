package dev.agentdeck.app

import kotlinx.serialization.json.*

internal fun hasVisibleMessageContent(entry:ChatEntry):Boolean{
    if(entry.kind=="tool"||entry.text.isNotBlank())return true
    if(entry.kind!="assistant")return false
    val item=runCatching{wire.parseToJsonElement(entry.detail) as? JsonObject}.getOrNull()?:return false
    return (item["questions"] as? JsonArray)?.isNotEmpty()==true||item["memoryCitation"] is JsonObject
}

/** Shared presentation for persisted and completed native items. Never executes source content. */
internal fun nativeItemEntry(id:String,item:JsonObject,fallbackStatus:String="saved",textLimit:Int=128000):ChatEntry {
    fun value(key:String)=(item[key] as? JsonPrimitive)?.contentOrNull.orEmpty()
    fun strings(key:String)=(item[key] as? JsonArray).orEmpty().mapNotNull{(it as? JsonPrimitive)?.contentOrNull}.joinToString("\n\n")
    fun structured(key:String)=item[key]?.takeUnless{it is JsonNull}?.let{if(it is JsonPrimitive)it.content else it.toString()}.orEmpty()
    val type=value("type")
    val kind=when(type){"agentMessage"->"assistant";"plan"->"plan";"userMessage"->"user";else->"tool"}
    val title=when(type){
        "reasoning"->"思考过程"
        "commandExecution"->value("command").ifBlank{"执行命令"}
        "fileChange"->"修改文件"
        "mcpToolCall"->listOf(value("server"),value("tool")).filter{it.isNotBlank()}.joinToString(" · ")
        "dynamicToolCall"->value("tool").ifBlank{"工具调用"}
        "webSearch"->"搜索网页"
        "imageView"->"查看图片"
        "imageGeneration"->"生成图片"
        "collabAgentToolCall"->"协作代理 · "+value("tool")
        "subAgentActivity"->"代理活动"
        "contextCompaction"->"上下文已压缩"
        "enteredReviewMode"->"进入审查"
        "exitedReviewMode"->"审查结果"
        else->type.ifBlank{"执行步骤"}
    }
    val text=when(type){
        "agentMessage","plan"->value("text")
        "userMessage"->nativeUserText(item["content"] as? JsonArray?:JsonArray(emptyList()))
        "reasoning"->listOf(strings("summary"),strings("content")).filter{it.isNotBlank()}.joinToString("\n\n")
        "commandExecution"->value("aggregatedOutput")
        "fileChange"->(item["changes"] as? JsonArray).orEmpty().joinToString("\n\n"){change->val obj=change as? JsonObject;listOf("path","diff").mapNotNull{(obj?.get(it) as? JsonPrimitive)?.contentOrNull}.joinToString("\n")}
        "mcpToolCall"->listOf(structured("result"),structured("error")).filter{it.isNotBlank()}.joinToString("\n")
        "dynamicToolCall"->structured("contentItems")
        "webSearch"->listOf(value("query"),structured("action"),structured("results")).filter{it.isNotBlank()}.joinToString("\n\n")
        "imageView"->value("path")
        "imageGeneration"->listOf(value("revisedPrompt"),value("savedPath"),structured("failure")).filter{it.isNotBlank()}.joinToString("\n")
        "collabAgentToolCall"->listOf(value("prompt"),structured("agentsStates")).filter{it.isNotBlank()}.joinToString("\n")
        "subAgentActivity"->listOf(value("agentPath"),structured("kind")).joinToString("\n")
        "enteredReviewMode","exitedReviewMode"->value("review")
        "contextCompaction"->"较早的上下文已由 Codex 压缩。"
        else->item.toString()
    }
    return ChatEntry(id,kind,text.take(textLimit),title,value("status").ifBlank{fallbackStatus},item.toString(),text.length>textLimit)
}
