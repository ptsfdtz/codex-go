package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

/** Citation metadata describes the source; it does not grant access to memory files. */
@Composable internal fun AssistantSources(entry:ChatEntry,mask:String){
    if(entry.kind!="assistant")return
    val item=remember(entry.detail){runCatching{wire.parseToJsonElement(entry.detail) as? JsonObject}.getOrNull()}?:return
    val citation=item["memoryCitation"] as? JsonObject?:return
    val sources=(citation["entries"] as? JsonArray).orEmpty()
    val threads=(citation["threadIds"] as? JsonArray).orEmpty().mapNotNull{(it as? JsonPrimitive)?.contentOrNull}.distinct()
    if(sources.isEmpty()&&threads.isEmpty())return
    var expanded by rememberSaveable(entry.id){mutableStateOf(false)}
    var query by remember(entry.id){mutableStateOf("")}
    var category by remember(entry.id){mutableStateOf("sources")}
    var page by remember(entry.id,query,category){mutableIntStateOf(0)}
    var reading by remember(entry.id,mask){mutableStateOf<Pair<String,String>?>(null)}
    val sessions=LocalNativeAgentSessions.current
    val navigate=LocalNativeSessionNavigation.current
    val terms=query.trim().split(Regex("\\s+")).filter{it.isNotBlank()}
    val matchingSources=sources.filter{source->val text=maskDisplay(source.toString(),mask);terms.all{text.contains(it,true)}}
    val matchingThreads=threads.filter{id->val text=maskDisplay(id+" "+sessions[id]?.title.orEmpty(),mask);terms.all{text.contains(it,true)}}
    Column(Modifier.fillMaxWidth()){
        TextButton(onClick={expanded=!expanded}){Text(if(expanded)"收起记忆来源" else "记忆来源 · ${sources.size} 条引用 / ${threads.size} 个会话")}
        if(expanded){
            Row{
                TextButton(onClick={category="sources"}){Text("引用 (${matchingSources.size})")}
                TextButton(onClick={category="threads"}){Text("来源会话 (${matchingThreads.size})")}
            }
            OutlinedTextField(query,{query=it.take(200)},Modifier.fillMaxWidth(),singleLine=true,label={Text("查找来源路径、说明或会话")})
            val size=if(category=="sources")matchingSources.size else matchingThreads.size
            val pages=((size+19)/20).coerceAtLeast(1)
            val current=page.coerceIn(0,pages-1)
            if(pages>1)Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                TextButton(onClick={page=current-1},enabled=current>0){Text("上一页")}
                Text("${current+1} / $pages · $size 项",style=MaterialTheme.typography.labelSmall)
                TextButton(onClick={page=current+1},enabled=current<pages-1){Text("下一页")}
            }
            if(size==0)Text("没有匹配来源。",style=MaterialTheme.typography.bodySmall)
            if(category=="sources")matchingSources.drop(current*20).take(20).forEach{element->val source=element as? JsonObject
                if(source!=null)OutlinedCard(Modifier.fillMaxWidth().padding(vertical=4.dp)){
                    Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
                        val path=(source["path"] as? JsonPrimitive)?.contentOrNull.orEmpty()
                        val start=(source["lineStart"] as? JsonPrimitive)?.longOrNull
                        val end=(source["lineEnd"] as? JsonPrimitive)?.longOrNull
                        SelectionContainer{Text(maskDisplay(path,mask),style=MaterialTheme.typography.bodySmall)}
                        if(start!=null&&end!=null)Text("引用行 $start–$end",style=MaterialTheme.typography.labelSmall)
                        val note=(source["note"] as? JsonPrimitive)?.contentOrNull.orEmpty()
                        if(note.isNotBlank())SelectionContainer{Text(maskDisplay(note,mask).take(4000),style=MaterialTheme.typography.bodySmall)}
                        if(note.length>4000)TextButton(onClick={reading="记忆来源说明" to note}){Text("阅读完整说明")}
                    }
                }else TextButton(onClick={reading="来源记录" to element.toString()}){Text("阅读未知来源记录")}
            }else matchingThreads.drop(current*20).take(20).forEach{id->
                val session=sessions[id]
                if(session!=null)TextButton(onClick={navigate?.invoke(session.sessionId)},enabled=navigate!=null){Text("打开来源会话 · "+maskDisplay(session.title,mask))}
                else SelectionContainer{Text("来源会话（尚未同步或未授权）："+maskDisplay(id,mask),style=MaterialTheme.typography.bodySmall)}
            }
            Text("引用文件路径仅供查看，不读取项目外记忆文件；会话入口沿用当前电脑已有授权。这里只展示已加载来源记录。",style=MaterialTheme.typography.labelSmall)
        }
    }
    reading?.let{(title,text)->LoadedTextReader(title,text,mask){reading=null}}
}
