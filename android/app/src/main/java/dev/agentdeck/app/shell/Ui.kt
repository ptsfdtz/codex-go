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
    var panel by rememberSaveable{mutableStateOf("chat")}
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
    LaunchedEffect(state.notificationNavigation){if(state.notificationNavigation.isNotEmpty()&&state.notificationNavigation!=notificationSeen){notificationSeen=state.notificationNavigation;apiMode=false;panel="chat";sidebar=false;showPair=false;showComputers=false}}
    if(apiMode){androidx.activity.compose.BackHandler{apiMode=false};ApiWorkspace(api){apiMode=false};return}
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
        val wide=maxWidth>=900.dp
        val compactToolbar=maxWidth<600.dp
        Row(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)){
            if(wide&&sidebarExpanded&&state.host!=null){ChatSidebar(state,repo,panel,onChat={panel="chat"},onSettings={panel="settings"},onPair={showComputers=true},onCollapse={sidebarExpanded=false});VerticalDivider()}
            Column(Modifier.weight(1f).fillMaxHeight().windowInsetsPadding(WindowInsets.safeDrawing).testTag("workspace-content")){
                Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal=16.dp),verticalAlignment=Alignment.CenterVertically){
                    if(state.host!=null&&(!wide||!sidebarExpanded))IconButton(onClick={if(wide)sidebarExpanded=true else sidebar=true}){Icon(Icons.Outlined.Menu,"打开会话列表")}
                    Column(Modifier.weight(1f).clickable(enabled=!state.busy){showComputers=true}.semantics{contentDescription="选择电脑"}){
                        Text(if(panel=="settings")"设置" else state.snapshot.sessions.find{it.sessionId==state.selectedSession}?.title?:state.snapshot.projects.find{it.projectId==state.selectedProject}?.name?:"AgentDeck",fontSize=16.sp,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis)
                        if(state.host!=null)Row(verticalAlignment=Alignment.CenterVertically){Icon(Icons.Outlined.Computer,null,Modifier.size(13.dp));Spacer(Modifier.width(4.dp));Text("${state.host.label} · ${state.connection}",fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.weight(1f,fill=false));Icon(Icons.Outlined.ExpandMore,null,Modifier.size(13.dp))}
                    }
                    if(!compactToolbar&&state.host!=null){
                        IconButton(onClick={navigate(-1)},enabled=canBack){Icon(Icons.Outlined.ArrowBack,"后退到上一会话或项目")}
                        IconButton(onClick={navigate(1)},enabled=canForward){Icon(Icons.Outlined.ArrowForward,"前进到下一会话或项目")}
                    }
                    if(!compactToolbar){
                    if(panel!="chat")TextButton(onClick={panel="chat"}){Text("返回对话")}
                    else if(state.host!=null){IconButton(onClick={panel="review";repo.refreshGit()},enabled=state.selectedProject!=null){Icon(Icons.Outlined.Difference,"审查")};IconButton(onClick={state.selectedProject?.let(repo::selectProject)},enabled=state.selectedProject!=null){Icon(Icons.Outlined.EditNote,"新对话")}}
                    }
                    if(state.host!=null)IconButton(onClick={showDrafts=true}){Icon(Icons.Outlined.Drafts,"未发送草稿")}
                    IconButton(onClick={showCommands=true}){Icon(Icons.Outlined.Search,"搜索操作与会话")}
                    if(!compactToolbar){
                    TextButton(onClick={apiMode=true}){Text("chat")}
                    DisplayMaskAction(state.displayMask,repo::setDisplayMask)
                    }
                    if(!wide||state.host==null)IconButton(onClick={panel="settings"},modifier=Modifier.testTag("codex-open-settings")){Icon(Icons.Outlined.Settings,"设置")}
                }
                if(compactToolbar)Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal=12.dp),verticalAlignment=Alignment.CenterVertically){
                    if(state.host!=null){
                        IconButton(onClick={navigate(-1)},enabled=canBack){Icon(Icons.Outlined.ArrowBack,"后退到上一会话或项目")}
                        IconButton(onClick={navigate(1)},enabled=canForward){Icon(Icons.Outlined.ArrowForward,"前进到下一会话或项目")}
                    }
                    if(panel!="chat")TextButton(onClick={panel="chat"}){Text("返回对话")}
                    if(state.host!=null){
                        TextButton(onClick={panel="review";repo.refreshGit()},enabled=state.selectedProject!=null){Icon(Icons.Outlined.Difference,null,Modifier.size(18.dp));Spacer(Modifier.width(6.dp));Text("审查")}
                        TextButton(onClick={state.selectedProject?.let(repo::selectProject);panel="chat"},enabled=state.selectedProject!=null){Icon(Icons.Outlined.EditNote,null,Modifier.size(18.dp));Spacer(Modifier.width(6.dp));Text("新对话")}
                    }
                    TextButton(onClick={apiMode=true}){Text("chat")}
                    DisplayMaskAction(state.displayMask,repo::setDisplayMask)
                }
                if(state.stale&&state.host!=null)Surface(color=MaterialTheme.colorScheme.surfaceContainerHighest){Row(Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically){Icon(Icons.Outlined.CloudOff,null,Modifier.size(16.dp));Spacer(Modifier.width(8.dp));Text("连接已断开 · 当前显示缓存，恢复连接后可继续",fontSize=12.sp,modifier=Modifier.weight(1f));TextButton(onClick=repo::reconnect){Text("重连")}}}
                state.error?.let{message->Surface(color=MaterialTheme.colorScheme.errorContainer){Row(Modifier.fillMaxWidth().padding(start=20.dp),verticalAlignment=Alignment.CenterVertically){Text(message,modifier=Modifier.weight(1f),fontSize=12.sp);IconButton(onClick=repo::clearError){Icon(Icons.Outlined.Close,"关闭提示")}}}}
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
                                        ChatWorkspace(state,repo,onInterrupt={confirmInterrupt=true})
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
        if(sidebar&&!wide){val drawer=rememberDrawerState(DrawerValue.Open);LaunchedEffect(drawer.currentValue){if(drawer.currentValue==DrawerValue.Closed)sidebar=false};ModalNavigationDrawer(drawerState=drawer,drawerContent={ModalDrawerSheet(modifier=Modifier.width(260.dp),windowInsets=WindowInsets(0),drawerContainerColor=MaterialTheme.colorScheme.surfaceContainerLow){ChatSidebar(state,repo,panel,onChat={panel="chat";sidebar=false},onSettings={panel="settings";sidebar=false},onPair={showComputers=true;sidebar=false},onCollapse={sidebar=false})}},content={Box(Modifier.fillMaxSize().clickable{sidebar=false})})}
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

    var search by rememberSaveable(state.host?.hostId){mutableStateOf("")}
    var filter by rememberSaveable(state.host?.hostId){mutableStateOf("all")}
    var sort by rememberSaveable(state.host?.hostId){mutableStateOf("recent")}
    var sortOpen by remember(state.host?.hostId){mutableStateOf(false)}
    val pendingSessions=state.snapshot.approvals.filter{it.status=="pending"}.map{it.sessionId}.toSet()
    val visible=state.snapshot.sessions.filter{session->when(filter){
        "archived"->session.archived==1
        "pinned"->session.archived==0&&session.pinned==1
        "active"->session.archived==0&&(session.status in listOf("running","queued","waitingApproval","unknown")||session.sessionId in pendingSessions)
        else->session.archived==0
    }}
    val terms=search.trim().split(Regex("\\s+")).filter{it.isNotBlank()}
    fun matches(session:Session,project:Project)=terms.all{maskDisplay(session.title+" "+project.name,state.displayMask).contains(it,true)}
    val ordering=when(sort){"title"->compareBy<Session>{maskDisplay(it.title,state.displayMask).lowercase()};else->compareByDescending<Session>{it.updatedAt}}
    var collapsed by rememberSaveable(state.host?.hostId){mutableStateOf(emptyList<String>())}
    Column(Modifier.width(260.dp).fillMaxHeight().testTag("chat-sidebar").background(MaterialTheme.colorScheme.surfaceContainerLow).windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Vertical+WindowInsetsSides.Start)).padding(12.dp)){
        Row(Modifier.fillMaxWidth().height(48.dp).padding(start=8.dp),verticalAlignment=Alignment.CenterVertically){Icon(Icons.Outlined.Code,null,Modifier.size(22.dp));Spacer(Modifier.width(10.dp));Text("AgentDeck",modifier=Modifier.weight(1f),fontWeight=FontWeight.SemiBold,fontSize=17.sp);IconButton(onClick=onCollapse){Icon(Icons.Outlined.MenuOpen,"收起会话列表")}}
        TextButton(onClick={state.selectedProject?.let(repo::selectProject);onChat()},enabled=state.selectedProject!=null,modifier=Modifier.fillMaxWidth()){Icon(Icons.Outlined.EditNote,null,Modifier.size(18.dp));Spacer(Modifier.width(10.dp));Text("新对话",modifier=Modifier.weight(1f))}
        ConversationSearch(search,{search=it},"搜索已同步会话")
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(4.dp)){
            listOf("all" to "全部","active" to "活动","pinned" to "置顶","archived" to "归档").forEach{(key,label)->FilterChip(selected=filter==key,onClick={filter=key},label={Text(label)})}
        }
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
            Text("${visible.size} 个会话",Modifier.weight(1f),fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Box{
                TextButton(onClick={sortOpen=true}){Text(if(sort=="title")"按名称" else "最近更新",fontSize=11.sp)}
                DropdownMenu(expanded=sortOpen,onDismissRequest={sortOpen=false}){
                    DropdownMenuItem(text={Text("最近更新")},onClick={sort="recent";sortOpen=false})
                    DropdownMenuItem(text={Text("按名称")},onClick={sort="title";sortOpen=false})
                }
            }
        }
        if(state.capabilities?.supports("nativeProjectReadViews")==true)TextButton(onClick={showNativeProjects=true},enabled=!state.stale){Text("Codex 项目")}
        LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp),contentPadding=PaddingValues(vertical=14.dp)){
            item{Row(Modifier.fillMaxWidth().padding(start=10.dp),verticalAlignment=Alignment.CenterVertically){Text("项目",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.weight(1f));IconButton(onClick=repo::addProject,enabled=!state.stale){Icon(Icons.Outlined.CreateNewFolder,"授权项目",Modifier.size(18.dp))}}}
            if(state.snapshot.projects.isEmpty())item{Text("还没有授权项目，请在 Windows 选择目录。",Modifier.padding(10.dp),fontSize=12.sp)}
            if(state.snapshot.projects.isNotEmpty()&&visible.none{session->state.snapshot.projects.find{it.projectId==session.projectId}?.let{matches(session,it)}==true})item{Column{Text("当前筛选没有匹配的已同步会话",Modifier.padding(10.dp),fontSize=12.sp);TextButton(onClick={search="";filter="all"}){Text("显示全部未归档会话")}}}
            state.snapshot.projects.forEach{project->
                val projectSessions=visible.filter{it.projectId==project.projectId}
                val matches=projectSessions.filter{matches(it,project)}
                val expanded=project.projectId !in collapsed||search.isNotBlank()||filter!="all"
                if(matches.isNotEmpty()||(filter=="all"&&terms.all{maskDisplay(project.name,state.displayMask).contains(it,true)}))item(key="p:"+project.projectId){
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                        IconButton(onClick={collapsed=if(project.projectId in collapsed)collapsed-project.projectId else collapsed+project.projectId},modifier=Modifier.size(28.dp),enabled=search.isBlank()&&filter=="all"){
                            Icon(if(expanded)Icons.Outlined.ExpandMore else Icons.Outlined.ChevronRight,if(expanded)"折叠项目 ${project.name}" else "展开项目 ${project.name}",Modifier.size(16.dp))
                        }
                        Row(Modifier.weight(1f).clickable(enabled=!state.busy){repo.selectProject(project.projectId);onChat()}.padding(vertical=10.dp),verticalAlignment=Alignment.CenterVertically){
                            Icon(Icons.Outlined.FolderOpen,null,Modifier.size(17.dp));Spacer(Modifier.width(9.dp))
                            Text(maskDisplay(project.name,state.displayMask),modifier=Modifier.weight(1f),fontSize=13.sp,fontWeight=if(project.projectId==state.selectedProject)FontWeight.SemiBold else FontWeight.Normal,maxLines=1,overflow=TextOverflow.Ellipsis)
                            if(!expanded)Text(projectSessions.size.toString(),Modifier.padding(horizontal=6.dp),fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if(expanded)items(matches.sortedWith(compareByDescending<Session>{it.pinned}.then(ordering)),key={it.sessionId}){session->
                    val pending=state.snapshot.approvals.any{it.sessionId==session.sessionId&&it.status=="pending"}
                    Row(Modifier.fillMaxWidth().background(if(state.selectedSession==session.sessionId&&panel=="chat")MaterialTheme.colorScheme.surfaceContainerHighest else Color.Transparent,RoundedCornerShape(8.dp)).clickable(enabled=!state.busy){repo.selectSession(session.sessionId);onChat()}.padding(start=35.dp,end=10.dp,top=11.dp,bottom=11.dp),verticalAlignment=Alignment.CenterVertically){
                        if(session.pinned==1)Icon(Icons.Outlined.PushPin,null,Modifier.size(12.dp))
                        Text(maskDisplay(session.title,state.displayMask),fontSize=13.sp,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.weight(1f))
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
@Composable internal fun Review(state:DeckState,repo:DeckRepository){LaunchedEffect(state.host?.hostId,state.selectedProject){if(state.selectedProject!=null&&!state.stale)repo.refreshGit()};BoxWithConstraints(Modifier.fillMaxSize().padding(20.dp)){val wide=maxWidth>=760.dp;var showDiff by rememberSaveable(state.host?.hostId){mutableStateOf(false)};if(wide)Row(horizontalArrangement=Arrangement.spacedBy(16.dp)){GitFiles(state,repo,Modifier.width(280.dp),onFile={repo.selectFile(it)});DiffPane(state.diff,Modifier.weight(1f),state.displayMask)}else Column{if(!showDiff){GitFiles(state,repo,Modifier.fillMaxSize(),onFile={repo.selectFile(it);showDiff=true})}else{TextButton(onClick={showDiff=false}){Text("返回文件列表")};DiffPane(state.diff,Modifier.weight(1f),state.displayMask)}}}}
@Composable private fun GitFiles(state:DeckState,repo:DeckRepository,modifier:Modifier,onFile:(GitFile)->Unit){var filter by rememberSaveable(state.host?.hostId,state.selectedProject){mutableStateOf("")};val files=remember(state.git,filter){filterGitFiles(state.git?.files?:emptyList(),filter)};LazyColumn(modifier.testTag("git-files"),verticalArrangement=Arrangement.spacedBy(8.dp)){item{Text("Git 审查",fontSize=24.sp,fontWeight=FontWeight.SemiBold);Text("工作区当前变化，可能包含外部修改。",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant);Spacer(Modifier.height(12.dp));state.snapshot.projects.forEach{project->FilterChip(selected=state.selectedProject==project.projectId,onClick={repo.selectProject(project.projectId);repo.refreshGit()},label={Text(project.name)})};TextButton(onClick=repo::refreshGit,enabled=!state.stale){Text("刷新真实 Git 状态")};state.git?.baseline?.let{Text("基线 ${it.take(12)}",fontSize=10.sp,fontFamily=FontFamily.Monospace)};OutlinedTextField(value=filter,onValueChange={if(it.length<=200)filter=it},label={Text("筛选文件路径")},singleLine=true,modifier=Modifier.fillMaxWidth());if(state.git?.truncated==true)Text("文件列表已截断",color=MaterialTheme.colorScheme.error)};if(state.git?.available==false)item{Empty("此项目没有可用 Git 仓库","Codex 任务仍可使用。")};if(state.git?.available==true&&state.git.files.isEmpty())item{Text("工作区干净，没有待审查改动。",fontSize=13.sp)};if(state.git?.available==true&&state.git.files.isNotEmpty()&&files.isEmpty())item{Text("没有匹配的文件",fontSize=13.sp)};items(files,key={it.fileId}){file->OutlinedCard(onClick={onFile(file)},modifier=Modifier.fillMaxWidth()){Row(Modifier.padding(12.dp),horizontalArrangement=Arrangement.spacedBy(10.dp)){Text(if(file.untracked)"??" else file.index+file.worktree,fontFamily=FontFamily.Monospace,color=MaterialTheme.colorScheme.primary);Column{Text(file.path,fontSize=12.sp);file.oldPath?.let{Text("原路径 $it",fontSize=10.sp)}}}}}}}
@Composable private fun PairContent(state:DeckState,repo:DeckRepository,onDone:()->Unit){val initialDevice=remember{state.host?.let{it.hostId to it.deviceId}};var scanner by remember{mutableStateOf(false)};var raw by rememberSaveable{mutableStateOf("")};LaunchedEffect(state.host?.deviceId,state.busy){if(state.host!=null&&(state.host.hostId to state.host.deviceId)!=initialDevice&&state.pairingCode==null&&!state.busy)onDone()};Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)){Text("在 Windows 管理窗生成二维码。扫描后，在两台设备核对相同的六位码，并在 Windows 确认。",fontSize=13.sp);if(state.pairingCode!=null){Text(state.pairingCode,fontSize=38.sp,fontFamily=FontFamily.Monospace,fontWeight=FontWeight.SemiBold);Text(state.pairingName?:"");Text("等待 Windows 人工确认…",color=MaterialTheme.colorScheme.primary)}else{if(scanner)QrScanner(Modifier.fillMaxWidth().height(260.dp)){scanner=false;repo.beginPair(it)}else Button(onClick={scanner=true},enabled=!state.busy){Icon(Icons.Outlined.QrCodeScanner,null);Spacer(Modifier.width(8.dp));Text("扫描配对二维码")};Text("或粘贴完整配对 JSON",fontSize=12.sp);OutlinedTextField(value=raw,onValueChange={if(it.length<4096)raw=it},modifier=Modifier.fillMaxWidth(),maxLines=5,enabled=!state.busy);OutlinedButton(onClick={repo.beginPair(raw)},enabled=raw.isNotBlank()&&!state.busy){Text("验证证书并申请配对")}};if(state.busy)LinearProgressIndicator(Modifier.fillMaxWidth());state.error?.let{Text(it,color=MaterialTheme.colorScheme.error,fontSize=12.sp)}}}
@Composable private fun Empty(title:String,description:String){Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){Text(title,fontWeight=FontWeight.Medium);Text(description,fontSize=13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,lineHeight=21.sp)}}
@Composable private fun Confirm(title:String,text:String,onDismiss:()->Unit,onConfirm:()->Unit){AlertDialog(onDismissRequest=onDismiss,title={Text(title)},text={Text(text)},confirmButton={Button(onClick=onConfirm){Text("确认")}},dismissButton={TextButton(onClick=onDismiss){Text("取消")}})}

