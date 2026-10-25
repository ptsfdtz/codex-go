package dev.agentdeck.app

import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable internal fun ComputerPickerDialog(state:DeckState,onSelect:(String)->Unit,onAdd:()->Unit,onDismiss:()->Unit,onRename:(String,String)->Unit){
    AlertDialog(onDismissRequest=onDismiss,title={Text("选择电脑")},text={Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
        Text("账户下的电脑保持独立连接。切换后显示所选电脑的项目和会话，其他电脑继续同步任务与审批。",fontSize=13.sp)
        ComputerList(state,onSelect,onRename)
    }},confirmButton={TextButton(onClick=onAdd,enabled=!state.busy){Text("账户与电脑")}},dismissButton={TextButton(onClick=onDismiss){Text("关闭")}})
}

@Composable internal fun ComputerList(state:DeckState,onSelect:(String)->Unit,onRename:(String,String)->Unit){
    var editing by remember{mutableStateOf<Host?>(null)}
    var alias by remember{mutableStateOf("")}
    editing?.let{host->AlertDialog(onDismissRequest={editing=null},title={Text("电脑别名")},text={OutlinedTextField(value=alias,onValueChange={alias=it.take(80)},label={Text("例如：办公室、家里的电脑")},singleLine=true)},confirmButton={TextButton(onClick={onRename(host.hostId,alias.trim());editing=null},enabled=alias.isNotBlank()&&!state.busy){Text("保存")}},dismissButton={TextButton(onClick={editing=null}){Text("取消")}})}
    val hosts=state.hosts.ifEmpty{listOfNotNull(state.host)}
    if(hosts.isEmpty())Text("还没有电脑，请在桌面端登录同一账户。")
    else LazyColumn(Modifier.fillMaxWidth().heightIn(max=280.dp).selectableGroup(),verticalArrangement=Arrangement.spacedBy(4.dp)){
        items(hosts,key={it.hostId}){host->
            val selected=state.host?.hostId==host.hostId
            Row(Modifier.fillMaxWidth().testTag("computer-${host.hostId}").selectable(selected=selected,enabled=!state.busy,role=Role.RadioButton,onClick={onSelect(host.hostId)}).padding(vertical=8.dp),verticalAlignment=Alignment.CenterVertically){
                RadioButton(selected=selected,onClick=null)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)){
                    Text(host.label,fontWeight=FontWeight.Medium)
                    if(selected)Text("当前电脑",fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    state.computerConnections[host.hostId]?.let{status->Text(status.error?:listOf(status.connection,status.route).filter{it.isNotBlank()}.joinToString(" · "),fontSize=11.sp,color=if(status.error==null)MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error)}
                }
                IconButton(onClick={alias=host.name;editing=host},enabled=!state.busy){Icon(Icons.Outlined.Edit,"编辑 ${host.label} 的别名")}
            }
        }
    }
}
