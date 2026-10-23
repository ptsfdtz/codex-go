package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable internal fun ProjectFiles(repo:DeckRepository,state:DeckState,projectId:String,onReference:(String)->Boolean={false},onDismiss:()->Unit){
    var directory by remember{mutableStateOf("")}
    var query by remember{mutableStateOf("")}
    var data by remember{mutableStateOf<JsonObject?>(null)}
    var error by remember{mutableStateOf<String?>(null)}
    var loading by remember{mutableStateOf(false)}
    var revision by remember{mutableIntStateOf(0)}
    var preview by remember(state.host?.hostId,projectId){mutableStateOf<String?>(null)}
    var resolving by remember{mutableStateOf(false)}
    val scope=rememberCoroutineScope()
    preview?.let{path->ProjectTextPreview(repo,state,projectId,path,onReference={reference->if(onReference(reference)){onDismiss();true}else false}){preview=null}}
    LaunchedEffect(state.host?.hostId,state.connection,state.stale,directory,revision){
        data=null;error=null;loading=false
        if(!state.stale){loading=true;try{data=repo.listProjectFiles(projectId,directory)}catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"无法读取目录"}finally{loading=false}}
    }
    Dialog(onDismissRequest=onDismiss){Surface(shape=MaterialTheme.shapes.large,modifier=Modifier.fillMaxWidth().heightIn(max=620.dp)){
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
            Text("项目文件",style=MaterialTheme.typography.titleLarge)
            SelectionContainer{Text(maskDisplay(directory.ifBlank{"项目根目录"},state.displayMask),style=MaterialTheme.typography.bodySmall)}
            Row{
                TextButton(onClick={directory=directory.substringBeforeLast('/',"");query=""},enabled=directory.isNotEmpty()&&!loading){Text("上一级")}
                TextButton(onClick={directory="";query=""},enabled=directory.isNotEmpty()&&!loading){Text("根目录")}
                TextButton(onClick={revision++},enabled=!state.stale&&!loading){Text("刷新")}
            }
            OutlinedTextField(value=query,onValueChange={query=it.take(200)},singleLine=true,label={Text("筛选当前目录")},modifier=Modifier.fillMaxWidth())
            if(loading)LinearProgressIndicator(Modifier.fillMaxWidth())
            if(state.stale)Text("连接电脑后可浏览文件。")
            error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
            val entries=(data?.get("entries") as? JsonArray).orEmpty().mapNotNull{it as? JsonObject}.filter{it["name"]?.jsonPrimitive?.contentOrNull?.contains(query,true)==true}
            if(data!=null&&entries.isEmpty())Text("没有匹配的文件或目录")
            LazyColumn(Modifier.weight(1f,fill=false)){
                items(entries){entry->
                    val folder=entry["kind"]?.jsonPrimitive?.content=="directory"
                    val name=entry["name"]?.jsonPrimitive?.content.orEmpty()
                    if(folder)TextButton(onClick={directory=entry["path"]!!.jsonPrimitive.content;query=""},enabled=!state.stale&&!loading){Text("▸ "+maskDisplay(name,state.displayMask))}
                    else Row(Modifier.fillMaxWidth()){
                        ListItem(modifier=Modifier.weight(1f).clickable(enabled=!state.stale&&state.capabilities?.supports("projectTextPreview")==true){preview=entry["path"]!!.jsonPrimitive.content},headlineContent={Text(maskDisplay(name,state.displayMask))},supportingContent={Text("${entry["size"]?.jsonPrimitive?.longOrNull?:0} 字节 · 预览正文")})
                        if(state.capabilities?.supports("projectFileReference")==true)TextButton(enabled=!state.stale&&!state.busy&&!resolving,onClick={scope.launch{
                            resolving=true;error=null
                            try{val reference=repo.projectFileReference(projectId,entry["path"]!!.jsonPrimitive.content);if(onReference(reference))onDismiss()}
                            catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"无法引用文件"}finally{resolving=false}
                        }}){Text("引用")}
                    }
                }
            }
            if(data?.get("truncated")?.jsonPrimitive?.booleanOrNull==true)Text("目录达到扫描数量或响应大小上限，仅显示部分结果。",style=MaterialTheme.typography.labelSmall)
            if(resolving)LinearProgressIndicator(Modifier.fillMaxWidth())
            Text("点击文件预览 UTF-8 正文（最多 256 KiB）；引用会将电脑文件链接加入当前草稿，文件内容不会被冻结。",style=MaterialTheme.typography.labelSmall)
            TextButton(onClick=onDismiss,modifier=Modifier.fillMaxWidth()){Text("关闭")}
        }
    }}
}
