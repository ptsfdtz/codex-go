package dev.agentdeck.app

import androidx.compose.foundation.clickable
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
) {
    var query by rememberSaveable { mutableStateOf("") }
    var restoreId by rememberSaveable { mutableStateOf<String?>(null) }
    val restoring = entries.find { it.id == restoreId }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("已归档会话") },
        text = {
            Column {
                ConversationSearch(query, { query = it }, "搜索已归档会话", "已归档")
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 12.sp) }
                val filtered = entries.filter { it.title.contains(query, true) || it.detail.contains(query, true) }
                if (filtered.isEmpty()) Text(if (entries.isEmpty()) "暂无已归档会话" else "没有匹配的会话", Modifier.padding(vertical = 20.dp))
                LazyColumn(Modifier.fillMaxWidth().heightIn(max = 400.dp)) {
                    items(filtered, key = { it.id }) { entry ->
                        Row(Modifier.fillMaxWidth().clickable(enabled = !busy) { onOpen(entry.id) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(entry.title, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                if (entry.detail.isNotEmpty()) Text(entry.detail, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            TextButton(onClick = { restoreId = entry.id }, enabled = !busy && entry.canRestore) { Text("恢复") }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("关闭") } },
    )
    if (restoring != null) AlertDialog(
        onDismissRequest = { restoreId = null },
        title = { Text("恢复会话？") },
        text = { Text("恢复“${restoring.title}”后，可在会话列表继续对话。") },
        confirmButton = { TextButton(onClick = { onRestore(restoring.id); restoreId = null }, enabled = !busy && restoring.canRestore) { Text("确认") } },
        dismissButton = { TextButton(onClick = { restoreId = null }) { Text("取消") } },
    )
}
