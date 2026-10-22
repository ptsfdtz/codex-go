package dev.agentdeck.app

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable internal fun SkillSettings(state:DeckState,repo:DeckRepository){
    var detail by remember(state.host?.hostId){mutableStateOf<JsonObject?>(null)}
    var enabledFilter by remember(state.host?.hostId){mutableStateOf("all")}
    var scopeFilter by remember(state.host?.hostId){mutableStateOf("all")}
    detail?.let{SkillDetails(it,state.displayMask){detail=null}}
    var project by remember(state.host?.hostId){mutableStateOf(state.selectedProject?:state.snapshot.projects.firstOrNull()?.projectId)}
    var result by remember(state.host?.hostId){mutableStateOf<JsonObject?>(null)}
    var error by remember(state.host?.hostId){mutableStateOf<String?>(null)}
    var query by remember(state.host?.hostId){mutableStateOf("")}
    var revision by remember{mutableIntStateOf(0)}
    var loading by remember{mutableStateOf(false)}
    var writing by remember{mutableStateOf(false)}
    var outcome by remember(state.host?.hostId){mutableStateOf<String?>(null)}
    var change by remember(state.host?.hostId,state.connection,state.stale,project){mutableStateOf<JsonObject?>(null)}
    val scope=rememberCoroutineScope()
    val supported=state.capabilities?.supports("projectSkillCatalog")==true
    LaunchedEffect(state.snapshot.projects){if(state.snapshot.projects.none{it.projectId==project})project=state.snapshot.projects.firstOrNull()?.projectId}
    LaunchedEffect(state.host?.hostId,state.connection,state.stale,project,supported,revision){
        result=null;error=null;loading=false
        val id=project
        if(id!=null&&!state.stale&&supported){loading=true;try{result=repo.readSkillCatalog(id)}catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"无法读取技能目录"}finally{loading=false}}
    }
    Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
        Text("来自电脑原生服务的项目技能目录。启用状态修改写入电脑的技能配置，可能影响其他项目；不会安装或执行技能。",style=MaterialTheme.typography.bodySmall)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
            state.snapshot.projects.forEach{item->FilterChip(selected=project==item.projectId,onClick={project=item.projectId},enabled=!writing,label={Text(item.name)})}
        }
        if(project==null)Text("请先在电脑授权项目。")
        else if(state.stale)Text("连接电脑后可读取技能目录。")
        else if(!supported)Text("当前电脑版本尚未提供技能目录。")
        TextButton(onClick={revision++},enabled=project!=null&&!state.stale&&supported&&!loading&&!writing){Text("刷新技能目录")}
        if(loading||writing)LinearProgressIndicator(Modifier.fillMaxWidth())
        outcome?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
        error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
        result?.let{data->
            OutlinedTextField(value=query,onValueChange={query=it.take(200)},singleLine=true,label={Text("搜索技能")},modifier=Modifier.fillMaxWidth())
            val skills=(data["skills"] as? JsonArray).orEmpty().mapNotNull{it as? JsonObject}
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)){
                listOf("all" to "全部","enabled" to "已启用","disabled" to "已禁用").forEach{(key,label)->FilterChip(selected=enabledFilter==key,onClick={enabledFilter=key},label={Text(label)})}
            }
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)){
                (listOf("all")+skills.map{skillText(it,"scope")}.filter{it.isNotBlank()}.distinct()).forEach{key->FilterChip(selected=scopeFilter==key,onClick={scopeFilter=key},label={Text(if(key=="all")"全部范围" else skillScope(key))})}
            }
            val matches=skills.filter{matchesSkill(it,query,state.displayMask)&&(scopeFilter=="all"||skillText(it,"scope")==scopeFilter)&&(enabledFilter=="all"||(it["enabled"]?.jsonPrimitive?.booleanOrNull==true)==(enabledFilter=="enabled"))}
            Text("${matches.size} / ${skills.size} 个技能",style=MaterialTheme.typography.labelSmall)
            if(matches.isEmpty())Text(if(skills.isEmpty())"此项目未返回技能" else "没有匹配的技能")
            matches.forEach{skill->
                fun text(key:String)=(skill[key] as? JsonPrimitive)?.contentOrNull.orEmpty()
                OutlinedCard{Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                    Text(maskDisplay(text("displayName").ifBlank{text("name")},state.displayMask),style=MaterialTheme.typography.titleMedium)
                    Text("${if(skill["enabled"]?.jsonPrimitive?.booleanOrNull==true)"已启用" else "已禁用"} · ${when(text("scope")){"user"->"用户";"repo"->"项目";"system"->"系统";"admin"->"管理员";else->text("scope")}}",style=MaterialTheme.typography.labelSmall)
                    SelectionContainer{Text(maskDisplay(text("description").ifBlank{text("shortDescription")},state.displayMask),style=MaterialTheme.typography.bodySmall)}
                    TextButton(onClick={detail=skill}){Text("查看技能详情")}
                    if(state.capabilities?.supports("skillConfiguration")==true)TextButton(onClick={change=skill},enabled=!state.stale&&!state.busy&&!writing&&!loading&&text("id").length==64){Text(if(skill["enabled"]?.jsonPrimitive?.booleanOrNull==true)"禁用技能" else "启用技能")}
                }}
            }
            val errors=data["errorCount"]?.jsonPrimitive?.intOrNull?:0
            if(errors>0)Text("原生服务报告 $errors 个技能加载错误，请在电脑检查。",color=MaterialTheme.colorScheme.error)
        }
    }
    change?.let{skill->
        val enabled=skill["enabled"]?.jsonPrimitive?.booleanOrNull==true
        val name=skill["displayName"]?.jsonPrimitive?.contentOrNull?:skill["name"]?.jsonPrimitive?.content.orEmpty()
        AlertDialog(onDismissRequest={if(!writing)change=null},title={Text(if(enabled)"禁用技能？" else "启用技能？")},text={Text("将修改电脑上“${maskDisplay(name,state.displayMask)}”的技能配置，可能同时影响其他项目。不会执行技能或中断当前任务；电脑会重新核对技能身份及当前状态。")},confirmButton={TextButton(enabled=!writing&&!state.stale&&!state.busy,onClick={
            val id=project
            if(id!=null)scope.launch{
                writing=true;error=null;outcome=null
                try{val effective=repo.setSkillEnabled(id,skill["id"]!!.jsonPrimitive.content,!enabled,enabled);outcome=if(effective==!enabled)"技能配置修改已确认。" else "电脑已接受修改，但实际启用状态受其他配置约束，请核对刷新结果。";result=null;revision++}
                catch(e:CancellationException){throw e}catch(e:Exception){result=null;error=(e.message?:"修改未获确认")+"；请先刷新技能目录核对，不要重复提交。"}
                finally{writing=false;change=null}
            }
        }){Text("确认修改")}},dismissButton={TextButton(onClick={change=null},enabled=!writing){Text("取消")}})
    }
}
