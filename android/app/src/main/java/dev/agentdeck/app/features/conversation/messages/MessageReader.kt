package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

/** UTF-16 boundaries must never split a surrogate pair, including before clipboard copies. */
internal fun messagePageOffsets(text:String,limit:Int=32000):List<Int>{
    require(limit>=2)
    val offsets=mutableListOf(0)
    var position=0
    while(position<text.length){var next=(position+limit).coerceAtMost(text.length);if(next<text.length&&text[next-1].isHighSurrogate()&&text[next].isLowSurrogate())next--;offsets+=next;position=next}
    if(offsets.size==1)offsets+=0
    return offsets
}

internal fun loadedMessageText(entry:ChatEntry):String{
    val item=runCatching{wire.parseToJsonElement(entry.detail) as? JsonObject}.getOrNull()
    return if(item!=null&&!(item["type"] as? JsonPrimitive)?.contentOrNull.isNullOrBlank())nativeItemEntry(entry.id,item,textLimit=Int.MAX_VALUE).text.ifEmpty{entry.text} else entry.text
}

@Composable internal fun LoadedTextReader(title:String,text:String,mask:String,onClose:()->Unit){
    MessageReader(ChatEntry("loaded-text","tool",text),mask,title=title,onClose=onClose)
}

@Composable internal fun MessageReader(entry:ChatEntry,mask:String,title:String="已加载消息正文",allowRaw:Boolean=false,onQuote:((String)->Unit)?=null,onClose:()->Unit){
    var rawRecord by remember{mutableStateOf(false)}
    var body by remember{mutableStateOf<String?>(null)}
    var error by remember{mutableStateOf<String?>(null)}
    var page by remember{mutableIntStateOf(0)}
    var query by remember{mutableStateOf("")}
    var match by remember{mutableIntStateOf(0)}
    var markdown by remember{mutableStateOf(false)}
    val clipboard=LocalClipboardManager.current
    LaunchedEffect(entry.detail,entry.text,mask,rawRecord){
        body=null;error=null;page=0;markdown=false
        try{body=withContext(Dispatchers.Default){
            val text=if(rawRecord)entry.detail else loadedMessageText(entry)
            maskDisplay(text,mask)
        }}catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"无法读取已加载正文"}
    }
    val text=body.orEmpty()
    val offsets=remember(text){messagePageOffsets(text)}
    val count=offsets.size-1
    val matches=remember(text,query){buildList<Int>{if(query.isNotBlank()){var start=0;while(size<1001){val found=text.indexOf(query,start,ignoreCase=true);if(found<0)break;add(found);start=found+query.length}}}}
    LaunchedEffect(query){match=0}
    LaunchedEffect(match,matches){matches.getOrNull(match)?.let{position->page=(offsets.indexOfLast{it<=position}).coerceIn(0,count-1)}}
    val index=page.coerceIn(0,count-1)
    val chunk=text.substring(offsets[index],offsets[index+1])
    val scroll=rememberScrollState()
    var targetY by remember{mutableIntStateOf(0)}
    LaunchedEffect(index,match,matches,targetY,markdown){
        val position=matches.getOrNull(match)
        scroll.scrollTo(if(!markdown&&position!=null&&position in offsets[index] until offsets[index+1])targetY else 0)
    }
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false)){
        Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).imePadding()){
            Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                Row(Modifier.fillMaxWidth()){Text(maskDisplay(title,mask),Modifier.weight(1f),style=MaterialTheme.typography.titleLarge);TextButton(onClick=onClose){Text("关闭")}}
                if(allowRaw)Row{
                    TextButton(onClick={rawRecord=false},enabled=rawRecord){Text("内容")}
                    TextButton(onClick={rawRecord=true},enabled=!rawRecord){Text("原始记录")}
                }
                if(body==null&&error==null)LinearProgressIndicator(Modifier.fillMaxWidth())
                error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
                OutlinedTextField(query,{query=it.take(200)},Modifier.fillMaxWidth(),singleLine=true,label={Text("查找正文")})
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                    TextButton(onClick={match=(match-1+matches.size)%matches.size},enabled=matches.isNotEmpty()){Text("上一处")}
                    Text(if(matches.isEmpty())"0 / 0" else "${match+1} / ${matches.size}"+(if(matches.size>1000)"+" else ""),style=MaterialTheme.typography.labelSmall)
                    TextButton(onClick={match=(match+1)%matches.size},enabled=matches.isNotEmpty()){Text("下一处")}
                }
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())){
                    TextButton(onClick={clipboard.setText(AnnotatedString(chunk))},enabled=body!=null){Text("复制当前段")}
                    if(onQuote!=null&&!rawRecord)TextButton(onClick={onQuote(chunk)},enabled=body!=null&&chunk.isNotBlank()){Text("引用当前段")}
                    if(count==1&&entry.kind!="user"&&!rawRecord)TextButton(onClick={markdown=!markdown}){Text(if(markdown)"查看纯文本" else "渲染 Markdown")}
                }
                SelectionContainer(Modifier.weight(1f).verticalScroll(scroll)){
                    if(markdown&&count==1&&!rawRecord)MarkdownText(text)else{
                        val position=matches.getOrNull(match)?.minus(offsets[index])
                        val highlighted=buildAnnotatedString{
                            append(chunk)
                            if(position!=null&&position in chunk.indices)addStyle(SpanStyle(background=MaterialTheme.colorScheme.secondaryContainer),position,(position+query.length).coerceAtMost(chunk.length))
                        }
                        Text(highlighted,fontFamily=FontFamily.Monospace,style=MaterialTheme.typography.bodySmall,onTextLayout={layout->targetY=if(position!=null&&position in chunk.indices)layout.getLineTop(layout.getLineForOffset(position)).toInt()else 0})
                    }
                }
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                    TextButton(onClick={page--},enabled=index>0){Text("上一段")}
                    Text("${index+1} / $count",style=MaterialTheme.typography.labelSmall)
                    TextButton(onClick={page++},enabled=index<count-1){Text("下一段")}
                }
                Text("${text.length} 字符 · 长正文分段纯文本阅读，查找最多定位前 1001 处。仅使用已加载记录，不恢复上游或传输截断的内容。",style=MaterialTheme.typography.labelSmall)
            }
        }
    }
}
