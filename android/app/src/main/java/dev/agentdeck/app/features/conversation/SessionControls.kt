package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable fun SessionActions(session:Session,state:DeckState,repo:DeckRepository,showButton:Boolean=true,requestMenu:Boolean=false,onMenuConsumed:()->Unit={}){
    var menu by remember(state.host?.hostId,session.sessionId){mutableStateOf(false)}
    var operation by remember(state.host?.hostId,session.sessionId){mutableStateOf("")}
    LaunchedEffect(requestMenu){if(requestMenu){menu=true;onMenuConsumed()}}
    val enabled=canManageSession(state,session)
    Box{
        if(showButton)IconButton(onClick={menu=true}){Icon(Icons.Outlined.MoreHoriz,"管理会话 ${session.title}",Modifier.size(18.dp))}
        DropdownMenu(expanded=menu,onDismissRequest={menu=false}){
            DropdownMenuItem(text={Text("任务与同步状态")},onClick={menu=false;operation="activity"})
            DropdownMenuItem(text={Text("会话关系与来源")},onClick={menu=false;operation="relations"})
            if(state.capabilities?.supports("sessionGoalView")==true)DropdownMenuItem(text={Text("查看会话目标")},onClick={menu=false;operation="goal"})
            if(state.capabilities?.supports("sessionCompaction")==true)DropdownMenuItem(text={Text("压缩上下文")},enabled=enabled&&session.archived!=1,onClick={menu=false;operation="compact"})
            if(state.capabilities?.supports("sessionFork")==true)DropdownMenuItem(text={Text("分叉到新会话")},enabled=enabled,onClick={menu=false;operation="fork"})
            listOf("rename" to "重命名","pin" to if(session.pinned==1)"取消置顶" else "置顶","archive" to if(session.archived==1)"恢复会话" else "归档","delete" to "删除").forEach{(key,label)->
                DropdownMenuItem(text={Text(label)},enabled=enabled,onClick={menu=false;if(key=="pin")repo.manageSession(session,"pin")else operation=if(key=="archive"&&session.archived==1)"restore" else key})
            }
        }
    }
    if(operation=="compact")key(state.host?.hostId,session.sessionId){SessionCompactionDialog(session,state,repo){operation=""}}
    else if(operation=="activity")key(state.host?.hostId,session.sessionId){SessionActivityDialog(session,state,repo){operation=""}}
    else if(operation=="relations")key(state.host?.hostId,session.sessionId){SessionRelationsDialog(session,state,repo){operation=""}}
    else if(operation=="goal")key(state.host?.hostId,session.sessionId){SessionGoalDialog(session,state,repo){operation=""}}
    else if(operation.isNotEmpty())SessionOperationDialog(session,state,repo,operation){operation=""}
}

internal fun canManageSession(state:DeckState,session:Session)=
    state.host!=null&&!state.stale&&!state.busy&&session.status !in listOf("queued","running","waitingApproval","unknown")

@Composable internal fun SessionOperationDialog(session:Session,state:DeckState,repo:DeckRepository,operation:String,onDismiss:()->Unit){
    if(operation !in listOf("fork","rename","archive","restore","delete"))return
    var title by rememberSaveable(state.host?.hostId,session.sessionId,operation){mutableStateOf(session.title)}
    val enabled=canManageSession(state,session)&&(operation!="fork"||state.capabilities?.supports("sessionFork")==true)
    AlertDialog(onDismissRequest=onDismiss,title={Text(when(operation){"fork"->"分叉到新会话？";"rename"->"重命名会话";"archive"->"归档会话？";"restore"->"恢复会话？";else->"永久删除会话？"})},text={
        if(operation=="rename")OutlinedTextField(value=title,onValueChange={if(it.length<=160)title=it},label={Text("会话名称")},singleLine=true)
        else Text(if(operation=="fork")"由电脑上的 Codex 从此会话的已保存历史创建派生会话。原会话保留，不会自动发送消息或执行任务。" else if(operation=="delete")"将请求 Codex 永久删除此线程及其派生子线程，并删除 AgentDeck 中的本地消息记录。不可撤回，不会删除项目文件。" else if(operation=="archive")"会话会移入归档，可以稍后恢复。" else "恢复后可继续对话。")
    },confirmButton={TextButton(enabled=enabled&&(operation!="rename"||title.isNotBlank()),onClick={if(operation=="fork")repo.forkSession(session)else repo.manageSession(session,operation,title);onDismiss()}){Text(if(operation=="delete")"永久删除" else "确认")}},dismissButton={TextButton(onClick=onDismiss){Text("取消")}})
}

fun effortLabel(value:String)=when(value){"none"->"无";"minimal"->"最少";"low"->"低";"medium"->"中";"high"->"高";"xhigh"->"超高";else->value}

@Composable fun CodexModelPicker(state:DeckState,repo:DeckRepository,enabled:Boolean){
    var open by remember(state.host?.hostId){mutableStateOf(false)}
    val selected=state.models.find{it.model==state.selectedModel}?:state.models.firstOrNull{state.selectedModel.isEmpty()&&it.isDefault}
    val effort=state.selectedEffort.ifEmpty{selected?.defaultReasoningEffort.orEmpty()}
    Box{
        TextButton(onClick={open=true},enabled=enabled,contentPadding=PaddingValues(horizontal=8.dp)){
            Text(maskDisplay(selected?.displayName?:state.selectedModel.ifEmpty{"默认模型"},state.displayMask),fontSize=12.sp,maxLines=1,overflow=androidx.compose.ui.text.style.TextOverflow.Ellipsis,modifier=Modifier.weight(1f,fill=false).widthIn(max=140.dp))
            if(effort.isNotEmpty())Text(" · "+effortLabel(effort),fontSize=12.sp,maxLines=1)
            Icon(Icons.Outlined.ExpandMore,null,Modifier.size(16.dp))
        }
        DropdownMenu(expanded=open,onDismissRequest={open=false},shape=androidx.compose.foundation.shape.RoundedCornerShape(20.dp)){
            Column(Modifier.width(280.dp).padding(horizontal=16.dp,vertical=8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
                Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically,horizontalArrangement=Arrangement.SpaceBetween){
                    Text("模型与思维强度",style=MaterialTheme.typography.labelMedium)
                    IconButton(onClick=repo::refreshModels,enabled=enabled,modifier=Modifier.size(40.dp)){Icon(Icons.Outlined.Refresh,"刷新模型",Modifier.size(18.dp))}
                }
                val models=state.models
                if(models.isEmpty())Text("尚未获取模型",style=MaterialTheme.typography.bodySmall)
                else DiscreteComposerSlider("模型",models.map{maskDisplay(it.displayName,state.displayMask)},models.indexOfFirst{it.model==selected?.model},enabled){repo.selectModel(models[it])}
                val efforts=selected?.supportedReasoningEfforts.orEmpty()
                if(efforts.isNotEmpty())DiscreteComposerSlider("思维强度",efforts.map{effortLabel(it.reasoningEffort)},efforts.indexOfFirst{it.reasoningEffort==effort},enabled){repo.selectEffort(efforts[it].reasoningEffort)}
            }
        }
    }
}

@Composable private fun DiscreteComposerSlider(label:String,options:List<String>,selected:Int,enabled:Boolean,onSelect:(Int)->Unit){
    var position by remember(options,selected){mutableFloatStateOf(selected.coerceAtLeast(0).toFloat())}
    val index=kotlin.math.round(position).toInt().coerceIn(options.indices)
    Text(label,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    Text(options[index],style=MaterialTheme.typography.titleSmall,modifier=Modifier.fillMaxWidth(),textAlign=androidx.compose.ui.text.style.TextAlign.Center)
    Slider(value=position,onValueChange={position=it},onValueChangeFinished={onSelect(index)},enabled=enabled&&options.size>1,valueRange=0f..(options.size-1).coerceAtLeast(1).toFloat(),steps=(options.size-2).coerceAtLeast(0),modifier=Modifier.fillMaxWidth())
}
