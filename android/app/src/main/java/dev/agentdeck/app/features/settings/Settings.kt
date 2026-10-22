package dev.agentdeck.app

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.ui.Alignment
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

internal val deckSettingsSections=listOf("general" to "通用","account" to "账户与用量","execution" to "执行配置","skills" to "技能","conversations" to "会话","shortcuts" to "键盘快捷键","computers" to "电脑与连接","data" to "数据与诊断")

@Composable fun DeckSettings(state:DeckState,repo:DeckRepository,onPair:()->Unit,onForget:()->Unit,onReconnect:()->Unit,onOpenArchived:(String)->Unit,requestedSection:String?=null,onSectionConsumed:()->Unit={}){
    var section by rememberSaveable{mutableStateOf("general")}
    var query by rememberSaveable{mutableStateOf("")}
    var navExpanded by rememberSaveable{mutableStateOf(true)}
    var targetIndex by remember{mutableStateOf<Int?>(null)}
    val settingsList=rememberLazyListState()
    var showArchivedFromSearch by remember{mutableStateOf(false)}
    fun navigateSetting(destination:SettingsDestination){query="";section=destination.section;targetIndex=destination.index;if(destination.id=="archived")showArchivedFromSearch=true}
    var showArchived by rememberSaveable(state.host?.hostId){mutableStateOf(false)}
    LaunchedEffect(showArchivedFromSearch){if(showArchivedFromSearch){showArchived=true;showArchivedFromSearch=false}}
    LaunchedEffect(section,targetIndex,query){if(query.isBlank()&&targetIndex!=null){withFrameNanos{};settingsList.scrollToItem(targetIndex!!);targetIndex=null}}
    LaunchedEffect(requestedSection){
        if(requestedSection!=null){
            settingsDestinations.find{requestedSection=="item:"+it.id}?.let{navigateSetting(it);onSectionConsumed();return@LaunchedEffect}
            val target=if(requestedSection=="archived")"conversations" else requestedSection
            if(deckSettingsSections.any{it.first==target}){query="";section=target;showArchived=requestedSection=="archived"}
            onSectionConsumed()
        }
    }
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
    val sections=deckSettingsSections
    val destinations=matchingSettings(query)
    val visibleSections=sections.filter{(id,_)->query.isBlank()||destinations.any{it.section==id}}
    BoxWithConstraints(Modifier.fillMaxSize()){
    val wide=maxWidth>=720.dp
    Row(Modifier.fillMaxSize()){
    if(wide&&navExpanded){
        Column(Modifier.width(200.dp).fillMaxHeight().padding(16.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
            Text("设置",modifier=Modifier.padding(horizontal=12.dp,vertical=16.dp),style=MaterialTheme.typography.titleLarge)
            visibleSections.forEach{(id,label)->NavigationDrawerItem(label={Text(label)},selected=section==id,onClick={section=id;query="";targetIndex=0},modifier=Modifier.fillMaxWidth())}
        }
        VerticalDivider()
    }
    Column(Modifier.weight(1f).fillMaxHeight()){
    Row(Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically){
        if(wide)IconButton(onClick={navExpanded=!navExpanded}){Icon(if(navExpanded)Icons.Outlined.MenuOpen else Icons.Outlined.Menu,if(navExpanded)"收起设置导航" else "展开设置导航")}
        OutlinedTextField(value=query,onValueChange={query=it.take(160)},label={Text("搜索设置")},singleLine=true,leadingIcon={Icon(Icons.Outlined.Search,null)},trailingIcon={if(query.isNotEmpty())IconButton(onClick={query=""}){Icon(Icons.Outlined.Close,"清除设置搜索")}},modifier=Modifier.weight(1f))
    }
    if(!wide)Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal=24.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)){
        visibleSections.forEach{(id,label)->FilterChip(selected=section==id,onClick={section=id;query="";targetIndex=0},label={Text(label)})}
    }
    if(query.isNotBlank()&&destinations.isNotEmpty())LazyColumn(Modifier.weight(1f),contentPadding=PaddingValues(24.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
        item{Text("${destinations.size} 个设置入口",style=MaterialTheme.typography.labelSmall)}
        items(destinations,key={it.id}){destination->OutlinedCard(onClick={navigateSetting(destination)},modifier=Modifier.fillMaxWidth()){
            Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
                Text(destination.title,style=MaterialTheme.typography.titleMedium)
                Text(destination.detail,style=MaterialTheme.typography.bodySmall)
                Text(sections.find{it.first==destination.section}?.second.orEmpty(),style=MaterialTheme.typography.labelSmall)
            }
        }}
    }else if(visibleSections.isEmpty())Column(Modifier.fillMaxWidth().padding(24.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
        Text("没有匹配的设置项")
        TextButton(onClick={query=""}){Text("清除筛选，查看全部设置")}
    }else key(section){LazyColumn(Modifier.weight(1f),state=settingsList,contentPadding=PaddingValues(24.dp),verticalArrangement=Arrangement.spacedBy(18.dp)){
        item{Text(sections.firstOrNull{it.first==section}?.second?:"设置",fontSize=28.sp,fontWeight=FontWeight.SemiBold)}
        if(section=="shortcuts")item{OutlinedCard{Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)){
            Text("连接实体键盘后可用。快捷键在对应输入框或会话获得焦点时生效。",style=MaterialTheme.typography.bodySmall)
            listOf(
                Triple("Alt + ← / →","会话与项目后退/前进","当前电脑的应用内导航记录；跳过已删除或未授权目标"),
                Triple("Ctrl + K","搜索操作与会话","主工作区；可触屏点击顶部搜索按钮"),
                Triple("↑ / ↓ · Enter · Ctrl+Home/End","操作菜单导航","菜单打开时跳过不可用项，Ctrl+Home/End 选择首末可用项；Escape 关闭"),
                Triple("Ctrl + Enter","发送输入框内容","输入框；仍遵循当前发送、追加或队列模式及可用状态"),
                Triple("/","输入框命令","输入框仅有 /命令 前缀时显示已接通操作"),
                Triple("↑ / ↓ · Enter / Tab","选择输入框命令","命令建议打开时；Esc 保留文字并关闭"),
                Triple("Ctrl + F","查找已加载消息","已打开的会话"),
                Triple("Enter","下一个匹配","会话查找输入框"),
                Triple("Shift + Enter","上一个匹配","会话查找输入框"),
                Triple("Escape","关闭会话查找","查找已打开时")
            ).forEach{(keys,action,availability)->
                Column(verticalArrangement=Arrangement.spacedBy(4.dp)){
                    Text(action,fontWeight=FontWeight.SemiBold)
                    Text(keys,fontFamily=FontFamily.Monospace,color=MaterialTheme.colorScheme.primary)
                    Text(availability,style=MaterialTheme.typography.bodySmall)
                }
            }
        }}}
        if(section=="execution")item{ExecutionConfigSettings(state,repo)}
        if(section=="skills")item{SkillSettings(state,repo)}
        if(section=="account")item{AccountSettings(state,repo)}
        if(section=="conversations")item{ArchivedSettingsCard(state.snapshot.sessions.count{it.archived==1}){showArchived=true}}
        if(section=="general")item{OutlinedCard{Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
            Text("外观",fontWeight=FontWeight.SemiBold)
            ThemeOptions(state.preferences.theme,repo::setTheme)
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Column(Modifier.weight(1f)){Text("任务与审批通知");Text("默认关闭。仅提示新事件，不显示提示词或命令内容。",fontSize=12.sp)};Switch(modifier=Modifier.semantics{contentDescription="任务与审批通知"},checked=state.preferences.notifications,onCheckedChange={enabled->if(enabled&&Build.VERSION.SDK_INT>=33)notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)else repo.setNotifications(enabled)})}
            Text("通知依赖应用连接。系统休眠或结束进程后不保证后台推送；重新打开会同步真实状态。",fontSize=12.sp)
        }}}
        if(section=="computers")item{OutlinedCard{Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
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
        if(section=="data")item{OutlinedCard{Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
            Text("Bridge 日志保留",fontWeight=FontWeight.SemiBold)
            Text(if(state.stale)"连接主机后读取和修改策略。" else "策略保存在 Windows，并由定时清理生效。不会删除 Codex 上游历史。",fontSize=12.sp)
            Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){OutlinedTextField(value=days,onValueChange={if(it.length<=3&&it.all(Char::isDigit))days=it},label={Text("天数 1–365")},singleLine=true,modifier=Modifier.weight(1f));OutlinedTextField(value=size,onValueChange={if(it.length<=4&&it.all(Char::isDigit))size=it},label={Text("MiB 16–1024")},singleLine=true,modifier=Modifier.weight(1f))}
            Button(onClick={confirmRetention=true},enabled=valid&&!state.stale&&!state.busy){Text("保存保留策略")}
        }}}
        if(section=="data")item{OutlinedCard{Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
            Text("诊断导出",fontWeight=FontWeight.SemiBold);Text("只包含版本、连接、计数和保留策略；不包含凭据、提示词、文件内容或审批上下文。",fontSize=12.sp)
            OutlinedButton(onClick=repo::fetchDiagnostics,enabled=!state.stale&&!state.busy){Text("读取真实诊断")}
            if(diagnosticText!=null){SelectionContainer{Text(diagnosticText,fontFamily=FontFamily.Monospace,fontSize=11.sp)};Button(onClick={export.launch("AgentDeck-diagnostics.json")}){Text("导出诊断 JSON")}}
        }}}
        item{Text("AgentDeck ${BuildConfig.VERSION_NAME} · 凭据由 Keystore 保护。Codex 登录信息保留在 Windows。",fontSize=12.sp)}
    }}}
    }
    }
    if(showArchived)ArchivedConversationsDialog(
        entries=state.snapshot.sessions.filter{it.archived==1}.sortedByDescending{it.updatedAt}.map{session->ArchivedConversationItem(session.sessionId,session.title,state.snapshot.projects.find{it.projectId==session.projectId}?.name.orEmpty(),!state.stale&&session.status !in listOf("queued","running","waitingApproval","unknown"))},
        busy=state.busy,error=state.error,onDismiss={showArchived=false},mask=state.displayMask,scopeKey=state.host?.hostId.orEmpty(),
        onOpen={id->
            val expected=state.snapshot.sessions.find{it.sessionId==id}
            val now=repo.state.value
            if(expected!=null&&now.host?.hostId==state.host?.hostId&&now.snapshot.sessions.any{it.sessionId==id&&it.upstreamThreadId==expected.upstreamThreadId}&&now.snapshot.projects.any{it.projectId==expected.projectId&&it.enabled}){showArchived=false;onOpenArchived(id)}
            else repo.showMessage("电脑、会话或授权已变化，请重新选择。")
        },
        onRestore={id->
            val expected=state.snapshot.sessions.find{it.sessionId==id}
            val now=repo.state.value
            val current=now.snapshot.sessions.find{it.sessionId==id}
            if(expected!=null&&current!=null&&now.host?.hostId==state.host?.hostId&&current.upstreamThreadId==expected.upstreamThreadId&&current.archived==1&&canManageSession(now,current)&&now.snapshot.projects.any{it.projectId==current.projectId&&it.enabled})repo.manageSession(current,"restore")
            else repo.showMessage("电脑、会话或任务状态已变化，请刷新后再恢复。")
        },
    )
    if(confirmRetention)AlertDialog(onDismissRequest={confirmRetention=false},title={Text("保存日志保留策略？")},text={Text("保留 $days 天，目标上限 $size MiB。后续清理可能永久移除超期或超量的 Bridge 事件，平板将显示历史缺口。")},confirmButton={Button(onClick={confirmRetention=false;repo.updateRetention(Retention(days.toInt(),size.toInt()))}){Text("确认保存")}},dismissButton={TextButton(onClick={confirmRetention=false}){Text("取消")}})
}

@Composable internal fun ThemeOptions(theme:String,onTheme:(String)->Unit){
    Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf("system" to "跟随系统","light" to "浅色","dark" to "深色").forEach{(value,label)->FilterChip(selected=theme==value,onClick={onTheme(value)},label={Text(label)})}}
}
