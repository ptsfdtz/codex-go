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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext

@Composable internal fun ChatWorkspace(state:DeckState,repo:DeckRepository,onInterrupt:()->Unit){
    val keyboard=LocalSoftwareKeyboardController.current
    val focus=LocalFocusManager.current
    val session=state.snapshot.sessions.find{it.sessionId==state.selectedSession}
    val entries=remember(state.events){conversationEntries(state.events)}
    val approvals=state.snapshot.approvals.filter{it.sessionId==state.selectedSession&&it.status=="pending"}
    val active=session?.status in listOf("running","queued","waitingApproval","unknown")
    var showUpstreamHistory by remember(state.host?.hostId,state.selectedSession){mutableStateOf(false)}
    if(showUpstreamHistory&&session!=null)key(state.host?.hostId,session.sessionId){UpstreamHistoryDialog(repo,session.sessionId){showUpstreamHistory=false}}
    var drafts by rememberSaveable{mutableStateOf(mapOf<String,String>())}
    LaunchedEffect(state.hosts){if(state.hosts.isNotEmpty())drafts=drafts.filterKeys{key->state.hosts.any{key.startsWith("${it.hostId}:")}}}
    val draftKey="${state.host?.hostId}:"+(state.selectedSession?:"new:${state.selectedProject}")
    val text=drafts[draftKey].orEmpty()
    var modes by rememberSaveable{mutableStateOf(mapOf<String,String>())}
    val mode=modes[draftKey]?:session?.mode?:"default"
    var attachmentDrafts by remember{mutableStateOf(mapOf<String,List<ChatAttachment>>())}
    val attachments=attachmentDrafts[draftKey].orEmpty()
    val context=LocalContext.current
    val attachmentScope=rememberCoroutineScope()
    var pickingKey by remember{mutableStateOf("")}
    var readingAttachments by remember{mutableStateOf(false)}
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()){uris->
        val key=pickingKey
        if(uris.isNotEmpty())attachmentScope.launch{
            readingAttachments=true
            try{
                val existing=attachmentDrafts[key].orEmpty()
                val added=withContext(Dispatchers.IO){readChatAttachments(context,uris,existing)}
                attachmentDrafts=attachmentDrafts+(key to (existing+added))
            }catch(e:Exception){repo.showMessage(e.message?:"无法读取附件")}
            finally{readingAttachments=false}
        }
    }
    val list=rememberLazyListState()
    val scope=rememberCoroutineScope()
    var follow by remember(state.host?.hostId,state.selectedSession){mutableStateOf(true)}
    LaunchedEffect(list){snapshotFlow{list.isScrollInProgress to list.canScrollForward}.collect{(moving,away)->if(moving)follow=!away}}
    LaunchedEffect(state.host?.hostId,state.selectedSession,entries.lastOrNull(),approvals.size){if(follow){withFrameNanos{};if(list.layoutInfo.totalItemsCount>0)list.scrollToItem(list.layoutInfo.totalItemsCount-1)}}
    Column(Modifier.fillMaxSize()){
        if(session!=null)Row(Modifier.fillMaxWidth().padding(horizontal=24.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically){Text(session.title,fontSize=13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.weight(1f));if(session.archived==1)TextButton(onClick={repo.manageSession(session,"restore")},enabled=!state.stale&&!state.busy){Text("恢复会话")};if(state.capabilities?.supports("upstreamHistoryPages")==true)TextButton(onClick={showUpstreamHistory=true},enabled=!state.stale){Text("历史")};SessionActions(session,state,repo);if(state.busy)CircularProgressIndicator(Modifier.size(14.dp),strokeWidth=1.5.dp)}
        Box(Modifier.weight(1f).fillMaxWidth()){
            if(session==null)Column(Modifier.align(Alignment.Center).padding(32.dp).widthIn(max=640.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(14.dp)){
                Icon(Icons.Outlined.Code,null,Modifier.size(38.dp))
                Text("想在这个项目里做什么？",fontSize=28.sp,fontWeight=FontWeight.SemiBold)
                Text(if(state.selectedProject==null)"先在会话列表中授权一个项目，再开始对话。" else "描述你的目标，Codex 会在 Windows 工作区中开始处理。",fontSize=14.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,lineHeight=23.sp)
                if(state.selectedProject==null)OutlinedButton(onClick=repo::addProject,enabled=!state.stale){Text("在 Windows 选择项目")}
            }else LazyColumn(Modifier.fillMaxSize().testTag("execution-timeline"),state=list,contentPadding=PaddingValues(horizontal=24.dp,vertical=20.dp),verticalArrangement=Arrangement.spacedBy(24.dp)){
                item{Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.Center){TextButton(onClick=repo::olderEvents,enabled=!state.stale&&!state.busy){Text("加载更早的消息",fontSize=12.sp)}}}
                items(entries,key={"${state.host?.hostId}:${it.id}"}){entry->ChatWidth{ChatMessage(entry,state.displayMask)}}
                items(approvals,key={"${state.host?.hostId}:approval:"+it.approvalId}){approval->ChatWidth{if(approval.method=="item/tool/requestUserInput")QuestionCard(approval,state.stale||state.busy,repo::answerQuestions,{repo.decide(approval,"cancel")})else ApprovalCard(approval,state.stale||state.busy,repo::decide)}}
                item{ChatWidth{if(active&&approvals.isEmpty())Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)){if(!state.stale&&session.status!="unknown")CircularProgressIndicator(Modifier.size(13.dp),strokeWidth=1.5.dp);Text(if(state.stale)"连接恢复后核对任务状态" else statusLabel(session.status),fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}
            }
            if(!follow&&session!=null)FilledTonalIconButton(onClick={follow=true;scope.launch{list.animateScrollToItem((list.layoutInfo.totalItemsCount-1).coerceAtLeast(0))}},modifier=Modifier.align(Alignment.BottomCenter).padding(8.dp)){Icon(Icons.Outlined.ArrowDownward,"回到最新消息")}
        }
        ChatWidth{Column(Modifier.imePadding().padding(start=20.dp,end=20.dp,bottom=12.dp)){
            Surface(shape=RoundedCornerShape(20.dp),color=MaterialTheme.colorScheme.surfaceContainerHighest){
                Column(Modifier.padding(horizontal=8.dp,vertical=6.dp)){
                    if(attachments.isNotEmpty())Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)){
                        attachments.forEach{file->InputChip(selected=false,onClick={},label={Text(file.name,maxLines=1)},trailingIcon={IconButton(onClick={attachmentDrafts=attachmentDrafts+(draftKey to attachments.filterNot{it===file})},modifier=Modifier.size(22.dp),enabled=!state.busy){Icon(Icons.Outlined.Close,"移除附件",Modifier.size(14.dp))}})}
                    }
                    if(readingAttachments)Text("正在读取附件…",Modifier.padding(8.dp),fontSize=12.sp)
                    if(active&&attachments.isNotEmpty())Text("追加指令暂支持文字，请先移除附件",Modifier.padding(8.dp),fontSize=12.sp)
                    TextField(value=text,onValueChange={if(it.length<=64000)drafts=drafts+(draftKey to it)},placeholder={Text(if(session==null)"向 Codex 描述任务…" else if(active)"向当前任务追加指令…" else "发送消息，继续对话…",fontSize=15.sp)},modifier=Modifier.fillMaxWidth().heightIn(min=64.dp,max=180.dp).testTag("chat-input"),maxLines=7,colors=TextFieldDefaults.colors(focusedContainerColor=androidx.compose.ui.graphics.Color.Transparent,unfocusedContainerColor=androidx.compose.ui.graphics.Color.Transparent,focusedIndicatorColor=androidx.compose.ui.graphics.Color.Transparent,unfocusedIndicatorColor=androidx.compose.ui.graphics.Color.Transparent))
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                        var addOpen by remember{mutableStateOf(false)}
                        var permissionOpen by remember{mutableStateOf(false)}
                        val controlsEnabled=!active&&!state.busy&&!state.stale&&session?.archived!=1
                        Box{
                            IconButton(onClick={addOpen=true},modifier=Modifier.size(40.dp),enabled=!state.busy&&!active&&!state.stale&&!readingAttachments){Icon(Icons.Outlined.Add,"更多操作",Modifier.size(20.dp))}
                            DropdownMenu(expanded=addOpen,onDismissRequest={addOpen=false}){
                                DropdownMenuItem(text={Column{Text("上传文件或图片");Text("最多 4 个 · 总计 512 KB",style=MaterialTheme.typography.bodySmall)}},leadingIcon={Icon(Icons.Outlined.AttachFile,null)},onClick={addOpen=false;pickingKey=draftKey;picker.launch(arrayOf("*/*"))},enabled=attachments.size<4)
                                HorizontalDivider()
                                listOf("default" to "默认 · 直接执行","plan" to "Plan · 先制定计划","goal" to "Goal · 持续完成目标").forEach{(value,label)->
                                    DropdownMenuItem(text={Text(label)},trailingIcon={if(mode==value)Icon(Icons.Outlined.Check,null)},onClick={addOpen=false;modes=modes+(draftKey to value)})
                                }
                                HorizontalDivider()
                                DropdownMenuItem(text={Text("新对话")},onClick={addOpen=false;state.selectedProject?.let(repo::selectProject)},enabled=state.selectedProject!=null)
                                DropdownMenuItem(text={Text("在 Windows 授权项目")},onClick={addOpen=false;repo.addProject()},enabled=!state.stale)
                            }
                        }
                        TextButton(onClick={addOpen=true},enabled=controlsEnabled,contentPadding=PaddingValues(horizontal=4.dp)){Text(when(mode){"plan"->"Plan";"goal"->"Goal";else->"默认"},fontSize=12.sp);Icon(Icons.Outlined.ExpandMore,null,Modifier.size(14.dp))}
                        Box{
                            TextButton(onClick={permissionOpen=true},enabled=controlsEnabled,contentPadding=PaddingValues(horizontal=4.dp)){
                                val tint=if(state.fullAccess)Color(0xFFFF914D) else MaterialTheme.colorScheme.onSurfaceVariant
                                Icon(if(state.fullAccess)Icons.Outlined.Shield else Icons.Outlined.Security,null,Modifier.size(15.dp),tint=tint)
                                Spacer(Modifier.width(5.dp));Text(if(state.fullAccess)"全部权限" else "工作区审批",fontSize=12.sp,color=tint)
                            }
                            DropdownMenu(expanded=permissionOpen,onDismissRequest={permissionOpen=false}){
                                DropdownMenuItem(text={Text("全部权限 · 无需审批")},onClick={permissionOpen=false;repo.setFullAccess(true)})
                                DropdownMenuItem(text={Text("工作区 · 按需审批")},onClick={permissionOpen=false;repo.setFullAccess(false)})
                            }
                        }
                        Spacer(Modifier.weight(1f))
                        Box(Modifier.weight(1f).widthIn(max=420.dp),contentAlignment=Alignment.CenterEnd){
                            CodexModelPicker(state,repo,enabled=controlsEnabled)
                        }
                        if(active)FilledIconButton(onClick=onInterrupt,enabled=!state.stale&&!state.busy,modifier=Modifier.size(36.dp)){Icon(Icons.Outlined.Stop,"中断任务",Modifier.size(18.dp))}
                        if(!active||state.capabilities?.supports("activeTurnSteering")==true)FilledIconButton(onClick={keyboard?.hide();focus.clearFocus();val sent=text;val key=draftKey;val sentFiles=attachments;val accepted={val target="${state.host?.hostId}:"+repo.state.value.selectedSession;modes=modes+(target to mode);if(drafts[key]==sent)drafts=drafts-key;if(attachmentDrafts[key]==sentFiles)attachmentDrafts=attachmentDrafts-key;Unit};val prompt=sent.ifBlank{"请查看上传的附件。"};if(active)repo.steerTask(prompt,accepted)else if(session==null)repo.newTask(prompt,mode,sentFiles,accepted)else repo.continueTask(prompt,mode,sentFiles,accepted)},enabled=(if(active)text.isNotBlank()&&attachments.isEmpty() else text.isNotBlank()||attachments.isNotEmpty())&&!readingAttachments&&!state.stale&&!state.busy&&state.selectedProject!=null&&session?.archived!=1,modifier=Modifier.size(36.dp)){Icon(Icons.Outlined.ArrowUpward,if(active)"追加指令" else "发送消息",Modifier.size(20.dp))}
                    }
                }
            }
            if(state.stale)Text("离线 · 草稿已保留，连接恢复后可发送",modifier=Modifier.align(Alignment.CenterHorizontally).padding(top=8.dp),fontSize=10.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
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
            MarkdownText(text)
            if(entry.truncated)Text("消息预览已截断，请在 Windows 核对完整内容。",fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            IconButton(onClick={clipboard.setText(AnnotatedString(text))},modifier=Modifier.size(30.dp)){Icon(Icons.Outlined.ContentCopy,"复制回复",Modifier.size(15.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)}
        }
        "tool"->{var expanded by rememberSaveable(entry.id){mutableStateOf(false)}
            Surface(shape=RoundedCornerShape(10.dp),border=BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)){
                Column(Modifier.fillMaxWidth()){
                    Row(Modifier.fillMaxWidth().clickable{expanded=!expanded}.padding(12.dp),verticalAlignment=Alignment.CenterVertically){Icon(if(entry.title=="修改文件")Icons.Outlined.Difference else Icons.Outlined.Terminal,null,Modifier.size(16.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant);Spacer(Modifier.width(10.dp));Text(maskDisplay(entry.title,mask),maxLines=1,overflow=TextOverflow.Ellipsis,fontFamily=FontFamily.Monospace,fontSize=12.sp,modifier=Modifier.weight(1f));Spacer(Modifier.width(8.dp));Text(statusLabel(entry.status),fontSize=10.sp,color=MaterialTheme.colorScheme.onSurfaceVariant);Icon(if(expanded)Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,"展开执行详情",Modifier.size(18.dp))}
                    if(expanded){HorizontalDivider();val detail=if(entry.status=="failed")userFacingError(raw=entry.text.ifBlank{entry.detail}) else entry.title+"\n"+entry.text+"\n"+entry.detail;SelectionContainer{Text(maskDisplay(detail,mask).take(24000),Modifier.padding(14.dp),fontFamily=FontFamily.Monospace,fontSize=12.sp,lineHeight=19.sp)};if(entry.status!="failed"&&entry.text.length+entry.detail.length>24000)Text("输出预览已截断",Modifier.padding(12.dp),fontSize=11.sp)}
                }
            }
        }
        else->Column{Text(if(entry.status=="failed")userFacingError(raw=entry.detail) else text,fontSize=12.sp,color=if(entry.status=="failed")MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant);if(entry.detail.isNotBlank()&&entry.status!="failed")SelectionContainer{Text(maskDisplay(entry.detail,mask),fontSize=12.sp)}}
    }
}
