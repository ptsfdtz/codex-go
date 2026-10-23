package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ensureActive
import kotlinx.serialization.json.*
import kotlin.coroutines.coroutineContext

private data class HistorySearchHit(val entry:ChatEntry,val excerpt:String)

@Composable internal fun HistorySearch(repo:DeckRepository,sessionId:String,initialQuery:String,onClose:()->Unit){
    val state by repo.state.collectAsState()
    var query by remember{mutableStateOf(initialQuery)}
    var results by remember{mutableStateOf<List<HistorySearchHit>>(emptyList())}
    var cursor by remember{mutableStateOf<String?>(null)}
    var seen by remember{mutableStateOf(setOf<String>())}
    var pages by remember{mutableIntStateOf(0)}
    var scanned by remember{mutableIntStateOf(0)}
    var complete by remember{mutableStateOf(false)}
    var limited by remember{mutableStateOf(false)}
    var running by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf<String?>(null)}
    var expanded by remember{mutableStateOf<String?>(null)}
    var reset by remember{mutableIntStateOf(0)}
    LaunchedEffect(query,state.host?.hostId,state.connection,state.stale,state.historyGeneration,state.displayMask,reset){
        running=false;results=emptyList();cursor=null;seen=emptySet();pages=0;scanned=0;complete=false;limited=false;error=null;expanded=null
    }
    LaunchedEffect(running,query,state.host?.hostId,state.connection,state.stale,state.historyGeneration,state.displayMask,reset){
        if(!running)return@LaunchedEffect
        val needle=query.trim()
        if(needle.isBlank()||state.stale){running=false;return@LaunchedEffect}
        try{
            repeat(20){
                coroutineContext.ensureActive()
                val target=cursor
                val page=repo.readUpstreamHistory(sessionId,target)
                coroutineContext.ensureActive()
                require(page.nextCursor==null||(page.nextCursor!=target&&page.nextCursor !in seen)){"历史游标重复，请重新搜索。"}
                val additions=page.entries.mapNotNull{source->
                    val entry=persistedChatEntry(sessionId,source)
                    val full=nativeItemEntry(entry.id,source.getValue("item").jsonObject,textLimit=Int.MAX_VALUE)
                    val body=maskDisplay(full.text,state.displayMask)
                    if(!body.contains(needle,true)&&!maskDisplay(entry.title,state.displayMask).contains(needle,true))null else{
                        val index=body.indexOf(needle,ignoreCase=true).coerceAtLeast(0)
                        HistorySearchHit(entry,body.substring((index-80).coerceAtLeast(0)).take(500))
                    }
                }
                val merged=(results+additions).distinctBy{it.entry.id}
                if(merged.size>200||merged.sumOf{it.entry.detail.toByteArray(Charsets.UTF_8).size.toLong()+it.entry.text.toByteArray(Charsets.UTF_8).size+it.excerpt.toByteArray(Charsets.UTF_8).size}>8L*1024*1024){limited=true;running=false;return@LaunchedEffect}
                results=merged;pages++;scanned+=page.entries.size
                target?.let{seen=seen+it};cursor=page.nextCursor
                if(page.nextCursor==null){complete=true;running=false;return@LaunchedEffect}
            }
        }catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"搜索中断，请核对连接后继续。"}finally{running=false}
    }
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false)){
        Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).imePadding()){
            Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                Row(Modifier.fillMaxWidth()){Text("搜索已保存历史",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge);TextButton(onClick=onClose){Text("关闭")}}
                OutlinedTextField(query,{query=it.take(200)},Modifier.fillMaxWidth(),singleLine=true,label={Text("搜索消息、工具正文或标题")},enabled=!running)
                Row{
                    if(running)TextButton(onClick={running=false}){Text("暂停扫描")}
                    else TextButton(onClick={error=null;running=true},enabled=!state.stale&&query.isNotBlank()&&!complete&&!limited){Text(if(pages==0)"开始搜索" else "继续扫描")}
                    TextButton(onClick={reset++},enabled=!running){Text("重新搜索")}
                }
                if(running)LinearProgressIndicator(Modifier.fillMaxWidth())
                if(state.stale)Text("离线时停止扫描，恢复连接后重新搜索。",style=MaterialTheme.typography.bodySmall)
                error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
                Text("已扫描 $pages 页 / $scanned 条 · ${results.size} 条匹配"+(if(complete)" · 已到历史末页" else " · 结果尚不完整"),style=MaterialTheme.typography.labelSmall)
                if(limited)Text("匹配内容达到 200 条或 8 MiB 限制，请缩小关键词后重新搜索。",style=MaterialTheme.typography.bodySmall)
                Text("每次最多扫描 20 页，可暂停/继续；只搜索原生已保存的消息正文与工具内容，不搜索未报告字段。历史在扫描期间可能变化，不是原子快照。",style=MaterialTheme.typography.labelSmall)
                LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(12.dp)){
                    if(!running&&pages>0&&results.isEmpty())item{Text(if(complete)"已扫描历史中没有匹配内容。" else "已扫描范围内暂无匹配，可继续扫描。")}
                    items(results,key={it.entry.id}){hit->val entry=hit.entry;OutlinedCard(Modifier.fillMaxWidth()){
                        Column(Modifier.padding(12.dp)){
                            Text(maskDisplay(entry.title.ifBlank{entry.kind},state.displayMask),style=MaterialTheme.typography.labelSmall)
                            TextButton(onClick={expanded=if(expanded==entry.id)null else entry.id}){Text(if(expanded==entry.id)"收起记录" else "展开原始消息")}
                            if(expanded==entry.id)NativeMessage(entry,state.displayMask,repo,sessionId)
                            else Text(hit.excerpt,style=MaterialTheme.typography.bodySmall)
                            if(entry.truncated)Text("命中依据已读取正文；展开消息仍是有界预览，完整内容请沿会话历史查看。",style=MaterialTheme.typography.labelSmall)
                        }
                    }}
                }
            }
        }
    }
}
