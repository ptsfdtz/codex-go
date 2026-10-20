package dev.agentdeck.app

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*

private val diagnosticJson=Json{prettyPrint=true}

@Composable fun DeckSettings(state:DeckState,repo:DeckRepository,onPair:()->Unit,onForget:()->Unit,onReconnect:()->Unit,onOpenArchived:(String)->Unit){
    var showArchived by rememberSaveable(state.host?.hostId){mutableStateOf(false)}
    var renameComputer by remember(state.host?.hostId){mutableStateOf(false)}
    var computerName by rememberSaveable(state.host?.hostId,state.host?.name){mutableStateOf(state.host?.name.orEmpty())}
    val context=LocalContext.current
    val scope=rememberCoroutineScope()
    var days by rememberSaveable(state.retention.days){mutableStateOf(state.retention.days.toString())}
    var size by rememberSaveable(state.retention.maxMiB){mutableStateOf(state.retention.maxMiB.toString())}
    var confirmRetention by remember(state.host?.hostId){mutableStateOf(false)}
    val valid=days.toIntOrNull() in 1..365 && size.toIntOrNull() in 16..1024
    val notificationPermission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){granted->repo.setNotifications(granted);if(!granted)repo.showMessage("通知权限未授予，前台任务与审批仍可使用")}
    val diagnosticText=remember(state.diagnostics,state.connection,state.snapshot.cursor){state.diagnostics?.let{bridge->diagnosticJson.encodeToString(JsonObject.serializer(),buildJsonObject{put("androidVersion",Build.VERSION.RELEASE);put("appVersion",BuildConfig.VERSION_NAME);put("connection",state.connection);put("cacheCursor",state.snapshot.cursor);put("bridge",bridge)})}}
    val export=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")){uri->if(uri!=null&&diagnosticText!=null)scope.launch{try{withContext(Dispatchers.IO){checkNotNull(context.contentResolver.openOutputStream(uri)).use{it.write(diagnosticText.toByteArray(Charsets.UTF_8))}};repo.showMessage("诊断已导出")}catch(_:Exception){repo.showMessage("无法导出诊断，请重新选择保存位置")}}}
    if(renameComputer)AlertDialog(onDismissRequest={renameComputer=false},title={Text("重命名电脑")},text={OutlinedTextField(value=computerName,onValueChange={computerName=it.take(80)},label={Text("电脑名称")},singleLine=true)},confirmButton={TextButton(onClick={state.host?.let{repo.renameHost(it.hostId,computerName)};renameComputer=false},enabled=computerName.isNotBlank()&&!state.busy){Text("保存")}},dismissButton={TextButton(onClick={renameComputer=false}){Text("取消")}})
    LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(24.dp),verticalArrangement=Arrangement.spacedBy(18.dp)){
        item{Text("设置与诊断",fontSize=28.sp,fontWeight=FontWeight.SemiBold)}
        item{ArchivedSettingsCard(state.snapshot.sessions.count{it.archived==1}){showArchived=true}}
        item{OutlinedCard{Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
            Text("外观",fontWeight=FontWeight.SemiBold)
            ThemeOptions(state.preferences.theme,repo::setTheme)
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Column(Modifier.weight(1f)){Text("任务与审批通知");Text("默认关闭。仅提示新事件，不显示提示词或命令内容。",fontSize=12.sp)};Switch(modifier=Modifier.semantics{contentDescription="任务与审批通知"},checked=state.preferences.notifications,onCheckedChange={enabled->if(enabled&&Build.VERSION.SDK_INT>=33)notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)else repo.setNotifications(enabled)})}
            Text("通知依赖应用连接。系统休眠或结束进程后不保证后台推送；重新打开会同步真实状态。",fontSize=12.sp)
        }}}
        item{OutlinedCard{Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
            Text("我的电脑",fontWeight=FontWeight.SemiBold)
            ComputerList(state,repo::selectHost)
            TextButton(onClick=onPair,enabled=!state.busy){Text("添加电脑")}
            Text("当前电脑",fontWeight=FontWeight.SemiBold);Text(state.host?.endpoint?:"未配对")
            TextButton(onClick={renameComputer=true},enabled=state.host!=null&&!state.busy){Text("重命名当前电脑")}
            Text("证书 SHA-256",fontSize=12.sp);SelectionContainer{Text(state.host?.fingerprint?:"尚无固定证书",fontFamily=FontFamily.Monospace,fontSize=12.sp)}
            Text("设备 ${state.host?.deviceId?:"未配对"}",fontSize=11.sp)
            Text("Codex CLI ${state.snapshot.host?.codexVersion?:"未知"} · 协议 v1",fontSize=12.sp)
            Text("最后同步 ${state.lastSynced?:"尚无"}",fontSize=12.sp)
            OutlinedButton(onClick=onReconnect,enabled=state.host!=null&&!state.busy){Text("重新连接")};TextButton(onClick=onPair,enabled=!state.busy){Text("重新配对当前电脑")}
            TextButton(onClick=onForget,enabled=state.host!=null&&!state.busy,colors=ButtonDefaults.textButtonColors(contentColor=MaterialTheme.colorScheme.error)){Text("移除当前电脑及其缓存")}
        }}}
        item{OutlinedCard{Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
            Text("Bridge 日志保留",fontWeight=FontWeight.SemiBold)
            Text(if(state.stale)"连接主机后读取和修改策略。" else "策略保存在 Windows，并由定时清理生效。不会删除 Codex 上游历史。",fontSize=12.sp)
            Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){OutlinedTextField(value=days,onValueChange={if(it.length<=3&&it.all(Char::isDigit))days=it},label={Text("天数 1–365")},singleLine=true,modifier=Modifier.weight(1f));OutlinedTextField(value=size,onValueChange={if(it.length<=4&&it.all(Char::isDigit))size=it},label={Text("MiB 16–1024")},singleLine=true,modifier=Modifier.weight(1f))}
            Button(onClick={confirmRetention=true},enabled=valid&&!state.stale&&!state.busy){Text("保存保留策略")}
        }}}
        item{OutlinedCard{Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
            Text("诊断导出",fontWeight=FontWeight.SemiBold);Text("只包含版本、连接、计数和保留策略；不包含凭据、提示词、文件内容或审批上下文。",fontSize=12.sp)
            OutlinedButton(onClick=repo::fetchDiagnostics,enabled=!state.stale&&!state.busy){Text("读取真实诊断")}
            if(diagnosticText!=null){SelectionContainer{Text(diagnosticText,fontFamily=FontFamily.Monospace,fontSize=11.sp)};Button(onClick={export.launch("AgentDeck-diagnostics.json")}){Text("导出诊断 JSON")}}
        }}}
        item{Text("AgentDeck ${BuildConfig.VERSION_NAME} · 凭据由 Keystore 保护。Codex 登录信息保留在 Windows。",fontSize=12.sp)}
    }
    if(showArchived)ArchivedConversationsDialog(
        entries=state.snapshot.sessions.filter{it.archived==1}.sortedByDescending{it.updatedAt}.map{session->ArchivedConversationItem(session.sessionId,session.title,state.snapshot.projects.find{it.projectId==session.projectId}?.name.orEmpty(),!state.stale&&session.status !in listOf("queued","running","waitingApproval","unknown"))},
        busy=state.busy,error=state.error,onDismiss={showArchived=false},
        onOpen={showArchived=false;onOpenArchived(it)},
        onRestore={id->state.snapshot.sessions.find{it.sessionId==id}?.let{repo.manageSession(it,"restore")}},
    )
    if(confirmRetention)AlertDialog(onDismissRequest={confirmRetention=false},title={Text("保存日志保留策略？")},text={Text("保留 $days 天，目标上限 $size MiB。后续清理可能永久移除超期或超量的 Bridge 事件，平板将显示历史缺口。")},confirmButton={Button(onClick={confirmRetention=false;repo.updateRetention(Retention(days.toInt(),size.toInt()))}){Text("确认保存")}},dismissButton={TextButton(onClick={confirmRetention=false}){Text("取消")}})
}

@Composable internal fun ThemeOptions(theme:String,onTheme:(String)->Unit){
    Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf("system" to "跟随系统","light" to "浅色","dark" to "深色").forEach{(value,label)->FilterChip(selected=theme==value,onClick={onTheme(value)},label={Text(label)})}}
}
