package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*

/** Message actions operate only on loaded text and this original session's local draft. */
@Composable internal fun MessageActions(entry:ChatEntry,mask:String,repo:DeckRepository,sessionId:String){
    val host=repo.state.value.host?.hostId.orEmpty()
    val key=ComposerKey(host,sessionId)
    var menu by remember(key,entry.id,mask){mutableStateOf(false)}
    var reading by remember(key,entry.id,mask){mutableStateOf(false)}
    var quote by remember(key,entry.id,mask){mutableStateOf<String?>(null)}
    var busy by remember(key,entry.id,mask){mutableStateOf(false)}
    var error by remember(key,entry.id,mask){mutableStateOf<String?>(null)}
    val scope=rememberCoroutineScope()
    val clipboard=LocalClipboardManager.current
    val current=repo.state.value
    val canQuote=current.host?.hostId==host&&current.snapshot.sessions.any{it.sessionId==sessionId&&it.archived!=1}
    fun load(copy:Boolean){
        if(busy)return
        busy=true
        scope.launch{try{
            val text=withContext(Dispatchers.Default){maskDisplay(loadedMessageText(entry),mask)}
            if(repo.state.value.host?.hostId!=host||repo.state.value.displayMask!=mask)return@launch
            if(text.isBlank())repo.showMessage("此消息没有已加载的文字正文。")
            else if(copy){
                if(text.toByteArray(Charsets.UTF_8).size>256*1024){reading=true;repo.showMessage("正文较长，请在阅读窗口分段复制。")}else clipboard.setText(AnnotatedString(text))
            }else if(text.length>32000){reading=true;repo.showMessage("长消息可逐段引用；请在阅读窗口选择当前段。")}else{quote=text;error=null}
        }catch(e:CancellationException){throw e}catch(e:Exception){repo.showMessage(e.message?:"无法读取消息正文")}finally{busy=false}}
    }
    Row(Modifier.fillMaxWidth(),horizontalArrangement=if(entry.kind=="user")Arrangement.End else Arrangement.Start){
        if(entry.kind!="user")IconButton(onClick={load(true)},enabled=!busy,modifier=Modifier.size(48.dp)){Icon(Icons.Outlined.ContentCopy,"复制回复",Modifier.size(18.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)}
        Box{
            IconButton(onClick={menu=true},enabled=!busy,modifier=Modifier.size(48.dp)){Icon(Icons.Outlined.MoreHoriz,"消息操作",Modifier.size(18.dp))}
            DropdownMenu(expanded=menu,onDismissRequest={menu=false}){
                DropdownMenuItem(text={Text("复制已加载正文")},onClick={menu=false;load(true)})
                DropdownMenuItem(text={Text("阅读与查找正文")},onClick={menu=false;reading=true})
                DropdownMenuItem(text={Text("引用到本会话草稿")},enabled=canQuote,onClick={menu=false;load(false)})
            }
        }
    }
    if(reading)MessageReader(entry,mask,onQuote=if(canQuote){{text->quote=text;error=null}}else null){reading=false}
    quote?.let{value->
        AlertDialog(onDismissRequest={quote=null},title={Text("引用到草稿")},text={Column(Modifier.heightIn(max=480.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)){
            Text("可修改引用文字。确认后以 Markdown 引用追加到原会话草稿，保留已有正文、附件和技能；不会自动发送。只引用文字，不复制原消息资源。",style=MaterialTheme.typography.bodySmall)
            OutlinedTextField(value,{if(it.length<=32000)quote=it},Modifier.fillMaxWidth(),minLines=3,maxLines=9,label={Text("引用文字")})
            Text("${value.length} 字符",style=MaterialTheme.typography.labelSmall)
            error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
        }},confirmButton={TextButton(onClick={
            val state=repo.state.value
            if(state.host?.hostId!=host||state.snapshot.sessions.none{it.sessionId==sessionId&&it.archived!=1})error="原电脑或会话已变化，请关闭后重新选择。"
            else{
                val old=repo.composerDrafts[key]
                val block=value.lineSequence().joinToString("\n"){"> $it"}
                val merged=old.text+(if(old.text.isBlank())"" else "\n\n")+block+"\n\n"
                if(merged.length>64000)error="引用与现有草稿合计超过 64000 字符，请缩短引用。"
                else{repo.composerDrafts.edit(key){it.copy(text=merged)};quote=null;reading=false;repo.showMessage("引用已加入本会话草稿，请检查后发送。")}
            }
        },enabled=canQuote&&value.isNotBlank()){Text("加入草稿")}},dismissButton={TextButton(onClick={quote=null}){Text("取消")}})
    }
}
