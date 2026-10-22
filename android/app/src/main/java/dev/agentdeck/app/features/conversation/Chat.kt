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
import androidx.compose.ui.input.key.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext

@Composable internal fun ChatWorkspace(state:DeckState,repo:DeckRepository,onInterrupt:()->Unit,requestedAction:String?=null,onActionConsumed:()->Unit={}){
    val keyboard=LocalSoftwareKeyboardController.current
    val focus=LocalFocusManager.current
    val session=state.snapshot.sessions.find{it.sessionId==state.selectedSession}
    val history=state.timelineHistory.takeIf{it.sessionId==state.selectedSession}
    val entries=remember(state.events,history?.entries,state.snapshot.turns,state.selectedSession){state.selectedSession?.let{conversationTimeline(it,state.events,history?.entries.orEmpty(),state.snapshot.turns)}?:emptyList()}
    val approvals=state.snapshot.approvals.filter{it.sessionId==state.selectedSession&&it.status=="pending"}
    val active=session?.status in listOf("running","queued","waitingApproval","unknown")
    var showUpstreamHistory by remember(state.host?.hostId,state.selectedSession){mutableStateOf(false)}
    if(showUpstreamHistory&&session!=null)key(state.host?.hostId,session.sessionId){UpstreamHistoryDialog(repo,session.sessionId){showUpstreamHistory=false}}
    var showCompaction by remember(state.host?.hostId,state.selectedSession){mutableStateOf(false)}
    if(showCompaction&&session!=null)key(state.host?.hostId,session.sessionId){SessionCompactionDialog(session,state,repo){showCompaction=false}}
    var showQueue by remember(state.host?.hostId,state.selectedSession){mutableStateOf(false)}
    if(showQueue&&session!=null)key(state.host?.hostId,session.sessionId){NativeQueueDialog(repo,session.sessionId){showQueue=false}}
    var revisionIntent by remember(state.host?.hostId,state.selectedSession){mutableStateOf<HistoryRevision?>(null)}
    val draftKey=ComposerKey(state.host?.hostId.orEmpty(),state.selectedSession?:"new:${state.selectedProject}")
    val drafts=repo.composerDrafts
    val draft=drafts[draftKey]
    val text=draft.text
    val mode=draft.mode?:session?.mode?:"default"
    val skills=draft.skills
    var choosingSkill by remember(draftKey){mutableStateOf(false)}
    var browsingFiles by remember(draftKey){mutableStateOf(false)}
    val attachments=draft.attachments
    val readingAttachments=draft.reading
    revisionIntent?.let{intent->HistoryRevisionDialog(intent,state,{revisionIntent=null},onKeepDraft={replacement->
        val old=drafts[draftKey]
        val recovered=if(old.text.isBlank())replacement else old.text+"\n\n"+replacement
        if(recovered.length<=64000){drafts.edit(draftKey){it.copy(text=recovered)};revisionIntent=null}
        else repo.showMessage("现有草稿与消息合计超过 64000 字符，请先处理现有草稿；恢复文字仍保留在此窗口。")
    },onRefresh=repo::refresh,onConfirm={replacement,progress->session?.let{repo.reviseTurn(it,intent.beforeTurn,intent.expectedLastTurn,replacement,intent.itemId,progress){revisionIntent=null}}})}
    var inspectingAttachment by remember(draftKey){mutableStateOf<ChatAttachment?>(null)}
    val context=LocalContext.current
    var pickingHost by rememberSaveable{mutableStateOf("")}
    var pickingConversation by rememberSaveable{mutableStateOf("")}
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()){uris->
        if(pickingHost.isNotEmpty()&&state.hosts.any{it.hostId==pickingHost})drafts.read(context,ComposerKey(pickingHost,pickingConversation),uris,repo::showMessage)
        pickingHost="";pickingConversation=""
    }
    val canSubmit=(if(active)text.isNotBlank()&&attachments.isEmpty()&&skills.isEmpty()&&state.capabilities?.supports("activeTurnSteering")==true else text.isNotBlank()||attachments.isNotEmpty()||skills.isNotEmpty())&&!readingAttachments&&!state.stale&&!state.busy&&state.selectedProject!=null&&session?.archived!=1
    val submit:()->Unit={keyboard?.hide();focus.clearFocus();val sent=text;val key=draftKey;val sentFiles=attachments;val accepted={val target=ComposerKey(key.hostId,repo.state.value.selectedSession?:key.conversation);drafts.accepted(key,draft.copy(mode=mode),target);Unit};val prompt=sent.ifBlank{if(skills.isNotEmpty())"请使用所选技能完成任务。" else "请查看上传的附件。"};if(active)repo.steerTask(prompt,accepted)else if(session==null)repo.newTask(prompt,mode,sentFiles,accepted,skills)else repo.continueTask(prompt,mode,sentFiles,accepted,skills)}
    val canQueue=active&&state.capabilities?.supports("nativeQueue")==true&&(skills.isEmpty()||state.capabilities?.supports("nativeQueueSkills")==true)&&(text.isNotBlank()||attachments.isNotEmpty()||skills.isNotEmpty())&&(attachments.isEmpty()||state.capabilities?.supports("nativeQueueAttachments")==true)&&!readingAttachments&&!state.stale&&!state.busy&&session?.archived!=1
    val enqueue:()->Unit={val captured=draft;repo.enqueueTask(text.ifBlank{if(skills.isNotEmpty())"请使用所选技能完成任务。" else "请查看上传的附件。"},attachments,skills){drafts.accepted(draftKey,captured,draftKey)}}
    var expandedComposer by remember(draftKey){mutableStateOf(false)}
    var forkBoundary by remember(state.host?.hostId,state.selectedSession){mutableStateOf<String?>(null)}
    forkBoundary?.let{turn->AlertDialog(onDismissRequest={forkBoundary=null},title={Text("从这轮回复分叉？")},text={Text("保留截至这轮的已保存对话，后续轮次不进入新会话。原会话保持不变。")},confirmButton={TextButton(onClick={session?.let{repo.forkSession(it,turn)};forkBoundary=null},enabled=!state.stale&&!state.busy&&!active){Text("分叉到新会话")}},dismissButton={TextButton(onClick={forkBoundary=null}){Text("取消")}})}
    var showFind by rememberSaveable(state.host?.hostId,state.selectedSession){mutableStateOf(false)}
    var manageOpen by remember(state.host?.hostId,state.selectedSession){mutableStateOf(false)}
    LaunchedEffect(requestedAction){
        when(requestedAction){"find"->showFind=true;"history"->showUpstreamHistory=true;"queue"->showQueue=true;"manage"->manageOpen=true}
        if(requestedAction!=null)onActionConsumed()
    }
    if(session!=null)SessionActions(session,state,repo,showButton=false,requestMenu=manageOpen,onMenuConsumed={manageOpen=false})
    var findQuery by rememberSaveable(state.host?.hostId,state.selectedSession){mutableStateOf("")}
    var searchHistory by remember(state.host?.hostId,state.selectedSession){mutableStateOf(false)}
    if(searchHistory&&session!=null)key(state.host?.hostId,session.sessionId){HistorySearch(repo,session.sessionId,findQuery){searchHistory=false}}
    var foundId by rememberSaveable(state.host?.hostId,state.selectedSession){mutableStateOf<String?>(null)}
    val matches=remember(entries,findQuery,state.displayMask){if(findQuery.isBlank())emptyList() else entries.filter{maskDisplay(it.text,state.displayMask).contains(findQuery,true)||maskDisplay(it.title,state.displayMask).contains(findQuery,true)}.map{it.id}}
    LaunchedEffect(matches){if(foundId !in matches)foundId=matches.firstOrNull()}
    val savedViewport=remember(draftKey){repo.conversationViewports[draftKey]}
    val list=remember(draftKey){LazyListState()}
    val scope=rememberCoroutineScope()
    var follow by remember(draftKey){mutableStateOf(savedViewport?.follow?:true)}
    var restored by remember(draftKey){mutableStateOf(false)}
    var missingViewport by remember(draftKey){mutableStateOf(false)}
    val historyHeaderCount=if(state.capabilities?.supports("upstreamHistoryOrdering")==true)(if(history?.loading==true)1 else 0)+(if(history?.error!=null)1 else 0)+(if(history?.nextCursor!=null)1 else 0) else 1
    val currentEntries by key(draftKey){rememberUpdatedState(entries)}
    val currentFollow by key(draftKey){rememberUpdatedState(follow)}
    val currentRestored by key(draftKey){rememberUpdatedState(restored)}
    fun saveViewport(){
        if(currentRestored&&currentEntries.isNotEmpty()){
            val index=list.firstVisibleItemIndex
            val visibleKey=list.layoutInfo.visibleItemsInfo.firstOrNull()?.key
            val anchor=currentEntries.firstOrNull{"${draftKey.hostId}:${it.id}"==visibleKey}?.id
            repo.conversationViewports.save(draftKey,ConversationViewport(anchor,index,list.firstVisibleItemScrollOffset,currentFollow))
        }
    }
    DisposableEffect(draftKey){onDispose{saveViewport()}}
    LaunchedEffect(list){snapshotFlow{Triple(list.firstVisibleItemIndex,list.firstVisibleItemScrollOffset,list.isScrollInProgress)}.collect{(_,_,moving)->
        if(restored){if(moving)follow=!list.canScrollForward else if(!list.canScrollForward)follow=true;saveViewport()}
    }}
    LaunchedEffect(draftKey,entries,history?.loading){
        if(!restored&&entries.isNotEmpty()){
            withFrameNanos{}
            if(savedViewport!=null&&!savedViewport.follow){
                val anchor=entries.indexOfFirst{it.id==savedViewport.anchor}
                missingViewport=savedViewport.anchor!=null&&anchor<0
                val target=if(anchor>=0)anchor+historyHeaderCount else savedViewport.index.coerceIn(0,(list.layoutInfo.totalItemsCount-1).coerceAtLeast(0))
                list.scrollToItem(target,savedViewport.offset)
            }else if(list.layoutInfo.totalItemsCount>0)list.scrollToItem(list.layoutInfo.totalItemsCount-1)
            restored=true
        }
    }
    LaunchedEffect(draftKey,entries.lastOrNull(),approvals.size,showFind,restored){if(restored&&follow&&!showFind){withFrameNanos{};if(list.layoutInfo.totalItemsCount>0)list.scrollToItem(list.layoutInfo.totalItemsCount-1)}}
    val foundIndex=entries.indexOfFirst{it.id==foundId}
    LaunchedEffect(foundIndex,showFind,historyHeaderCount){if(showFind&&foundIndex>=0){follow=false;list.animateScrollToItem(foundIndex+historyHeaderCount)}}
    fun moveMatch(delta:Int){if(matches.isNotEmpty()){val current=matches.indexOf(foundId).coerceAtLeast(0);foundId=matches[(current+delta+matches.size)%matches.size]}}
    var commandDismissed by remember(draftKey){mutableStateOf<String?>(null)}
    var commandIndex by remember(draftKey){mutableIntStateOf(0)}
    val commandReady=!state.stale&&!state.busy&&session?.archived!=1&&state.selectedProject!=null
    val commands=buildList{
        add(ComposerCommand("plan","计划模式","下一次发送先制定计划",commandReady&&!active){drafts.edit(draftKey){it.copy(mode="plan")}})
        add(ComposerCommand("default","默认模式","下一次发送直接处理任务",commandReady&&!active){drafts.edit(draftKey){it.copy(mode="default")}})
        add(ComposerCommand("goal","持续目标","下一次发送持续推进目标",commandReady&&!active){drafts.edit(draftKey){it.copy(mode="goal")}})
        if(state.capabilities?.supports("composerSkills")==true)add(ComposerCommand("skills","选择技能","添加已启用的电脑技能",commandReady&&skills.size<8&&(!active||state.capabilities?.supports("nativeQueueSkills")==true)){choosingSkill=true})
        if(state.capabilities?.supports("projectFileBrowser")==true)add(ComposerCommand("mention","引用文件","浏览授权项目并加入文件链接",commandReady){browsingFiles=true})
        if(session!=null&&state.capabilities?.supports("nativeQueue")==true)add(ComposerCommand("queue","待发送消息","查看电脑上的原生消息队列",!state.stale){showQueue=true})
        if(session!=null&&state.capabilities?.supports("upstreamHistoryPages")==true)add(ComposerCommand("history","会话历史","读取完整原生历史",!state.stale){showUpstreamHistory=true})
        if(session!=null&&state.capabilities?.supports("sessionCompaction")==true)add(ComposerCommand("compact","压缩上下文","核对原会话后确认压缩，不自动发送草稿",commandReady&&!active){showCompaction=true})
        add(ComposerCommand("new","新对话","当前会话的附件和技能草稿仍保留",state.selectedProject!=null&&!state.busy){state.selectedProject?.let(repo::selectProject)})
    }
    val commandMatches=if(commandDismissed==text)emptyList()else matchingComposerCommands(text,commands)
    LaunchedEffect(text,draftKey){commandIndex=0;if(commandDismissed!=text)commandDismissed=null}
    fun chooseCommand(command:ComposerCommand){
        if(!command.enabled)return
        val captured=text
        drafts.edit(draftKey){if(it.text==captured)it.copy(text="")else it}
        commandDismissed=null;commandIndex=0;command.action()
    }
    val composerResources:@Composable ()->Unit={
                    if(attachments.isNotEmpty())Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)){
                        attachments.forEach{file->InputChip(selected=false,onClick={inspectingAttachment=file},label={Text(maskDisplay(file.name,state.displayMask),maxLines=1)},trailingIcon={IconButton(onClick={drafts.edit(draftKey){it.copy(attachments=it.attachments.filterNot{item->item===file})}},modifier=Modifier.size(22.dp),enabled=!state.busy){Icon(Icons.Outlined.Close,"移除附件",Modifier.size(14.dp))}})}
                    }
                    if(skills.isNotEmpty())Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())){skills.forEach{skill->InputChip(selected=false,onClick={choosingSkill=true},label={Text("技能 · "+maskDisplay(skill.name,state.displayMask))},trailingIcon={IconButton(onClick={drafts.edit(draftKey){it.copy(skills=it.skills.filterNot{item->item.id==skill.id})}},enabled=!state.busy){Icon(Icons.Outlined.Close,"移除技能")}})}}
                    if(active&&skills.isNotEmpty())Text("技能可加入待发送队列；即时追加仅支持文字。技能仍保留在当前草稿中。",Modifier.padding(8.dp),fontSize=12.sp)
                    if(readingAttachments)Text("正在读取附件…",Modifier.padding(8.dp),fontSize=12.sp)
                    if(active&&state.capabilities?.supports("nativeQueue")==true)Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){TextButton(onClick=enqueue,enabled=canQueue){Icon(Icons.Outlined.PlaylistAdd,null,Modifier.size(16.dp));Spacer(Modifier.width(6.dp));Text("加入待发送队列")}}
                    if(active&&attachments.isNotEmpty())Text("附件可加入待发送队列；即时追加指令仅支持文字。队列使用工作区审批，不携带当前模式、模型或完全访问设置。",Modifier.padding(8.dp),fontSize=12.sp)
    }
    val composerControls:@Composable ()->Unit={
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                        var addOpen by remember{mutableStateOf(false)}
                        var permissionOpen by remember{mutableStateOf(false)}
                        val controlsEnabled=!active&&!state.busy&&!state.stale&&session?.archived!=1
                        Box{
                            IconButton(onClick={addOpen=true},modifier=Modifier.size(48.dp),enabled=!readingAttachments){Icon(Icons.Outlined.Add,"添加附件与工具",Modifier.size(24.dp))}
                            DropdownMenu(expanded=addOpen,onDismissRequest={addOpen=false}){
                                DropdownMenuItem(text={Column{Text("上传文件或图片");Text("最多 4 个 · 总计 512 KB",style=MaterialTheme.typography.bodySmall)}},leadingIcon={Icon(Icons.Outlined.AttachFile,null)},onClick={addOpen=false;pickingHost=draftKey.hostId;pickingConversation=draftKey.conversation;picker.launch(arrayOf("*/*"))},enabled=attachments.size<4&&!state.busy&&!state.stale&&(!active||state.capabilities?.supports("nativeQueueAttachments")==true))
                                if(state.capabilities?.supports("composerSkills")==true)DropdownMenuItem(text={Text("选择技能")},onClick={addOpen=false;choosingSkill=true},enabled=!state.busy&&!state.stale&&session?.archived!=1&&(!active||state.capabilities?.supports("nativeQueueSkills")==true)&&state.selectedProject!=null&&skills.size<8)
                                if(state.capabilities?.supports("projectFileBrowser")==true)DropdownMenuItem(text={Text("浏览项目文件")},onClick={addOpen=false;browsingFiles=true},enabled=state.selectedProject!=null&&!state.stale)
                                HorizontalDivider()
                                listOf("default" to "默认 · 直接执行","plan" to "Plan · 先制定计划","goal" to "Goal · 持续完成目标").forEach{(value,label)->
                                    DropdownMenuItem(text={Text(label)},trailingIcon={if(mode==value)Icon(Icons.Outlined.Check,null)},enabled=controlsEnabled,onClick={addOpen=false;drafts.edit(draftKey){it.copy(mode=value)}})
                                }
                                HorizontalDivider()
                                DropdownMenuItem(text={Text("展开编辑任务内容")},onClick={addOpen=false;expandedComposer=true})
                                DropdownMenuItem(text={Text("新对话")},onClick={addOpen=false;state.selectedProject?.let(repo::selectProject)},enabled=state.selectedProject!=null)
                                DropdownMenuItem(text={Text("在 Windows 授权项目")},onClick={addOpen=false;repo.addProject()},enabled=!state.stale)
                            }
                        }
                        if(mode!="default")TextButton(onClick={addOpen=true},enabled=controlsEnabled,contentPadding=PaddingValues(horizontal=4.dp)){Text(if(mode=="plan")"Plan" else "Goal",fontSize=12.sp)}
                        Box{
                            IconButton(onClick={permissionOpen=true},enabled=controlsEnabled,modifier=Modifier.size(48.dp)){
                                Icon(if(state.fullAccess)Icons.Outlined.Shield else Icons.Outlined.Security,if(state.fullAccess)"全部权限 · 无需审批" else "工作区 · 按需审批",Modifier.size(20.dp),tint=if(state.fullAccess)Color(0xFFFF914D) else MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            DropdownMenu(expanded=permissionOpen,onDismissRequest={permissionOpen=false}){
                                DropdownMenuItem(text={Text("全部权限 · 无需审批")},onClick={permissionOpen=false;repo.setFullAccess(true)})
                                DropdownMenuItem(text={Text("工作区 · 按需审批")},onClick={permissionOpen=false;repo.setFullAccess(false)})
                            }
                        }
                        Spacer(Modifier.weight(1f))
                        if(active)FilledIconButton(onClick=onInterrupt,enabled=!state.stale&&!state.busy,modifier=Modifier.size(48.dp).padding(4.dp)){Icon(Icons.Outlined.Stop,"中断任务",Modifier.size(18.dp))}
                        if(!active||state.capabilities?.supports("activeTurnSteering")==true)FilledIconButton(onClick=submit,enabled=canSubmit,modifier=Modifier.size(48.dp).padding(4.dp)){Icon(Icons.Outlined.ArrowUpward,if(active)"追加指令" else "发送消息",Modifier.size(20.dp))}
                    }
    }
    if(expandedComposer)key(draftKey){ExpandedComposer(draft,maskDisplay(session?.title?:"新任务",state.displayMask),active,state.stale,state.busy,session?.archived==1,canSubmit,{value->drafts.edit(draftKey){it.copy(text=value)}},submit,composerResources,composerControls){expandedComposer=false}}
    if(browsingFiles&&state.selectedProject!=null)key(draftKey){ProjectFiles(repo,state,state.selectedProject,onReference={reference->
        val old=drafts[draftKey]
        val updated=old.text+(if(old.text.isBlank()||old.text.endsWith("\n"))"" else "\n")+reference+" "
        if(updated.length>64000){repo.showMessage("加入引用后草稿超过 64000 字符，请先缩短内容。");false}
        else{drafts.edit(draftKey){it.copy(text=updated)};true}
    }){browsingFiles=false}}
    if(choosingSkill&&state.selectedProject!=null)key(draftKey){SkillPicker(repo,state,state.selectedProject,skills,onSelect={skill->drafts.edit(draftKey){it.copy(skills=if(it.skills.any{value->value.id==skill.id})it.skills.filterNot{value->value.id==skill.id}else (it.skills+skill).take(8))}},onDismiss={choosingSkill=false})}
    inspectingAttachment?.let{file->ComposerAttachmentPreview(file,state.displayMask,state.busy,onRemove={drafts.edit(draftKey){it.copy(attachments=it.attachments.filterNot{item->item===file})};inspectingAttachment=null},onClose={inspectingAttachment=null})}
    Column(Modifier.fillMaxSize().onPreviewKeyEvent{event->
        if(event.type==KeyEventType.KeyDown&&event.isCtrlPressed&&event.key==Key.F&&session!=null){showFind=true;true}
        else if(event.type==KeyEventType.KeyDown&&event.key==Key.Escape&&showFind){showFind=false;true}else false
    }){
        if(missingViewport&&session!=null)Row(Modifier.fillMaxWidth().padding(start=24.dp,end=12.dp),verticalAlignment=Alignment.CenterVertically){
            Text("上次阅读位置不在已加载范围，可加载更早消息或打开历史。",Modifier.weight(1f),fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            IconButton(onClick={missingViewport=false}){Icon(Icons.Outlined.Close,"关闭阅读位置提示",Modifier.size(16.dp))}
        }
        if(showFind&&session!=null)ConversationFindBar(findQuery,{findQuery=it},matches.indexOf(foundId)+1,matches.size,{moveMatch(-1)},{moveMatch(1)},{showFind=false})
        if(showFind&&session!=null&&state.capabilities?.supports("upstreamHistoryPages")==true)TextButton(onClick={searchHistory=true},enabled=!state.stale){Text("搜索更早的已保存历史")}
        if(session!=null&&state.observationPendingSession==session.sessionId&&!state.stale)Text("当前可查看历史，电脑恢复此会话后将同步实时消息",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(horizontal=24.dp,vertical=4.dp))
        Box(Modifier.weight(1f).fillMaxWidth()){
            if(session==null)Column(Modifier.align(Alignment.Center).padding(32.dp).widthIn(max=640.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(14.dp)){
                Text("有什么可以帮忙的？",fontSize=28.sp,fontWeight=FontWeight.SemiBold)
                Text(if(state.selectedProject==null)"先在会话列表中授权一个项目，再开始对话。" else maskDisplay(state.snapshot.projects.find{it.projectId==state.selectedProject}?.name.orEmpty(),state.displayMask),fontSize=14.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,lineHeight=23.sp)
                if(state.selectedProject==null)OutlinedButton(onClick=repo::addProject,enabled=!state.stale){Text("在 Windows 选择项目")}
            }else LazyColumn(Modifier.fillMaxSize().testTag("execution-timeline"),state=list,contentPadding=PaddingValues(horizontal=20.dp,vertical=20.dp),verticalArrangement=Arrangement.spacedBy(24.dp)){
                if(state.capabilities?.supports("upstreamHistoryOrdering")==true){
                    if(history?.loading==true)item{LinearProgressIndicator(Modifier.fillMaxWidth())}
                    history?.error?.let{message->item{Text(message,color=MaterialTheme.colorScheme.error);TextButton(onClick=repo::refresh,enabled=!state.stale){Text("重新读取会话")}}}
                    if(history?.nextCursor!=null)item{Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.Center){TextButton(onClick=repo::olderHistory,enabled=!state.stale&&history.loading!=true){Text("加载更早的消息",fontSize=12.sp)}}}
                }else item{Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.Center){TextButton(onClick=repo::olderEvents,enabled=!state.stale&&!state.busy){Text("加载更早的消息",fontSize=12.sp)}}}
                items(entries,key={"${state.host?.hostId}:${it.id}"}){entry->ChatWidth{Column(if(showFind&&foundId==entry.id)Modifier.border(1.dp,MaterialTheme.colorScheme.primary,RoundedCornerShape(8.dp)).padding(8.dp) else Modifier){
                    NativeMessage(entry,state.displayMask,repo,session.sessionId)
                    if(state.capabilities?.supports("sessionHistoryRevert")==true&&entry.sourceTurn!=null&&entry.kind in listOf("user","assistant")){
                        val users=entries.filter{it.kind=="user"&&it.sourceTurn==entry.sourceTurn}
                        val sourceEntry=users.singleOrNull()
                        val resourceRevision=state.capabilities?.supports("sessionResourceRevision")==true
                        val source=sourceEntry?.let{revisableUserText(it,resourceRevision,resourceRevision&&state.capabilities?.supports("sessionSkillRevision")==true)}
                        val skillCount=sourceEntry?.detail?.let{runCatching{wire.parseToJsonElement(it).jsonObject["content"]?.jsonArray?.count{part->part.jsonObject["type"]?.jsonPrimitive?.contentOrNull=="skill"}?:0}.getOrDefault(0)}?:0
                        val imageCount=sourceEntry?.detail?.let{runCatching{wire.parseToJsonElement(it).jsonObject["content"]?.jsonArray?.count{part->part.jsonObject["type"]?.jsonPrimitive?.contentOrNull=="localImage"}?:0}.getOrDefault(0)}?:0
                        val expected=entries.lastOrNull{it.sourceTurn!=null}?.sourceTurn
                        if(source!=null&&expected!=null)TextButton(onClick={repo.clearError();revisionIntent=HistoryRevision(entry.sourceTurn,expected,source,entry.kind=="assistant",if(resourceRevision)sourceEntry?.sourceItem else null,imageCount,skillCount)},enabled=!state.stale&&!state.busy&&!active&&session.archived!=1){Text(if(entry.kind=="user")"编辑并重新发送" else "重试这一轮",fontSize=12.sp)}
                    }
                    if(entry.kind=="assistant"&&entry.sourceTurn!=null&&state.capabilities?.supports("sessionForkAtTurn")==true)TextButton(onClick={forkBoundary=entry.sourceTurn},enabled=!state.stale&&!state.busy&&!active){Icon(Icons.Outlined.CallSplit,null,Modifier.size(15.dp));Spacer(Modifier.width(6.dp));Text("从这里分叉",fontSize=12.sp)}
                }}}
                items(approvals,key={"${state.host?.hostId}:approval:"+it.approvalId}){approval->ChatWidth{if(approval.method=="item/tool/requestUserInput")QuestionCard(approval,state.stale||state.busy,repo::answerQuestions,{repo.decide(approval,"cancel")},state.displayMask)else ApprovalCard(approval,state.stale||state.busy,repo::decide,state.displayMask)}}
                item{ChatWidth{if(active&&approvals.isEmpty())Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)){if(!state.stale&&session.status!="unknown")CircularProgressIndicator(Modifier.size(13.dp),strokeWidth=1.5.dp);Text(if(state.stale)"连接恢复后核对任务状态" else statusLabel(session.status),fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}
            }
            if(!follow&&session!=null)FilledTonalIconButton(onClick={follow=true;scope.launch{list.animateScrollToItem((list.layoutInfo.totalItemsCount-1).coerceAtLeast(0))}},modifier=Modifier.align(Alignment.BottomCenter).padding(8.dp)){Icon(Icons.Outlined.ArrowDownward,"回到最新消息")}
        }
        ChatWidth{Column(Modifier.imePadding().padding(start=12.dp,end=12.dp,bottom=8.dp)){
            if(commandMatches.isNotEmpty())ComposerCommandSuggestions(commandMatches,commandIndex.coerceIn(commandMatches.indices),::chooseCommand,{commandDismissed=text})
            Surface(shape=RoundedCornerShape(28.dp),color=MaterialTheme.colorScheme.surfaceContainer){
                Column(Modifier.padding(horizontal=8.dp,vertical=6.dp)){
                    composerResources()
                    TextField(value=text,onValueChange={if(it.length<=64000)drafts.edit(draftKey){old->old.copy(text=it)}},placeholder={Text(if(session==null)"向 Codex 描述任务…" else if(active)"向当前任务追加指令…" else "发送消息…",fontSize=16.sp)},modifier=Modifier.fillMaxWidth().heightIn(min=56.dp,max=180.dp).testTag("chat-input").onPreviewKeyEvent{event->if(event.type!=KeyEventType.KeyDown)false
                        else if(commandMatches.isNotEmpty()&&!event.isCtrlPressed&&!event.isAltPressed&&!event.isShiftPressed)when(event.key){
                            Key.DirectionDown->{commandIndex=(commandIndex+1)%commandMatches.size;true}
                            Key.DirectionUp->{commandIndex=(commandIndex-1+commandMatches.size)%commandMatches.size;true}
                            Key.Enter,Key.Tab->{chooseCommand(commandMatches[commandIndex.coerceIn(commandMatches.indices)]);true}
                            Key.Escape->{commandDismissed=text;true}
                            else->false
                        }
                        else if(event.key==Key.Enter&&event.isCtrlPressed){if(canSubmit)submit();true}else false},maxLines=7,colors=TextFieldDefaults.colors(focusedContainerColor=androidx.compose.ui.graphics.Color.Transparent,unfocusedContainerColor=androidx.compose.ui.graphics.Color.Transparent,focusedIndicatorColor=androidx.compose.ui.graphics.Color.Transparent,unfocusedIndicatorColor=androidx.compose.ui.graphics.Color.Transparent))
                    composerControls()
                }
            }
            if(state.stale)Text("离线 · 草稿已保留，连接恢复后可发送",modifier=Modifier.align(Alignment.CenterHorizontally).padding(top=8.dp),fontSize=10.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }}
    }
}
@Composable private fun ChatWidth(content:@Composable ()->Unit){Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.TopCenter){Column(Modifier.widthIn(max=840.dp).fillMaxWidth()){content()}}}

@Composable internal fun ChatMessage(entry:ChatEntry,mask:String){
    val text=maskDisplay(entry.text,mask)
    when(entry.kind){
        "user"->BoxWithConstraints(Modifier.fillMaxWidth()){val bubbleWidth=minOf(640.dp,maxWidth*0.85f);Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){Surface(Modifier.widthIn(max=bubbleWidth),shape=RoundedCornerShape(24.dp),color=MaterialTheme.colorScheme.surfaceContainerHighest){SelectionContainer{Text(text,Modifier.padding(horizontal=18.dp,vertical=14.dp),fontSize=16.sp,lineHeight=25.sp)}}}}
        "assistant","plan"->Column{
            if(entry.kind=="plan")Text("计划",fontSize=12.sp,fontWeight=FontWeight.Medium,color=MaterialTheme.colorScheme.onSurfaceVariant)
            MarkdownText(text)
            if(entry.truncated)Text("消息预览已截断，可通过会话上方的历史查看完整记录。",fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        "tool"->{var expanded by rememberSaveable(entry.id){mutableStateOf(false)}
            var fullOutput by remember(entry.id){mutableStateOf(false)}
            if(fullOutput)MessageReader(entry,mask,title=entry.title.ifBlank{"工具输出"},allowRaw=true){fullOutput=false}
            Surface(shape=RoundedCornerShape(10.dp),border=BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)){
                Column(Modifier.fillMaxWidth()){
                    Row(Modifier.fillMaxWidth().clickable{expanded=!expanded}.padding(12.dp),verticalAlignment=Alignment.CenterVertically){Icon(if(entry.title=="修改文件")Icons.Outlined.Difference else Icons.Outlined.Terminal,null,Modifier.size(16.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant);Spacer(Modifier.width(10.dp));Text(maskDisplay(entry.title,mask),maxLines=1,overflow=TextOverflow.Ellipsis,fontFamily=FontFamily.Monospace,fontSize=12.sp,modifier=Modifier.weight(1f));Spacer(Modifier.width(8.dp));Text(statusLabel(entry.status),fontSize=10.sp,color=MaterialTheme.colorScheme.onSurfaceVariant);Icon(if(expanded)Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,"展开执行详情",Modifier.size(18.dp))}
                    if(expanded){HorizontalDivider();NativeToolBody(entry,mask);TextButton(onClick={fullOutput=true}){Text("查看已保留的完整输出")}}
                }
            }
        }
        else->Column{Text(if(entry.status=="failed")userFacingError(raw=entry.detail) else text,fontSize=12.sp,color=if(entry.status=="failed")MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant);if(entry.detail.isNotBlank()&&entry.status!="failed")SelectionContainer{Text(maskDisplay(entry.detail,mask),fontSize=12.sp)}}
    }
}
