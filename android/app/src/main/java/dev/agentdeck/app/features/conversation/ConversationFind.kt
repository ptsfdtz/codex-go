package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.*
import androidx.compose.ui.unit.dp

@Composable internal fun ConversationFindBar(query:String,onQuery:(String)->Unit,current:Int,total:Int,onPrevious:()->Unit,onNext:()->Unit,onClose:()->Unit){
    val focus=remember{FocusRequester()}
    LaunchedEffect(Unit){focus.requestFocus()}
    Column(Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=4.dp)){
        OutlinedTextField(value=query,onValueChange={onQuery(it.take(200))},singleLine=true,label={Text("查找已加载消息")},modifier=Modifier.fillMaxWidth().focusRequester(focus).onPreviewKeyEvent{event->if(event.type==KeyEventType.KeyDown&&event.key==Key.Enter){if(event.isShiftPressed)onPrevious() else onNext();true}else false})
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.End){
            Text("$current/$total",Modifier.padding(horizontal=8.dp),style=MaterialTheme.typography.labelSmall)
            IconButton(onClick=onPrevious,enabled=total>0){Icon(Icons.Outlined.KeyboardArrowUp,"上一条匹配")}
            IconButton(onClick=onNext,enabled=total>0){Icon(Icons.Outlined.KeyboardArrowDown,"下一条匹配")}
            IconButton(onClick=onClose){Icon(Icons.Outlined.Close,"关闭查找")}
        }
        Text("仅查找已加载的消息和工具内容；加载更早消息后会更新结果。",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
