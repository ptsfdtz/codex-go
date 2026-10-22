package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

@Composable internal fun NativeQueueDialog(repo:DeckRepository,sessionId:String,onClose:()->Unit){
    val scope=rememberCoroutineScope()
    val state by repo.state.collectAsState()
    var needsRefresh by remember{mutableStateOf(false)}
    var starting by remember{mutableStateOf<JsonObject?>(null)}
    var entries by remember{mutableStateOf<List<JsonObject>>(emptyList())}
    var busy by remember{mutableStateOf(false)}
    var loaded by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf<String?>(null)}
    var editing by remember{mutableStateOf<JsonObject?>(null)}
    var deleting by remember{mutableStateOf<JsonObject?>(null)}
    var text by remember{mutableStateOf("")}
    var query by remember{mutableStateOf("")}
    var details by remember{mutableStateOf<JsonObject?>(null)}
    var reader by remember{mutableStateOf<Pair<String,String>?>(null)}
    val terms=query.trim().split(Regex("\\s+")).filter{it.isNotBlank()}
    val visible=entries.withIndex().filter{(_,entry)->
        val shown=maskDisplay(nativeUserText(entry.getValue("input").jsonArray),state.displayMask)
        terms.all{shown.contains(it,true)}
    }
    suspend fun refresh(){
        val response=repo.nativeQueue(sessionId,"list")
        val data=response["data"]?.jsonArray?:error("队列响应无效")
        require(data.size<=128){"队列过大"}
        entries=data.map{it.jsonObject};loaded=true
    }
    fun run(operation:String="list",extra:JsonObject=JsonObject(emptyMap())){scope.launch{
        if(busy)return@launch
        busy=true;error=null
        try{
            if(operation!="list"){
                repo.nativeQueue(sessionId,operation,extra)
                editing=null;deleting=null;starting=null;text=""
                // The mutation is already acknowledged; a failed refresh must not offer resubmission.
                loaded=false
            }
            refresh()
        }catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"队列操作失败，请刷新核实结果";loaded=false}
        finally{busy=false}
    }}
    val changed=state.events.lastOrNull{it.sessionId==sessionId&&it.action=="queue.changed"}?.eventId
    LaunchedEffect(state.host?.hostId,sessionId,state.connection,state.stale,changed){
        if(state.stale)loaded=false else needsRefresh=true
    }
    LaunchedEffect(needsRefresh,busy){if(needsRefresh&&!busy){needsRefresh=false;run()}}
    Dialog(onDismissRequest={if(!busy)onClose()},properties=DialogProperties(usePlatformDefaultWidth=false)){
        Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)){
            Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text("待发送消息",style=MaterialTheme.typography.titleLarge);TextButton(onClick=onClose,enabled=!busy){Text("关闭")}}
                Text("电脑上同一会话的原生队列。可在当前任务结束后启动指定消息；列表随已收到的队列变更刷新。",style=MaterialTheme.typography.bodySmall)
                Row{TextButton(onClick={run()},enabled=!busy&&!state.stale){Text("刷新队列")};if(busy)CircularProgressIndicator(Modifier.size(22.dp))}
                if(state.stale)Text("连接已断开，当前列表仅供查看；恢复后重新读取。",style=MaterialTheme.typography.bodySmall)
                error?.let{Text(maskDisplay(it,state.displayMask),color=MaterialTheme.colorScheme.error)}
                OutlinedTextField(query,{query=it.take(200)},Modifier.fillMaxWidth(),singleLine=true,label={Text("搜索待发送内容")},trailingIcon={if(query.isNotEmpty())IconButton(onClick={query=""}){Icon(Icons.Outlined.Close,"清除搜索")}})
                Text("${visible.size} / ${entries.size} 条 · 排序按钮按原队列位置移动",style=MaterialTheme.typography.labelSmall)
                LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(12.dp)){
                    if(loaded&&entries.isEmpty())item{Text("没有待发送消息")}
                    if(loaded&&entries.isNotEmpty()&&visible.isEmpty())item{Text("没有匹配的待发送消息")}
                    itemsIndexed(visible,key={_,value->value.value.getValue("id").jsonPrimitive.content}){_,value->
                        val index=value.index
                        val entry=value.value
                        val input=entry.getValue("input").jsonArray
                        val startable=input.all{part->when((part as? JsonObject)?.get("type")?.jsonPrimitive?.contentOrNull){"text"->true;"localImage"->state.capabilities?.supports("nativeQueueAttachments")==true;"skill"->state.capabilities?.supports("nativeQueueSkills")==true;else->false}}
                        val editable=input.count{it.jsonObject["type"]?.jsonPrimitive?.contentOrNull=="text"}<=1&&input.all{part->val obj=part.jsonObject;when(obj["type"]?.jsonPrimitive?.contentOrNull){"text"->(obj["text_elements"] as? JsonArray).orEmpty().isEmpty();"localImage","skill"->state.capabilities?.supports("nativeQueueResourceEdit")==true;else->false}}
                        val content=nativeUserText(input)
                        OutlinedCard{Column(Modifier.fillMaxWidth().padding(12.dp)){
                            Text("${index+1}",style=MaterialTheme.typography.labelSmall)
                            SelectionContainer{Text(maskDisplay(content,state.displayMask).take(2400),maxLines=12)}
                            if(content.length>2400||content.count{it=='\n'}>=12)Text("内容预览已折叠，请打开完整正文阅读。",style=MaterialTheme.typography.labelSmall)
                            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())){
                                TextButton(onClick={reader="待发送消息 ${index+1}" to content}){Text("完整正文")}
                                TextButton(onClick={details=entry}){Text("输入与资源详情")}
                            }
                            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())){
                                if(state.capabilities?.supports("nativeQueueStart")==true)TextButton(onClick={starting=entry},enabled=loaded&&!busy&&!state.stale&&startable){Text("启动")}
                                TextButton(onClick={editing=entry;text=input.mapNotNull{part->part.jsonObject.takeIf{it["type"]?.jsonPrimitive?.contentOrNull=="text"}?.get("text")?.jsonPrimitive?.contentOrNull}.joinToString("\n")},enabled=loaded&&!busy&&!state.stale&&editable){Text("编辑")}
                                TextButton(onClick={deleting=entry},enabled=loaded&&!busy&&!state.stale){Text("删除")}
                                fun move(delta:Int){val ids=entries.map{it.getValue("id")}.toMutableList();val value=ids.removeAt(index);ids.add(index+delta,value);run("reorder",buildJsonObject{put("submissionIds",JsonArray(ids))})}
                                IconButton(onClick={move(-1)},enabled=loaded&&!busy&&!state.stale&&index>0){Icon(Icons.Outlined.ArrowUpward,"上移")}
                                IconButton(onClick={move(1)},enabled=loaded&&!busy&&!state.stale&&index<entries.lastIndex){Icon(Icons.Outlined.ArrowDownward,"下移")}
                            }
                        }}
                    }
                }
            }
        }
    }
    starting?.let{entry->AlertDialog(onDismissRequest={if(!busy)starting=null},title={Text("启动这条待发送消息？")},text={Column{Text("将使用工作区审批在电脑上启动，不启用全部权限。已有任务或 Goal 仍在运行时，电脑会拒绝此次启动。");error?.let{Text(maskDisplay(it,state.displayMask),color=MaterialTheme.colorScheme.error)}}},confirmButton={TextButton(onClick={run("start",buildJsonObject{put("submissionId",entry.getValue("id"))})},enabled=loaded&&!busy&&!state.stale){Text("启动")}},dismissButton={TextButton(onClick={starting=null},enabled=!busy){Text("取消")}})}
    editing?.let{entry->AlertDialog(onDismissRequest={if(!busy)editing=null},title={Text("编辑待发送消息")},text={Column{Text("仅修改文字，原图片与技能按原顺序保留。保存前由电脑校验；资源失效时请刷新处理。",style=MaterialTheme.typography.bodySmall);OutlinedTextField(value=text,onValueChange={if(it.length<=64000)text=it},minLines=3,maxLines=10,enabled=!busy)}},confirmButton={TextButton(onClick={run("update",buildJsonObject{put("submissionId",entry.getValue("id"));put("text",text);entry["inputRevision"]?.let{put("expectedInputRevision",it)}})},enabled=loaded&&!busy&&!state.stale&&text.isNotBlank()){Text("保存")}},dismissButton={TextButton(onClick={editing=null},enabled=!busy){Text("取消")}})}
    deleting?.let{entry->AlertDialog(onDismissRequest={if(!busy)deleting=null},title={Text("删除待发送消息？")},text={Text("从电脑端原生队列移除，不会停止已经开始的任务。")},confirmButton={TextButton(onClick={run("delete",buildJsonObject{put("submissionId",entry.getValue("id"))})},enabled=loaded&&!busy&&!state.stale){Text("删除")}},dismissButton={TextButton(onClick={deleting=null},enabled=!busy){Text("取消")}})}
    details?.let{entry->NativeQueueDetails(entry,state.displayMask){details=null}}
    reader?.let{(title,body)->LoadedTextReader(title,body,state.displayMask){reader=null}}

}
