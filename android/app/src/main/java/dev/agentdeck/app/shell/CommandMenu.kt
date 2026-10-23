package dev.agentdeck.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.*
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog

internal data class DeckCommand(val id:String,val title:String,val detail:String="",val enabled:Boolean=true,val run:()->Unit)

@Composable internal fun CommandMenu(commands:List<DeckCommand>,mask:String="",onDismiss:()->Unit){
    var query by remember{mutableStateOf("")}
    var category by remember{mutableStateOf("all")}
    var selectedId by remember{mutableStateOf<String?>(null)}
    val focus=remember{FocusRequester()}
    val list=rememberLazyListState()
    fun group(command:DeckCommand)=when{command.id.startsWith("session:")->"sessions";command.id.startsWith("project:")->"projects";else->"actions"}
    val terms=query.trim().split(Regex("\\s+")).filter{it.isNotEmpty()}
    val matches=commands.filter{command->(category=="all"||group(command)==category)&&terms.all{maskDisplay("${command.title} ${command.detail}",mask).contains(it,true)}}
    val selected=matches.indexOfFirst{it.id==selectedId}
    LaunchedEffect(query,category,mask){selectedId=matches.firstOrNull{it.enabled}?.id;list.scrollToItem(0)}
    LaunchedEffect(matches.map{it.id to it.enabled}){
        if(matches.none{it.id==selectedId&&it.enabled})selectedId=matches.firstOrNull{it.enabled}?.id
    }
    LaunchedEffect(selectedId){val index=matches.indexOfFirst{it.id==selectedId};if(index>=0)list.animateScrollToItem(index)}
    LaunchedEffect(Unit){focus.requestFocus()}
    fun execute(command:DeckCommand){
        // Re-resolve the selected identity from this composition's current command list.
        commands.find{it.id==command.id&&it.enabled}?.let{onDismiss();it.run()}
    }
    fun move(delta:Int){
        if(matches.isEmpty())return
        val start=if(selected<0){if(delta>0)-1 else 0}else selected
        for(step in 1..matches.size){
            val index=((start+delta*step)%matches.size+matches.size)%matches.size
            if(matches[index].enabled){selectedId=matches[index].id;return}
        }
    }
    Dialog(onDismissRequest=onDismiss){
        Surface(shape=MaterialTheme.shapes.large,modifier=Modifier.widthIn(max=640.dp).fillMaxWidth().heightIn(max=680.dp).imePadding().onPreviewKeyEvent{event->
            if(event.type!=KeyEventType.KeyDown)false else when{
                event.key==Key.Escape->{onDismiss();true}
                event.key==Key.DirectionDown->{move(1);true}
                event.key==Key.DirectionUp->{move(-1);true}
                event.key==Key.Enter->{matches.find{it.id==selectedId}?.let(::execute);true}
                event.isCtrlPressed&&event.key==Key.MoveHome->{selectedId=matches.firstOrNull{it.enabled}?.id;true}
                event.isCtrlPressed&&event.key==Key.MoveEnd->{selectedId=matches.lastOrNull{it.enabled}?.id;true}
                else->false
            }
        }){
            Column(Modifier.padding(16.dp)){
                Text("搜索操作与会话",style=MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value=query,onValueChange={query=it.take(200)},singleLine=true,label={Text("输入操作、项目或会话名称")},trailingIcon={if(query.isNotEmpty())TextButton(onClick={query=""}){Text("清除")}},keyboardOptions=KeyboardOptions(imeAction=ImeAction.Search),keyboardActions=KeyboardActions(onSearch={matches.find{it.id==selectedId}?.let(::execute)}),modifier=Modifier.fillMaxWidth().focusRequester(focus))
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)){
                    listOf("all" to "全部","actions" to "操作","projects" to "项目","sessions" to "会话").forEach{(id,label)->FilterChip(selected=category==id,onClick={category=id},label={Text(label)})}
                }
                Text("${matches.size} 个结果 · ${matches.count{it.enabled}} 项可用",style=MaterialTheme.typography.labelSmall)
                Spacer(Modifier.height(8.dp))
                if(matches.isEmpty())Text("没有匹配的操作或已索引会话",Modifier.padding(16.dp))
                LazyColumn(state=list,modifier=Modifier.weight(1f,fill=false)){
                    itemsIndexed(matches,key={_,command->command.id}){_,command->
                        val checked=command.id==selectedId
                        Surface(color=if(checked)MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface,shape=MaterialTheme.shapes.small){
                            Column(Modifier.fillMaxWidth().semantics{this.selected=checked}.clickable(enabled=command.enabled){selectedId=command.id;execute(command)}.padding(12.dp)){
                                Text(maskDisplay(command.title,mask),color=if(command.enabled)MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                                if(command.detail.isNotBlank())Text(maskDisplay(command.detail,mask),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                                if(!command.enabled)Text("当前状态不可用",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
                Text("↑ / ↓ 选择可用项 · Enter 打开 · Ctrl+Home/End 首末项 · Esc 关闭",style=MaterialTheme.typography.labelSmall)
                TextButton(onClick=onDismiss,modifier=Modifier.fillMaxWidth()){Text("关闭")}
            }
        }
    }
}
