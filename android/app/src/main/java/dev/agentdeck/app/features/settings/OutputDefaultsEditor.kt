package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

private val verbosityOptions=listOf("default" to "使用上游默认","low" to "简短","medium" to "适中","high" to "详细")
private val summaryOptions=listOf("default" to "使用上游默认","auto" to "自动","concise" to "简明","detailed" to "详细","none" to "不显示摘要")

@Composable private fun OutputChoice(label:String,value:String,options:List<Pair<String,String>>,enabled:Boolean,onChange:(String)->Unit){
    var open by remember{mutableStateOf(false)}
    Box{
        OutlinedButton(onClick={open=true},enabled=enabled){Text(label+"："+(options.find{it.first==value}?.second?:value))}
        DropdownMenu(expanded=open,onDismissRequest={open=false}){options.forEach{(key,title)->DropdownMenuItem(text={Text(title)},onClick={open=false;onChange(key)},enabled=enabled)}}
    }
}

@Composable internal fun OutputDefaultsEditor(state:DeckState,repo:DeckRepository,data:JsonObject,onChanged:(String)->Unit){
    if(state.capabilities?.supports("outputDefaultsWrite")!=true)return
    val revision=(data["userRevision"] as? JsonPrimitive)?.contentOrNull?:return
    val values=data["values"] as? JsonObject
    var verbosity by remember(revision){mutableStateOf((values?.get("model_verbosity") as? JsonPrimitive)?.contentOrNull?:"default")}
    var summary by remember(revision){mutableStateOf((values?.get("model_reasoning_summary") as? JsonPrimitive)?.contentOrNull?:"default")}
    var confirm by remember(revision){mutableStateOf(false)}
    var attempted by remember(revision){mutableStateOf(false)}
    var busy by remember(revision){mutableStateOf(false)}
    var error by remember(revision){mutableStateOf<String?>(null)}
    val scope=rememberCoroutineScope()
    val enabled=!state.stale&&!state.busy&&!busy&&!attempted
    val valid=verbosityOptions.any{it.first==verbosity}&&summaryOptions.any{it.first==summary}
    OutlinedCard{Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
        Text("电脑默认回复设置",style=MaterialTheme.typography.titleMedium)
        Text("写入电脑基础用户配置，可能影响其他项目的新会话。模型及更高优先级配置可能限制或覆盖这些选项；不改变模型、审批、沙箱或指令。当前选择来自生效配置。",style=MaterialTheme.typography.bodySmall)
        OutputChoice("回复详细程度",verbosity,verbosityOptions,enabled){verbosity=it}
        OutputChoice("推理摘要",summary,summaryOptions,enabled){summary=it}
        Text("使用上游默认会移除对应用户层覆盖。推理摘要是模型提供的摘要，不是完整内部推理。",style=MaterialTheme.typography.labelSmall)
        if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let{Text(maskDisplay(it,state.displayMask),color=MaterialTheme.colorScheme.error)}
        Button(onClick={confirm=true},enabled=enabled&&valid){Text("保存回复设置")}
    }}
    if(confirm)AlertDialog(onDismissRequest={if(!busy)confirm=false},title={Text("保存电脑默认回复设置？")},text={Text("回复详细程度：${verbosityOptions.find{it.first==verbosity}?.second}\n推理摘要：${summaryOptions.find{it.first==summary}?.second}\n将修改电脑基础用户配置；配置版本变化时拒绝覆盖。")},confirmButton={TextButton(onClick={
        confirm=false;busy=true;attempted=true
        scope.launch{try{
            val result=repo.writeOutputDefaults(verbosity,summary,revision)
            onChanged(if(result["overridden"]?.jsonPrimitive?.booleanOrNull==true)"写入已确认，但有更高优先级配置覆盖，请核对生效值。" else "回复设置写入已确认，正在刷新配置。")
        }catch(e:CancellationException){throw e}catch(e:Exception){error=(e.message?:"写入未确认")+"；请刷新核对，不要重复保存。"}finally{busy=false}}
    },enabled=enabled&&valid){Text("确认保存")}},dismissButton={TextButton(onClick={confirm=false},enabled=!busy){Text("取消")}})
}
