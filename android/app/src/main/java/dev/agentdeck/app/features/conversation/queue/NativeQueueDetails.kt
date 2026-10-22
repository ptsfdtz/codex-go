package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.serialization.json.*

/** Metadata only: a native queue path is not authorization to open a computer file. */
@Composable internal fun NativeQueueDetails(entry:JsonObject,mask:String,onClose:()->Unit){
    val parts=(entry["input"] as? JsonArray).orEmpty()
    var page by remember(entry){mutableIntStateOf(0)}
    var reader by remember(entry){mutableStateOf<Pair<String,String>?>(null)}
    val pages=((parts.size+11)/12).coerceAtLeast(1)
    val index=page.coerceIn(0,pages-1)
    val pretty=remember{Json{prettyPrint=true}}
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false)){
        Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)){
            Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
                Row(Modifier.fillMaxWidth()){Text("待发送输入与资源",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge);TextButton(onClick=onClose){Text("关闭")}}
                Text("电脑返回的原生输入记录。这里显示已排队内容与资源元数据，不读取资源文件，也不保证资源仍有效。",style=MaterialTheme.typography.bodySmall)
                Text("${parts.size} 个输入项",style=MaterialTheme.typography.labelSmall)
                TextButton(onClick={reader="原生队列记录" to pretty.encodeToString(JsonObject.serializer(),entry)}){Text("阅读完整记录")}
                if(pages>1)Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                    TextButton(onClick={page=index-1},enabled=index>0){Text("上一页")};Text("${index+1} / $pages");TextButton(onClick={page=index+1},enabled=index+1<pages){Text("下一页")}
                }
                LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(10.dp)){
                    parts.drop(index*12).take(12).forEachIndexed{offset,part->item(key=index*12+offset){
                        val obj=part as? JsonObject
                        val type=(obj?.get("type") as? JsonPrimitive)?.contentOrNull.orEmpty()
                        val label=when(type){"text"->"文字";"localImage","image"->"图片";"skill"->"技能";"mention"->"引用";"audio","localAudio"->"音频";else->type.ifBlank{"未知输入"}}
                        val body=if(type=="text")(obj?.get("text") as? JsonPrimitive)?.contentOrNull.orEmpty()else pretty.encodeToString(JsonElement.serializer(),part)
                        OutlinedCard{Column(Modifier.fillMaxWidth().padding(12.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
                            Text("${index*12+offset+1}. ${maskDisplay(label,mask)}",style=MaterialTheme.typography.titleSmall)
                            Text(maskDisplay(body,mask).take(1600),maxLines=8,style=MaterialTheme.typography.bodySmall)
                            TextButton(onClick={reader=label to body}){Text("阅读完整内容")}
                        }}
                    }}
                }
            }
        }
    }
    reader?.let{(title,text)->LoadedTextReader(title,text,mask){reader=null}}
}
