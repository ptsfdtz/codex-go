package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*

@Composable internal fun SessionCompactionDialog(session:Session,state:DeckState,repo:DeckRepository,onClose:()->Unit){
    var latest by remember{mutableStateOf<LatestTurn?>(null)}
    var loading by remember{mutableStateOf(false)}
    var writing by remember{mutableStateOf(false)}
    var attempted by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf<String?>(null)}
    var accepted by remember{mutableStateOf(false)}
    var revision by remember{mutableIntStateOf(0)}
    val scope=rememberCoroutineScope()
    LaunchedEffect(state.host?.hostId,session.upstreamThreadId,state.stale,revision){
        latest=null
        if(!state.stale){loading=true;try{latest=repo.readLatestSessionTurn(session)}catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"无法核对原会话"}finally{loading=false}}
    }
    val ready=latest?.threadStatus=="idle"&&latest?.turnId!=null&&latest?.status!="inProgress"&&canManageSession(state,session)&&session.archived!=1
    AlertDialog(onDismissRequest={if(!writing)onClose()},title={Text("压缩原会话上下文？")},text={Column(verticalArrangement=Arrangement.spacedBy(10.dp)){
        Text("由电脑上的 Codex 整理原线程较早的上下文，可能使用模型额度并改变后续模型可见的上下文。保留当前草稿，不复制线程或发送新任务。请先暂停持续目标和运行中的任务。")
        Text("先核对最新已保存轮次，变化时拒绝提交。原生接口无原子版本条件，双端并发仍存在窗口；受理不等于压缩完成。",style=MaterialTheme.typography.bodySmall)
        if(loading||writing)LinearProgressIndicator(Modifier.fillMaxWidth())
        latest?.let{Text("原生线程：${it.threadStatus} · 最新轮次：${it.status?:"无"}",style=MaterialTheme.typography.labelSmall)}
        error?.let{Text(maskDisplay(it,state.displayMask),color=MaterialTheme.colorScheme.error)}
        if(accepted)Text("电脑已受理压缩请求。请刷新会话历史核对原生压缩记录；此处未确认完成。")
        if(attempted&&!writing&&!accepted)Text("本次提交已尝试，请核对电脑和原会话历史，不要重复提交。")
        if(!attempted)TextButton(onClick={error=null;revision++},enabled=!loading&&!writing&&!state.stale){Text("重新核对轮次")}
    }},confirmButton={if(!attempted)TextButton(onClick={
        val turn=latest?.turnId?:return@TextButton
        attempted=true;writing=true;error=null
        scope.launch{try{repo.compactSession(session,turn);accepted=true}catch(e:CancellationException){throw e}catch(e:Exception){error=(e.message?:"压缩提交未确认")+"；请核对，不要重复操作。"}finally{writing=false}}
    },enabled=ready&&!loading&&!writing&&!state.stale){Text("确认压缩")}},dismissButton={TextButton(onClick=onClose,enabled=!writing){Text("关闭")}})
}
