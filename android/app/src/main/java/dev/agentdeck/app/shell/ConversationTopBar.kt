package dev.agentdeck.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** One flat navigation row; secondary workspace tools live in the overflow menu. */
@Composable internal fun ConversationTopBar(
    state:DeckState, repo:DeckRepository, panel:String, showNavigation:Boolean,
    onNavigation:()->Unit, onChat:()->Unit, onNew:()->Unit, onComputers:()->Unit,
    onSettings:()->Unit, onSearch:()->Unit, onDrafts:()->Unit, onReview:()->Unit,
    onConversationAction:(String)->Unit,
){
    var workspaceMenu by remember(state.host?.hostId){mutableStateOf(false)}
    var toolsMenu by remember(state.host?.hostId){mutableStateOf(false)}
    val session=state.snapshot.sessions.find{it.sessionId==state.selectedSession}
    Row(Modifier.fillMaxWidth().height(56.dp).background(MaterialTheme.colorScheme.surface).padding(horizontal=6.dp).testTag("conversation-top-bar"),verticalAlignment=Alignment.CenterVertically){
        if(panel!="chat")IconButton(onClick=onChat){Icon(Icons.Outlined.ArrowBack,"返回对话",Modifier.size(22.dp))}
        else if(showNavigation)IconButton(onClick=onNavigation){Icon(Icons.Outlined.Menu,"打开会话列表",Modifier.size(24.dp))}
        if(panel=="chat"){
            Box(Modifier.weight(1f)){
                TextButton(onClick={workspaceMenu=true},contentPadding=PaddingValues(horizontal=8.dp,vertical=2.dp),shape=RoundedCornerShape(10.dp)){
                    Row(verticalAlignment=Alignment.CenterVertically){
                        Text(maskDisplay(session?.title?:"AgentDeck",state.displayMask),fontSize=20.sp,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.weight(1f,fill=false))
                        if(state.host!=null)Icon(Icons.Outlined.ExpandMore,null,Modifier.padding(start=3.dp).size(18.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                DropdownMenu(expanded=workspaceMenu,onDismissRequest={workspaceMenu=false},shape=RoundedCornerShape(16.dp)){
                    DropdownMenuItem(text={Text(state.host?.label?:"连接电脑")},leadingIcon={Icon(Icons.Outlined.Computer,null)},onClick={workspaceMenu=false;onComputers()})
                    if(state.host!=null){
                        Text(state.connection,Modifier.padding(horizontal=16.dp),style=MaterialTheme.typography.labelSmall)
                        HorizontalDivider()
                        HorizontalDivider()
                        state.snapshot.projects.forEach{item->DropdownMenuItem(text={Text(maskDisplay(item.name,state.displayMask))},leadingIcon={Icon(Icons.Outlined.FolderOpen,null)},trailingIcon={if(item.projectId==state.selectedProject)Icon(Icons.Outlined.Check,null)},enabled=!state.busy,onClick={workspaceMenu=false;repo.selectProject(item.projectId);onChat()})}
                    }
                }
            }
        }else Text(when(panel){"settings"->"设置";"review"->"工作区改动";else->"AgentDeck"},Modifier.weight(1f).padding(start=10.dp),fontSize=20.sp,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis)
        if(state.host!=null&&panel=="chat")IconButton(onClick=onNew,enabled=state.selectedProject!=null&&!state.busy){Icon(Icons.Outlined.Edit,"新对话",Modifier.size(22.dp))}
        if(state.host!=null)IconButton(onClick=onComputers){Icon(Icons.Outlined.Computer,"切换电脑",Modifier.size(22.dp))}
        Box{
            IconButton(onClick={toolsMenu=true}){Icon(Icons.Outlined.MoreHoriz,"更多操作",Modifier.size(24.dp))}
            DropdownMenu(expanded=toolsMenu,onDismissRequest={toolsMenu=false},shape=RoundedCornerShape(16.dp)){
                if(state.host!=null){
                    DropdownMenuItem(text={Text("未发送草稿")},leadingIcon={Icon(Icons.Outlined.Drafts,null)},onClick={toolsMenu=false;onDrafts()})
                    DropdownMenuItem(text={Text("审查工作区改动")},leadingIcon={Icon(Icons.Outlined.Difference,null)},enabled=state.selectedProject!=null,onClick={toolsMenu=false;onReview()})
                }
                if(session!=null&&panel=="chat"){
                    HorizontalDivider()
                    DropdownMenuItem(text={Text("在会话中查找")},leadingIcon={Icon(Icons.Outlined.FindInPage,null)},onClick={toolsMenu=false;onConversationAction("find")})
                    if(state.capabilities?.supports("upstreamHistoryPages")==true)DropdownMenuItem(text={Text("会话历史")},leadingIcon={Icon(Icons.Outlined.History,null)},enabled=!state.stale,onClick={toolsMenu=false;onConversationAction("history")})
                    if(state.capabilities?.supports("nativeQueue")==true)DropdownMenuItem(text={Text("待发送消息")},leadingIcon={Icon(Icons.Outlined.ScheduleSend,null)},enabled=!state.stale,onClick={toolsMenu=false;onConversationAction("queue")})
                    DropdownMenuItem(text={Text("管理当前会话")},leadingIcon={Icon(Icons.Outlined.MoreVert,null)},onClick={toolsMenu=false;onConversationAction("manage")})
                }
                HorizontalDivider()
                DisplayMaskAction(state.displayMask,repo::setDisplayMask)
                DropdownMenuItem(text={Text("设置")},leadingIcon={Icon(Icons.Outlined.Settings,null)},modifier=Modifier.testTag("codex-open-settings"),onClick={toolsMenu=false;onSettings()})
            }
        }
    }
}
