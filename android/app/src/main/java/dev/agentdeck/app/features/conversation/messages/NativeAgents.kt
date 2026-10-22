package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

@Composable internal fun NativeAgentResults(item:JsonObject,mask:String){
    val sessions=LocalNativeAgentSessions.current
    val navigate=LocalNativeSessionNavigation.current
    val agents=item["agentsStates"] as? JsonObject
    val recipients=(item["receiverThreadIds"] as? JsonArray).orEmpty().mapNotNull{(it as? JsonPrimitive)?.contentOrNull}
    val ids=(agents?.keys.orEmpty()+recipients).distinct()
    var query by remember(item["id"]){mutableStateOf("")}
    var page by remember(item["id"],query){mutableIntStateOf(0)}
    var reading by remember(item["id"],mask){mutableStateOf<Pair<String,String>?>(null)}
    reading?.let{(title,text)->LoadedTextReader(title,text,mask){reading=null}}
    fun value(key:String)=(item[key] as? JsonPrimitive)?.contentOrNull.orEmpty()
    val prompt=value("prompt")
    if(prompt.isNotBlank()){
        SelectionContainer{Text(maskDisplay(prompt,mask).take(4000),style=MaterialTheme.typography.bodySmall)}
        if(prompt.length>4000)TextButton(onClick={reading="代理指令" to prompt}){Text("阅读完整已加载指令")}
    }
    if(value("senderThreadId").isNotBlank())SelectionContainer{Text("发送代理："+maskDisplay(value("senderThreadId"),mask),style=MaterialTheme.typography.labelSmall)}
    val terms=query.trim().split(Regex("\\s+")).filter{it.isNotBlank()}
    val matches=ids.filter{id->val text=maskDisplay(id+" "+sessions[id]?.title.orEmpty()+" "+agents?.get(id)?.toString().orEmpty(),mask);terms.all{text.contains(it,true)}}
    if(ids.isNotEmpty())OutlinedTextField(query,{query=it.take(200)},Modifier.fillMaxWidth(),singleLine=true,label={Text("查找代理、状态或会话")})
    val pages=((matches.size+11)/12).coerceAtLeast(1)
    val current=page.coerceIn(0,pages-1)
    Text("${matches.size} / ${ids.size} 个代理 · 活动记录不表示当前仍在运行",style=MaterialTheme.typography.labelSmall)
    if(pages>1)Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
        TextButton(onClick={page=current-1},enabled=current>0){Text("上一页")}
        Text("${current+1} / $pages",style=MaterialTheme.typography.labelSmall)
        TextButton(onClick={page=current+1},enabled=current<pages-1){Text("下一页")}
    }
    matches.drop(current*12).take(12).forEach{id->
        OutlinedCard(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
            val session=sessions[id]
            Text(maskDisplay(session?.title?:id,mask),style=MaterialTheme.typography.titleSmall)
            val agent=agents?.get(id)
            if(agent!=null){
                val status=(agent as? JsonObject)?.get("status") as? JsonPrimitive
                status?.contentOrNull?.let{Text(maskDisplay(it,mask),style=MaterialTheme.typography.labelSmall)}
                val text=agent.toString()
                SelectionContainer{Text(maskDisplay(text,mask).take(2000),style=MaterialTheme.typography.bodySmall)}
                if(text.length>2000)TextButton(onClick={reading="代理状态 · $id" to text}){Text("阅读完整状态记录")}
            }else Text("此记录未报告代理状态。",style=MaterialTheme.typography.labelSmall)
            if(session!=null)TextButton(onClick={navigate?.invoke(session.sessionId)},enabled=navigate!=null){Text("打开原代理会话")}
            else Text("尚未同步或不在当前授权项目中，无法打开。",style=MaterialTheme.typography.labelSmall)
        }}
    }
    if(matches.isEmpty())Text(if(ids.isEmpty())"此记录没有代理列表，详见原始记录。" else "没有匹配代理。",style=MaterialTheme.typography.bodySmall)
}
