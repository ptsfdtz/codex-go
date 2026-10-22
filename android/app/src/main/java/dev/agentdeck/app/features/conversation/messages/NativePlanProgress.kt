package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

@Composable internal fun NativePlanProgress(item:JsonObject,mask:String){
    val steps=(item["plan"] as? JsonArray).orEmpty()
    val completed=steps.count{(it as? JsonObject)?.get("status")?.jsonPrimitive?.contentOrNull=="completed"}
    Text("计划步骤 · $completed / ${steps.size}",style=MaterialTheme.typography.titleSmall)
    if(steps.isNotEmpty())LinearProgressIndicator(progress={completed.toFloat()/steps.size},modifier=Modifier.fillMaxWidth())
    val explanation=(item["explanation"] as? JsonPrimitive)?.contentOrNull.orEmpty()
    if(explanation.isNotBlank()){
        MarkdownText(maskDisplay(explanation,mask).take(24000),fontSizeSp=13f)
        if(explanation.length>24000)Text("说明预览已截断，可查看原始记录。",style=MaterialTheme.typography.labelSmall)
    }
    if(steps.isEmpty())Text("上游当前报告空计划。",style=MaterialTheme.typography.bodySmall)
    steps.take(128).forEachIndexed{index,element->
        val step=element as? JsonObject
        val status=(step?.get("status") as? JsonPrimitive)?.contentOrNull.orEmpty()
        val text=(step?.get("step") as? JsonPrimitive)?.contentOrNull?:element.toString()
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.Top,horizontalArrangement=Arrangement.spacedBy(10.dp)){
            Icon(when(status){"completed"->Icons.Outlined.CheckCircle;"inProgress"->Icons.Outlined.PlayCircleOutline;else->Icons.Outlined.RadioButtonUnchecked},null,Modifier.size(20.dp),tint=if(status=="inProgress")MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
            Column(Modifier.weight(1f)){
                Text("${index+1} · "+when(status){"completed"->"已完成";"inProgress"->"进行中";"pending"->"待处理";else->status.ifBlank{"未报告状态"}},style=MaterialTheme.typography.labelSmall)
                SelectionContainer{Text(maskDisplay(text,mask).take(24000),style=MaterialTheme.typography.bodySmall)}
                if(text.length>24000)Text("此步骤预览已截断。",style=MaterialTheme.typography.labelSmall)
            }
        }
    }
    if(steps.size>128)Text("显示前 128 步，完整已加载内容可查看原始记录。",style=MaterialTheme.typography.labelSmall)
    Text("步骤状态来自最近收到的原生计划更新；不代表任务轮次已经结束。",style=MaterialTheme.typography.labelSmall)
}
