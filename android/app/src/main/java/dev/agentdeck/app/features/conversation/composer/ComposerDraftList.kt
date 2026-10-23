package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

@Composable internal fun ComposerDraftList(state:DeckState,repo:DeckRepository,onOpen:()->Unit,onClose:()->Unit){
    val hostId=state.host?.hostId.orEmpty()
    var query by remember(hostId){mutableStateOf("")}
    var deleting by remember(hostId){mutableStateOf<Pair<ComposerKey,ComposerDraft>?>(null)}
    var reading by remember(hostId){mutableStateOf<Pair<String,String>?>(null)}
    val rows=repo.composerDrafts.entries(hostId)
    fun session(key:ComposerKey)=state.snapshot.sessions.find{it.sessionId==key.conversation}
    fun project(key:ComposerKey)=state.snapshot.projects.find{it.projectId==(session(key)?.projectId?:key.conversation.removePrefix("new:"))}
    fun title(key:ComposerKey)=session(key)?.title?:if(key.conversation.startsWith("new:"))"新对话 · ${project(key)?.name?:"项目未同步"}" else "原会话未同步"
    val terms=query.trim().split(Regex("\\s+")).filter{it.isNotBlank()}
    val matches=rows.filter{(key,draft)->val text=maskDisplay(title(key)+" "+project(key)?.name.orEmpty()+" "+draft.text+" "+draft.attachments.joinToString(" "){it.name}+" "+draft.skills.joinToString(" "){it.name},state.displayMask);terms.all{text.contains(it,true)}}
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false)){
        Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).imePadding()){
            Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
                Row(Modifier.fillMaxWidth()){Text("本机未发送草稿",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge);TextButton(onClick=onClose){Text("关闭")}}
                Text("当前电脑的安卓内存草稿，不是桌面共享草稿。切换页面会保留，应用进程结束后可能丢失；附件只保存在内存中。",style=MaterialTheme.typography.bodySmall)
                OutlinedTextField(query,{query=it.take(200)},Modifier.fillMaxWidth(),singleLine=true,label={Text("查找草稿、会话或项目")})
                Text("${matches.size} / ${rows.size} 个草稿",style=MaterialTheme.typography.labelSmall)
                LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(12.dp)){
                    if(matches.isEmpty())item{Text(if(rows.isEmpty())"没有未发送草稿" else "没有匹配草稿")}
                    items(matches,key={it.first.conversation}){(key,draft)->
                        val destination=session(key)
                        val targetProject=project(key)
                        val valid=if(key.conversation.startsWith("new:"))targetProject?.enabled==true else destination!=null&&targetProject?.enabled==true
                        OutlinedCard(Modifier.fillMaxWidth()) {Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                            Text(maskDisplay(title(key),state.displayMask),style=MaterialTheme.typography.titleSmall)
                            targetProject?.let{Text(maskDisplay(it.name,state.displayMask),style=MaterialTheme.typography.labelSmall)}
                            if(destination?.archived==1)Text("原会话已归档，恢复后才可发送。",style=MaterialTheme.typography.labelSmall)
                            if(!valid)Text("原会话或授权项目尚未同步，可查看或清理草稿。",style=MaterialTheme.typography.labelSmall)
                            SelectionContainer{Text(maskDisplay(draft.text,state.displayMask).take(1000),maxLines=6,style=MaterialTheme.typography.bodySmall)}
                            Text("${draft.text.length} 字符 · ${draft.attachments.size} 个附件 · ${draft.skills.size} 个技能",style=MaterialTheme.typography.labelSmall)
                            if(draft.reading)LinearProgressIndicator(Modifier.fillMaxWidth())
                            Row{
                                TextButton(onClick={
                                    val now=repo.state.value
                                    if(now.host?.hostId!=hostId)repo.showMessage("电脑已切换，请重新打开草稿列表。")
                                    else if(key.conversation.startsWith("new:")){
                                        val id=key.conversation.removePrefix("new:")
                                        if(now.snapshot.projects.any{it.projectId==id&&it.enabled}){repo.selectProject(id);onOpen()}
                                    }else if(now.snapshot.sessions.any{it.sessionId==key.conversation}){repo.selectSession(key.conversation);onOpen()}
                                },enabled=valid&&!state.busy){Text("继续编辑")}
                                TextButton(onClick={reading=title(key) to draft.text},enabled=draft.text.isNotEmpty()){Text("阅读正文")}
                                TextButton(onClick={deleting=key to draft},enabled=!draft.reading&&!state.busy){Text("清理草稿")}
                            }
                        }}
                    }
                }
            }
        }
    }
    reading?.let{(title,text)->LoadedTextReader(title,text,state.displayMask){reading=null}}
    deleting?.let{(key,captured)->AlertDialog(onDismissRequest={deleting=null},title={Text("清理此草稿？")},text={Text("删除这份安卓内存草稿的文字、附件、技能与模式，不影响原会话消息、电脑文件或原生待发送队列。无法撤回；确认期间草稿发生变化时将拒绝清理。")},confirmButton={TextButton(onClick={
        if(repo.state.value.host?.hostId!=hostId||!repo.composerDrafts.discard(key,captured.revision))repo.showMessage("草稿或电脑已变化，未清理，请重新核对。")
        deleting=null
    },enabled=!state.busy){Text("清理草稿")}},dismissButton={TextButton(onClick={deleting=null}){Text("取消")}})}
}
