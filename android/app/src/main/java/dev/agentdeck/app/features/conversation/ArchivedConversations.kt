package dev.agentdeck.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun SettingsCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    OutlinedCard {
        Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}

@Composable
internal fun ArchivedSettingsCard(count: Int, onOpen: () -> Unit) {
    SettingsCard("会话管理") {
        Text("已归档 $count 个会话，可查看内容或恢复到会话列表。", fontSize = 12.sp)
        OutlinedButton(onClick = onOpen) { Text("查看已归档会话") }
    }
}

internal data class ArchivedConversationItem(val id: String, val title: String, val detail: String = "", val canRestore: Boolean = true)

@Composable
internal fun ArchivedConversationsDialog(
    entries: List<ArchivedConversationItem>,
    busy: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onOpen: (String) -> Unit,
    onRestore: (String) -> Unit,
    mask: String = "",
    scopeKey: String = "api",
) {
    var query by rememberSaveable(scopeKey) { mutableStateOf("") }
    var restoreId by rememberSaveable(scopeKey) { mutableStateOf<String?>(null) }
    var sort by rememberSaveable(scopeKey) { mutableStateOf("recent") }
    var project by rememberSaveable(scopeKey) { mutableStateOf("") }
    var projectsOpen by remember(scopeKey){mutableStateOf(false)}
    val restoring = entries.find { it.id == restoreId }
    val groups=entries.map{it.detail}.filter{it.isNotBlank()}.distinct()
    LaunchedEffect(groups){if(project.isNotEmpty()&&project !in groups)project=""}
    val terms=query.trim().split(Regex("\\s+")).filter{it.isNotBlank()}
    val matches=entries.filter{entry->(project.isEmpty()||entry.detail==project)&&terms.all{maskDisplay(entry.title+" "+entry.detail,mask).contains(it,true)}}
    val filtered=when(sort){"title"->matches.sortedBy{maskDisplay(it.title,mask).lowercase()};"oldest"->matches.asReversed();else->matches}
    androidx.compose.ui.window.Dialog(onDismissRequest=onDismiss,properties=androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth=false)){
        Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).imePadding()){
            Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text("已归档会话",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge);TextButton(onClick=onDismiss){Text("关闭")}}
                ConversationSearch(query,{query=it.take(200)},"搜索已归档会话","已归档")
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)){
                    listOf("recent" to "最近更新","oldest" to "最早更新","title" to "名称").forEach{(id,label)->FilterChip(selected=sort==id,onClick={sort=id},label={Text(label)})}
                    if(groups.isNotEmpty())Box{
                        TextButton(onClick={projectsOpen=true}){Text(if(project.isEmpty())"全部项目" else maskDisplay(project,mask))}
                        DropdownMenu(expanded=projectsOpen,onDismissRequest={projectsOpen=false}){
                            DropdownMenuItem(text={Text("全部项目")},onClick={project="";projectsOpen=false})
                            groups.forEach{name->DropdownMenuItem(text={Text(maskDisplay(name,mask))},onClick={project=name;projectsOpen=false})}
                        }
                    }
                }
                Text("${filtered.size} / ${entries.size} 个已索引归档会话",style=MaterialTheme.typography.labelSmall)
                error?.let{Text(maskDisplay(it,mask),color=MaterialTheme.colorScheme.error,fontSize=12.sp)}
                if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
                if(filtered.isEmpty())Text(if(entries.isEmpty())"暂无已归档会话" else "没有匹配的会话",Modifier.padding(vertical=20.dp))
                LazyColumn(Modifier.fillMaxWidth().weight(1f),verticalArrangement=Arrangement.spacedBy(10.dp)){
                    items(filtered,key={it.id}){entry->
                        OutlinedCard(Modifier.fillMaxWidth()) {Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                            Text(maskDisplay(entry.title,mask),maxLines=3,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.titleSmall)
                            if(entry.detail.isNotEmpty())Text(maskDisplay(entry.detail,mask),fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                            Row{
                                TextButton(onClick={onOpen(entry.id)},enabled=!busy){Text("打开原会话")}
                                TextButton(onClick={restoreId=entry.id},enabled=!busy&&entry.canRestore){Text("恢复")}
                            }
                            if(!entry.canRestore)Text("当前连接或任务状态不允许恢复，可先查看内容。",style=MaterialTheme.typography.labelSmall)
                        }}
                    }
                }
            }
        }
    }
    if (restoring != null) AlertDialog(
        onDismissRequest = { restoreId = null },
        title = { Text("恢复会话？") },
        text = { Text("恢复“${maskDisplay(restoring.title,mask)}”后，可在会话列表继续对话。") },
        confirmButton = { TextButton(onClick = { onRestore(restoring.id); restoreId = null }, enabled = !busy && restoring.canRestore) { Text("确认") } },
        dismissButton = { TextButton(onClick = { restoreId = null }) { Text("取消") } },
    )
}
