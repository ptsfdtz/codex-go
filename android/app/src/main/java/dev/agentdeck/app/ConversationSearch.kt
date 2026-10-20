package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp

@Composable
internal fun ConversationSearch(
    query: String,
    onQueryChange: (String) -> Unit,
    label: String,
    title: String = "会话",
) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    val focusRequester = remember { FocusRequester() }
    Column {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.weight(1f))
            IconButton(onClick = {
                if (expanded) onQueryChange("")
                expanded = !expanded
            }) {
                Icon(
                    if (expanded) Icons.Outlined.Close else Icons.Outlined.Search,
                    if (expanded) "收起搜索" else label,
                    Modifier.size(18.dp),
                )
            }
        }
        if (expanded) {
            OutlinedTextField(
                value = query,
                onValueChange = { onQueryChange(it.take(160)) },
                placeholder = { Text(label) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().focusRequester(focusRequester),
            )
            LaunchedEffect(Unit) { focusRequester.requestFocus() }
        }
    }
}
