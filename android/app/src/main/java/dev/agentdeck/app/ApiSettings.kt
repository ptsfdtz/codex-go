package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun ApiSettings(state: ApiState, repo: ApiRepository, onOpenArchived: () -> Unit) {
    val deck = (LocalContext.current.applicationContext as DeckApplication).repository
    val deckState by deck.state.collectAsState()
    var base by rememberSaveable { mutableStateOf(state.config.baseUrl) }
    var key by remember { mutableStateOf("") }
    var model by rememberSaveable { mutableStateOf(state.config.model) }
    var saving by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(state.busy, saving) {
        if (saving && !state.busy) {
            saving = false
            if (state.error == null) {
                base = state.config.baseUrl
                model = state.config.model
                key = ""
            }
        }
    }
    LazyColumn(Modifier.fillMaxSize().imePadding().testTag("api-settings"), contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item { Text("设置", fontSize = 28.sp, fontWeight = FontWeight.SemiBold) }
        item { ArchivedSettingsCard(state.conversations.count { it.archived }, onOpenArchived) }
        item { SettingsCard("外观") { ThemeOptions(deckState.preferences.theme, deck::setTheme) } }
        item {
            SettingsCard("API 配置") {
                Text("OpenAI 兼容 Chat Completions。密钥与本地对话由 Keystore 加密，不会发送给 Windows。", fontSize = 12.sp)
                OutlinedTextField(value = base, onValueChange = { base = it.take(2048) }, modifier = Modifier.fillMaxWidth().testTag("api-base"), label = { Text("HTTPS 基础地址（包含 /v1）") }, singleLine = true, enabled = !state.busy)
                OutlinedTextField(value = key, onValueChange = { key = it.take(4096) }, modifier = Modifier.fillMaxWidth().testTag("api-key"), label = { Text(if (state.config.key.isEmpty()) "API 密钥" else "新密钥（留空保留）") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), enabled = !state.busy)
                OutlinedTextField(value = model, onValueChange = { model = it.take(160) }, modifier = Modifier.fillMaxWidth().testTag("api-model"), label = { Text("模型 ID（可留空）") }, singleLine = true, enabled = !state.busy)
                Text("保存时自动获取并添加对端模型；模型 ID 留空时自动选择第一个。获取失败可手动填写模型 ID。", fontSize = 12.sp)
                Text("请求与密钥将发送到上述地址。更换主机需重新输入密钥。思考强度依服务商和模型支持。", fontSize = 12.sp)
                state.modelNotice?.let { Text(it, fontSize = 12.sp) }
                Button(onClick = { saving = true; repo.configure(base, key, model, state.config.effort) }, enabled = !state.busy && state.storageReady) {
                    Text(if (saving) "正在获取模型…" else "保存并获取模型")
                }
            }
        }
        item { Text("AgentDeck ${BuildConfig.VERSION_NAME} · 凭据由 Keystore 保护。", fontSize = 12.sp) }
    }
}
