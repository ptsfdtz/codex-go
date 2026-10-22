package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*
import java.text.NumberFormat

/** Upstream observations only; these counters are not a local tokenizer or a billing estimate. */
@Composable internal fun ContextUsage(state:DeckState){
    if(state.selectedSession==null||state.capabilities?.supports("sessionTokenUsage")!=true)return
    val event=remember(state.events,state.selectedSession){state.events.lastOrNull{it.sessionId==state.selectedSession&&it.action=="session.tokenUsage"}}
    val usage=(event?.payload as? JsonObject)?.get("tokenUsage") as? JsonObject
    var expanded by remember(state.host?.hostId,state.selectedSession){mutableStateOf(false)}
    fun number(value:JsonElement?)=(value as? JsonPrimitive)?.longOrNull?.takeIf{it>=0}
    fun count(value:JsonElement?)=number(value)?.let{NumberFormat.getIntegerInstance().format(it)}?:"未报告"
    val last=usage?.get("last") as? JsonObject
    val total=usage?.get("total") as? JsonObject
    val window=number(usage?.get("modelContextWindow"))?.takeIf{it>0}
    val used=number(last?.get("totalTokens"))
    val label=if(used!=null&&window!=null)"最近用量 ${count(last?.get("totalTokens"))} / ${NumberFormat.getIntegerInstance().format(window)}" else if(used!=null)"最近用量 ${count(last?.get("totalTokens"))} tokens" else "上下文用量未报告"
    TextButton(onClick={expanded=true},contentPadding=PaddingValues(horizontal=8.dp,vertical=0.dp)){Text(label,style=MaterialTheme.typography.labelSmall)}
    if(expanded)AlertDialog(onDismissRequest={expanded=false},title={Text("上下文与 token 用量")},text={
        Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)){
            Text("显示电脑上游最近报告的原生计数；不是费用估算，也不保证是当前输入框发送后的占用。",style=MaterialTheme.typography.bodySmall)
            if(usage==null)Text("尚未收到报告，或报告已不在已加载事件中。下一次上游用量通知到达后更新。")
            else{
                Text("模型上下文窗口：${window?.let{NumberFormat.getIntegerInstance().format(it)}?:"未报告"}")
                listOf("最近一次" to last,"会话累计" to total).forEach{(title,values)->
                    Text(title,style=MaterialTheme.typography.titleSmall)
                    listOf("inputTokens" to "输入","cachedInputTokens" to "缓存输入","cacheWriteInputTokens" to "缓存写入","outputTokens" to "输出","reasoningOutputTokens" to "推理输出","totalTokens" to "总计").forEach{(key,label)->
                        if(key!="cacheWriteInputTokens"||values?.containsKey(key)==true)Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text(label);Text(count(values?.get(key)))}
                    }
                }
                Text("报告时间：${event?.ts.orEmpty()}${if(state.stale)" · 当前离线，显示已记录数据" else ""}",style=MaterialTheme.typography.bodySmall)
                Text("缓存与推理计数可能包含在输入/输出中，请勿重复相加。压缩后窗口占用与会话累计用量不同。",style=MaterialTheme.typography.bodySmall)
            }
        }
    },confirmButton={TextButton(onClick={expanded=false}){Text("关闭")}})
}
