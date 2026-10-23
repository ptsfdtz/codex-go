@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package dev.agentdeck.app

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import kotlinx.serialization.json.*
import java.time.Instant

@Composable fun DeckApp(state:DeckState,repo:DeckRepository){
    var panel by rememberSaveable{mutableStateOf("chat")}
    var conversationAction by remember(state.host?.hostId,state.selectedSession){mutableStateOf<String?>(null)}
    var showPair by rememberSaveable{mutableStateOf(false)}
    var showComputers by rememberSaveable{mutableStateOf(false)}
    var sidebar by rememberSaveable{mutableStateOf(false)}
    var sidebarExpanded by rememberSaveable{mutableStateOf(true)}
    var showCommands by remember(state.host?.hostId){mutableStateOf(false)}
    var showDrafts by remember(state.host?.hostId){mutableStateOf(false)}
    var settingsTarget by remember(state.host?.hostId){mutableStateOf<String?>(null)}
    var sessionCommand by remember(state.host?.hostId){mutableStateOf<Pair<String,String>?>(null)}
    val workspaceState=rememberSaveableStateHolder()
    var notificationSeen by rememberSaveable{mutableStateOf("")}
    LaunchedEffect(state.notificationNavigation){if(state.notificationNavigation.isNotEmpty()&&state.notificationNavigation!=notificationSeen){notificationSeen=state.notificationNavigation;panel="chat";sidebar=false;showPair=false;showComputers=false}}
    val canBack=!state.busy&&state.host?.hostId?.let{repo.workspaceNavigation.destination(it,-1,state.snapshot)}!=null
    val canForward=!state.busy&&state.host?.hostId?.let{repo.workspaceNavigation.destination(it,1,state.snapshot)}!=null
    fun navigate(direction:Int){if(repo.navigateWorkspace(direction)){panel="chat";sidebar=false}}
    var confirmInterrupt by remember(state.host?.hostId){mutableStateOf(false)}
    var confirmForget by remember(state.host?.hostId){mutableStateOf(false)}
    androidx.compose.runtime.CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurface){BoxWithConstraints(Modifier.fillMaxSize().onPreviewKeyEvent{event->if(event.type!=KeyEventType.KeyDown)false else when{
        event.isCtrlPressed&&event.key==Key.K->{showCommands=!showCommands;true}
        event.isAltPressed&&event.key==Key.DirectionLeft&&canBack->{navigate(-1);true}
        event.isAltPressed&&event.key==Key.DirectionRight&&canForward->{navigate(1);true}
        else->false
    }}){
        val wide=maxWidth>=840.dp
        Row(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)){
            if(wide&&sidebarExpanded&&state.host!=null){ChatGptSidebar(state,repo,panel,onChat={panel="chat"},onSettings={panel="settings"},onPair={showComputers=true},onCollapse={sidebarExpanded=false});VerticalDivider()}
            Column(Modifier.weight(1f).fillMaxHeight().windowInsetsPadding(WindowInsets.safeDrawing).testTag("workspace-content")){
                ConversationTopBar(state,repo,panel,showNavigation=state.host!=null&&(!wide||!sidebarExpanded),
                    onNavigation={if(wide)sidebarExpanded=true else sidebar=true},onChat={panel="chat"},
                    onNew={state.selectedProject?.let(repo::selectProject);panel="chat"},onComputers={showComputers=true},
                    onSettings={panel="settings"},onSearch={showCommands=true},onDrafts={showDrafts=true},
                    onReview={panel="review";repo.refreshGit()},onConversationAction={conversationAction=it})
                if(state.stale&&state.host!=null)Surface(color=MaterialTheme.colorScheme.surfaceContainerLow){Row(Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=6.dp),verticalAlignment=Alignment.CenterVertically){Icon(Icons.Outlined.CloudOff,null,Modifier.size(15.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant);Spacer(Modifier.width(8.dp));Text("连接已断开，显示缓存内容",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.weight(1f));TextButton(onClick=repo::reconnect,contentPadding=PaddingValues(horizontal=8.dp)){Text("重连",fontSize=12.sp)}}}
                state.error?.let{message->Surface(color=MaterialTheme.colorScheme.errorContainer){Row(Modifier.fillMaxWidth().padding(start=16.dp),verticalAlignment=Alignment.CenterVertically){Text(message,modifier=Modifier.weight(1f),fontSize=12.sp,color=MaterialTheme.colorScheme.onErrorContainer);IconButton(onClick=repo::clearError,modifier=Modifier.size(40.dp)){Icon(Icons.Outlined.Close,"关闭提示",Modifier.size(18.dp))}}}}
                Box(Modifier.weight(1f)){
                    when {
                        panel=="settings"->workspaceState.SaveableStateProvider("settings"){
                            DeckSettings(state,repo,onPair={showPair=true},onForget={confirmForget=true},onReconnect=repo::reconnect,onOpenArchived={id->repo.selectSession(id);panel="chat"},requestedSection=settingsTarget,onSectionConsumed={settingsTarget=null})
                        }
                        state.host==null->Welcome{showPair=true}
                        else->BoxWithConstraints(Modifier.fillMaxSize()){
                            // Measure the remaining workspace, not the whole display: an open
                            // sidebar must not squeeze the conversation below a usable width.
                            val splitReview=maxWidth>=1000.dp
                            Row(Modifier.fillMaxSize()){
                                Box(Modifier.weight(1f).fillMaxHeight()){
                                    if(panel!="review"||splitReview)workspaceState.SaveableStateProvider("conversation"){
                                        ChatWorkspace(state,repo,onInterrupt={confirmInterrupt=true},requestedAction=conversationAction,onActionConsumed={conversationAction=null})
                                    }
                                }
                                if(panel=="review"){
                                    if(splitReview)VerticalDivider()
                                    Column((if(splitReview)Modifier.width(440.dp) else Modifier.fillMaxWidth()).fillMaxHeight().testTag("workspace-review")){
                                        Row(Modifier.fillMaxWidth().padding(start=20.dp,end=8.dp),verticalAlignment=Alignment.CenterVertically){
                                            Text("工作区改动",Modifier.weight(1f),fontWeight=FontWeight.SemiBold)
                                            IconButton(onClick={panel="chat"}){Icon(Icons.Outlined.Close,"关闭审查")}
                                        }
                                        Box(Modifier.weight(1f)){Review(state,repo)}
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        if(sidebar&&!wide){val drawer=rememberDrawerState(DrawerValue.Open);LaunchedEffect(drawer.currentValue){if(drawer.currentValue==DrawerValue.Closed)sidebar=false};ModalNavigationDrawer(drawerState=drawer,drawerContent={ModalDrawerSheet(drawerShape=RectangleShape,modifier=Modifier.widthIn(max=320.dp).fillMaxWidth(0.88f),windowInsets=WindowInsets(0),drawerContainerColor=MaterialTheme.colorScheme.surface){ChatGptSidebar(state,repo,panel,onChat={panel="chat";sidebar=false},onSettings={panel="settings";sidebar=false},onPair={showComputers=true;sidebar=false},onCollapse={sidebar=false})}},content={Box(Modifier.fillMaxSize().clickable{sidebar=false})})}
    }
    }
    androidx.activity.compose.BackHandler(enabled=sidebar||panel!="chat"){if(sidebar)sidebar=false else panel="chat"}
    if(showCommands){
        val commands=buildList{
            add(DeckCommand("settings","打开设置"){panel="settings"})
            deckSettingsSections.forEach{(id,label)->
                add(DeckCommand("settings:$id",label,"设置"){settingsTarget=id;panel="settings"})
            }
            settingsDestinations.forEach{destination->add(DeckCommand("setting-item:"+destination.id,destination.title,"设置 · "+destination.detail){settingsTarget="item:"+destination.id;panel="settings"})}
            add(DeckCommand("archived","管理归档会话","设置 · 查看、打开或恢复已归档会话"){settingsTarget="archived";panel="settings"})
            add(DeckCommand("back","后退到上一会话或项目","Alt + ←",canBack){navigate(-1)})
            add(DeckCommand("forward","前进到下一会话或项目","Alt + →",canForward){navigate(1)})
            add(DeckCommand("drafts","查看未发送草稿","当前电脑 · 安卓内存草稿",state.host!=null){showDrafts=true})
            add(DeckCommand("chat","返回对话"){panel="chat"})
            add(DeckCommand("computers","切换电脑"){showComputers=true})
            add(DeckCommand("pair","添加电脑","安全配对 Windows"){showPair=true})
            add(DeckCommand("new","新对话","当前项目",state.selectedProject!=null&&!state.busy){state.selectedProject?.let(repo::selectProject);panel="chat"})
            add(DeckCommand("review","审查工作区改动","当前项目",state.selectedProject!=null&&!state.stale){panel="review";repo.refreshGit()})
            add(DeckCommand("refresh","刷新会话与项目","从当前电脑同步",state.host!=null&&!state.stale&&!state.busy){repo.refresh()})
            add(DeckCommand("reconnect","重新连接电脑","当前电脑",state.host!=null&&!state.busy){repo.reconnect()})
            state.snapshot.sessions.find{it.sessionId==state.selectedSession}?.let{session->
                val enabled=canManageSession(state,session)
                listOf("rename" to "重命名当前会话","archive" to if(session.archived==1)"恢复当前会话" else "归档当前会话","delete" to "永久删除当前会话").forEach{(operation,label)->
                    add(DeckCommand("current:$operation",label,session.title,enabled){sessionCommand=session.sessionId to if(operation=="archive"&&session.archived==1)"restore" else operation})
                }
                add(DeckCommand("current:pin",if(session.pinned==1)"取消置顶当前会话" else "置顶当前会话",session.title,enabled){repo.manageSession(session,"pin")})
                if(state.capabilities?.supports("sessionFork")==true)add(DeckCommand("current:fork","分叉当前会话",session.title,enabled){sessionCommand=session.sessionId to "fork"})
            }
            state.snapshot.projects.forEach{project->
                add(DeckCommand("project:${project.projectId}","新对话 · ${project.name}","已授权项目",!state.busy){repo.selectProject(project.projectId);panel="chat"})
            }
            state.snapshot.sessions.filter{it.archived==0}.sortedByDescending{it.updatedAt}.forEach{session->
                val project=state.snapshot.projects.find{it.projectId==session.projectId}
                add(DeckCommand("session:${session.sessionId}",session.title,"${project?.name.orEmpty()} · ${statusLabel(session.status)}",!state.busy){repo.selectSession(session.sessionId);panel="chat"})
            }
        }
        CommandMenu(commands,state.displayMask){showCommands=false}
    }
    sessionCommand?.let{(id,operation)->
        val session=state.snapshot.sessions.find{it.sessionId==id}
        if(session!=null)SessionOperationDialog(session,state,repo,operation){sessionCommand=null}
        else LaunchedEffect(id){sessionCommand=null}
    }
    if(showDrafts)ComposerDraftList(state,repo,onOpen={showDrafts=false;panel="chat";sidebar=false},onClose={showDrafts=false})
    if(showComputers)ComputerPickerDialog(state,onSelect={id->showComputers=false;sidebar=false;panel="chat";repo.selectHost(id)},onAdd={showComputers=false;showPair=true},onDismiss={showComputers=false},onRename=repo::renameHost)
    if(showPair)AlertDialog(onDismissRequest={showPair=false;repo.cancelPair()},confirmButton={},dismissButton={TextButton(onClick={showPair=false;repo.cancelPair()}){Text("关闭")}},title={Text("安全配对 Windows")},text={PairContent(state,repo,onDone={showPair=false})})
    if(confirmInterrupt)Confirm("停止当前任务？","将向 Codex 请求中断，收到确认后更新任务状态。",{confirmInterrupt=false},{confirmInterrupt=false;repo.interrupt()})
    if(confirmForget)Confirm("移除当前电脑？","仅移除此电脑的配对和缓存，其他电脑会保留。在线时撤销该电脑的设备凭据；离线时请随后在该 Windows 电脑撤销设备。",{confirmForget=false},{confirmForget=false;repo.forgetHost()})
}
@Composable private fun Welcome(onPair:()->Unit){Box(Modifier.fillMaxSize().padding(32.dp),contentAlignment=Alignment.Center){Column(Modifier.widthIn(max=420.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(14.dp)){
    Text("欢迎使用 AgentDeck",fontSize=28.sp,lineHeight=34.sp,fontWeight=FontWeight.SemiBold)
    Text("连接你的 Windows，继续同一份 Codex 会话。",fontSize=15.sp,lineHeight=23.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
    Spacer(Modifier.height(6.dp))
    Button(onClick=onPair,modifier=Modifier.fillMaxWidth().height(50.dp),shape=RoundedCornerShape(14.dp)){Text("配对 Windows 主机",fontSize=16.sp)}
    Text("在 AgentDeck 中生成二维码，扫码并确认即可。",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
}}}
@Composable private fun ChatSidebar(state:DeckState,repo:DeckRepository,panel:String,onChat:()->Unit,onSettings:()->Unit,onPair:()->Unit,onCollapse:()->Unit){
    var search by rememberSaveable(state.host?.hostId){mutableStateOf("")}
    var filter by rememberSaveable(state.host?.hostId){mutableStateOf("all")}
    var sort by rememberSaveable(state.host?.hostId){mutableStateOf("recent")}
    var filterMenu by remember{mutableStateOf(false)}
    var projectsExpanded by rememberSaveable(state.host?.hostId){mutableStateOf(false)}
    var showNativeProjects by remember(state.host?.hostId){mutableStateOf(false)}
    var manageSession by remember(state.host?.hostId){mutableStateOf<String?>(null)}
    if(showNativeProjects)NativeProjectsDialog(repo,state.host?.hostId,onClose={showNativeProjects=false},onOpenChat=onChat)
    val pending=state.snapshot.approvals.filter{it.status=="pending"}.map{it.sessionId}.toSet()
    val terms=search.trim().split(Regex("\\s+")).filter{it.isNotBlank()}
    val visible=state.snapshot.sessions.filter{session->
        val project=state.snapshot.projects.find{it.projectId==session.projectId}
        val matches=terms.all{maskDisplay(session.title+" "+project?.name.orEmpty(),state.displayMask).contains(it,true)}
        matches&&when(filter){
            "archived"->session.archived==1
            "pinned"->session.archived==0&&session.pinned==1
            "active"->session.archived==0&&(session.status in listOf("running","queued","waitingApproval","unknown")||session.sessionId in pending)
            else->session.archived==0
        }
    }
    val ordering=if(sort=="title")compareBy<Session>{maskDisplay(it.title,state.displayMask).lowercase()} else compareByDescending<Session>{it.updatedAt}
    Column(Modifier.widthIn(max=340.dp).fillMaxWidth().fillMaxHeight().testTag("chat-sidebar").background(MaterialTheme.colorScheme.surfaceContainerLow).windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Vertical+WindowInsetsSides.Start)).padding(horizontal=12.dp)){
        Row(Modifier.fillMaxWidth().height(56.dp),verticalAlignment=Alignment.CenterVertically){
            Text("AgentDeck",Modifier.weight(1f).padding(start=12.dp),fontSize=20.sp,fontWeight=FontWeight.SemiBold)
            IconButton(onClick=onCollapse){Icon(Icons.Outlined.MenuOpen,"收起会话列表")}
        }
        ConversationSearch(search,{search=it},"搜索会话")
        TextButton(onClick={state.selectedProject?.let(repo::selectProject);onChat()},enabled=state.selectedProject!=null&&!state.busy,modifier=Modifier.fillMaxWidth(),contentPadding=PaddingValues(12.dp)){
            Icon(Icons.Outlined.Edit,null,Modifier.size(22.dp));Spacer(Modifier.width(12.dp));Text("新对话",Modifier.weight(1f),fontSize=16.sp)
        }
        LazyColumn(Modifier.weight(1f),contentPadding=PaddingValues(bottom=16.dp)){
            item{
                Row(Modifier.fillMaxWidth().clickable{projectsExpanded=!projectsExpanded}.padding(horizontal=12.dp,vertical=16.dp),verticalAlignment=Alignment.CenterVertically){
                    Icon(Icons.Outlined.FolderOpen,null,Modifier.size(21.dp));Spacer(Modifier.width(12.dp));Text("项目",Modifier.weight(1f),fontSize=15.sp)
                    Icon(if(projectsExpanded)Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,null,Modifier.size(18.dp))
                }
            }
            if(projectsExpanded){
                items(state.snapshot.projects,key={"project:"+it.projectId}){project->
                    TextButton(onClick={repo.selectProject(project.projectId);onChat()},enabled=!state.busy,modifier=Modifier.fillMaxWidth(),contentPadding=PaddingValues(start=44.dp,end=12.dp,top=10.dp,bottom=10.dp)){
                        Text(maskDisplay(project.name,state.displayMask),Modifier.weight(1f),maxLines=1,overflow=TextOverflow.Ellipsis)
                        if(state.selectedProject==project.projectId)Icon(Icons.Outlined.Check,null,Modifier.size(16.dp))
                    }
                }
                item{TextButton(onClick=repo::addProject,enabled=!state.stale){Icon(Icons.Outlined.CreateNewFolder,null,Modifier.size(18.dp));Spacer(Modifier.width(10.dp));Text("在 Windows 授权项目")}}
                if(state.capabilities?.supports("nativeProjectReadViews")==true)item{TextButton(onClick={showNativeProjects=true},enabled=!state.stale){Text("Codex 项目")}}
            }
            item{
                Row(Modifier.fillMaxWidth().padding(start=12.dp,top=8.dp),verticalAlignment=Alignment.CenterVertically){
                    Text(when(filter){"active"->"活动任务";"pinned"->"置顶";"archived"->"归档";else->"对话"},Modifier.weight(1f),fontSize=13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    Box{
                        IconButton(onClick={filterMenu=true}){Icon(Icons.Outlined.Tune,"筛选和排序会话",Modifier.size(18.dp))}
                        DropdownMenu(expanded=filterMenu,onDismissRequest={filterMenu=false}){
                            listOf("all" to "全部对话","active" to "活动任务","pinned" to "置顶","archived" to "归档").forEach{(id,label)->DropdownMenuItem(text={Text(label)},trailingIcon={if(filter==id)Icon(Icons.Outlined.Check,null)},onClick={filter=id;filterMenu=false})}
                            HorizontalDivider()
                            listOf("recent" to "最近更新","title" to "按名称").forEach{(id,label)->DropdownMenuItem(text={Text(label)},trailingIcon={if(sort==id)Icon(Icons.Outlined.Check,null)},onClick={sort=id;filterMenu=false})}
                        }
                    }
                }
            }
            if(visible.isEmpty())item{Text(if(search.isNotBlank())"没有匹配的会话" else "暂无会话",Modifier.padding(12.dp),fontSize=14.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)}
            items(visible.sortedWith(compareByDescending<Session>{it.pinned}.then(ordering)),key={it.sessionId}){session->
                Box{
                    Row(Modifier.fillMaxWidth().background(if(state.selectedSession==session.sessionId&&panel=="chat")MaterialTheme.colorScheme.surfaceContainerHighest else Color.Transparent,RoundedCornerShape(12.dp)).combinedClickable(enabled=!state.busy,onClick={repo.selectSession(session.sessionId);onChat()},onLongClickLabel="管理会话",onLongClick={manageSession=session.sessionId}).padding(horizontal=12.dp,vertical=15.dp),verticalAlignment=Alignment.CenterVertically){
                        Text(maskDisplay(session.title,state.displayMask),fontSize=15.sp,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.weight(1f))
                        if(session.sessionId in pending)Icon(Icons.Outlined.Security,"等待审批",Modifier.padding(start=8.dp).size(16.dp),tint=MaterialTheme.colorScheme.error)
                        else if(session.status in listOf("running","queued"))CircularProgressIndicator(Modifier.padding(start=8.dp).size(14.dp),strokeWidth=1.5.dp)
                        else if(session.status=="unknown")Icon(Icons.Outlined.SyncProblem,"任务状态待核对",Modifier.padding(start=8.dp).size(16.dp))
                        else if(session.pinned==1)Icon(Icons.Outlined.PushPin,"已置顶",Modifier.padding(start=8.dp).size(14.dp))
                    }
                    SessionActions(session,state,repo,showButton=false,requestMenu=manageSession==session.sessionId,onMenuConsumed={manageSession=null})
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(vertical=8.dp),verticalAlignment=Alignment.CenterVertically){
            TextButton(onClick=onPair,enabled=!state.busy,modifier=Modifier.weight(1f)){
                Icon(Icons.Outlined.Computer,null,Modifier.size(22.dp));Spacer(Modifier.width(12.dp));Column(Modifier.weight(1f),horizontalAlignment=Alignment.Start){Text(maskDisplay(state.host?.label?:"连接电脑",state.displayMask),fontSize=14.sp,maxLines=1,overflow=TextOverflow.Ellipsis);Text(state.connection,fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)}
            }
            IconButton(onClick=onSettings,modifier=Modifier.testTag("codex-open-settings")){Icon(Icons.Outlined.Settings,"设置")}
        }
    }
}
@Composable internal fun Review(state:DeckState,repo:DeckRepository){LaunchedEffect(state.host?.hostId,state.selectedProject){if(state.selectedProject!=null&&!state.stale)repo.refreshGit()};BoxWithConstraints(Modifier.fillMaxSize().padding(20.dp)){val wide=maxWidth>=760.dp;var showDiff by rememberSaveable(state.host?.hostId){mutableStateOf(false)};if(wide)Row(horizontalArrangement=Arrangement.spacedBy(16.dp)){GitFiles(state,repo,Modifier.width(280.dp),onFile={repo.selectFile(it)});DiffPane(state.diff,Modifier.weight(1f),state.displayMask)}else Column{if(!showDiff){GitFiles(state,repo,Modifier.fillMaxSize(),onFile={repo.selectFile(it);showDiff=true})}else{TextButton(onClick={showDiff=false}){Text("返回文件列表")};DiffPane(state.diff,Modifier.weight(1f),state.displayMask)}}}}
@Composable private fun GitFiles(state:DeckState,repo:DeckRepository,modifier:Modifier,onFile:(GitFile)->Unit){var filter by rememberSaveable(state.host?.hostId,state.selectedProject){mutableStateOf("")};val files=remember(state.git,filter){filterGitFiles(state.git?.files?:emptyList(),filter)};LazyColumn(modifier.testTag("git-files"),verticalArrangement=Arrangement.spacedBy(8.dp)){item{Text("Git 审查",fontSize=24.sp,fontWeight=FontWeight.SemiBold);Text("工作区当前变化，可能包含外部修改。",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant);Spacer(Modifier.height(12.dp));state.snapshot.projects.forEach{project->FilterChip(selected=state.selectedProject==project.projectId,onClick={repo.selectProject(project.projectId);repo.refreshGit()},label={Text(project.name)})};TextButton(onClick=repo::refreshGit,enabled=!state.stale){Text("刷新真实 Git 状态")};state.git?.baseline?.let{Text("基线 ${it.take(12)}",fontSize=10.sp,fontFamily=FontFamily.Monospace)};OutlinedTextField(value=filter,onValueChange={if(it.length<=200)filter=it},label={Text("筛选文件路径")},singleLine=true,modifier=Modifier.fillMaxWidth());if(state.git?.truncated==true)Text("文件列表已截断",color=MaterialTheme.colorScheme.error)};if(state.git?.available==false)item{Empty("此项目没有可用 Git 仓库","Codex 任务仍可使用。")};if(state.git?.available==true&&state.git.files.isEmpty())item{Text("工作区干净，没有待审查改动。",fontSize=13.sp)};if(state.git?.available==true&&state.git.files.isNotEmpty()&&files.isEmpty())item{Text("没有匹配的文件",fontSize=13.sp)};items(files,key={it.fileId}){file->OutlinedCard(onClick={onFile(file)},modifier=Modifier.fillMaxWidth()){Row(Modifier.padding(12.dp),horizontalArrangement=Arrangement.spacedBy(10.dp)){Text(if(file.untracked)"??" else file.index+file.worktree,fontFamily=FontFamily.Monospace,color=MaterialTheme.colorScheme.primary);Column{Text(file.path,fontSize=12.sp);file.oldPath?.let{Text("原路径 $it",fontSize=10.sp)}}}}}}}
@Composable private fun PairContent(state:DeckState,repo:DeckRepository,onDone:()->Unit){val initialDevice=remember{state.host?.let{it.hostId to it.deviceId}};var scanner by remember{mutableStateOf(false)};var raw by rememberSaveable{mutableStateOf("")};LaunchedEffect(state.host?.deviceId,state.busy){if(state.host!=null&&(state.host.hostId to state.host.deviceId)!=initialDevice&&state.pairingCode==null&&!state.busy)onDone()};Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)){Text("在 Windows 管理窗生成二维码。扫描后，在两台设备核对相同的六位码，并在 Windows 确认。",fontSize=13.sp);if(state.pairingCode!=null){Text(state.pairingCode,fontSize=38.sp,fontFamily=FontFamily.Monospace,fontWeight=FontWeight.SemiBold);Text(state.pairingName?:"");Text("等待 Windows 人工确认…",color=MaterialTheme.colorScheme.primary)}else{if(scanner)QrScanner(Modifier.fillMaxWidth().height(260.dp)){scanner=false;repo.beginPair(it)}else Button(onClick={scanner=true},enabled=!state.busy){Icon(Icons.Outlined.QrCodeScanner,null);Spacer(Modifier.width(8.dp));Text("扫描配对二维码")};Text("或粘贴完整配对 JSON",fontSize=12.sp);OutlinedTextField(value=raw,onValueChange={if(it.length<4096)raw=it},modifier=Modifier.fillMaxWidth(),maxLines=5,enabled=!state.busy);OutlinedButton(onClick={repo.beginPair(raw)},enabled=raw.isNotBlank()&&!state.busy){Text("验证证书并申请配对")}};if(state.busy)LinearProgressIndicator(Modifier.fillMaxWidth());state.error?.let{Text(it,color=MaterialTheme.colorScheme.error,fontSize=12.sp)}}}
@Composable private fun Empty(title:String,description:String){Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){Text(title,fontWeight=FontWeight.Medium);Text(description,fontSize=13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,lineHeight=21.sp)}}
@Composable private fun Confirm(title:String,text:String,onDismiss:()->Unit,onConfirm:()->Unit){AlertDialog(onDismissRequest=onDismiss,title={Text(title)},text={Text(text)},confirmButton={Button(onClick=onConfirm){Text("确认")}},dismissButton={TextButton(onClick=onDismiss){Text("取消")}})}

