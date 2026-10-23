package dev.agentdeck.app

import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.*
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog

@Composable internal fun ModelSelection(models:List<CodexModel>,selected:String,enabled:Boolean,mask:String,onSelect:(CodexModel)->Unit,onRefresh:()->Unit,onClose:()->Unit){
    var query by remember{mutableStateOf("")}
    val matches=remember(models,query,mask){val terms=query.trim().split(Regex("\\s+")).filter{it.isNotBlank()};models.filter{model->terms.all{maskDisplay("${model.displayName} ${model.model} ${model.description}",mask).contains(it,true)}}}
    var focused by remember{mutableIntStateOf(0)}
    val list=rememberLazyListState()
    val focus=remember{FocusRequester()}
    LaunchedEffect(Unit){focus.requestFocus()}
    LaunchedEffect(query){focused=0;list.scrollToItem(0)}
    LaunchedEffect(matches.size){focused=focused.coerceIn(0,(matches.size-1).coerceAtLeast(0))}
    LaunchedEffect(focused){if(matches.isNotEmpty())list.animateScrollToItem(focused)}
    Dialog(onDismissRequest=onClose){
        Surface(Modifier.widthIn(max=600.dp).fillMaxWidth().heightIn(max=640.dp).imePadding().onPreviewKeyEvent{event->
            if(event.type!=KeyEventType.KeyDown)false else when(event.key){
                Key.Escape->{onClose();true}
                Key.DirectionDown->{focused=(focused+1).coerceAtMost((matches.size-1).coerceAtLeast(0));true}
                Key.DirectionUp->{focused=(focused-1).coerceAtLeast(0);true}
                Key.Enter->{if(enabled)matches.getOrNull(focused)?.let{onSelect(it);onClose()};true}
                else->false
            }
        },shape=MaterialTheme.shapes.large){
            Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                Text("选择模型",style=MaterialTheme.typography.titleLarge)
                OutlinedTextField(query,{query=it.take(200)},Modifier.fillMaxWidth().focusRequester(focus),singleLine=true,label={Text("搜索名称或说明")})
                if(matches.isEmpty())Text(if(models.isEmpty())"尚未获取可用模型，请连接电脑后刷新。" else "没有匹配的模型。",style=MaterialTheme.typography.bodySmall)
                LazyColumn(Modifier.weight(1f,fill=false),state=list){
                    itemsIndexed(matches){index,model->
                        val checked=model.model==selected
                        Row(Modifier.fillMaxWidth().background(if(index==focused)MaterialTheme.colorScheme.surfaceContainerHighest else MaterialTheme.colorScheme.surface).selectable(selected=checked,enabled=enabled,role=Role.RadioButton,onClick={onSelect(model);onClose()}).padding(vertical=10.dp)){
                            RadioButton(checked,onClick=null)
                            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){
                                Text(maskDisplay(model.displayName,mask),style=MaterialTheme.typography.titleSmall)
                                if(model.model!=model.displayName)Text(maskDisplay(model.model,mask),style=MaterialTheme.typography.labelSmall)
                                if(model.isDefault)Text("电脑报告的默认模型",style=MaterialTheme.typography.labelSmall)
                                if(model.description.isNotBlank())Text(maskDisplay(model.description,mask),style=MaterialTheme.typography.bodySmall)
                                if(model.inputModalities.isNotEmpty())Text("原生输入类型："+model.inputModalities.joinToString("、"){when(it){"text"->"文字";"image"->"图片";"audio"->"音频";else->it}},style=MaterialTheme.typography.labelSmall)
                            }
                        }
                        HorizontalDivider()
                    }
                }
                Text("输入类型由模型目录报告，不代表当前客户端已支持全部媒体。选择仅影响后续发送。",style=MaterialTheme.typography.labelSmall)
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){TextButton(onClick=onRefresh,enabled=enabled){Text("刷新模型")};TextButton(onClick=onClose){Text("关闭")}}
            }
        }
    }
}

@Composable internal fun ReasoningOptionLabel(option:ReasoningOption,selected:Boolean,mask:String){
    Column(verticalArrangement=Arrangement.spacedBy(3.dp)){
        Text(effortLabel(option.reasoningEffort)+(if(selected)" ✓" else ""))
        if(option.description.isNotBlank())Text(maskDisplay(option.description,mask),style=MaterialTheme.typography.bodySmall)
    }
}
