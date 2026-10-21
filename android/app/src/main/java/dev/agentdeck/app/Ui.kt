@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package dev.agentdeck.app

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import kotlinx.serialization.json.*
import java.time.Instant

@Composable fun DeckTheme(theme:String="system",content: @Composable () -> Unit){
    val dark=theme=="dark"||theme=="system"&&isSystemInDarkTheme()
    MaterialTheme(colorScheme=if(dark)darkColorScheme(primary=Color(0xFFE6E6E6),onPrimary=Color(0xFF171717),primaryContainer=Color(0xFF333333),onPrimaryContainer=Color(0xFFF5F5F5),background=Color(0xFF181818),surface=Color(0xFF181818),surfaceContainerLow=Color(0xFF212121),surfaceContainer=Color(0xFF252525),surfaceContainerHighest=Color(0xFF303030),secondaryContainer=Color(0xFF303030),onSecondaryContainer=Color(0xFFF0F0F0),outlineVariant=Color(0xFF373737))else lightColorScheme(primary=Color(0xFF202020),onPrimary=Color.White,primaryContainer=Color(0xFFEAEAEA),onPrimaryContainer=Color(0xFF202020),background=Color.White,surface=Color.White,surfaceContainerLow=Color(0xFFF8F8F8),surfaceContainer=Color(0xFFF3F3F3),surfaceContainerHighest=Color(0xFFEEEEEE),secondaryContainer=Color(0xFFEAEAEA),onSecondaryContainer=Color(0xFF202020),outlineVariant=Color(0xFFE8E8E8)),typography=Typography(),content=content)
}
@Composable fun DeckApp(state:DeckState,repo:DeckRepository){
    val api=(LocalContext.current.applicationContext as DeckApplication).apiRepository
    var apiMode by rememberSaveable{mutableStateOf(false)}
    if(apiMode){androidx.activity.compose.BackHandler{apiMode=false};ApiWorkspace(api){apiMode=false};return}
    var panel by rememberSaveable{mutableStateOf("chat")}
    var showPair by rememberSaveable{mutableStateOf(false)}
    var showComputers by rememberSaveable{mutableStateOf(false)}
    var sidebar by rememberSaveable{mutableStateOf(false)}
    var sidebarExpanded by rememberSaveable{mutableStateOf(true)}
    var confirmInterrupt by remember(state.host?.hostId){mutableStateOf(false)}
    var confirmForget by remember(state.host?.hostId){mutableStateOf(false)}
    androidx.compose.runtime.CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurface){BoxWithConstraints(Modifier.fillMaxSize()){
        val wide=maxWidth>=900.dp
        Row(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)){
            if(wide&&sidebarExpanded&&state.host!=null){ChatSidebar(state,repo,panel,onChat={panel="chat"},onSettings={panel="settings"},onPair={showComputers=true},onCollapse={sidebarExpanded=false});VerticalDivider()}
            Column(Modifier.weight(1f).fillMaxHeight().windowInsetsPadding(WindowInsets.safeDrawing).testTag("workspace-content")){
                Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal=16.dp),verticalAlignment=Alignment.CenterVertically){
                    if(state.host!=null&&(!wide||!sidebarExpanded))IconButton(onClick={if(wide)sidebarExpanded=true else sidebar=true}){Icon(Icons.Outlined.Menu,"打开会话列表")}
                    Column(Modifier.weight(1f).clickable(enabled=!state.busy){showComputers=true}.semantics{contentDescription="选择电脑"}){
                        Text(if(panel=="settings")"设置" else if(panel=="review")"工作区改动" else state.snapshot.projects.find{it.projectId==state.selectedProject}?.name?:"AgentDeck",fontSize=16.sp,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis)
                        if(state.host!=null)Row(verticalAlignment=Alignment.CenterVertically){Icon(Icons.Outlined.Computer,null,Modifier.size(13.dp));Spacer(Modifier.width(4.dp));Text("${state.host.label} · ${state.connection}",fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.weight(1f,fill=false));Icon(Icons.Outlined.ExpandMore,null,Modifier.size(13.dp))}
                    }
                    if(panel!="chat")TextButton(onClick={panel="chat"}){Text("返回对话")}
                    else if(state.host!=null){IconButton(onClick={panel="review";repo.refreshGit()},enabled=state.selectedProject!=null){Icon(Icons.Outlined.Difference,"审查")};IconButton(onClick={state.selectedProject?.let(repo::selectProject)},enabled=state.selectedProject!=null){Icon(Icons.Outlined.EditNote,"新对话")}}
                    TextButton(onClick={apiMode=true}){Text("chat")}
                    DisplayMaskAction(state.displayMask,repo::setDisplayMask)
                    if(!wide||state.host==null)IconButton(onClick={panel="settings"},modifier=Modifier.testTag("codex-open-settings")){Icon(Icons.Outlined.Settings,"设置")}
                }
                if(state.stale&&state.host!=null)Surface(color=MaterialTheme.colorScheme.surfaceContainerHighest){Row(Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically){Icon(Icons.Outlined.CloudOff,null,Modifier.size(16.dp));Spacer(Modifier.width(8.dp));Text("连接已断开 · 当前显示缓存，恢复连接后可继续",fontSize=12.sp,modifier=Modifier.weight(1f));TextButton(onClick=repo::reconnect){Text("重连")}}}
                state.error?.let{message->Surface(color=MaterialTheme.colorScheme.errorContainer){Row(Modifier.fillMaxWidth().padding(start=20.dp),verticalAlignment=Alignment.CenterVertically){Text(message,modifier=Modifier.weight(1f),fontSize=12.sp);IconButton(onClick=repo::clearError){Icon(Icons.Outlined.Close,"关闭提示")}}}}
                Box(Modifier.weight(1f)){
                    when {
                        panel=="settings"->DeckSettings(state,repo,onPair={showPair=true},onForget={confirmForget=true},onReconnect=repo::reconnect,onOpenArchived={id->repo.selectSession(id);panel="chat"})
                        state.host==null->Welcome{showPair=true}
                        panel=="review"->Review(state,repo)
                        else->ChatWorkspace(state,repo,onInterrupt={confirmInterrupt=true})
                    }
                }
            }
        }
        if(sidebar&&!wide){val drawer=rememberDrawerState(DrawerValue.Open);LaunchedEffect(drawer.currentValue){if(drawer.currentValue==DrawerValue.Closed)sidebar=false};ModalNavigationDrawer(drawerState=drawer,drawerContent={ModalDrawerSheet(modifier=Modifier.width(260.dp),windowInsets=WindowInsets(0),drawerContainerColor=MaterialTheme.colorScheme.surfaceContainerLow){ChatSidebar(state,repo,panel,onChat={panel="chat";sidebar=false},onSettings={panel="settings";sidebar=false},onPair={showComputers=true;sidebar=false},onCollapse={sidebar=false})}},content={Box(Modifier.fillMaxSize().clickable{sidebar=false})})}
    }
    }
    androidx.activity.compose.BackHandler(enabled=sidebar||panel!="chat"){if(sidebar)sidebar=false else panel="chat"}
    if(showComputers)ComputerPickerDialog(state,onSelect={id->showComputers=false;sidebar=false;panel="chat";repo.selectHost(id)},onAdd={showComputers=false;showPair=true},onDismiss={showComputers=false})
    if(showPair)AlertDialog(onDismissRequest={showPair=false;repo.cancelPair()},confirmButton={},dismissButton={TextButton(onClick={showPair=false;repo.cancelPair()}){Text("关闭")}},title={Text("安全配对 Windows")},text={PairContent(state,repo,onDone={showPair=false})})
    if(confirmInterrupt)Confirm("停止当前任务？","将向 Codex 请求中断，收到确认后更新任务状态。",{confirmInterrupt=false},{confirmInterrupt=false;repo.interrupt()})
    if(confirmForget)Confirm("移除当前电脑？","仅移除此电脑的配对和缓存，其他电脑会保留。在线时撤销该电脑的设备凭据；离线时请随后在该 Windows 电脑撤销设备。",{confirmForget=false},{confirmForget=false;repo.forgetHost()})
}
@Composable private fun Welcome(onPair:()->Unit){Box(Modifier.fillMaxSize().padding(32.dp),contentAlignment=Alignment.Center){Column(Modifier.widthIn(max=460.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(20.dp)){
    Icon(Icons.Outlined.Code,null,Modifier.size(48.dp));Text("在平板上，继续用 Codex。",fontSize=28.sp,fontWeight=FontWeight.SemiBold)
    Text("连接你的 Windows，一起写代码、解决问题、查看改动。",color=MaterialTheme.colorScheme.onSurfaceVariant,lineHeight=24.sp)
    Button(onClick=onPair,contentPadding=PaddingValues(horizontal=24.dp,vertical=14.dp)){Icon(Icons.Outlined.QrCodeScanner,null);Spacer(Modifier.width(10.dp));Text("配对 Windows 主机")}
    Text("在 Windows Bridge 中生成二维码，扫码并确认即可。",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
}}}
@Composable private fun ChatSidebar(state:DeckState,repo:DeckRepository,panel:String,onChat:()->Unit,onSettings:()->Unit,onPair:()->Unit,onCollapse:()->Unit){
    var showNativeProjects by remember(state.host?.hostId){mutableStateOf(false)}
    if(showNativeProjects)NativeProjectsDialog(repo,state.host?.hostId,onClose={showNativeProjects=false},onOpenChat=onChat)

    var search by rememberSaveable{mutableStateOf("")}
    Column(Modifier.width(260.dp).fillMaxHeight().testTag("chat-sidebar").background(MaterialTheme.colorScheme.surfaceContainerLow).windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Vertical+WindowInsetsSides.Start)).padding(12.dp)){
        Row(Modifier.fillMaxWidth().height(48.dp).padding(start=8.dp),verticalAlignment=Alignment.CenterVertically){Icon(Icons.Outlined.Code,null,Modifier.size(22.dp));Spacer(Modifier.width(10.dp));Text("AgentDeck",modifier=Modifier.weight(1f),fontWeight=FontWeight.SemiBold,fontSize=17.sp);IconButton(onClick=onCollapse){Icon(Icons.Outlined.MenuOpen,"收起会话列表")}}
        TextButton(onClick={state.selectedProject?.let(repo::selectProject);onChat()},enabled=state.selectedProject!=null,modifier=Modifier.fillMaxWidth()){Icon(Icons.Outlined.EditNote,null,Modifier.size(18.dp));Spacer(Modifier.width(10.dp));Text("新对话",modifier=Modifier.weight(1f))}
        ConversationSearch(search,{search=it},"搜索会话")
        if(state.capabilities?.supports("nativeProjectReadViews")==true)TextButton(onClick={showNativeProjects=true},enabled=!state.stale){Text("Codex 项目")}
        LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp),contentPadding=PaddingValues(vertical=14.dp)){
            item{Row(Modifier.fillMaxWidth().padding(start=10.dp),verticalAlignment=Alignment.CenterVertically){Text("项目",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.weight(1f));IconButton(onClick=repo::addProject,enabled=!state.stale){Icon(Icons.Outlined.CreateNewFolder,"授权项目",Modifier.size(18.dp))}}}
            if(state.snapshot.projects.isEmpty())item{Text("还没有授权项目，请在 Windows 选择目录。",Modifier.padding(10.dp),fontSize=12.sp)}
            state.snapshot.projects.forEach{project->
                item(key="p:"+project.projectId){Row(Modifier.fillMaxWidth().clickable(enabled=!state.busy){repo.selectProject(project.projectId);onChat()}.padding(10.dp),verticalAlignment=Alignment.CenterVertically){Icon(Icons.Outlined.FolderOpen,null,Modifier.size(17.dp));Spacer(Modifier.width(9.dp));Text(project.name,fontSize=13.sp,fontWeight=if(project.projectId==state.selectedProject)FontWeight.SemiBold else FontWeight.Normal,maxLines=1,overflow=TextOverflow.Ellipsis)}}
                items(state.snapshot.sessions.filter{it.projectId==project.projectId&&it.archived==0}.filter{it.title.contains(search,true)||project.name.contains(search,true)}.sortedWith(compareByDescending<Session>{it.pinned}.thenByDescending{it.updatedAt}),key={it.sessionId}){session->
                    val pending=state.snapshot.approvals.any{it.sessionId==session.sessionId&&it.status=="pending"}
                    Row(Modifier.fillMaxWidth().background(if(state.selectedSession==session.sessionId&&panel=="chat")MaterialTheme.colorScheme.surfaceContainerHighest else Color.Transparent,RoundedCornerShape(8.dp)).clickable(enabled=!state.busy){repo.selectSession(session.sessionId);onChat()}.padding(start=35.dp,end=10.dp,top=11.dp,bottom=11.dp),verticalAlignment=Alignment.CenterVertically){
                        if(session.pinned==1)Icon(Icons.Outlined.PushPin,null,Modifier.size(12.dp))
                        Text(session.title,fontSize=13.sp,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.weight(1f))
                        if(pending)Icon(Icons.Outlined.Security,"等待审批",Modifier.size(14.dp),tint=MaterialTheme.colorScheme.error)
                        else if(session.status in listOf("running","queued"))CircularProgressIndicator(Modifier.size(12.dp),strokeWidth=1.5.dp)
                        SessionActions(session,state,repo)
                    }
                }
            }
        }
        HorizontalDivider()
        TextButton(onClick=onSettings,modifier=Modifier.fillMaxWidth().testTag("codex-open-settings")){Icon(Icons.Outlined.Settings,null,Modifier.size(18.dp));Spacer(Modifier.width(10.dp));Text("设置",Modifier.weight(1f))}
        TextButton(onClick=onPair,enabled=!state.busy,modifier=Modifier.fillMaxWidth()){Icon(Icons.Outlined.Computer,null,Modifier.size(18.dp));Spacer(Modifier.width(10.dp));Text("切换电脑",Modifier.weight(1f),fontSize=12.sp)}
    }
}
@Composable internal fun ApprovalCard(approval:Approval,disabled:Boolean,onDecision:(Approval,String)->Unit){
    var confirm by remember{mutableStateOf(false)}
    var details by rememberSaveable(approval.approvalId){mutableStateOf(false)}
    var expired by remember(approval.expiresAt){mutableStateOf(false)}
    LaunchedEffect(approval.expiresAt){while(true){expired=runCatching{!Instant.parse(approval.expiresAt).isAfter(Instant.now())}.getOrDefault(true);if(expired)break;kotlinx.coroutines.delay(1000)}}
    val enabled=!disabled&&!expired&&approval.status=="pending"
    OutlinedCard{Column(Modifier.fillMaxWidth().padding(18.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){Icon(Icons.Outlined.Security,null,Modifier.size(18.dp));Text("需要你的确认",fontWeight=FontWeight.SemiBold)}
        Text(when{approval.method.contains("commandExecution")->"Codex 请求执行以下命令";approval.method.contains("fileChange")->"Codex 请求修改文件";else->"Codex 请求额外权限"},fontSize=13.sp)
        approval.context.filterKeys{it !in setOf("threadId","turnId","itemId")}.forEach{(key,value)->
            if(value!=JsonNull){Column(verticalArrangement=Arrangement.spacedBy(4.dp)){
                Text(when(key){"command"->"命令";"cwd"->"执行目录";"reason"->"原因";"permissions"->"请求的权限";"grantRoot"->"授权目录";"availableDecisions"->"可用决定";else->key},fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                SelectionContainer{Text((value as? JsonPrimitive)?.contentOrNull?:Json{prettyPrint=true}.encodeToString(JsonElement.serializer(),value),fontSize=12.sp,lineHeight=20.sp,fontFamily=FontFamily.Monospace)}
            }}
        }
        TextButton(onClick={details=!details},contentPadding=PaddingValues(0.dp)){Text(if(details)"收起完整请求" else "查看完整请求",fontSize=11.sp)}
        if(details)SelectionContainer{Text(approval.context.toString(),fontSize=11.sp,fontFamily=FontFamily.Monospace)}
        Text(if(expired)"请求已过期" else if(disabled)"连接恢复后才能处理" else "仅允许这一次，不会自动批准后续请求。",fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){
            OutlinedButton(onClick={onDecision(approval,"reject")},enabled=enabled){Text("拒绝")}
            Button(onClick={confirm=true},enabled=enabled&&"approve" in approval.allowedDecisions){Text("检查并允许一次")}
        }
    }}
    if(confirm)Confirm("允许这一次操作？","请核对命令、文件路径和权限范围。确认后将发送给 Windows 上的 Codex。",{confirm=false},{confirm=false;onDecision(approval,"approve")})
}
@Composable internal fun Review(state:DeckState,repo:DeckRepository){LaunchedEffect(state.host?.hostId,state.selectedProject){if(state.selectedProject!=null&&!state.stale)repo.refreshGit()};BoxWithConstraints(Modifier.fillMaxSize().padding(20.dp)){val wide=maxWidth>=760.dp;var showDiff by rememberSaveable(state.host?.hostId){mutableStateOf(false)};if(wide)Row(horizontalArrangement=Arrangement.spacedBy(16.dp)){GitFiles(state,repo,Modifier.width(280.dp),onFile={repo.selectFile(it)});DiffPane(state.diff,Modifier.weight(1f),state.displayMask)}else Column{if(!showDiff){GitFiles(state,repo,Modifier.fillMaxSize(),onFile={repo.selectFile(it);showDiff=true})}else{TextButton(onClick={showDiff=false}){Text("返回文件列表")};DiffPane(state.diff,Modifier.weight(1f),state.displayMask)}}}}
@Composable private fun GitFiles(state:DeckState,repo:DeckRepository,modifier:Modifier,onFile:(GitFile)->Unit){var filter by rememberSaveable(state.host?.hostId,state.selectedProject){mutableStateOf("")};val files=remember(state.git,filter){filterGitFiles(state.git?.files?:emptyList(),filter)};LazyColumn(modifier.testTag("git-files"),verticalArrangement=Arrangement.spacedBy(8.dp)){item{Text("Git 审查",fontSize=24.sp,fontWeight=FontWeight.SemiBold);Text("工作区当前变化，可能包含外部修改。",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant);Spacer(Modifier.height(12.dp));state.snapshot.projects.forEach{project->FilterChip(selected=state.selectedProject==project.projectId,onClick={repo.selectProject(project.projectId);repo.refreshGit()},label={Text(project.name)})};TextButton(onClick=repo::refreshGit,enabled=!state.stale){Text("刷新真实 Git 状态")};state.git?.baseline?.let{Text("基线 ${it.take(12)}",fontSize=10.sp,fontFamily=FontFamily.Monospace)};OutlinedTextField(value=filter,onValueChange={if(it.length<=200)filter=it},label={Text("筛选文件路径")},singleLine=true,modifier=Modifier.fillMaxWidth());if(state.git?.truncated==true)Text("文件列表已截断",color=MaterialTheme.colorScheme.error)};if(state.git?.available==false)item{Empty("此项目没有可用 Git 仓库","Codex 任务仍可使用。")};if(state.git?.available==true&&state.git.files.isEmpty())item{Text("工作区干净，没有待审查改动。",fontSize=13.sp)};if(state.git?.available==true&&state.git.files.isNotEmpty()&&files.isEmpty())item{Text("没有匹配的文件",fontSize=13.sp)};items(files,key={it.fileId}){file->OutlinedCard(onClick={onFile(file)},modifier=Modifier.fillMaxWidth()){Row(Modifier.padding(12.dp),horizontalArrangement=Arrangement.spacedBy(10.dp)){Text(if(file.untracked)"??" else file.index+file.worktree,fontFamily=FontFamily.Monospace,color=MaterialTheme.colorScheme.primary);Column{Text(file.path,fontSize=12.sp);file.oldPath?.let{Text("原路径 $it",fontSize=10.sp)}}}}}}}
@Composable private fun PairContent(state:DeckState,repo:DeckRepository,onDone:()->Unit){val initialDevice=remember{state.host?.let{it.hostId to it.deviceId}};var scanner by remember{mutableStateOf(false)};var raw by rememberSaveable{mutableStateOf("")};LaunchedEffect(state.host?.deviceId,state.busy){if(state.host!=null&&(state.host.hostId to state.host.deviceId)!=initialDevice&&state.pairingCode==null&&!state.busy)onDone()};Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)){Text("在 Windows 管理窗生成二维码。扫描后，在两台设备核对相同的六位码，并在 Windows 确认。",fontSize=13.sp);if(state.pairingCode!=null){Text(state.pairingCode,fontSize=38.sp,fontFamily=FontFamily.Monospace,fontWeight=FontWeight.SemiBold);Text(state.pairingName?:"");Text("等待 Windows 人工确认…",color=MaterialTheme.colorScheme.primary)}else{if(scanner)QrScanner(Modifier.fillMaxWidth().height(260.dp)){scanner=false;repo.beginPair(it)}else Button(onClick={scanner=true},enabled=!state.busy){Icon(Icons.Outlined.QrCodeScanner,null);Spacer(Modifier.width(8.dp));Text("扫描配对二维码")};Text("或粘贴完整配对 JSON",fontSize=12.sp);OutlinedTextField(value=raw,onValueChange={if(it.length<4096)raw=it},modifier=Modifier.fillMaxWidth(),maxLines=5,enabled=!state.busy);OutlinedButton(onClick={repo.beginPair(raw)},enabled=raw.isNotBlank()&&!state.busy){Text("验证证书并申请配对")}};if(state.busy)LinearProgressIndicator(Modifier.fillMaxWidth());state.error?.let{Text(it,color=MaterialTheme.colorScheme.error,fontSize=12.sp)}}}
@Composable private fun Empty(title:String,description:String){Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){Text(title,fontWeight=FontWeight.Medium);Text(description,fontSize=13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,lineHeight=21.sp)}}
@Composable private fun Confirm(title:String,text:String,onDismiss:()->Unit,onConfirm:()->Unit){AlertDialog(onDismissRequest=onDismiss,title={Text(title)},text={Text(text)},confirmButton={Button(onClick=onConfirm){Text("确认")}},dismissButton={TextButton(onClick=onDismiss){Text("取消")}})}

