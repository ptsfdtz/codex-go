package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.TrackChanges
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import kotlinx.serialization.json.*
import java.text.NumberFormat

internal fun goalStatus(value:String)=when(value){"active"->"持续推进中";"paused"->"已暂停";"blocked"->"受阻";"usageLimited"->"达到用量限制";"budgetLimited"->"达到预算限制";"complete"->"已完成";else->value}

@Composable internal fun SessionGoalDialog(session:Session,state:DeckState,repo:DeckRepository,onClose:()->Unit){
    var resuming by remember{mutableStateOf(false)}
    var clearing by remember{mutableStateOf(false)}
    var editing by remember{mutableStateOf(false)}
    var writing by remember{mutableStateOf(false)}
    var message by remember{mutableStateOf<String?>(null)}
    var objective by remember{mutableStateOf("")}
    var budget by remember{mutableStateOf("")}
    var expected by remember{mutableStateOf("")}
    var attempted by remember{mutableStateOf(false)}
    var confirm by remember{mutableStateOf(false)}
    var actionsOpen by remember{mutableStateOf(false)}
    val scope=rememberCoroutineScope()
    var result by remember{mutableStateOf<JsonObject?>(null)}
    var error by remember{mutableStateOf<String?>(null)}
    var loading by remember{mutableStateOf(false)}
    var revision by remember{mutableIntStateOf(0)}
    val changed=state.events.lastOrNull{it.sessionId==session.sessionId&&it.action=="goal.updated"}?.eventId
    LaunchedEffect(state.host?.hostId,state.connection,state.stale,session.sessionId,changed,revision){
        result=null;error=null;loading=false
        if(!state.stale){loading=true;try{result=repo.readSessionGoal(session)}catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"无法读取目标"}finally{loading=false}}
    }
    val muted=MaterialTheme.colorScheme.onSurfaceVariant
    AlertDialog(onDismissRequest={if(!writing)onClose()},title={
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
            Icon(Icons.Outlined.TrackChanges,null,Modifier.size(20.dp),tint=muted)
            Text("会话目标",style=MaterialTheme.typography.titleMedium,modifier=Modifier.weight(1f))
            IconButton(onClick={revision++},enabled=!state.stale&&!loading&&!writing,modifier=Modifier.size(32.dp)){Icon(Icons.Outlined.Refresh,"刷新目标",Modifier.size(18.dp))}
        }
    },text={Column(Modifier.fillMaxWidth().heightIn(max=500.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)){
        if(loading)LinearProgressIndicator(Modifier.fillMaxWidth())
        if(state.stale)Text("连接电脑后读取目标。")
        error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
        message?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
        result?.let{data->
            val goal=data["goal"] as? JsonObject
            if(goal==null)Text("此会话当前没有持续目标。")else{
                fun value(key:String)=(goal[key] as? JsonPrimitive)?.contentOrNull.orEmpty()
                fun count(key:String)=(goal[key] as? JsonPrimitive)?.longOrNull?.takeIf{it>=0}?.let{NumberFormat.getIntegerInstance().format(it)}?:"未报告"
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                Surface(shape=MaterialTheme.shapes.small,color=MaterialTheme.colorScheme.surfaceContainerHigh){Text(goalStatus(value("status")),Modifier.padding(horizontal=10.dp,vertical=5.dp),style=MaterialTheme.typography.labelMedium)}
                Spacer(Modifier.weight(1f))
                if(listOf("sessionGoalEdit","sessionGoalResume","sessionGoalClear").any{state.capabilities?.supports(it)==true})Box{
                IconButton(onClick={actionsOpen=true},enabled=!loading&&!writing,modifier=Modifier.size(32.dp)){Icon(Icons.Outlined.MoreHoriz,"目标操作",Modifier.size(20.dp))}
                DropdownMenu(expanded=actionsOpen,onDismissRequest={actionsOpen=false}){
                if(state.capabilities?.supports("sessionGoalEdit")==true)DropdownMenuItem(text={Text("编辑目标与预算")},onClick={
                    actionsOpen=false
                    objective=value("objective");budget=(goal["tokenBudget"] as? JsonPrimitive)?.longOrNull?.toString().orEmpty();expected=data["goalRevision"]?.jsonPrimitive?.contentOrNull.orEmpty();attempted=false;editing=true
                },enabled=!loading&&!writing&&!state.stale&&canManageSession(state,session)&&session.archived!=1&&value("status")!="active"&&data["goalRevision"] is JsonPrimitive)
                if(state.capabilities?.supports("sessionGoalResume")==true&&value("status") in listOf("paused","blocked"))DropdownMenuItem(text={Text("恢复已有目标")},onClick={
                    actionsOpen=false
                    expected=data["goalRevision"]?.jsonPrimitive?.contentOrNull.orEmpty();attempted=false;message=null;resuming=true
                },enabled=!loading&&!writing&&!state.stale&&canManageSession(state,session)&&session.archived!=1&&data["goalRevision"] is JsonPrimitive)
                if(state.capabilities?.supports("sessionGoalClear")==true)DropdownMenuItem(text={Text("删除目标",color=MaterialTheme.colorScheme.error)},onClick={
                    actionsOpen=false
                    expected=data["goalRevision"]?.jsonPrimitive?.contentOrNull.orEmpty();attempted=false;clearing=true
                },enabled=!loading&&!writing&&!state.stale&&canManageSession(state,session)&&session.archived!=1&&value("status")!="active"&&data["goalRevision"] is JsonPrimitive)
                }}}
                Surface(shape=MaterialTheme.shapes.medium,color=MaterialTheme.colorScheme.surfaceContainerHigh){Box(Modifier.fillMaxWidth().padding(12.dp)){MarkdownText(maskDisplay(value("objective"),state.displayMask),fontSizeSp=14f)}}
                val seconds=(goal["timeUsedSeconds"] as? JsonPrimitive)?.longOrNull?.takeIf{it>=0}
                val duration=seconds?.let{when{it>=3600->"${it/3600} 时 ${it%3600/60} 分";it>=60->"${it/60} 分 ${it%60} 秒";else->"$it 秒"}}?:"—"
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(16.dp)){
                    listOf("已用 tokens" to count("tokensUsed"),"执行时长" to duration).forEach{(label,value)->
                        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){
                            Text(label,style=MaterialTheme.typography.labelSmall,color=muted)
                            Text(value,style=MaterialTheme.typography.titleMedium)
                        }
                    }
                }
                HorizontalDivider()
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                    Text("Token 预算",style=MaterialTheme.typography.bodySmall,color=muted)
                    Text(if(goal["tokenBudget"]==null||goal["tokenBudget"]==JsonNull)"未设置" else count("tokenBudget"),style=MaterialTheme.typography.bodySmall)
                }
            }
        }
    }},confirmButton={TextButton(onClick=onClose,enabled=!writing){Text("关闭")}})
    if(editing)AlertDialog(onDismissRequest={if(!writing)editing=false},title={Text("编辑目标",style=MaterialTheme.typography.titleMedium)},text={Column(Modifier.heightIn(max=480.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)){
        Text("保存后不自动恢复执行；预算留空保留原值。",style=MaterialTheme.typography.bodySmall,color=muted)
        OutlinedTextField(objective,{if(it.toByteArray(Charsets.UTF_8).size<=128000)objective=it},Modifier.fillMaxWidth(),label={Text("目标正文")},minLines=4,maxLines=10,enabled=!writing&&!attempted)
        OutlinedTextField(budget,{if(it.length<=19&&it.all(Char::isDigit))budget=it},Modifier.fillMaxWidth(),label={Text("Token 预算（正整数）")},singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number),enabled=!writing&&!attempted)
        if(writing)LinearProgressIndicator(Modifier.fillMaxWidth())
        message?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
        if(attempted&&!writing)Text("本次修改已尝试，请关闭并刷新目标核对后再操作。",style=MaterialTheme.typography.labelSmall)
    }},confirmButton={TextButton(onClick={confirm=true},enabled=!attempted&&!writing&&!state.stale&&objective.isNotBlank()&&(budget.isBlank()||budget.toLongOrNull()?.let{it>0}==true)){Text("检查修改")}},dismissButton={TextButton(onClick={editing=false},enabled=!writing){Text("关闭")}})
    if(confirm)AlertDialog(onDismissRequest={confirm=false},title={Text("保存目标修改？")},text={Text("修改电脑上的原会话目标。目标版本或执行状态变化时将拒绝覆盖；原生接口没有原子版本条件，双端并发仍存在窗口。不会恢复执行。")},confirmButton={TextButton(onClick={
        confirm=false;attempted=true;writing=true;message=null
        scope.launch{try{result=repo.editSessionGoal(session,objective,budget.toLongOrNull(),expected);message="目标修改已确认。";editing=false}catch(e:CancellationException){throw e}catch(e:Exception){result=null;message=(e.message?:"目标修改未确认")+"；请刷新核对，不要重复保存。"}finally{writing=false}}
    },enabled=!writing&&!attempted&&!state.stale){Text("确认保存")}},dismissButton={TextButton(onClick={confirm=false}){Text("取消")}})
    if(resuming)AlertDialog(onDismissRequest={if(!writing)resuming=false},title={Text("恢复已有目标？")},text={Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
        Text("激活原目标并发送继续指令，保留正文、预算与累计统计。使用会话保存的模型或默认模型，以及工作区权限和按需审批。双端并发仍存在窗口。")
        if(writing)LinearProgressIndicator(Modifier.fillMaxWidth())
        message?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
        if(attempted&&!writing)Text("本次恢复已尝试，请关闭并刷新核对，不要重复启动。")
    }},confirmButton={TextButton(onClick={
        attempted=true;writing=true;message=null
        scope.launch{try{repo.resumeSessionGoal(session,expected);result=null;message="恢复轮次已确认。";resuming=false;revision++}catch(e:CancellationException){throw e}catch(e:Exception){result=null;message=(e.message?:"目标恢复未确认")+"；请刷新核对，不要重复启动。"}finally{writing=false}}
    },enabled=!writing&&!attempted&&!state.stale){Text("恢复并继续")}},dismissButton={TextButton(onClick={resuming=false},enabled=!writing){Text("取消")}})
    if(clearing)AlertDialog(onDismissRequest={if(!writing)clearing=false},title={Text("删除当前会话目标？")},text={Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
        Text("将删除电脑原生服务中的目标正文、预算和目标统计。保留原会话、消息和项目文件；不会启动任务。此操作无法撤回。活动目标须先暂停。")
        if(writing)LinearProgressIndicator(Modifier.fillMaxWidth())
        message?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
        if(attempted&&!writing)Text("本次操作已尝试，请关闭并刷新核对，不要重复删除。",style=MaterialTheme.typography.labelSmall)
    }},confirmButton={TextButton(onClick={
        attempted=true;writing=true;message=null
        scope.launch{try{result=repo.clearSessionGoal(session,expected);message="目标删除已确认，会话仍保留。";clearing=false}catch(e:CancellationException){throw e}catch(e:Exception){result=null;message=(e.message?:"目标删除未确认")+"；请刷新核对。"}finally{writing=false}}
    },enabled=!writing&&!attempted&&!state.stale){Text("删除目标",color=MaterialTheme.colorScheme.error)}},dismissButton={TextButton(onClick={clearing=false},enabled=!writing){Text("取消")}})

}
