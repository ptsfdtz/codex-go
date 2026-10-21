package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

internal data class NativeProjectPage(val viewId:String,val entries:List<JsonObject>,val nextCursor:String?)
internal fun decodeNativeProjectPage(value:JsonObject):NativeProjectPage {
    require(value["contractVersion"]?.jsonPrimitive?.intOrNull==1&&value["consistency"]?.jsonPrimitive?.content=="bounded-read-view") {"不支持的项目读取版本"}
    require(value["source"]?.jsonPrimitive?.content=="upstream-native-projects") {"项目来源无效"}
    val view=value["viewId"]?.jsonPrimitive?.content.orEmpty()
    require(view.isNotBlank()) {"项目视图身份无效"}
    val entries=(value["data"] as? JsonArray?:error("缺少项目列表")).map{it.jsonObject}
    val ids=hashSetOf<String>()
    for(entry in entries){
        val project=entry.getValue("project").jsonObject
        require(ids.add(project.getValue("id").jsonPrimitive.content)&&project.getValue("id").jsonPrimitive.content.isNotBlank()) {"项目身份重复或无效"}
        val roots=project.getValue("roots").jsonArray
        val grants=entry.getValue("rootGrants").jsonArray
        require(roots.isNotEmpty()&&roots.size==grants.size) {"项目授权不完整"}
        grants.forEachIndexed{index,grant->require(grant.jsonObject["rootIndex"]?.jsonPrimitive?.intOrNull==index&&!grant.jsonObject["projectId"]?.jsonPrimitive?.content.isNullOrBlank()) {"目录授权映射无效"}}
    }
    val cursor=value["nextCursor"]?.takeUnless{it==JsonNull}?.jsonPrimitive?.content
    require(cursor==null||Regex("[A-Za-z0-9_-]{43}").matches(cursor)) {"项目游标无效"}
    return NativeProjectPage(view,entries,cursor)
}

@Composable internal fun NativeProjectsDialog(repo:DeckRepository,hostId:String?,onClose:()->Unit){
    NativeProjectsViewer(hostId,repo::readNativeProjects,onClose)
}

@Composable internal fun NativeProjectsViewer(hostId:String?,readPage:suspend (String?)->NativeProjectPage,onClose:()->Unit){
    val scope=rememberCoroutineScope()
    var page by remember(hostId){mutableStateOf<NativeProjectPage?>(null)}
    var busy by remember(hostId){mutableStateOf(false)}
    var error by remember(hostId){mutableStateOf<String?>(null)}
    var seen by remember(hostId){mutableStateOf(setOf<String>())}
    suspend fun load(cursor:String?){
        busy=true;error=null
        try{
            val next=readPage(cursor)
            if(cursor!=null)require(next.viewId==page?.viewId&&next.nextCursor!=cursor&&next.nextCursor !in seen){"项目分页已变化，请刷新"}
            if(cursor==null)seen=emptySet() else seen=seen+cursor
            page=next
        }catch(e:CancellationException){throw e}catch(e:Exception){page=null;seen=emptySet();error=e.message?:"项目读取失败，请刷新"}finally{busy=false}
    }
    LaunchedEffect(hostId){load(null)}
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false)){
        Surface(Modifier.fillMaxSize().padding(12.dp),shape=MaterialTheme.shapes.large){Column(Modifier.padding(16.dp)){
            Row{Text("Codex 项目",modifier=Modifier.weight(1f),style=MaterialTheme.typography.titleLarge);TextButton(onClick=onClose){Text("关闭")}}
            Text("显示电脑已授权的项目。列表暂存两分钟；查看最新变化请刷新。",style=MaterialTheme.typography.bodySmall)
            TextButton(onClick={scope.launch{load(null)}},enabled=!busy){Text("刷新")}
            if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
            LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(12.dp)){
                if(page?.entries?.isEmpty()==true)item{Text("没有已授权的 Codex 项目")}
                items(page?.entries.orEmpty(),key={it.getValue("project").jsonObject.getValue("id").jsonPrimitive.content}){entry->
                    val project=entry.getValue("project").jsonObject
                    var expanded by remember(entry){mutableStateOf(false)}
                    OutlinedCard(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp)){
                        Text(project["name"]?.jsonPrimitive?.content.orEmpty(),style=MaterialTheme.typography.titleMedium)
                        project.getValue("roots").jsonArray.forEach{root->SelectionContainer{Text(root.jsonObject.getValue("path").jsonPrimitive.content)}}
                        TextButton(onClick={expanded=!expanded}){Text(if(expanded)"收起详情" else "查看完整详情")}
                        if(expanded)SelectionContainer{Text(project.toString(),style=MaterialTheme.typography.bodySmall)}
                    }}
                }
            }
            page?.nextCursor?.let{cursor->TextButton(onClick={scope.launch{load(cursor)}},enabled=!busy){Text("下一页")}}
        }}
    }
}
