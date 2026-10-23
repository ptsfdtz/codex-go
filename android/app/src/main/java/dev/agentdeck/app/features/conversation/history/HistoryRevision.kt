package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

internal enum class HistoryRevisionPhase { Ready, Reverting, Reverted, Sending, Uncertain, Accepted }

internal data class HistoryRevision(val beforeTurn:String,val expectedLastTurn:String,val text:String,val retry:Boolean,val itemId:String?=null,val imageCount:Int=0,val skillCount:Int=0)

/** Replay only resource types the computer can preserve and authorize. */
internal fun revisableUserText(entry:ChatEntry,allowImages:Boolean=false,allowSkills:Boolean=false):String? {
    if(entry.kind!="user"||entry.sourceTurn==null||entry.sourceItem==null)return null
    val item=runCatching{wire.parseToJsonElement(entry.detail).jsonObject}.getOrNull()?:return null
    if(item["type"]?.jsonPrimitive?.contentOrNull!="userMessage")return null
    val parts=item["content"] as? JsonArray?:return null
    val allowed=listOf("text")+(if(allowImages)listOf("localImage") else emptyList())+(if(allowSkills)listOf("skill") else emptyList())
    if(parts.isEmpty()||parts.any{(it as? JsonObject)?.get("type")?.jsonPrimitive?.contentOrNull !in allowed})return null
    if(parts.count{it.jsonObject["type"]?.jsonPrimitive?.contentOrNull=="text"}>1)return null
    if(parts.any{part->(part.jsonObject["text_elements"] as? JsonArray)?.isNotEmpty()==true})return null
    return parts.filter{it.jsonObject["type"]?.jsonPrimitive?.contentOrNull=="text"}.joinToString("\n"){it.jsonObject["text"]?.jsonPrimitive?.content.orEmpty()}.ifBlank{if(parts.any{it.jsonObject["type"]?.jsonPrimitive?.contentOrNull=="skill"})"请使用所选技能完成任务。" else if(allowImages)"请查看上传的附件。" else ""}.takeIf{it.isNotBlank()&&it.length<=64000}
}

@Composable internal fun HistoryRevisionDialog(intent:HistoryRevision,state:DeckState,onClose:()->Unit,onKeepDraft:(String)->Unit,onRefresh:()->Unit,onConfirm:(String,(HistoryRevisionPhase)->Unit)->Unit){
    var text by remember(intent){mutableStateOf(intent.text)}
    var phase by remember(intent){mutableStateOf(HistoryRevisionPhase.Ready)}
    AlertDialog(onDismissRequest={if(!state.busy)onClose()},title={Text(if(intent.retry)"重试这一轮？" else "编辑并重新发送")},text={
        Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
            Text("将从同一会话中移除这一轮及之后的已保存对话，再发送下面的消息。不会撤销已经执行的命令或修改的文件。")
            if(intent.imageCount>0)Text("电脑将从原始输入保留 ${intent.imageCount} 张本地图片；不从安卓重新上传。",style=MaterialTheme.typography.bodySmall)
            if(intent.skillCount>0)Text("保留 ${intent.skillCount} 个原技能引用；回退前及发送前核验当前目录，已失效或禁用的技能会被拒绝。",style=MaterialTheme.typography.bodySmall)
            Text("重新发送使用当前模型、推理强度及权限设置（${if(state.fullAccess)"完全访问" else "工作区审批"}）。",style=MaterialTheme.typography.bodySmall)
            OutlinedTextField(value=text,onValueChange={if(it.length<=64000)text=it},label={Text("重新发送的消息")},modifier=Modifier.fillMaxWidth().heightIn(max=260.dp),enabled=!state.busy&&phase==HistoryRevisionPhase.Ready,minLines=3)
            when(phase){
                HistoryRevisionPhase.Reverting->Text("正在请求回退历史，请勿重复操作。")
                HistoryRevisionPhase.Reverted,HistoryRevisionPhase.Sending->Text("历史回退已确认，正在重新发送消息。")
                HistoryRevisionPhase.Uncertain->Text("本次操作未获完整确认。请先刷新核对历史和任务，勿再次回退或重复发送。可保留消息文字到草稿。",color=MaterialTheme.colorScheme.error)
                else->Unit
            }
            if(phase==HistoryRevisionPhase.Uncertain)TextButton(onClick=onRefresh,enabled=!state.busy&&!state.stale){Text("刷新会话状态")}
            state.error?.let{Text(it,color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)}
            if(state.busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        }
    },confirmButton={Column{if(phase==HistoryRevisionPhase.Ready)TextButton(onClick={phase=HistoryRevisionPhase.Reverting;onConfirm(text){phase=it}},enabled=!state.busy&&!state.stale&&text.isNotBlank()){Text("回退并发送")}else if(phase==HistoryRevisionPhase.Uncertain)TextButton(onClick={onKeepDraft(text)},enabled=!state.busy){Text("保留文字到草稿")}}},dismissButton={TextButton(onClick=onClose,enabled=!state.busy){Text(if(phase==HistoryRevisionPhase.Ready)"取消" else "关闭")}})
}
