package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
    val percent=if(used!=null&&window!=null)(used.toDouble()/window*100).coerceIn(0.0,100.0) else null
    val cumulative=number(total?.get("totalTokens"))
    val contextLabel=percent?.let{"${kotlin.math.round(it).toInt()}%"}?:"—"
    val tokenLabel=cumulative?.let{value->
        val divisor=when{value>=1_000_000->1_000_000.0;value>=1_000->1_000.0;else->1.0}
        val suffix=when{value>=1_000_000->"M";value>=1_000->"K";else->""}
        if(divisor==1.0)value.toString() else String.format(java.util.Locale.ROOT,"%.1f",value/divisor).removeSuffix(".0")+suffix
    }?:"—"
    val muted=MaterialTheme.colorScheme.onSurfaceVariant
    val track=MaterialTheme.colorScheme.outlineVariant
    val indicator=if(percent!=null&&percent>=90)MaterialTheme.colorScheme.tertiary else muted
    Row(Modifier.clickable(onClickLabel="查看用量详情"){expanded=true}.padding(horizontal=8.dp,vertical=10.dp)
        .semantics(mergeDescendants=true){contentDescription="上下文占用 ${if(percent==null)"未报告" else contextLabel}，会话累计 ${count(total?.get("totalTokens"))} tokens"},
        verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)){
        Canvas(Modifier.size(14.dp)){
            val stroke=2.dp.toPx()
            val diameter=size.width-stroke
            val offset=androidx.compose.ui.geometry.Offset(stroke/2,stroke/2)
            drawArc(track,0f,360f,false,offset,Size(diameter,diameter),style=Stroke(stroke))
            if(percent!=null&&percent>0)drawArc(indicator,-90f,(percent*3.6).toFloat(),false,offset,Size(diameter,diameter),style=Stroke(stroke,cap=StrokeCap.Round))
        }
        Text("上下文 $contextLabel",style=MaterialTheme.typography.labelSmall,color=muted)
        Text("·",style=MaterialTheme.typography.labelSmall,color=track)
        Text("$tokenLabel tokens",style=MaterialTheme.typography.labelSmall,color=muted)
    }
    if(expanded)AlertDialog(onDismissRequest={expanded=false},title={Text("用量",style=MaterialTheme.typography.titleMedium)},text={
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)){
            if(usage==null)Text("暂无用量数据",style=MaterialTheme.typography.bodySmall,color=muted)
            else{
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                    Text("上下文",style=MaterialTheme.typography.labelMedium,color=muted)
                    Text(contextLabel,style=MaterialTheme.typography.labelMedium,color=indicator)
                }
                if(percent!=null)Canvas(Modifier.fillMaxWidth().height(5.dp).semantics{contentDescription="上下文占用 $contextLabel"}){
                    drawRoundRect(track,cornerRadius=androidx.compose.ui.geometry.CornerRadius(size.height/2))
                    if(percent>0)drawRoundRect(indicator,size=Size(size.width*(percent/100).toFloat(),size.height),cornerRadius=androidx.compose.ui.geometry.CornerRadius(size.height/2))
                }
                Text("${count(last?.get("totalTokens"))} / ${count(usage["modelContextWindow"])} tokens",style=MaterialTheme.typography.labelSmall,color=muted)
                HorizontalDivider(color=track)
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                    Text("tokens",Modifier.weight(0.9f),style=MaterialTheme.typography.labelSmall,color=muted)
                    Text("最近一次",Modifier.weight(1f),textAlign=TextAlign.End,style=MaterialTheme.typography.labelSmall,color=muted)
                    Text("会话累计",Modifier.weight(1f),textAlign=TextAlign.End,style=MaterialTheme.typography.labelSmall,color=muted)
                }
                // The app's neutral theme maps primary and tertiary to near-identical
                // grays. Chart series need distinct colors independent of that palette.
                val dark=MaterialTheme.colorScheme.surface.luminance()<0.5f
                val inputColor=if(dark)Color(0xFF75B8FF) else Color(0xFF1769BA)
                val outputColor=if(dark)Color(0xFFFFB45B) else Color(0xFFAC5000)
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=Alignment.CenterVertically){
                    Row(Modifier.weight(0.9f),horizontalArrangement=Arrangement.spacedBy(4.dp)){
                        Text("输入",style=MaterialTheme.typography.labelSmall,color=inputColor)
                        Text("/",style=MaterialTheme.typography.labelSmall,color=muted)
                        Text("输出",style=MaterialTheme.typography.labelSmall,color=outputColor)
                    }
                    listOf(last,total).forEach{values->
                        val input=number(values?.get("inputTokens"))
                        val output=number(values?.get("outputTokens"))
                        Canvas(Modifier.weight(1f).height(6.dp).semantics{contentDescription="输入 ${count(values?.get("inputTokens"))}，输出 ${count(values?.get("outputTokens"))}"}){
                            drawRoundRect(track,cornerRadius=androidx.compose.ui.geometry.CornerRadius(size.height/2))
                            // Cache and reasoning are subsets; only input/output form this chart.
                            if(input!=null&&output!=null&&input.toDouble()+output>0){
                                val split=(input.toDouble()/(input.toDouble()+output)).toFloat()*size.width
                                if(split>0)drawRect(inputColor,size=Size(split,size.height))
                                if(split<size.width)drawRect(outputColor,topLeft=androidx.compose.ui.geometry.Offset(split,0f),size=Size(size.width-split,size.height))
                            }
                        }
                    }
                }
                Column(verticalArrangement=Arrangement.spacedBy(7.dp)){
                    listOf("totalTokens" to "总计","inputTokens" to "输入","cachedInputTokens" to "  含缓存","cacheWriteInputTokens" to "  缓存写入","outputTokens" to "输出","reasoningOutputTokens" to "  含推理").forEach{(key,label)->
                        if(key!="cacheWriteInputTokens"||last?.containsKey(key)==true||total?.containsKey(key)==true){
                            val weight=if(key=="totalTokens")FontWeight.SemiBold else FontWeight.Normal
                            val seriesColor=when(key){"inputTokens"->inputColor;"outputTokens"->outputColor;else->muted}
                            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                                Text(label,Modifier.weight(0.9f),style=MaterialTheme.typography.bodySmall,color=seriesColor,fontWeight=weight)
                                listOf(last,total).forEach{values->Text(number(values?.get(key))?.let{NumberFormat.getIntegerInstance().format(it)}?:"—",Modifier.weight(1f),textAlign=TextAlign.End,style=MaterialTheme.typography.bodySmall,color=if(key in listOf("inputTokens","outputTokens"))seriesColor else MaterialTheme.colorScheme.onSurface,fontWeight=weight)}
                            }
                        }
                    }
                }
                if(state.stale)Text("离线 · 上次报告",style=MaterialTheme.typography.labelSmall,color=muted)
            }
        }
    },confirmButton={TextButton(onClick={expanded=false}){Text("关闭")}})
}
