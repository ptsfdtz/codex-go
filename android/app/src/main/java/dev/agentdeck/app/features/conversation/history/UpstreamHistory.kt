package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

internal data class UpstreamHistoryPage(val entries:List<JsonObject>,val nextCursor:String?)

@Composable internal fun UpstreamHistoryDialog(repo:DeckRepository,sessionId:String,onClose:()->Unit) {
    val state by repo.state.collectAsState()
    val scope=rememberCoroutineScope()
    var page by remember{mutableStateOf<UpstreamHistoryPage?>(null)}
    var cursor by remember{mutableStateOf<String?>(null)}
    var previous by remember{mutableStateOf<List<String?>>(emptyList())}
    var busy by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf<String?>(null)}
    var retryCursor by remember{mutableStateOf<String?>(null)}
    var retryBack by remember{mutableStateOf(false)}
    suspend fun load(target:String?,back:Boolean=false) {
        retryCursor=target;retryBack=back
        busy=true;error=null
        try {
            val result=repo.readUpstreamHistory(sessionId,target)
            if(result.nextCursor!=null)require(result.nextCursor!=target&&!previous.contains(result.nextCursor)){"历史游标重复，请重新打开历史"}
            if(back)previous=previous.dropLast(1) else if(page!=null)previous=previous+listOf(cursor)
            cursor=target;page=result
        }catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"历史读取失败"}finally{busy=false}
    }
    LaunchedEffect(sessionId,state.historyGeneration){page=null;cursor=null;previous=emptyList();load(null)}
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false)) {
        Surface(Modifier.fillMaxSize().padding(12.dp),shape=MaterialTheme.shapes.large) {
            Column(Modifier.padding(16.dp)) {
                Row(Modifier.fillMaxWidth()) { Text("已保存的会话历史",style=MaterialTheme.typography.titleLarge,modifier=Modifier.weight(1f));TextButton(onClick=onClose){Text("关闭")} }
                Text("来自电脑上同一 Codex 会话的已保存内容。运行中内容请查看会话。",style=MaterialTheme.typography.bodySmall)
                if(busy)LinearProgressIndicator(Modifier.fillMaxWidth().padding(vertical=8.dp))
                error?.let{Text(it,color=MaterialTheme.colorScheme.error);TextButton(onClick={scope.launch{load(retryCursor,retryBack)}},enabled=!busy){Text("重试")}}
                LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(16.dp)) {
                    if(page?.entries?.isEmpty()==true)item{Text("这一页没有已保存的内容")}
                    itemsIndexed(page?.entries.orEmpty()){_,entry->
                        var raw by remember(entry){mutableStateOf(false)}
                        Column{
                            NativeMessage(persistedChatEntry(sessionId,entry),repo.state.value.displayMask,repo,sessionId)
                            TextButton(onClick={raw=!raw}){Text(if(raw)"收起完整记录" else "查看完整记录")}
                            if(raw)SelectionContainer{Text(maskDisplay(entry.toString(),repo.state.value.displayMask),style=MaterialTheme.typography.bodySmall)}
                        }
                    }
                }
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
                    TextButton(onClick={scope.launch{load(previous.last(),true)}},enabled=!busy&&previous.isNotEmpty()){Text("上一页")}
                    TextButton(onClick={page?.nextCursor?.let{next->scope.launch{load(next)}}},enabled=!busy&&page?.nextCursor!=null){Text("下一页")}
                }
            }
        }
    }
}
