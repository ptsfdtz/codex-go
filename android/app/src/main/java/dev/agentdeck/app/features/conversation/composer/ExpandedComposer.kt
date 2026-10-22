package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/** A second view of the same memory draft, never a detached copy to overwrite on close. */
@Composable internal fun ExpandedComposer(draft:ComposerDraft,title:String,active:Boolean,stale:Boolean,busy:Boolean,archived:Boolean,canSubmit:Boolean,onText:(String)->Unit,onSubmit:()->Unit,resources:@Composable ()->Unit,controls:@Composable ()->Unit,onClose:()->Unit){
    var clear by remember{mutableStateOf(false)}
    val focus=remember{FocusRequester()}
    LaunchedEffect(Unit){focus.requestFocus()}
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false)){
        Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).imePadding().onPreviewKeyEvent{event->
            if(event.type!=KeyEventType.KeyDown)false
            else if(event.key==Key.Escape){onClose();true}
            else if(event.isCtrlPressed&&event.key==Key.Enter){if(canSubmit)onSubmit();true}else false
        }){
            Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                Row(Modifier.fillMaxWidth()){
                    Text(title,Modifier.weight(1f),style=MaterialTheme.typography.titleMedium,maxLines=2)
                    IconButton(onClick=onClose){Icon(Icons.Outlined.Close,"收起编辑器，保留草稿")}
                }
                if(stale)Text("离线编辑 · 恢复连接后可发送",style=MaterialTheme.typography.bodySmall)
                if(archived)Text("此会话已归档，恢复后可发送。",style=MaterialTheme.typography.bodySmall)
                if(draft.reading)LinearProgressIndicator(Modifier.fillMaxWidth())
                Column(Modifier.heightIn(max=160.dp).verticalScroll(rememberScrollState())){resources()}
                OutlinedTextField(draft.text,{if(it.length<=64000)onText(it)},Modifier.fillMaxWidth().weight(1f).focusRequester(focus),label={Text(if(active)"追加或排队的内容" else "任务内容")},supportingText={Text("${draft.text.length} / 64000")})
                Text(if(active)"即时追加只发送文字；加入队列保留受支持的附件与技能，使用工作区审批。" else "与输入框共用同一份内存草稿；收起不会丢失文字、附件或技能。",style=MaterialTheme.typography.labelSmall)
                controls()
                TextButton(onClick={clear=true},enabled=draft.text.isNotEmpty()&&!busy){Text("清空文字")}
                Text("Ctrl + Enter 发送 · Escape 收起 · 发送未确认时保留草稿",style=MaterialTheme.typography.labelSmall)
            }
        }
    }
    if(clear)AlertDialog(onDismissRequest={clear=false},title={Text("清空草稿文字？")},text={Text("只清空当前文字，保留附件、技能和模式。此操作无法撤回。")},confirmButton={TextButton(onClick={onText("");clear=false},enabled=!busy){Text("清空文字")}},dismissButton={TextButton(onClick={clear=false}){Text("取消")}})
}
