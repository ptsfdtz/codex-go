package dev.agentdeck.app

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

private fun JsonObject.toolString(key:String)=(get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()
private val readableToolJson=Json{prettyPrint=true}

/** Interpret known result shapes for display only. URIs never trigger implicit reads or execution. */
@Composable internal fun NativeToolResults(item:JsonObject,mask:String){
    val dynamic=item.toolString("type")=="dynamicToolCall"
    val result=item["result"] as? JsonObject
    val content=if(dynamic)item["contentItems"] as? JsonArray else result?.get("content") as? JsonArray
    var reading by remember(item.toolString("id")){mutableStateOf<Pair<String,String>?>(null)}
    var page by remember(item.toolString("id")){mutableIntStateOf(0)}
    var image by remember(item.toolString("id")){mutableStateOf<Pair<String,String>?>(null)}
    @Composable fun field(label:String,value:String){if(value.isNotBlank()){
        Text(label,style=MaterialTheme.typography.labelSmall)
        SelectionContainer{Text(maskDisplay(value,mask).take(24000),style=MaterialTheme.typography.bodySmall)}
        if(value.length>24000)TextButton(onClick={reading=label to value}){Text("阅读已加载完整内容")}
    }}
    @Composable fun media(mime:String,data:String){
        field("内嵌媒体",mime.ifBlank{"未知格式"})
        if(mime.lowercase() in listOf("image/png","image/jpeg","image/gif","image/webp")&&data.length<=700000)
            TextButton(onClick={image=mime to data}){Text("查看内嵌图片")}
        else Text("此媒体格式或大小暂不支持预览，内容保留在原始记录中。",style=MaterialTheme.typography.bodySmall)
    }
    if(content==null)Text(if(item.toolString("status")=="inProgress")"等待工具返回结果" else "工具未提供内容列表，详见原始记录。",style=MaterialTheme.typography.bodySmall)
    else if(content.isEmpty())Text("工具返回空内容列表。",style=MaterialTheme.typography.bodySmall)
    val pages=(((content?.size?:0)+19)/20).coerceAtLeast(1)
    val current=page.coerceIn(0,pages-1)
    @Composable fun pagination(){if(pages>1)Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
        TextButton(onClick={page=current-1},enabled=current>0){Text("上一页")}
        Text("${current+1} / $pages · ${content?.size?:0} 项",style=MaterialTheme.typography.labelSmall)
        TextButton(onClick={page=current+1},enabled=current<pages-1){Text("下一页")}
    }}
    pagination()
    content.orEmpty().drop(current*20).take(20).forEachIndexed{offset,element->
        val index=current*20+offset
        OutlinedCard(Modifier.fillMaxWidth()) {Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
            Text("结果 ${index+1}",style=MaterialTheme.typography.labelSmall)
            val part=element as? JsonObject
            when(part?.toolString("type")){
                "text","inputText"->{
                    val text=part.toolString("text")
                    if(text.isBlank())Text("空文本",style=MaterialTheme.typography.bodySmall)else MarkdownText(maskDisplay(text,mask).take(24000),fontSizeSp=13f)
                    if(text.length>24000)TextButton(onClick={reading="工具结果 ${index+1}" to text}){Text("阅读已加载完整正文")}
                }
                "image","audio"->media(part.toolString("mimeType"),part.toolString("data"))
                "inputImage","inputAudio"->{
                    val url=part.toolString(if(part.toolString("type")=="inputImage")"imageUrl" else "audioUrl")
                    val match=Regex("^data:([a-zA-Z0-9/+.-]+);base64,(.*)$",RegexOption.DOT_MATCHES_ALL).matchEntire(url)
                    if(match!=null)media(match.groupValues[1],match.groupValues[2])
                    else{field("媒体来源",url);WebLinkButton(url,mask,"在浏览器查看来源");Text("远端或电脑媒体地址不自动加载。",style=MaterialTheme.typography.labelSmall)}
                }
                "resource_link"->{
                    field("资源",part.toolString("title").ifBlank{part.toolString("name")})
                    field("说明",part.toolString("description"));field("类型",part.toolString("mimeType"));field("地址",part.toolString("uri"))
                    WebLinkButton(part.toolString("uri"),mask,"在浏览器查看资源来源")
                    Text("资源链接仅供查看，不授予读取权限。",style=MaterialTheme.typography.labelSmall)
                }
                "resource"->{
                    val resource=part["resource"] as? JsonObject
                    if(resource==null)field("资源记录",part.toString())else{
                        field("资源地址",resource.toolString("uri"));field("类型",resource.toolString("mimeType"))
                        if(resource["text"] is JsonPrimitive){
                            val text=resource.toolString("text")
                            if(resource.toolString("mimeType").lowercase() in listOf("text/markdown","text/x-markdown"))MarkdownText(maskDisplay(text,mask).take(24000),fontSizeSp=13f)
                            else field("资源正文",text)
                            if(text.length>24000)TextButton(onClick={reading="资源正文" to text}){Text("阅读已加载完整正文")}
                        }else if(resource["blob"] is JsonPrimitive)media(resource.toolString("mimeType"),resource.toolString("blob"))
                    }
                }
                else->field("未识别的内容",element.toString())
            }
        }}
    }
    pagination()
    result?.get("structuredContent")?.takeUnless{it==JsonNull}?.let{structured->
        Text("结构化结果",style=MaterialTheme.typography.labelSmall)
        val json=remember(structured){readableToolJson.encodeToString(JsonElement.serializer(),structured)}
        MessageCodeBlock(MessageBlock(maskDisplay(json,mask).take(24000),"json"))
        if(json.length>24000)TextButton(onClick={reading="结构化结果" to json}){Text("阅读已加载完整结构化结果")}
    }
    item["error"]?.takeUnless{it==JsonNull}?.let{field("工具错误",it.toString())}
    reading?.let{(title,text)->LoadedTextReader(title,text,mask){reading=null}}
    image?.let{source->ToolResultImage(source.first,source.second){image=null}}
}

@Composable private fun ToolResultImage(mime:String,data:String,onClose:()->Unit){
    var bitmap by remember{mutableStateOf<ImageBitmap?>(null)}
    var error by remember{mutableStateOf<String?>(null)}
    LaunchedEffect(mime,data){try{
        bitmap=withContext(Dispatchers.Default){
            require(data.length<=700000){"图片数据过大"}
            val bytes=java.util.Base64.getDecoder().decode(data)
            require(bytes.size<=512*1024){"内嵌图片预览上限为 512 KiB"}
            val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true}
            BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
            require(bounds.outWidth>0&&bounds.outHeight>0&&bounds.outWidth.toLong()*bounds.outHeight<=100_000_000){"图片尺寸无效或过大"}
            require(bounds.outMimeType?.lowercase()==mime.lowercase()){ "图片类型与内容不符" }
            var sample=1
            while(bounds.outWidth/sample>1536||bounds.outHeight/sample>1536)sample*=2
            (BitmapFactory.decodeByteArray(bytes,0,bytes.size,BitmapFactory.Options().apply{inSampleSize=sample})?:error("图片解码失败")).asImageBitmap()
        }
    }catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"图片预览失败"}}
    if(bitmap!=null){ImagePreviewDialog(bitmap!!,"工具返回的图片",onClose);return}
    AlertDialog(onDismissRequest=onClose,title={Text("工具返回的图片")},text={Column{
        if(bitmap==null&&error==null)LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
        bitmap?.let{Image(it,"工具返回的内嵌图片",Modifier.fillMaxWidth().heightIn(max=400.dp),contentScale=ContentScale.Fit)}
        Text("仅解码已加载结果中的数据，不访问网络或电脑路径；动画显示静态帧。",style=MaterialTheme.typography.labelSmall)
    }},confirmButton={TextButton(onClick=onClose){Text("关闭")}})
}
