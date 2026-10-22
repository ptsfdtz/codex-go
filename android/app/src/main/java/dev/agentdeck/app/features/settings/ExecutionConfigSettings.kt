package dev.agentdeck.app

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*

private fun configSource(type:String)=when(type){
    "packagedDefaults"->"安装包默认";"system"->"系统";"user"->"用户";"project"->"项目";"sessionFlags"->"会话启动参数";"mdm"->"设备管理";"enterpriseManaged"->"企业管理";"legacyManagedConfigTomlFromFile"->"旧版托管文件";else->type
}
private fun configLabel(key:String)=when(key){
    "model"->"模型";"model_provider"->"模型提供方";"review_model"->"审查模型";"model_reasoning_effort"->"推理强度";"model_reasoning_summary"->"推理摘要";"model_verbosity"->"回复详细程度";"service_tier"->"服务层级";"approval_policy"->"审批策略";"approvals_reviewer"->"审批处理方";"sandbox_mode"->"沙箱模式";"web_search"->"网页搜索";"default_permissions"->"默认权限配置";"model_context_window"->"上下文窗口";"model_auto_compact_token_limit"->"自动压缩阈值";else->key
}
@Composable private fun ConfigFields(values:JsonObject,origins:JsonObject?,mask:String){
    if(values.isEmpty())Text("此层未提供展示范围内的配置项。",style=MaterialTheme.typography.bodySmall)
    values.forEach{(key,value)->Column(verticalArrangement=Arrangement.spacedBy(3.dp)){
        Text(configLabel(key),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        SelectionContainer{Text(maskDisplay((value as? JsonPrimitive)?.contentOrNull?:"未提供可展示的标量值",mask),fontFamily=FontFamily.Monospace,style=MaterialTheme.typography.bodyMedium)}
        val origin=(origins?.get(key) as? JsonObject)?.get("sourceType")?.jsonPrimitive?.contentOrNull
        if(origin!=null)Text("来源：${configSource(origin)}",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }}
}
@Composable internal fun ExecutionConfigSettings(state:DeckState,repo:DeckRepository){
    var projectId by remember(state.host?.hostId){mutableStateOf(state.selectedProject)}
    var result by remember(state.host?.hostId){mutableStateOf<JsonObject?>(null)}
    var error by remember(state.host?.hostId){mutableStateOf<String?>(null)}
    var revision by remember(state.host?.hostId){mutableIntStateOf(0)}
    var loading by remember(state.host?.hostId){mutableStateOf(false)}
    var writeMessage by remember(state.host?.hostId){mutableStateOf<String?>(null)}
    val supported=state.capabilities?.supports("executionConfigView")==true
    LaunchedEffect(state.snapshot.projects){if(projectId!=null&&state.snapshot.projects.none{it.projectId==projectId})projectId=null}
    LaunchedEffect(state.host?.hostId,state.connection,state.stale,projectId,supported,revision){
        result=null;error=null;loading=false
        if(!state.stale&&supported){loading=true;try{result=repo.readExecutionConfig(projectId)}catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"无法读取执行配置"}finally{loading=false}}
    }
    Column(verticalArrangement=Arrangement.spacedBy(16.dp)){
        Text("读取电脑上同一服务的配置解析结果。发送时的模型、模式和权限仍以输入框选择及电脑审批为准。",style=MaterialTheme.typography.bodySmall)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
            FilterChip(selected=projectId==null,onClick={projectId=null},label={Text("服务默认")})
            state.snapshot.projects.forEach{project->FilterChip(selected=projectId==project.projectId,onClick={projectId=project.projectId},label={Text(project.name)})}
        }
        if(state.stale)Text("连接电脑后可读取配置。")else if(!supported)Text("当前电脑版本尚未提供执行配置视图。")
        TextButton(onClick={revision++},enabled=!state.stale&&supported&&!loading){Text("刷新执行配置")}
        if(loading)LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
        writeMessage?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
        result?.let{data->
            if(projectId==null){
                ModelDefaultsEditor(state,repo,data){writeMessage=it;revision++}
                OutputDefaultsEditor(state,repo,data){writeMessage=it;revision++}
            }
            OutlinedCard{Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
                Text("生效配置",fontWeight=FontWeight.SemiBold)
                ConfigFields(data["values"]?.jsonObject?:JsonObject(emptyMap()),data["origins"] as? JsonObject,state.displayMask)
                HorizontalDivider()
                Text(if(data["workspacePolicyCompatible"]?.jsonPrimitive?.booleanOrNull==true)"配置符合当前工作区权限规则" else "配置未通过当前工作区权限规则检查",style=MaterialTheme.typography.bodySmall)
                Text(if(data["sandboxVerified"]?.jsonPrimitive?.booleanOrNull==true)"电脑已记录隔离检查通过" else "电脑尚未确认隔离检查通过",style=MaterialTheme.typography.bodySmall)
                Text("只展示执行设置字段；不导出原始配置、指令、来源路径或凭据。",style=MaterialTheme.typography.labelSmall)
            }}
            val layers=(data["layers"] as? JsonArray).orEmpty()
            if(layers.isEmpty())Text("服务未返回配置层级。",style=MaterialTheme.typography.bodySmall)
            layers.forEachIndexed{index,element->val layer=element.jsonObject
                OutlinedCard{Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
                    Text("${index+1}. ${configSource(layer["sourceType"]?.jsonPrimitive?.contentOrNull?:"unknown")}",fontWeight=FontWeight.Medium)
                    if(layer["disabled"]?.jsonPrimitive?.booleanOrNull==true)Text("此层已禁用",style=MaterialTheme.typography.bodySmall)
                    ConfigFields(layer["values"]?.jsonObject?:JsonObject(emptyMap()),null,state.displayMask)
                }}
            }
            Text("层级按服务返回顺序显示 · ${data["readAt"]?.jsonPrimitive?.content.orEmpty()}",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
