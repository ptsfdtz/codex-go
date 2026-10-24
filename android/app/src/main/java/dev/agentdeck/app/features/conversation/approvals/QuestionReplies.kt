package dev.agentdeck.app

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.*

internal data class QuestionKey(val hostId:String,val sessionId:String,val requestId:String)
internal enum class ReplyPhase { Editing, Sending, Sent, Unknown, Unavailable }
internal data class QuestionReply(val answers:Map<String,String> = emptyMap(),val phase:ReplyPhase=ReplyPhase.Editing,val error:String?=null,val submittedIds:Set<String> = emptySet(),val pendingIds:Set<String> = emptySet())

/** Memory only, separate from the composer and global actions; never persists secret answers. */
internal class QuestionReplies(saved:String="",private val save:(String)->Unit={}) {
    private val mutable=MutableStateFlow(decodeQuestionReceipts(saved))
    val state=mutable.asStateFlow()
    @Synchronized fun edit(key:QuestionKey,id:String,value:String){
        val old=mutable.value[key]?:QuestionReply()
        if(old.phase!=ReplyPhase.Editing||id in old.submittedIds||value.length>16000)return
        mutable.value=mutable.value+(key to old.copy(answers=old.answers+(id to value),error=null))
    }
    @Synchronized fun claim(key:QuestionKey):QuestionReply? {
        val old=mutable.value[key]?:QuestionReply()
        if(old.phase!=ReplyPhase.Editing)return null
        mutable.value=mutable.value+(key to old.copy(phase=ReplyPhase.Sending,error=null,pendingIds=old.answers.filterValues{it.isNotBlank()}.keys))
        persist()
        return old
    }
    @Synchronized fun finish(key:QuestionKey,phase:ReplyPhase,error:String?=null){
        val old=mutable.value[key]?:return
        if(old.phase==ReplyPhase.Sent)return
        val resolved=if(phase==ReplyPhase.Unknown&&old.pendingIds.isNotEmpty()&&old.submittedIds.containsAll(old.pendingIds))ReplyPhase.Editing else phase
        mutable.value=mutable.value+(key to old.copy(phase=resolved,error=if(resolved==phase)error else null,answers=if(resolved==ReplyPhase.Sent||resolved==ReplyPhase.Unavailable)emptyMap() else old.answers,pendingIds=if(resolved==ReplyPhase.Unknown)old.pendingIds else emptySet()))
        persist()
    }
    @Synchronized fun accepted(key:QuestionKey,ids:Set<String>,allIds:Set<String>){
        val old=mutable.value[key]?:return
        val submitted=old.submittedIds+ids
        mutable.value=mutable.value+(key to old.copy(phase=if(submitted.containsAll(allIds))ReplyPhase.Sent else ReplyPhase.Editing,answers=old.answers.filterKeys{it !in submitted},submittedIds=submitted,error=null,pendingIds=emptySet()))
        persist()
    }
    /** Only positive evidence from native user history resolves an uncertain send. */
    @Synchronized fun reconcile(hostId:String,sessionId:String,entries:List<ChatEntry>){
        val delivered=entries.filter{it.kind=="user"&&it.sourceItem!=null}.flatMap{questionReplyItems(it.text)}.groupBy{it.first}
        if(delivered.isEmpty())return
        var next=mutable.value
        entries.forEach{entry->
            val item=questionSourceItem(entry)?:return@forEach
            val allIds=messageQuestions(entry).map{it.id}.toSet()
            val confirmed=delivered[item].orEmpty().map{it.second}.filter{it in allIds}.toSet()
            if(confirmed.isEmpty())return@forEach
            val key=QuestionKey(hostId,sessionId,entry.id)
            val old=next[key]?:QuestionReply()
            val submitted=old.submittedIds+confirmed
            val phase=when{
                submitted.containsAll(allIds)->ReplyPhase.Sent
                old.phase==ReplyPhase.Sending->ReplyPhase.Sending
                old.phase==ReplyPhase.Unknown&&old.pendingIds.isNotEmpty()&&submitted.containsAll(old.pendingIds)->ReplyPhase.Editing
                else->old.phase
            }
            val reply=old.copy(phase=phase,submittedIds=submitted,answers=old.answers.filterKeys{it !in submitted},error=if(phase==ReplyPhase.Sent||phase==ReplyPhase.Editing)null else old.error,pendingIds=if(phase==ReplyPhase.Sent||phase==ReplyPhase.Editing)emptySet() else old.pendingIds)
            if(reply!=old)next=next+(key to reply)
        }
        if(next!=mutable.value){mutable.value=next;persist()}
    }
    @Synchronized fun retainHosts(ids:Set<String>,visible:Set<String> = ids){mutable.value=mutable.value.filterKeys{it.hostId in ids}.mapValues{(key,reply)->if(key.hostId in visible)reply else reply.copy(answers=emptyMap())};persist()}
    private fun persist(){save(buildJsonArray{mutable.value.forEach{(key,reply)->if(reply.phase!=ReplyPhase.Editing||reply.submittedIds.isNotEmpty())add(buildJsonObject{
        put("host",key.hostId);put("session",key.sessionId);put("request",key.requestId);put("phase",reply.phase.name)
        put("submitted",buildJsonArray{reply.submittedIds.forEach{add(it)}})
        put("pending",buildJsonArray{reply.pendingIds.forEach{add(it)}})
    })}}.toString())}
}

/** Only delivery receipts persist. Interrupted submissions reopen as unknown, never retryable. */
private fun decodeQuestionReceipts(saved:String):Map<QuestionKey,QuestionReply> = runCatching{
    wire.parseToJsonElement(saved).jsonArray.associate{element->
        val item=element.jsonObject
        val key=QuestionKey(item.getValue("host").jsonPrimitive.content,item.getValue("session").jsonPrimitive.content,item.getValue("request").jsonPrimitive.content)
        val phase=ReplyPhase.valueOf(item.getValue("phase").jsonPrimitive.content).let{if(it==ReplyPhase.Sending)ReplyPhase.Unknown else it}
        key to QuestionReply(phase=phase,error=if(phase==ReplyPhase.Unknown)"发送结果待确认，请查看会话，勿重复提交。" else null,submittedIds=(item["submitted"] as? JsonArray).orEmpty().map{it.jsonPrimitive.content}.toSet(),pendingIds=(item["pending"] as? JsonArray).orEmpty().map{it.jsonPrimitive.content}.toSet())
    }
}.getOrDefault(emptyMap())

internal data class QuestionOption(val label:String,val description:String="")
internal data class ReplyQuestion(val id:String,val title:String,val header:String="",val options:List<QuestionOption> = emptyList(),val secret:Boolean=false)
internal fun approvalQuestions(approval:Approval)=(approval.context["questions"] as? JsonArray).orEmpty().mapNotNull{element->
    val q=element as? JsonObject?:return@mapNotNull null
    val id=(q["id"] as? JsonPrimitive)?.contentOrNull?:return@mapNotNull null
    ReplyQuestion(id,(q["question"] as? JsonPrimitive)?.contentOrNull.orEmpty(),(q["header"] as? JsonPrimitive)?.contentOrNull.orEmpty(),
        (q["options"] as? JsonArray).orEmpty().mapNotNull{option->val o=option as? JsonObject?:return@mapNotNull null;QuestionOption((o["label"] as? JsonPrimitive)?.contentOrNull.orEmpty(),(o["description"] as? JsonPrimitive)?.contentOrNull.orEmpty())},
        (q["isSecret"] as? JsonPrimitive)?.booleanOrNull==true)
}
internal fun messageQuestions(entry:ChatEntry):List<ReplyQuestion>{
    if(entry.kind!="assistant")return emptyList()
    val rows=runCatching{(wire.parseToJsonElement(entry.detail) as? JsonObject)?.get("questions") as? JsonArray}.getOrNull().orEmpty()
    return rows.mapIndexedNotNull{index,element->val q=element as? JsonObject?:return@mapIndexedNotNull null
        ReplyQuestion(index.toString(),(q["title"] as? JsonPrimitive)?.contentOrNull.orEmpty(),options=(q["options"] as? JsonArray).orEmpty().mapNotNull{(it as? JsonPrimitive)?.contentOrNull?.let(::QuestionOption)})}
}
private fun questionSourceItem(entry:ChatEntry)=entry.sourceItem?:runCatching{wire.parseToJsonElement(entry.detail).jsonObject["id"]?.jsonPrimitive?.contentOrNull}.getOrNull()
private fun questionReplyItems(text:String):List<Pair<String,String>> = runCatching{
    val trimmed=text.trim()
    require(trimmed.startsWith("<send_user_message_question_reply>")&&trimmed.endsWith("</send_user_message_question_reply>"))
    wire.parseToJsonElement(trimmed.removePrefix("<send_user_message_question_reply>").removeSuffix("</send_user_message_question_reply>").trim()).jsonArray.mapNotNull{element->
        val reply=element.jsonObject
        val identity=wire.parseToJsonElement(reply.getValue("questionItemId").jsonPrimitive.content).jsonArray
        if(identity.size!=3||identity[0].jsonPrimitive.content!="request_user_input_async"||reply["answer"]?.jsonPrimitive?.contentOrNull.isNullOrBlank())null
        else identity[1].jsonPrimitive.content to identity[2].jsonPrimitive.int.toString()
    }
}.getOrDefault(emptyList())
internal fun questionAnswerText(entry:ChatEntry,answers:Map<String,String>):String{
    val itemId=questionSourceItem(entry)
    require(!itemId.isNullOrBlank()){"问题身份缺失，请刷新会话"}
    val responses=buildJsonArray{messageQuestions(entry).forEach{q->answers[q.id]?.takeIf{it.isNotBlank()}?.let{answer->add(buildJsonObject{
        // Same structured text used by Codex desktop for an asynchronous question reply.
        put("questionItemId",buildJsonArray{add("request_user_input_async");add(itemId);add(q.id.toInt())}.toString())
        put("question",q.title);put("answer",answer)
    })}}}
    require(responses.isNotEmpty()){"请填写回答"}
    return "<send_user_message_question_reply>\n$responses\n</send_user_message_question_reply>"
}

internal fun questionReplyDisplayText(text:String):String{
    val trimmed=text.trim()
    if(!trimmed.startsWith("<send_user_message_question_reply>")||!trimmed.endsWith("</send_user_message_question_reply>"))return text
    return runCatching{
        val replies=wire.parseToJsonElement(trimmed.removePrefix("<send_user_message_question_reply>").removeSuffix("</send_user_message_question_reply>").trim()).jsonArray
        require(replies.isNotEmpty())
        replies.joinToString("\n\n"){element->val r=element.jsonObject;r.getValue("question").jsonPrimitive.content+"\n"+r.getValue("answer").jsonPrimitive.content}
    }.getOrDefault(text)
}

/** Reads the current turn once. Never converts a failed steer into a new turn. */
internal suspend fun deliverMessageAnswer(sessionId:String,text:String,start:JsonObject,request:suspend(String,JsonObject)->JsonObject){
    val active=request("turn.active",payload("sessionId" to sessionId))
    require(active["sessionId"]?.jsonPrimitive?.content==sessionId&&active.containsKey("upstreamTurnId")){"会话身份不匹配"}
    if(active["upstreamTurnId"]==JsonNull){
        val result=request("turn.start",start)
        require(result["turn"]?.jsonObject?.get("sessionId")?.jsonPrimitive?.content==sessionId){"回答受理结果需要核对"}
    }else{
        val expected=(active["upstreamTurnId"] as? JsonPrimitive)?.takeIf{it.isString}?.content?.takeIf{it.isNotBlank()}?:error("活动轮次身份无效")
        val result=request("turn.steer",payload("sessionId" to sessionId,"expectedTurnId" to expected,"text" to text))
        require(result["sessionId"]?.jsonPrimitive?.content==sessionId&&result["upstreamTurnId"]?.jsonPrimitive?.content==expected&&result["accepted"]?.jsonPrimitive?.booleanOrNull==true){"回答受理结果需要核对"}
    }
}
