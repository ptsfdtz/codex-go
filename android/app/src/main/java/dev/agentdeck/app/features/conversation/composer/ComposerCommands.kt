package dev.agentdeck.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

internal data class ComposerCommand(val name:String,val title:String,val detail:String,val enabled:Boolean=true,val action:()->Unit)

internal fun matchingComposerCommands(text:String,commands:List<ComposerCommand>):List<ComposerCommand>{
    if(!text.startsWith('/')||text.length>40||text.any{it.isWhitespace()})return emptyList()
    val query=text.drop(1)
    return commands.filter{it.name.startsWith(query,true)}
}

@Composable internal fun ComposerCommandSuggestions(commands:List<ComposerCommand>,selectedIndex:Int,onSelect:(ComposerCommand)->Unit,onDismiss:()->Unit){
    val list=rememberLazyListState()
    LaunchedEffect(selectedIndex,commands.map{it.name}){if(commands.isNotEmpty())list.scrollToItem(selectedIndex.coerceIn(commands.indices))}
    OutlinedCard(Modifier.fillMaxWidth().padding(bottom=8.dp)){
        Column{
            Row(Modifier.fillMaxWidth().padding(start=12.dp),horizontalArrangement=Arrangement.SpaceBetween){
                Text("输入框命令",Modifier.padding(top=12.dp),style=MaterialTheme.typography.labelMedium)
                TextButton(onClick=onDismiss){Text("关闭")}
            }
            LazyColumn(state=list,modifier=Modifier.fillMaxWidth().heightIn(max=230.dp)){
                itemsIndexed(commands,key={_,item->item.name}){index,item->
                    Surface(color=if(index==selectedIndex)MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface){
                        Column(Modifier.fillMaxWidth().semantics{selected=index==selectedIndex}.clickable(enabled=item.enabled){onSelect(item)}.padding(horizontal=14.dp,vertical=10.dp)){
                            Text("/${item.name} · ${item.title}",color=if(item.enabled)MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodyMedium)
                            Text(item.detail,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            Text("↑ ↓ 选择 · Enter / Tab 确认 · Esc 保留文字关闭",Modifier.padding(12.dp),style=MaterialTheme.typography.labelSmall)
        }
    }
}
