package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

private fun JsonObject.inputString(key:String)=(this[key] as? JsonPrimitive)?.contentOrNull.orEmpty()

/** Display only: references never authorize file access, media loading or skill execution. */
internal fun nativeUserText(content:JsonArray):String=content.joinToString("\n"){value->
    val part=value as? JsonObject
    if(part==null)"[未知输入]" else when(val type=part.inputString("type")){
        "text"->part.inputString("text")
        "skill"->"[技能：${part.inputString("name")}]"
        "mention"->"[引用：${part.inputString("name")}]"
        "localImage","image"->"[图片]"
        "localAudio","audio"->"[音频]"
        else->"[${type.ifBlank{"未知输入"}}]"
    }
}

private data class InputReference(val label:String,val value:String,val file:String?=null)

private fun nativeUserReferences(item:JsonObject):List<InputReference>{
    val references=mutableListOf<InputReference>()
    (item["content"] as? JsonArray).orEmpty().forEachIndexed{index,value->
        val part=value as? JsonObject?:return@forEachIndexed
        val type=part.inputString("type")
        if(type=="text"){
            val bytes=part.inputString("text").toByteArray(Charsets.UTF_8)
            (part["text_elements"] as? JsonArray).orEmpty().forEach{element->
                val span=element as? JsonObject?:return@forEach
                val range=span["byteRange"] as? JsonObject
                val start=(range?.get("start") as? JsonPrimitive)?.intOrNull
                val end=(range?.get("end") as? JsonPrimitive)?.intOrNull
                fun boundary(offset:Int)=offset==bytes.size||(bytes[offset].toInt() and 0xc0)!=0x80
                val valid=start!=null&&end!=null&&start>=0&&end>=start&&end<=bytes.size&&boundary(start)&&boundary(end)
                val source=if(valid)bytes.copyOfRange(start!!,end!!).toString(Charsets.UTF_8) else "范围无效，原文字保持显示"
                val placeholder=span.inputString("placeholder")
                references+=InputReference("文本元素 · 输入 ${index+1}",listOf(placeholder,source).filter{it.isNotBlank()}.joinToString("\n"))
            }
        }else{
            val label=when(type){"skill"->"技能";"mention"->"引用";"localImage"->"电脑图片";"image"->"远端图片";"localAudio"->"电脑音频";"audio"->"远端音频";else->"输入类型 $type"}
            val fields=listOf("name","path","url","fileId").mapNotNull{key->part.inputString(key).takeIf{it.isNotBlank()}}
            references+=InputReference("$label · 输入 ${index+1}",fields.joinToString("\n").ifBlank{"详见原始记录"},if(type=="mention")part.inputString("path").takeIf{it.isNotBlank()}else null)
        }
    }
    return references
}

@Composable internal fun NativeUserReferences(entry:ChatEntry,mask:String){
    val references=remember(entry.detail){
        val item=runCatching{wire.parseToJsonElement(entry.detail) as? JsonObject}.getOrNull()
        if(item?.inputString("type")=="userMessage")nativeUserReferences(item) else emptyList()
    }
    if(references.isEmpty())return
    var expanded by rememberSaveable(entry.id){mutableStateOf(false)}
    var page by remember(entry.id){mutableIntStateOf(0)}
    var reading by remember(entry.id,mask){mutableStateOf<InputReference?>(null)}
    val openFile=LocalNativeFilePreview.current
    reading?.let{LoadedTextReader(it.label,it.value,mask){reading=null}}
    Column(Modifier.fillMaxWidth()){
        TextButton(onClick={expanded=!expanded}){Text(if(expanded)"收起输入与引用 (${references.size})" else "输入与引用 (${references.size})")}
        if(expanded){
            Text("引用按原输入顺序显示；文件预览仍需通过当前项目授权检查，不读取其他引用资源。",style=MaterialTheme.typography.labelSmall)
            val pages=((references.size+19)/20).coerceAtLeast(1)
            val current=page.coerceIn(0,pages-1)
            if(pages>1)Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                TextButton(onClick={page=current-1},enabled=current>0){Text("上一页")}
                Text("${current+1} / $pages",style=MaterialTheme.typography.labelSmall)
                TextButton(onClick={page=current+1},enabled=current<pages-1){Text("下一页")}
            }
            references.drop(current*20).take(20).forEach{reference->
                OutlinedCard(Modifier.fillMaxWidth().padding(vertical=4.dp)){
                    Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
                        Text(reference.label,style=MaterialTheme.typography.labelMedium)
                        SelectionContainer{Text(maskDisplay(reference.value,mask).take(16000),style=MaterialTheme.typography.bodySmall)}
                        if(reference.value.length>16000)TextButton(onClick={reading=reference}){Text("阅读已加载完整引用")}
                        reference.file?.let{path->if(openFile!=null)TextButton(onClick={openFile(path)}){Text("预览当前项目文件")}}
                    }
                }
            }
        }
    }
}
