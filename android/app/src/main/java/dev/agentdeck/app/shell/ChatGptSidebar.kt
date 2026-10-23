package dev.agentdeck.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Phone drawer / tablet rail. Geometry and hierarchy follow the mobile assistant
 * reference: flat white rail, quiet search field, one primary action row and a
 * dense history list without card chrome.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable internal fun ChatGptSidebar(
    state:DeckState,repo:DeckRepository,panel:String,onChat:()->Unit,onSettings:()->Unit,
    onPair:()->Unit,onCollapse:()->Unit,
){
    var search by rememberSaveable(state.host?.hostId){mutableStateOf("")}
    var searchOpen by rememberSaveable(state.host?.hostId){mutableStateOf(false)}
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
    Column(Modifier.widthIn(max=320.dp).fillMaxWidth().fillMaxHeight().testTag("chat-sidebar").background(MaterialTheme.colorScheme.surface).windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Vertical+WindowInsetsSides.Start)).padding(horizontal=12.dp)){
        Row(Modifier.fillMaxWidth().height(52.dp),verticalAlignment=Alignment.CenterVertically){
            Text("AgentDeck",Modifier.weight(1f).padding(start=8.dp),fontSize=22.sp,fontWeight=FontWeight.Bold)
            IconButton(onClick=onCollapse,modifier=Modifier.size(40.dp)){Icon(Icons.Outlined.Close,"收起会话列表",Modifier.size(22.dp))}
        }
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)){
        Row(Modifier.weight(1f).heightIn(min=48.dp).clip(RoundedCornerShape(12.dp)).clickable(enabled=state.selectedProject!=null&&!state.busy){state.selectedProject?.let(repo::selectProject);onChat()}.padding(horizontal=8.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically){
            Icon(Icons.Outlined.Edit,null,Modifier.size(21.dp))
            Spacer(Modifier.width(14.dp))
            Text("新对话",fontSize=16.sp)
        }
        IconButton(onClick={searchOpen=!searchOpen;if(!searchOpen)search=""},modifier=Modifier.size(48.dp)){Icon(if(searchOpen)Icons.Outlined.Close else Icons.Outlined.Search,if(searchOpen)"关闭搜索" else "搜索会话",Modifier.size(22.dp))}
        }
        if(searchOpen)DrawerSearch(search,{search=it.take(160)}){}
        LazyColumn(Modifier.weight(1f),contentPadding=PaddingValues(bottom=12.dp)){
            item{
                Row(Modifier.fillMaxWidth().heightIn(min=48.dp).clip(RoundedCornerShape(10.dp)).clickable{projectsExpanded=!projectsExpanded}.padding(horizontal=8.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically){
                    Icon(Icons.Outlined.FolderOpen,null,Modifier.size(20.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.width(14.dp))
                    Text("项目",Modifier.weight(1f),fontSize=15.sp)
                    Icon(if(projectsExpanded)Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,null,Modifier.size(18.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if(projectsExpanded){
                items(state.snapshot.projects,key={"project:"+it.projectId}){project->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable(enabled=!state.busy){repo.selectProject(project.projectId);onChat()}.padding(start=42.dp,end=12.dp,top=10.dp,bottom=10.dp),verticalAlignment=Alignment.CenterVertically){
                        Text(maskDisplay(project.name,state.displayMask),Modifier.weight(1f),fontSize=14.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
                        if(state.selectedProject==project.projectId)Icon(Icons.Outlined.Check,null,Modifier.size(16.dp))
                    }
                }
                item{TextButton(onClick=repo::addProject,enabled=!state.stale,modifier=Modifier.padding(start=34.dp)){Text("在 Windows 授权项目",fontSize=14.sp)}}
                if(state.capabilities?.supports("nativeProjectReadViews")==true)item{TextButton(onClick={showNativeProjects=true},enabled=!state.stale,modifier=Modifier.padding(start=34.dp)){Text("Codex 项目",fontSize=14.sp)}}
            }
            item{
                Row(Modifier.fillMaxWidth().padding(start=8.dp,top=4.dp,end=2.dp),verticalAlignment=Alignment.CenterVertically){
                    Text(when(filter){"active"->"活动任务";"pinned"->"置顶";"archived"->"归档";else->"对话"},Modifier.weight(1f),fontSize=13.sp,fontWeight=FontWeight.Medium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    IconButton(onClick=repo::refresh,enabled=!state.stale&&!state.busy,modifier=Modifier.size(36.dp)){Icon(Icons.Outlined.Refresh,"同步电脑已有对话",Modifier.size(18.dp))}
                    Box{
                        IconButton(onClick={filterMenu=true},modifier=Modifier.size(36.dp)){Icon(Icons.Outlined.Tune,"筛选和排序会话",Modifier.size(18.dp))}
                        DropdownMenu(expanded=filterMenu,onDismissRequest={filterMenu=false},shape=RoundedCornerShape(16.dp)){
                            listOf("all" to "全部对话","active" to "活动任务","pinned" to "置顶","archived" to "归档").forEach{(id,label)->DropdownMenuItem(text={Text(label)},trailingIcon={if(filter==id)Icon(Icons.Outlined.Check,null)},onClick={filter=id;filterMenu=false})}
                            HorizontalDivider()
                            listOf("recent" to "最近更新","title" to "按名称").forEach{(id,label)->DropdownMenuItem(text={Text(label)},trailingIcon={if(sort==id)Icon(Icons.Outlined.Check,null)},onClick={sort=id;filterMenu=false})}
                        }
                    }
                }
            }
            if(visible.isEmpty())item{Text(if(search.isNotBlank())"没有匹配的会话" else if(state.snapshot.projects.isEmpty())"请先在 Windows 授权项目，再同步已有对话" else "暂无会话，点击刷新同步电脑已有对话",Modifier.padding(horizontal=8.dp,vertical=20.dp),fontSize=14.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)}
            visible.sortedWith(compareByDescending<Session>{it.pinned}.then(ordering)).groupBy{sessionDateLabel(it.updatedAt)}.forEach{(label,sessions)->
                item{Text(label,Modifier.padding(start=8.dp,top=8.dp,bottom=2.dp),fontSize=12.sp,fontWeight=FontWeight.Medium,color=MaterialTheme.colorScheme.onSurfaceVariant)}
                items(sessions,key={it.sessionId}){session->
                    Box{
                        Row(Modifier.fillMaxWidth().heightIn(min=48.dp).clip(RoundedCornerShape(10.dp)).background(if(state.selectedSession==session.sessionId&&panel=="chat")MaterialTheme.colorScheme.surfaceContainerHigh else Color.Transparent).combinedClickable(enabled=!state.busy,onClick={repo.selectSession(session.sessionId);onChat()},onLongClickLabel="管理会话",onLongClick={manageSession=session.sessionId}).padding(horizontal=10.dp,vertical=6.dp),verticalAlignment=Alignment.CenterVertically){
                            Text(maskDisplay(session.title,state.displayMask),fontSize=15.sp,fontWeight=if(state.selectedSession==session.sessionId&&panel=="chat")FontWeight.SemiBold else FontWeight.Normal,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.weight(1f))
                            when{
                                session.sessionId in pending->Icon(Icons.Outlined.Security,"等待审批",Modifier.padding(start=8.dp).size(16.dp),tint=MaterialTheme.colorScheme.error)
                                session.status in listOf("running","queued")->CircularProgressIndicator(Modifier.padding(start=8.dp).size(14.dp),strokeWidth=1.5.dp)
                                session.status=="unknown"->Icon(Icons.Outlined.SyncProblem,"任务状态待核对",Modifier.padding(start=8.dp).size(16.dp))
                                session.pinned==1->Icon(Icons.Outlined.PushPin,"已置顶",Modifier.padding(start=8.dp).size(14.dp))
                            }
                        }
                        SessionActions(session,state,repo,showButton=false,requestMenu=manageSession==session.sessionId,onMenuConsumed={manageSession=null})
                    }
                }
            }
        }
        HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
        Row(Modifier.fillMaxWidth().padding(vertical=8.dp),verticalAlignment=Alignment.CenterVertically){
            Row(Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).clickable(enabled=!state.busy,onClick=onPair).padding(horizontal=8.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically){
                Icon(Icons.Outlined.Computer,null,Modifier.size(20.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)){
                    Text(maskDisplay(state.host?.label?:"连接电脑",state.displayMask),fontSize=14.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
                }
            }
            IconButton(onClick=onSettings,modifier=Modifier.size(44.dp).testTag("codex-open-settings")){Icon(Icons.Outlined.Settings,"设置",Modifier.size(21.dp))}
        }
    }
}

/** Quiet rounded search field; no outline and no floating label. */
@Composable private fun DrawerSearch(value:String,onValueChange:(String)->Unit,onSubmit:()->Unit){    Surface(shape=RoundedCornerShape(12.dp),color=MaterialTheme.colorScheme.surfaceContainer,modifier=Modifier.fillMaxWidth()){
        Row(Modifier.height(44.dp).padding(horizontal=12.dp),verticalAlignment=Alignment.CenterVertically){
            Icon(Icons.Outlined.Search,null,Modifier.size(20.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(10.dp))
            BasicTextField(
                value=value,
                onValueChange=onValueChange,
                singleLine=true,
                textStyle=TextStyle(fontSize=15.sp,color=MaterialTheme.colorScheme.onSurface),
                cursorBrush=SolidColor(MaterialTheme.colorScheme.primary),
                keyboardOptions=KeyboardOptions(imeAction=ImeAction.Search),
                keyboardActions=KeyboardActions(onSearch={onSubmit()}),
                modifier=Modifier.weight(1f),
                decorationBox={inner->Box(contentAlignment=Alignment.CenterStart){if(value.isBlank())Text("搜索会话",fontSize=15.sp,color=MaterialTheme.colorScheme.onSurfaceVariant);inner()}},
            )
            if(value.isNotEmpty())IconButton(onClick={onValueChange("")},modifier=Modifier.size(24.dp)){Icon(Icons.Outlined.Close,"清除搜索",Modifier.size(16.dp))}
        }
    }
}

private fun sessionDateLabel(raw:String):String{
    val date=runCatching{java.time.Instant.parse(raw).atZone(java.time.ZoneId.systemDefault()).toLocalDate()}.getOrNull()?:return "更早"
    val today=java.time.LocalDate.now()
    return when{
        date==today->"今天"
        date==today.minusDays(1)->"昨天"
        !date.isBefore(today.minusDays(7))->"7 天内"
        !date.isBefore(today.minusDays(30))->"30 天内"
        else->"更早"
    }
}
