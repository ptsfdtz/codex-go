package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.CancellationException
import java.time.Instant

private fun nativeThreadState(value:String)=when(value){"idle"->"空闲";"active"->"活动中";"notLoaded"->"未加载";"systemError"->"原生服务错误";else->value}

@Composable internal fun SessionActivityDialog(session:Session,state:DeckState,repo:DeckRepository,onClose:()->Unit){
    var latest by remember{mutableStateOf<LatestTurn?>(null)}
    var readAt by remember{mutableStateOf("")}
    var error by remember{mutableStateOf<String?>(null)}
    var loading by remember{mutableStateOf(false)}
    var refresh by remember{mutableIntStateOf(0)}
    var page by remember{mutableIntStateOf(0)}
    var reading by remember(state.displayMask){mutableStateOf<Pair<String,String>?>(null)}
    val current=state.snapshot.sessions.find{it.sessionId==session.sessionId}?:session
    val turns=state.snapshot.turns.filter{it.sessionId==session.sessionId}.sortedByDescending{it.startedAt}
    val approvals=state.snapshot.approvals.filter{it.sessionId==session.sessionId&&it.status=="pending"}
    LaunchedEffect(state.host?.hostId,current.upstreamThreadId,current.projectId,state.stale,state.connection,state.capabilities?.supports("latestUpstreamTurn"),refresh){
        latest=null;error=null;readAt=""
        if(!state.stale&&state.capabilities?.supports("latestUpstreamTurn")==true){
            loading=true
            try{latest=repo.readLatestSessionTurn(current);readAt=Instant.now().toString()}
            catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"无法核对原生状态"}finally{loading=false}
        }
    }
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false)){
        Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)){
            Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
                Row(Modifier.fillMaxWidth()){Text("任务与同步状态",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge);TextButton(onClick=onClose){Text("关闭")}}
                Text(maskDisplay(current.title,state.displayMask),style=MaterialTheme.typography.titleSmall)
                if(loading)LinearProgressIndicator(Modifier.fillMaxWidth())
                LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(12.dp)){
                    item{OutlinedCard(Modifier.fillMaxWidth()){Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                        Text("电脑原生状态",style=MaterialTheme.typography.titleSmall)
                        if(state.stale)Text("当前离线，未读取实时原生状态。")
                        else if(state.capabilities?.supports("latestUpstreamTurn")!=true)Text("当前电脑尚不支持此项读取。")
                        error?.let{Text(maskDisplay(it,state.displayMask),color=MaterialTheme.colorScheme.error)}
                        latest?.let{source->
                            Text("线程："+nativeThreadState(source.threadStatus))
                            Text("最新轮次："+(source.status?.let(::statusLabel)?:"尚无轮次"))
                            source.turnId?.let{SelectionContainer{Text(maskDisplay(it,state.displayMask),style=MaterialTheme.typography.labelSmall)}}
                            Text("读取时间：$readAt",style=MaterialTheme.typography.labelSmall)
                        }
                        Text("这是一次读取结果，线程与最新轮次可能随后变化；不会据此覆盖本地未知任务或自动重试。",style=MaterialTheme.typography.bodySmall)
                        TextButton(onClick={refresh++},enabled=!state.stale&&!loading&&state.capabilities?.supports("latestUpstreamTurn")==true){Text("重新核对原生状态")}
                    }}}
                    item{OutlinedCard(Modifier.fillMaxWidth()){Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                        Text("已同步状态",style=MaterialTheme.typography.titleSmall)
                        Text("会话："+statusLabel(current.status))
                        Text("连接：${state.connection} · ${if(state.stale)"缓存" else "已连接"}")
                        Text("最近同步：${state.lastSynced?:"未报告"}",style=MaterialTheme.typography.labelSmall)
                        Text("待处理请求：${approvals.size} · 已记录轮次：${turns.size}")
                        if(state.observationPendingSession==session.sessionId)Text("尚未确认实时观察，当前内容可能仅来自已保存历史。",style=MaterialTheme.typography.bodySmall)
                        if(current.status=="unknown"||turns.any{it.status=="unknown"})Text("存在结果未确认的任务，请先核对电脑与消息记录。不要直接重发，避免重复执行。",color=MaterialTheme.colorScheme.error)
                        if(approvals.isNotEmpty())Text("返回会话后在原审批或问题卡片处理；此窗口不会代替审批。",style=MaterialTheme.typography.bodySmall)
                        TextButton(onClick=repo::refresh,enabled=!state.stale&&!state.busy){Text("刷新会话与记录")}
                    }}}
                    item{
                        Text("Bridge 已记录轮次",style=MaterialTheme.typography.titleSmall)
                        Text("不等于原线程完整历史，外部轮次可能没有本地记录。",style=MaterialTheme.typography.labelSmall)
                        val pages=((turns.size+19)/20).coerceAtLeast(1)
                        val index=page.coerceIn(0,pages-1)
                        if(pages>1)Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                            TextButton(onClick={page=index-1},enabled=index>0){Text("上一页")}
                            Text("${index+1} / $pages",style=MaterialTheme.typography.labelSmall)
                            TextButton(onClick={page=index+1},enabled=index<pages-1){Text("下一页")}
                        }
                        if(turns.isEmpty())Text("没有本地轮次记录。",style=MaterialTheme.typography.bodySmall)
                    }
                    items(turns.drop(page.coerceIn(0,((turns.size+19)/20-1).coerceAtLeast(0))*20).take(20),key={it.turnId}){turn->
                        OutlinedCard(Modifier.fillMaxWidth()){Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
                            Text(statusLabel(turn.status),style=MaterialTheme.typography.titleSmall)
                            Text("开始：${turn.startedAt}",style=MaterialTheme.typography.labelSmall)
                            turn.endedAt?.let{Text("结束：$it",style=MaterialTheme.typography.labelSmall)}
                            SelectionContainer{Text("原生轮次："+maskDisplay(turn.upstreamTurnId?:"尚未确认",state.displayMask),style=MaterialTheme.typography.bodySmall)}
                            turn.error?.takeIf{it.isNotBlank()}?.let{message->
                                Text(maskDisplay(userFacingError(raw=message),state.displayMask).take(1000),style=MaterialTheme.typography.bodySmall)
                                TextButton(onClick={reading="已记录轮次错误" to message}){Text("查看完整已记录错误")}
                            }
                        }}
                    }
                }
            }
        }
    }
    reading?.let{(title,text)->LoadedTextReader(title,text,state.displayMask){reading=null}}
}
