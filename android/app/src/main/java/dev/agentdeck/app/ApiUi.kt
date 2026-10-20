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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable fun ApiWorkspace(repo:ApiRepository,onCodex:()->Unit){
    val state by repo.state.collectAsState()
    var settings by rememberSaveable{mutableStateOf(false)}
    var listOpen by remember{mutableStateOf(false)}
    val selected=state.conversations.find{it.id==state.selected}
    var operation by remember{mutableStateOf("")}
    var title by rememberSaveable(selected?.id){mutableStateOf(selected?.title?:"")}
    var modelsOpen by remember{mutableStateOf(false)}
    var effortOpen by remember{mutableStateOf(false)}
    var menu by remember{mutableStateOf(false)}
    val clipboard=LocalClipboardManager.current
    Surface(color=MaterialTheme.colorScheme.background){BoxWithConstraints(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).imePadding()){
        val wide=maxWidth>=900.dp
        Row(Modifier.fillMaxSize()){
            if(wide){Box(Modifier.width(260.dp).fillMaxHeight().background(MaterialTheme.colorScheme.surfaceContainerLow)){ApiConversationList(state,repo){}};VerticalDivider()}
            Column(Modifier.weight(1f).fillMaxHeight()){
                Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal=16.dp),verticalAlignment=Alignment.CenterVertically){
                    if(!wide)IconButton(onClick={listOpen=true}){Icon(Icons.Outlined.Menu,"API 会话列表")}
                    Column(Modifier.weight(1f)){Text(selected?.title?:"API 对话",maxLines=1,overflow=TextOverflow.Ellipsis,fontWeight=FontWeight.SemiBold);Text("平板直连 · 不访问 Windows 工作区",fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)}
                    TextButton(onClick=onCodex){Text("Codex")}
                    IconButton(onClick={settings=true}){Icon(Icons.Outlined.Settings,"配置 API")}
                    if(selected!=null)Box{IconButton(onClick={menu=true}){Icon(Icons.Outlined.MoreHoriz,"管理 API 会话")};DropdownMenu(expanded=menu,onDismissRequest={menu=false}){
                        listOf("rename" to "重命名","pin" to if(selected.pinned)"取消置顶" else "置顶","archive" to if(selected.archived)"恢复会话" else "归档","delete" to "删除","copy" to "复制对话").forEach{(key,label)->DropdownMenuItem(text={Text(label)},enabled=!state.busy,onClick={menu=false;if(key=="rename")title=selected.title;when(key){"pin"->repo.manage(selected.id,key);"copy"->clipboard.setText(AnnotatedString(selected.messages.joinToString("\n\n"){it.role+": "+it.text}));else->operation=key}})}
                    }}
                }
                state.error?.let{message->Surface(color=MaterialTheme.colorScheme.errorContainer){Row(Modifier.fillMaxWidth().padding(start=20.dp),verticalAlignment=Alignment.CenterVertically){Text(message,Modifier.weight(1f),fontSize=12.sp);IconButton(onClick=repo::clearError){Icon(Icons.Outlined.Close,"关闭 API 提示")}}}}
                if(state.loading)Box(Modifier.weight(1f).fillMaxWidth(),contentAlignment=Alignment.Center){CircularProgressIndicator()}
                else if(selected==null)Box(Modifier.weight(1f).fillMaxWidth().padding(24.dp),contentAlignment=Alignment.Center){Column(horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(16.dp)){Icon(Icons.Outlined.ChatBubbleOutline,null,Modifier.size(40.dp));Text("直接使用你的 API 对话",fontSize=24.sp,fontWeight=FontWeight.SemiBold);Text("配置 HTTPS 地址、密钥和模型后即可发送。",fontSize=13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant);if(state.config.key.isEmpty())Button(onClick={settings=true},enabled=state.storageReady){Text("配置 API")}}}
                else {
                    val list=rememberLazyListState()
                    var following by remember(selected.id){mutableStateOf(true)}
                    LaunchedEffect(list){snapshotFlow{list.isScrollInProgress to list.canScrollForward}.collect{(moving,away)->if(moving)following=!away}}
                    LaunchedEffect(selected.messages.lastOrNull()){if(following&&selected.messages.isNotEmpty())list.scrollToItem(selected.messages.lastIndex)}
                    LazyColumn(Modifier.weight(1f).fillMaxWidth(),state=list,contentPadding=PaddingValues(24.dp),verticalArrangement=Arrangement.spacedBy(20.dp)){
                        items(selected.messages,key={it.id}){message->Box(Modifier.fillMaxWidth(),contentAlignment=if(message.role=="user")Alignment.CenterEnd else Alignment.CenterStart){Column(Modifier.widthIn(max=760.dp).then(if(message.role=="user")Modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest,RoundedCornerShape(20.dp)).padding(16.dp) else Modifier)){
                            if(message.text.isNotEmpty())SelectionContainer{Text(message.text,fontSize=15.sp,lineHeight=24.sp)}
                            if(message.status!="completed")Text(statusLabel(message.status),fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                            if(message.role=="assistant"&&message.text.isNotEmpty())IconButton(onClick={clipboard.setText(AnnotatedString(message.text))},modifier=Modifier.size(30.dp)){Icon(Icons.Outlined.ContentCopy,"复制 API 回复",Modifier.size(15.dp))}
                        }}}
                    }
                }
                Column(Modifier.fillMaxWidth().padding(horizontal=24.dp,vertical=12.dp)){
                    Row(Modifier.horizontalScroll(rememberScrollState())){
                        Box{TextButton(onClick={modelsOpen=true},enabled=!state.busy){Text(state.config.model.ifEmpty{"选择模型"});Icon(Icons.Outlined.ExpandMore,null,Modifier.size(16.dp))};DropdownMenu(expanded=modelsOpen,onDismissRequest={modelsOpen=false}){state.models.forEach{model->DropdownMenuItem(text={Text(model)},onClick={modelsOpen=false;repo.chooseModel(model)})};DropdownMenuItem(text={Text("读取 API 模型列表")},onClick={modelsOpen=false;repo.models()},enabled=state.config.key.isNotEmpty());DropdownMenuItem(text={Text("手动配置模型")},onClick={modelsOpen=false;settings=true})}}
                        Box{TextButton(onClick={effortOpen=true},enabled=!state.busy){Text("思考 · "+state.config.effort.ifEmpty{"默认"}.let(::effortLabel))};DropdownMenu(expanded=effortOpen,onDismissRequest={effortOpen=false}){listOf("","none","minimal","low","medium","high","xhigh").forEach{effort->DropdownMenuItem(text={Text(if(effort.isEmpty())"服务商默认" else effortLabel(effort))},onClick={effortOpen=false;repo.chooseEffort(effort)})}}}
                    }
                    var drafts by rememberSaveable{mutableStateOf(mapOf<String,String>())}
                    val draftKey=state.selected?:"new";val text=drafts[draftKey].orEmpty()
                    Row(verticalAlignment=Alignment.Bottom,horizontalArrangement=Arrangement.spacedBy(12.dp)){
                        OutlinedTextField(value=text,onValueChange={if(it.length<=64000)drafts=drafts+(draftKey to it)},modifier=Modifier.weight(1f).testTag("api-input"),placeholder={Text(if(selected?.archived==true)"先恢复已归档会话" else "发送消息")},enabled=!state.busy&&selected?.archived!=true,maxLines=6,shape=RoundedCornerShape(22.dp))
                        if(state.running!=null)FilledIconButton(onClick=repo::stop){Icon(Icons.Outlined.Stop,"停止 API 回复")}
                        else FilledIconButton(onClick={repo.send(text){if(drafts[draftKey]==text)drafts=drafts-draftKey}},enabled=text.isNotBlank()&&!state.busy&&state.storageReady&&selected?.archived!=true){Icon(Icons.Outlined.ArrowUpward,"发送 API 消息")}
                    }
                    Text("请求发送到你配置的服务商；不支持的模型参数会直接报错。",fontSize=10.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(top=8.dp))
                }
            }
        }
    }
    }
    if(settings)ApiSettingsDialog(state,repo){settings=false}
    if(listOpen)AlertDialog(onDismissRequest={listOpen=false},title={Text("API 会话")},text={Box(Modifier.height(400.dp)){ApiConversationList(state,repo){listOpen=false}}},confirmButton={TextButton(onClick={listOpen=false}){Text("关闭")}})
    if(operation.isNotEmpty()&&selected!=null)AlertDialog(onDismissRequest={operation=""},title={Text(when(operation){"rename"->"重命名";"archive"->if(selected.archived)"恢复会话？" else "归档会话？";else->"删除 API 会话？"})},text={if(operation=="rename")OutlinedTextField(value=title,onValueChange={if(it.length<=160)title=it},singleLine=true)else Text(if(operation=="delete")"删除平板中的会话及消息，不可恢复。不保证删除服务商保留的记录。" else "会话可在归档列表中恢复。")},confirmButton={TextButton(onClick={repo.manage(selected.id,operation,title);operation=""},enabled=operation!="rename"||title.isNotBlank()){Text("确认")}},dismissButton={TextButton(onClick={operation=""}){Text("取消")}})
}

@Composable private fun ApiConversationList(state:ApiState,repo:ApiRepository,onSelect:()->Unit){
    var search by rememberSaveable{mutableStateOf("")};var archived by rememberSaveable{mutableStateOf(false)}
    Column(Modifier.fillMaxSize().padding(12.dp)){
        TextButton(onClick={repo.select(null);onSelect()},enabled=!state.busy){Icon(Icons.Outlined.EditNote,null);Spacer(Modifier.width(8.dp));Text("新 API 对话")}
        OutlinedTextField(value=search,onValueChange={search=it.take(160)},label={Text("搜索 API 会话")},singleLine=true,modifier=Modifier.fillMaxWidth())
        Row{FilterChip(selected=!archived,onClick={archived=false},label={Text("会话")});Spacer(Modifier.width(8.dp));FilterChip(selected=archived,onClick={archived=true},label={Text("已归档")})}
        LazyColumn(Modifier.weight(1f)){items(state.conversations.filter{it.archived==archived&&it.title.contains(search,true)}.sortedWith(compareByDescending<ApiConversation>{it.pinned}.thenByDescending{it.updatedAt}),key={it.id}){chat->Row(Modifier.fillMaxWidth().background(if(chat.id==state.selected)MaterialTheme.colorScheme.surfaceContainerHighest else MaterialTheme.colorScheme.surfaceContainerLow,RoundedCornerShape(8.dp)).clickable(enabled=!state.busy){repo.select(chat.id);onSelect()}.padding(12.dp),verticalAlignment=Alignment.CenterVertically){if(chat.pinned)Icon(Icons.Outlined.PushPin,null,Modifier.size(14.dp));Text(chat.title,Modifier.weight(1f),maxLines=1,overflow=TextOverflow.Ellipsis)}}}
    }
}

@Composable private fun ApiSettingsDialog(state:ApiState,repo:ApiRepository,onClose:()->Unit){
    var base by remember{mutableStateOf(state.config.baseUrl)};var key by remember{mutableStateOf("")};var model by remember{mutableStateOf(state.config.model)}
    var saving by remember{mutableStateOf(false)}
    LaunchedEffect(state.busy,saving){if(saving&&!state.busy){saving=false;if(state.error==null)onClose()}}
    AlertDialog(onDismissRequest={if(!state.busy)onClose()},title={Text("API 配置")},text={Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)){
        Text("OpenAI 兼容 Chat Completions。密钥与本地对话由 Keystore 加密，不会发送给 Windows。",fontSize=12.sp)
        OutlinedTextField(value=base,onValueChange={base=it.take(2048)},modifier=Modifier.testTag("api-base"),label={Text("HTTPS 基础地址（包含 /v1）")},singleLine=true)
        OutlinedTextField(value=key,onValueChange={key=it.take(4096)},modifier=Modifier.testTag("api-key"),label={Text(if(state.config.key.isEmpty())"API 密钥" else "新密钥（留空保留）")},singleLine=true,visualTransformation=PasswordVisualTransformation())
        OutlinedTextField(value=model,onValueChange={model=it.take(160)},modifier=Modifier.testTag("api-model"),label={Text("模型 ID")},singleLine=true)
        Text("保存后，请求与密钥将发送到上述地址。更换主机需重新输入密钥。思考强度依服务商和模型支持，默认不发送该参数。",fontSize=12.sp)
        state.error?.let{Text(it,color=MaterialTheme.colorScheme.error,fontSize=12.sp)}
    }},confirmButton={TextButton(onClick={saving=true;repo.configure(base,key,model,state.config.effort)},enabled=!state.busy&&state.storageReady){Text(if(state.busy)"正在保存…" else "保存")}},dismissButton={TextButton(onClick=onClose,enabled=!state.busy){Text("取消")}})
}
