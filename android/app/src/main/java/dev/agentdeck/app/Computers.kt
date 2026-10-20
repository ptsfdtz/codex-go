package dev.agentdeck.app

import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable internal fun ComputerPickerDialog(state:DeckState,onSelect:(String)->Unit,onAdd:()->Unit,onDismiss:()->Unit){
    AlertDialog(onDismissRequest=onDismiss,title={Text("选择电脑")},text={Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
        Text("每次连接一台电脑。切换后显示所选电脑的项目和会话，原电脑待处理的审批可能失效。",fontSize=13.sp)
        ComputerList(state,onSelect)
    }},confirmButton={TextButton(onClick=onAdd,enabled=!state.busy){Text("添加电脑")}},dismissButton={TextButton(onClick=onDismiss){Text("关闭")}})
}

@Composable internal fun ComputerList(state:DeckState,onSelect:(String)->Unit){
    val hosts=state.hosts.ifEmpty{listOfNotNull(state.host)}
    if(hosts.isEmpty())Text("还没有已配对的电脑")
    else LazyColumn(Modifier.fillMaxWidth().heightIn(max=280.dp).selectableGroup(),verticalArrangement=Arrangement.spacedBy(4.dp)){
        items(hosts,key={it.hostId}){host->
            val selected=state.host?.hostId==host.hostId
            Row(Modifier.fillMaxWidth().testTag("computer-${host.hostId}").selectable(selected=selected,enabled=!state.busy,role=Role.RadioButton,onClick={onSelect(host.hostId)}).padding(vertical=8.dp),verticalAlignment=Alignment.CenterVertically){
                RadioButton(selected=selected,onClick=null)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)){
                    Text(host.label,fontWeight=FontWeight.Medium)
                    Text("${host.endpoint} · ${host.hostId.take(8)}",fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    if(selected)Text("当前电脑 · ${state.connection}",fontSize=11.sp,color=MaterialTheme.colorScheme.primary)
                }
            }
        }
    }
}
