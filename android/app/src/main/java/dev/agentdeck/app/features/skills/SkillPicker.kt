package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*

@Composable internal fun SkillPicker(repo:DeckRepository,state:DeckState,projectId:String,selected:List<ComposerSkill>,onSelect:(ComposerSkill)->Unit,onDismiss:()->Unit){
    var detail by remember{mutableStateOf<JsonObject?>(null)}
    detail?.let{SkillDetails(it,state.displayMask){detail=null}}
    var catalog by remember{mutableStateOf<JsonObject?>(null)}
    var error by remember{mutableStateOf<String?>(null)}
    var query by remember{mutableStateOf("")}
    var revision by remember{mutableIntStateOf(0)}
    var loading by remember{mutableStateOf(false)}
    LaunchedEffect(state.connection,state.stale,projectId,revision){
        catalog=null;error=null;loading=false
        if(!state.stale){loading=true;try{catalog=repo.readSkillCatalog(projectId)}catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"无法读取技能"}finally{loading=false}}
    }
    AlertDialog(onDismissRequest=onDismiss,title={Text("选择技能")},text={Column(verticalArrangement=Arrangement.spacedBy(10.dp)){
        Text("已选择 ${selected.size} / 8 个。发送时由电脑重新核验；技能执行仍遵循当前模式与权限。",style=MaterialTheme.typography.bodySmall)
        OutlinedTextField(value=query,onValueChange={query=it.take(200)},singleLine=true,label={Text("搜索技能")})
        if(loading)LinearProgressIndicator(Modifier.fillMaxWidth())
        if(state.stale)Text("连接已断开，请重连后选择。")
        error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
        val skills=(catalog?.get("skills") as? JsonArray).orEmpty().mapNotNull{it as? JsonObject}.filter{matchesSkill(it,query,state.displayMask)}
        if(catalog!=null&&skills.isEmpty())Text("没有匹配的技能")
        LazyColumn(Modifier.fillMaxWidth().heightIn(max=360.dp)){
            items(skills){row->
                val id=row["id"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val name=row["name"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val label=row["displayName"]?.jsonPrimitive?.contentOrNull?.ifBlank{null}?:name
                val added=selected.any{it.id==id}
                val enabled=row["enabled"]?.jsonPrimitive?.booleanOrNull==true
                Row(Modifier.fillMaxWidth()){
                    Checkbox(checked=added,onCheckedChange={onSelect(ComposerSkill(id,name))},enabled=!state.busy&&(added||(!state.stale&&enabled&&selected.size<8&&id.length==64)))
                    Column(Modifier.weight(1f).padding(vertical=4.dp)){
                        Text(maskDisplay(label,state.displayMask))
                        Text(if(added)"已选择，可取消" else if(!enabled)"已禁用" else maskDisplay(row["shortDescription"]?.jsonPrimitive?.contentOrNull.orEmpty(),state.displayMask),style=MaterialTheme.typography.bodySmall)
                        TextButton(onClick={detail=row}){Text("查看技能详情")}
                    }
                }
            }
        }
    }},confirmButton={TextButton(onClick=onDismiss){Text("完成")}},dismissButton={TextButton(onClick={revision++},enabled=!state.stale&&!loading){Text("刷新")}})
}
