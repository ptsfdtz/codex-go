package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private fun JsonObject.accountText(key:String)=(get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()

@Composable internal fun AccountSettings(state:DeckState,repo:DeckRepository){
    var result by remember(state.host?.hostId){mutableStateOf<JsonObject?>(null)}
    var error by remember(state.host?.hostId){mutableStateOf<String?>(null)}
    var loading by remember(state.host?.hostId){mutableStateOf(false)}
    var revision by remember(state.host?.hostId){mutableIntStateOf(0)}
    val supported=state.capabilities?.supports("accountSummary")==true
    LaunchedEffect(state.host?.hostId,state.connection,state.stale,supported,revision){
        result=null;error=null;loading=false
        if(!state.stale&&supported){
            loading=true
            try{result=repo.readAccountStatus()}catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"无法读取账户"}finally{loading=false}
        }
    }
    OutlinedCard{Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
        Text("电脑上的 Codex 账户",fontWeight=FontWeight.SemiBold)
        Text("登录与凭据保留在电脑。此页读取同一服务的账户和额度，不在安卓登录或切换账户。",style=MaterialTheme.typography.bodySmall)
        if(state.stale)Text("连接电脑后可读取账户状态。")
        else if(!supported)Text("当前电脑版本尚未提供账户概览。")
        if(loading)LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
        TextButton(onClick={revision++},enabled=!state.stale&&supported&&!loading){Text("刷新账户与用量")}
        result?.let{data->
            val account=data["account"] as? JsonObject
            if(account==null)Text(if(data["requiresOpenaiAuth"]?.jsonPrimitive?.booleanOrNull==true)"尚未登录，请在电脑上完成登录。" else "此服务未提供登录账户。")
            else{
                Text(when(account.accountText("type")){"chatgpt"->"ChatGPT";"apiKey"->"API Key";"amazonBedrock"->"Amazon Bedrock";else->account.accountText("type")},style=MaterialTheme.typography.titleMedium)
                if(account.accountText("email").isNotBlank())SelectionContainer{Text(maskDisplay(account.accountText("email"),state.displayMask))}
                if(account.accountText("planType").isNotBlank())Text("套餐：${account.accountText("planType")}")
                val usage=data["usage"] as? JsonObject
                if(usage!=null){
                    HorizontalDivider()
                    val allowed=usage["ordinaryUsageAllowed"]?.jsonPrimitive?.booleanOrNull
                    Text(when(allowed){true->"服务端确认常规额度可用";false->"服务端报告常规额度不可用";null->"常规额度可用状态未提供"},style=MaterialTheme.typography.bodySmall)
                    val buckets=(usage["buckets"] as? JsonArray).orEmpty()
                    if(buckets.isEmpty())Text("没有返回额度窗口。",style=MaterialTheme.typography.bodySmall)
                    buckets.forEach{element->val bucket=element.jsonObject
                        Text(bucket.accountText("limitName").ifBlank{bucket.accountText("limitId").ifBlank{"用量"}},fontWeight=FontWeight.Medium)
                        listOf("primary" to "主要窗口","secondary" to "次要窗口").forEach{(key,label)->
                            (bucket[key] as? JsonObject)?.let{window->
                                val percent=window["usedPercent"]?.jsonPrimitive?.intOrNull
                                val minutes=window["windowDurationMins"]?.jsonPrimitive?.longOrNull
                                val duration=minutes?.let{if(it>0&&it%1440L==0L)"${it/1440} 天" else if(it>0&&it%60L==0L)"${it/60} 小时" else "$it 分钟"}
                                Text("${duration?:label} · 已使用 ${percent?.toString()?:"未知"}%",style=MaterialTheme.typography.bodySmall)
                                if(percent!=null)LinearProgressIndicator(progress={percent.coerceIn(0,100)/100f},modifier=Modifier.fillMaxWidth())
                                window["resetsAt"]?.jsonPrimitive?.longOrNull?.let{epoch->
                                    val time=runCatching{DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.systemDefault()).format(Instant.ofEpochSecond(epoch))}.getOrDefault(epoch.toString())
                                    Text("重置时间：$time",style=MaterialTheme.typography.labelSmall)
                                }
                            }
                        }
                        (bucket["credits"] as? JsonObject)?.let{credits->
                            Text(when{credits["unlimited"]?.jsonPrimitive?.booleanOrNull==true->"点数不限量";credits["hasCredits"]?.jsonPrimitive?.booleanOrNull==true->"有可用点数";else->"没有可用点数"},style=MaterialTheme.typography.bodySmall)
                            if(credits.accountText("balance").isNotBlank())Text("点数余额：${credits.accountText("balance")}",style=MaterialTheme.typography.bodySmall)
                        }
                        if(bucket["spendControlReached"]?.jsonPrimitive?.booleanOrNull==true)Text("服务端报告已达到消费控制限制",color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)
                    }
                }
                data.accountText("usageErrorCode").takeIf{it.isNotBlank()}?.let{Text("账户已读取，额度暂不可用（$it）。可稍后刷新。",style=MaterialTheme.typography.bodySmall)}
            }
            Text("读取时间：${data.accountText("readAt")}",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }}
}
