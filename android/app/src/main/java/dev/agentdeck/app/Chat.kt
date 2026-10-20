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
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

@Composable internal fun ChatWorkspace(state:DeckState,repo:DeckRepository,onInterrupt:()->Unit){
    val keyboard=LocalSoftwareKeyboardController.current
    val focus=LocalFocusManager.current
    val session=state.snapshot.sessions.find{it.sessionId==state.selectedSession}
    val entries=remember(state.events){conversationEntries(state.events)}
    val approvals=state.snapshot.approvals.filter{it.sessionId==state.selectedSession&&it.status=="pending"}
    val active=session?.status in listOf("running","queued","waitingApproval","unknown")
    var drafts by rememberSaveable{mutableStateOf(mapOf<String,String>())}
    val draftKey="${state.host?.hostId}:"+(state.selectedSession?:"new:${state.selectedProject}")
    val text=drafts[draftKey].orEmpty()
    val list=rememberLazyListState()
    val scope=rememberCoroutineScope()
    var follow by remember(state.selectedSession){mutableStateOf(true)}
    LaunchedEffect(list){snapshotFlow{list.isScrollInProgress to list.canScrollForward}.collect{(moving,away)->if(moving)follow=!away}}
    LaunchedEffect(state.selectedSession,entries.lastOrNull(),approvals.size){if(follow){withFrameNanos{};if(list.layoutInfo.totalItemsCount>0)list.scrollToItem(list.layoutInfo.totalItemsCount-1)}}
    Column(Modifier.fillMaxSize()){
        if(session!=null)Row(Modifier.fillMaxWidth().padding(horizontal=24.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically){Text(session.title,fontSize=13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.weight(1f));if(state.busy)CircularProgressIndicator(Modifier.size(14.dp),strokeWidth=1.5.dp)}
        Box(Modifier.weight(1f).fillMaxWidth()){
            if(session==null)Column(Modifier.align(Alignment.Center).padding(32.dp).widthIn(max=640.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(14.dp)){
                Icon(Icons.Outlined.Code,null,Modifier.size(38.dp))
                Text("想在这个项目里做什么？",fontSize=28.sp,fontWeight=FontWeight.SemiBold)
                Text(if(state.selectedProject==null)"先在会话列表中授权一个项目，再开始对话。" else "描述你的目标，Codex 会在 Windows 工作区中开始处理。",fontSize=14.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,lineHeight=23.sp)
                if(state.selectedProject==null)OutlinedButton(onClick=repo::addProject,enabled=!state.stale){Text("在 Windows 选择项目")}
            }else LazyColumn(Modifier.fillMaxSize().testTag("execution-timeline"),state=list,contentPadding=PaddingValues(horizontal=24.dp,vertical=20.dp),verticalArrangement=Arrangement.spacedBy(24.dp)){
                item{Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.Center){TextButton(onClick=repo::olderEvents,enabled=!state.stale&&!state.busy){Text("加载更早的消息",fontSize=12.sp)}}}
                items(entries,key={it.id}){entry->ChatWidth{ChatMessage(entry,state.displayMask)}}
                items(approvals,key={"approval:"+it.approvalId}){approval->ChatWidth{ApprovalCard(approval,state.stale||state.busy,repo::decide)}}
                item{ChatWidth{if(active&&approvals.isEmpty())Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)){if(!state.stale&&session.status!="unknown")CircularProgressIndicator(Modifier.size(13.dp),strokeWidth=1.5.dp);Text(if(state.stale)"连接恢复后核对任务状态" else statusLabel(session.status),fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}
            }
            if(!follow&&session!=null)FilledTonalIconButton(onClick={follow=true;scope.launch{list.animateScrollToItem((list.layoutInfo.totalItemsCount-1).coerceAtLeast(0))}},modifier=Modifier.align(Alignment.BottomCenter).padding(8.dp)){Icon(Icons.Outlined.ArrowDownward,"回到最新消息")}
        }
        ChatWidth{Column(Modifier.imePadding().padding(start=20.dp,end=20.dp,bottom=12.dp)){
            Surface(shape=RoundedCornerShape(24.dp),color=MaterialTheme.colorScheme.surfaceContainerLow,border=BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)){
                Column(Modifier.padding(12.dp)){
                    TextField(value=text,onValueChange={if(it.length<=64000)drafts=drafts+(draftKey to it)},placeholder={Text(if(session==null)"向 Codex 描述任务…" else "发送消息，继续对话…",fontSize=15.sp)},modifier=Modifier.fillMaxWidth().heightIn(min=64.dp,max=180.dp).testTag("chat-input"),maxLines=7,colors=TextFieldDefaults.colors(focusedContainerColor=androidx.compose.ui.graphics.Color.Transparent,unfocusedContainerColor=androidx.compose.ui.graphics.Color.Transparent,focusedIndicatorColor=androidx.compose.ui.graphics.Color.Transparent,unfocusedIndicatorColor=androidx.compose.ui.graphics.Color.Transparent))
                    Row(Modifier.fillMaxWidth().padding(start=10.dp),verticalAlignment=Alignment.CenterVertically){
                        var projectsOpen by remember{mutableStateOf(false)}
                        Box{TextButton(onClick={projectsOpen=true},enabled=session==null&&!state.busy){Icon(Icons.Outlined.FolderOpen,null,Modifier.size(15.dp));Spacer(Modifier.width(6.dp));Text(state.snapshot.projects.find{it.projectId==state.selectedProject}?.name?:"选择项目",maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.widthIn(max=180.dp),fontSize=12.sp);if(session==null)Icon(Icons.Outlined.ExpandMore,null,Modifier.size(14.dp))};DropdownMenu(expanded=projectsOpen,onDismissRequest={projectsOpen=false}){state.snapshot.projects.forEach{project->DropdownMenuItem(text={Text(project.name)},onClick={projectsOpen=false;repo.selectProject(project.projectId)})};DropdownMenuItem(text={Text("在 Windows 授权项目")},onClick={projectsOpen=false;repo.addProject()},enabled=!state.stale)}}
                        Spacer(Modifier.weight(1f))
                        if(active)FilledIconButton(onClick=onInterrupt,enabled=!state.stale&&!state.busy,modifier=Modifier.size(36.dp)){Icon(Icons.Outlined.Stop,"中断任务",Modifier.size(18.dp))}
                        else FilledIconButton(onClick={keyboard?.hide();focus.clearFocus();val sent=text;val key=draftKey;val accepted={if(drafts[key]==sent)drafts=drafts-key;Unit};if(session==null)repo.newTask(sent,accepted)else repo.continueTask(sent,accepted)},enabled=text.isNotBlank()&&!state.stale&&!state.busy&&state.selectedProject!=null,modifier=Modifier.size(36.dp)){Icon(Icons.Outlined.ArrowUpward,"发送消息",Modifier.size(20.dp))}
                    }
                }
            }
            Text(if(state.stale)"离线 · 草稿已保留，连接恢复后可发送" else "Codex 可以修改工作区文件；额外权限由你确认。",modifier=Modifier.align(Alignment.CenterHorizontally).padding(top=8.dp),fontSize=10.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }}
    }
}

@Composable private fun ChatWidth(content:@Composable ()->Unit){Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.TopCenter){Column(Modifier.widthIn(max=840.dp).fillMaxWidth()){content()}}}

@Composable private fun ChatMessage(entry:ChatEntry,mask:String){
    val clipboard=LocalClipboardManager.current
    val text=maskDisplay(entry.text,mask)
    when(entry.kind){
        "user"->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){Surface(Modifier.widthIn(max=640.dp),shape=RoundedCornerShape(20.dp),color=MaterialTheme.colorScheme.surfaceContainerHighest){SelectionContainer{Text(text,Modifier.padding(horizontal=18.dp,vertical=14.dp),fontSize=15.sp,lineHeight=24.sp)}}}
        "assistant","plan"->Column{
            if(entry.kind=="plan")Text("计划",fontSize=12.sp,fontWeight=FontWeight.Medium,color=MaterialTheme.colorScheme.onSurfaceVariant)
            MessageBody(text)
            if(entry.truncated)Text("消息预览已截断，请在 Windows 核对完整内容。",fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            IconButton(onClick={clipboard.setText(AnnotatedString(text))},modifier=Modifier.size(30.dp)){Icon(Icons.Outlined.ContentCopy,"复制回复",Modifier.size(15.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)}
        }
        "tool"->{var expanded by rememberSaveable(entry.id){mutableStateOf(false)}
            Surface(shape=RoundedCornerShape(10.dp),border=BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)){
                Column(Modifier.fillMaxWidth()){
                    Row(Modifier.fillMaxWidth().clickable{expanded=!expanded}.padding(12.dp),verticalAlignment=Alignment.CenterVertically){Icon(if(entry.title=="修改文件")Icons.Outlined.Difference else Icons.Outlined.Terminal,null,Modifier.size(16.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant);Spacer(Modifier.width(10.dp));Text(maskDisplay(entry.title,mask),maxLines=1,overflow=TextOverflow.Ellipsis,fontFamily=FontFamily.Monospace,fontSize=12.sp,modifier=Modifier.weight(1f));Spacer(Modifier.width(8.dp));Text(statusLabel(entry.status),fontSize=10.sp,color=MaterialTheme.colorScheme.onSurfaceVariant);Icon(if(expanded)Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,"展开执行详情",Modifier.size(18.dp))}
                    if(expanded){HorizontalDivider();SelectionContainer{Text((maskDisplay(entry.title+"\n"+entry.text+"\n"+entry.detail,mask)).take(24000),Modifier.padding(14.dp),fontFamily=FontFamily.Monospace,fontSize=12.sp,lineHeight=19.sp)};if(entry.text.length+entry.detail.length>24000)Text("输出预览已截断",Modifier.padding(12.dp),fontSize=11.sp)}
                }
            }
        }
        else->Column{Text(text,fontSize=12.sp,color=if(entry.status=="failed")MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant);if(entry.detail.isNotBlank())SelectionContainer{Text(maskDisplay(entry.detail,mask),fontSize=12.sp)}}
    }
}

/** Fenced code remains selectable text, never executable UI. */
@Composable private fun MessageBody(text:String){
    val parts=remember(text){text.split("```")}
    Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
        parts.forEachIndexed{index,part->
            if(index%2==1){val language=part.substringBefore('\n').take(40);val code=part.substringAfter('\n',part).trimEnd();val clipboard=LocalClipboardManager.current
                Surface(shape=RoundedCornerShape(12.dp),color=MaterialTheme.colorScheme.surfaceContainerLow,border=BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)){
                    Column(Modifier.fillMaxWidth()){
                        Row(Modifier.fillMaxWidth().padding(horizontal=14.dp),verticalAlignment=Alignment.CenterVertically){Text(language,fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.weight(1f));IconButton(onClick={clipboard.setText(AnnotatedString(code))},modifier=Modifier.size(32.dp)){Icon(Icons.Outlined.ContentCopy,"复制代码",Modifier.size(14.dp))}}
                        SelectionContainer{Text(code,Modifier.horizontalScroll(rememberScrollState()).padding(14.dp),fontFamily=FontFamily.Monospace,fontSize=13.sp,lineHeight=21.sp)}
                    }
                }
            }else if(part.isNotBlank())SelectionContainer{Column(verticalArrangement=Arrangement.spacedBy(6.dp)){part.trim().split('\n').forEach{line->val heading=line.startsWith("#");Text(inlineMarkdown(line.trimStart('#').trimStart()),fontWeight=if(heading)FontWeight.SemiBold else FontWeight.Normal,fontSize=if(heading)18.sp else 15.sp,lineHeight=25.sp)}}}
        }
    }
}

@Composable private fun inlineMarkdown(text:String):AnnotatedString {
    val codeBackground=MaterialTheme.colorScheme.surfaceContainerHighest
    return remember(text,codeBackground){buildAnnotatedString{
        val pattern=Regex("`([^`]+)`|\\*\\*([^*]+)\\*\\*")
        var cursor=0
        for(match in pattern.findAll(text)){
            append(text.substring(cursor,match.range.first))
            val code=match.groups[1]?.value
            if(code!=null)withStyle(SpanStyle(fontFamily=FontFamily.Monospace,background=codeBackground)){append(code)}
            else withStyle(SpanStyle(fontWeight=FontWeight.SemiBold)){append(match.groups[2]!!.value)}
            cursor=match.range.last+1
        }
        append(text.substring(cursor))
    }}
}
