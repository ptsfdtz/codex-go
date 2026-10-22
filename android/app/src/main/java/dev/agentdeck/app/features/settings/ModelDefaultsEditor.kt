package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable internal fun ModelDefaultsEditor(state:DeckState,repo:DeckRepository,data:JsonObject,onChanged:(String)->Unit){
    val revision=data["userRevision"]?.jsonPrimitive?.contentOrNull
    if(state.capabilities?.supports("modelDefaultsWrite")!=true)return
    if(revision==null){Text("当前配置未提供可写的唯一基础用户层，无法修改默认模型。",style=MaterialTheme.typography.bodySmall);return}
    val values=data["values"] as? JsonObject
    var model by remember(revision){mutableStateOf(values?.get("model")?.jsonPrimitive?.contentOrNull.orEmpty())}
    var effort by remember(revision){mutableStateOf(values?.get("model_reasoning_effort")?.jsonPrimitive?.contentOrNull.orEmpty())}
    var modelOpen by remember{mutableStateOf(false)}
    var effortOpen by remember{mutableStateOf(false)}
    var confirm by remember{mutableStateOf(false)}
    var busy by remember{mutableStateOf(false)}
    var attempted by remember{mutableStateOf(false)}
    var message by remember{mutableStateOf<String?>(null)}
    val scope=rememberCoroutineScope()
    val selected=state.models.find{it.model==model}
    val enabled=!state.stale&&!state.busy&&!busy&&!attempted
    val valid=selected!=null&&(effort.isEmpty()||selected.supportedReasoningEfforts.any{it.reasoningEffort==effort})
    OutlinedCard{Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
        Text("电脑默认模型",style=MaterialTheme.typography.titleMedium)
        Text("修改电脑基础用户配置，可能影响其他项目的新会话。现有会话和输入框的显式模型选择优先，不更改审批或沙箱。",style=MaterialTheme.typography.bodySmall)
        Box{
            OutlinedButton(onClick={modelOpen=true},enabled=enabled){Text(selected?.displayName?:model.ifBlank{"选择模型"})}

        }
        if(modelOpen)ModelSelection(state.models,model,enabled,state.displayMask,{model=it.model;effort=""},repo::refreshModels){modelOpen=false}
        Box{
            OutlinedButton(onClick={effortOpen=true},enabled=enabled&&selected!=null){Text(if(effort.isEmpty())"推理强度：模型默认" else "推理强度：${effortLabel(effort)}")}
            DropdownMenu(expanded=effortOpen,onDismissRequest={effortOpen=false}){
                DropdownMenuItem(text={Text("模型默认")},onClick={effort="";effortOpen=false})
                selected?.supportedReasoningEfforts?.forEach{item->DropdownMenuItem(text={ReasoningOptionLabel(item,item.reasoningEffort==effort,state.displayMask)},onClick={effort=item.reasoningEffort;effortOpen=false})}
            }
        }
        TextButton(onClick=repo::refreshModels,enabled=enabled){Text("刷新可用模型")}
        Button(onClick={confirm=true},enabled=enabled&&valid){Text("保存默认模型")}
        if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        message?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
    }}
    if(confirm)AlertDialog(onDismissRequest={if(!busy)confirm=false},title={Text("保存电脑默认模型？")},text={Text("默认模型：${selected?.displayName?:model}\n推理强度：${if(effort.isEmpty())"模型默认" else effortLabel(effort)}\n这会写入电脑用户配置。若配置已变化，电脑将拒绝覆盖，请刷新后重新选择。")},confirmButton={TextButton(enabled=enabled&&valid,onClick={
        busy=true;attempted=true;confirm=false
        scope.launch{try{val result=repo.writeModelDefaults(model,effort,revision);onChanged(if(result["overridden"]?.jsonPrimitive?.booleanOrNull==true)"写入已确认，但有更高优先级配置覆盖，请核对刷新后的生效值。" else "默认模型写入已确认，正在刷新生效配置。")}catch(e:CancellationException){throw e}catch(e:Exception){message=(e.message?:"写入未确认")+"；请刷新配置核对，不要重复保存。"}finally{busy=false}}
    }){Text("确认保存")}},dismissButton={TextButton(onClick={confirm=false},enabled=!busy){Text("取消")}})
}
