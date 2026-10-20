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

@Composable fun SessionActions(session:Session,state:DeckState,repo:DeckRepository){
    var menu by remember{mutableStateOf(false)}
    var operation by remember{mutableStateOf("")}
    var title by rememberSaveable(session.sessionId){mutableStateOf(session.title)}
    val enabled=!state.stale&&!state.busy&&session.status !in listOf("queued","running","waitingApproval","unknown")
    Box{
        IconButton(onClick={menu=true}){Icon(Icons.Outlined.MoreHoriz,"管理会话 ${session.title}",Modifier.size(18.dp))}
        DropdownMenu(expanded=menu,onDismissRequest={menu=false}){
            listOf("rename" to "重命名","pin" to if(session.pinned==1)"取消置顶" else "置顶","archive" to if(session.archived==1)"恢复会话" else "归档","delete" to "删除").forEach{(key,label)->
                DropdownMenuItem(text={Text(label)},enabled=enabled,onClick={menu=false;if(key=="rename")title=session.title;if(key=="pin")repo.manageSession(session,"pin")else operation=if(key=="archive"&&session.archived==1)"restore" else key})
            }
        }
    }
    if(operation.isNotEmpty())AlertDialog(onDismissRequest={operation=""},title={Text(when(operation){"rename"->"重命名会话";"archive"->"归档会话？";"restore"->"恢复会话？";else->"永久删除会话？"})},text={
        if(operation=="rename")OutlinedTextField(value=title,onValueChange={if(it.length<=160)title=it},label={Text("会话名称")},singleLine=true)
        else Text(if(operation=="delete")"将请求 Codex 永久删除此线程及其派生子线程，并删除 AgentDeck 中的本地消息记录。不可撤回，不会删除项目文件。" else if(operation=="archive")"会话会移入归档，可以稍后恢复。" else "恢复后可继续对话。")
    },confirmButton={TextButton(enabled=enabled&&(operation!="rename"||title.isNotBlank()),onClick={repo.manageSession(session,operation,title);operation=""}){Text(if(operation=="delete")"永久删除" else "确认")}},dismissButton={TextButton(onClick={operation=""}){Text("取消")}})
}

fun effortLabel(value:String)=when(value){"none"->"无";"minimal"->"最少";"low"->"低";"medium"->"中";"high"->"高";"xhigh"->"超高";else->value}

@Composable fun CodexModelPicker(state:DeckState,repo:DeckRepository,enabled:Boolean){
    var modelsOpen by remember{mutableStateOf(false)}
    var effortOpen by remember{mutableStateOf(false)}
    val selected=state.models.find{it.model==state.selectedModel}
    Row(Modifier.horizontalScroll(rememberScrollState())){
        Box{TextButton(onClick={modelsOpen=true},enabled=enabled){Text(selected?.displayName?:state.selectedModel.ifEmpty{"默认模型"});Icon(Icons.Outlined.ExpandMore,null,Modifier.size(16.dp))}
            DropdownMenu(expanded=modelsOpen,onDismissRequest={modelsOpen=false}){
                state.models.forEach{model->DropdownMenuItem(text={Text(model.displayName)},onClick={modelsOpen=false;repo.selectModel(model)})}
                DropdownMenuItem(text={Text("刷新可用模型")},onClick={modelsOpen=false;repo.refreshModels()},enabled=!state.stale)
            }}
        if(selected!=null&&selected.supportedReasoningEfforts.isNotEmpty())Box{TextButton(onClick={effortOpen=true},enabled=enabled){Text("思考 · "+effortLabel(state.selectedEffort));Icon(Icons.Outlined.ExpandMore,null,Modifier.size(16.dp))}
            DropdownMenu(expanded=effortOpen,onDismissRequest={effortOpen=false}){selected.supportedReasoningEfforts.forEach{option->DropdownMenuItem(text={Text(effortLabel(option.reasoningEffort))},onClick={effortOpen=false;repo.selectEffort(option.reasoningEffort)})}}}
    }
}
