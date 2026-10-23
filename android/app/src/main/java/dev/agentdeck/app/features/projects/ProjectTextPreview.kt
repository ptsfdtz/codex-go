package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import kotlinx.coroutines.launch
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*

@Composable internal fun ProjectTextPreview(repo:DeckRepository,state:DeckState,projectId:String,path:String,initialLine:Int?=null,endLine:Int?=null,onReference:((String)->Boolean)?=null,onClose:()->Unit){
    var result by remember{mutableStateOf<JsonObject?>(null)}
    var error by remember{mutableStateOf<String?>(null)}
    var loading by remember{mutableStateOf(false)}
    var revision by remember{mutableIntStateOf(0)}
    val clipboard=LocalClipboardManager.current
    val scope=rememberCoroutineScope()
    var start by remember(path){mutableStateOf(initialLine?.toString().orEmpty())}
    var finish by remember(path){mutableStateOf(endLine?.toString().orEmpty())}
    var referencing by remember{mutableStateOf(false)}
    var referenceError by remember{mutableStateOf<String?>(null)}
    LaunchedEffect(state.host?.hostId,state.connection,state.stale,projectId,path,revision){
        result=null;error=null;loading=false
        if(!state.stale){loading=true;try{result=repo.readProjectText(projectId,path)}catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"无法预览文件"}finally{loading=false}}
    }
    val text=result?.get("text")?.jsonPrimitive?.content
    val displayed=remember(text,state.displayMask){text?.let{maskDisplay(it,state.displayMask)}}
    val lines=remember(displayed){displayed?.split('\n').orEmpty()}
    val from=start.toIntOrNull()
    val to=finish.toIntOrNull()?:from
    val validRange=from!=null&&to!=null&&from>=1&&to>=from&&to<=lines.size
    val list=rememberLazyListState()
    LaunchedEffect(displayed,initialLine){if(displayed!=null&&initialLine!=null)list.scrollToItem((initialLine-1).coerceIn(0,(lines.size-1).coerceAtLeast(0)))}
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false)){
        Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)){
            Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                Text("文件预览",style=MaterialTheme.typography.titleLarge)
                SelectionContainer{Text(maskDisplay(path,state.displayMask),style=MaterialTheme.typography.bodySmall)}
                Row{
                    TextButton(onClick={revision++},enabled=!state.stale&&!loading){Text("刷新")}
                    TextButton(onClick={displayed?.let{clipboard.setText(AnnotatedString(it))}},enabled=displayed!=null&&!state.stale){Text("复制正文")}
                    TextButton(onClick=onClose){Text("关闭")}
                }
                if(displayed!=null){
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        OutlinedTextField(start,{if(it.length<=8&&it.all(Char::isDigit))start=it},Modifier.weight(1f),singleLine=true,label={Text("起始行")},keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number))
                        OutlinedTextField(finish,{if(it.length<=8&&it.all(Char::isDigit))finish=it},Modifier.weight(1f),singleLine=true,label={Text("结束行（可空）")},keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number))
                    }
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())){
                        TextButton(onClick={scope.launch{list.scrollToItem(from!!-1)}},enabled=validRange){Text("定位范围")}
                        TextButton(onClick={if(validRange)clipboard.setText(AnnotatedString(lines.subList(from!!-1,to!!).joinToString("\n")))},enabled=validRange){Text("复制所选行")}
                        if(onReference!=null&&state.capabilities?.supports("projectFileReference")==true)TextButton(onClick={scope.launch{
                            val selectedFrom=from;val selectedTo=to
                            referencing=true;referenceError=null
                            try{
                                repo.projectFileReference(projectId,path)
                                val encoded=path.split('/').joinToString("/"){java.net.URLEncoder.encode(it,"UTF-8").replace("+","%20")}
                                val reference="[文件第 ${selectedFrom}–${selectedTo} 行]($encoded#L$selectedFrom-L$selectedTo)"
                                if(onReference(reference))onClose()
                            }catch(e:CancellationException){throw e}catch(e:Exception){referenceError=e.message?:"无法加入引用"}finally{referencing=false}
                        }},enabled=validRange&&!referencing&&!state.stale&&!state.busy){Text("引用范围")}
                    }
                    if(start.isNotEmpty()&&!validRange)Text("请输入当前文件范围内的有效行号。",style=MaterialTheme.typography.labelSmall)
                    referenceError?.let{Text(it,color=MaterialTheme.colorScheme.error)}
                    if(referencing)LinearProgressIndicator(Modifier.fillMaxWidth())
                }
                if(loading)LinearProgressIndicator(Modifier.fillMaxWidth())
                if(state.stale)Text("连接已断开，重新连接后读取文件。")
                error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
                if(displayed!=null){
                    Text("${result?.get("size")?.jsonPrimitive?.content.orEmpty()} 字节 · UTF-8 · ${lines.size} 行",style=MaterialTheme.typography.labelSmall)
                    if(initialLine!=null&&initialLine>lines.size)Text("引用行号超出当前文件范围，已定位到末行。",style=MaterialTheme.typography.bodySmall)
                    if(displayed.isEmpty())Text("空文件")
                    SelectionContainer(Modifier.weight(1f)){
                        LazyColumn(Modifier.fillMaxSize(),state=list){
                            itemsIndexed(lines){index,line->Row(Modifier.fillMaxWidth().then(if(validRange&&index+1 in from!!..to!!)Modifier.background(MaterialTheme.colorScheme.secondaryContainer)else Modifier).padding(vertical=2.dp)){
                                Text("${index+1}",Modifier.width(52.dp),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(line.ifEmpty{" "},fontFamily=FontFamily.Monospace,style=MaterialTheme.typography.bodySmall,modifier=Modifier.weight(1f))
                            }}
                        }
                    }
                }
            }
        }
    }
}
