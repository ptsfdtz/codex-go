package dev.agentdeck.app

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

@Composable internal fun ComposerAttachmentPreview(file:ChatAttachment,mask:String,busy:Boolean,onRemove:()->Unit,onClose:()->Unit){
    var expanded by remember(file){mutableStateOf(false)}
    var image by remember(file){mutableStateOf<ImageBitmap?>(null)}
    var text by remember(file){mutableStateOf<String?>(null)}
    var info by remember(file){mutableStateOf("正在读取预览…")}
    LaunchedEffect(file){
        try{
            val result=withContext(Dispatchers.Default){
                val bytes=Base64.decode(file.data,Base64.NO_WRAP)
                require(bytes.size<=512*1024&&bytes.size==file.size)
                val options=BitmapFactory.Options().apply{inJustDecodeBounds=true}
                BitmapFactory.decodeByteArray(bytes,0,bytes.size,options)
                if(options.outWidth>0&&options.outHeight>0){
                    require(options.outWidth.toLong()*options.outHeight<=100_000_000){"图片尺寸过大，无法预览"}
                    var sample=1
                    while(options.outWidth/sample>1536||options.outHeight/sample>1536)sample*=2
                    val bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.size,BitmapFactory.Options().apply{inSampleSize=sample})?:error("图片解码失败")
                    Triple(bitmap.asImageBitmap(),null,"${options.outWidth} × ${options.outHeight} · 静态预览")
                }else{
                    val decoded=if(bytes.size<=64*1024&&!bytes.contains(0.toByte()))runCatching{Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()}.getOrNull()else null
                    Triple(null,decoded,if(decoded!=null)"UTF-8 正文预览" else "此格式或大小暂不支持本地预览，附件仍可发送。")
                }
            }
            image=result.first;text=result.second;info=result.third
        }catch(e:CancellationException){throw e}catch(e:Exception){info=e.message?:"无法预览附件，附件仍保留在草稿中。"}
    }
    AlertDialog(onDismissRequest=onClose,title={Text(maskDisplay(file.name,mask))},text={
        Column(Modifier.heightIn(max=440.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)){
            Text("${file.size} 字节 · $info",style=MaterialTheme.typography.bodySmall)
            image?.let{Image(it,contentDescription="待发送的附件图片",modifier=Modifier.fillMaxWidth().heightIn(max=300.dp),contentScale=ContentScale.Fit)}
            if(image!=null)TextButton(onClick={expanded=true}){Text("全屏查看图片")}
            text?.let{SelectionContainer{Text(maskDisplay(it,mask).ifEmpty{"空文件"},style=MaterialTheme.typography.bodySmall)}}
            Text("预览只使用已选附件的内存内容。发送时才上传电脑；进程退出不保证恢复。",style=MaterialTheme.typography.labelSmall)
        }
    },confirmButton={TextButton(onClick=onClose){Text("关闭")}},dismissButton={TextButton(onClick=onRemove,enabled=!busy){Text("移除附件")}})
    if(expanded)image?.let{ImagePreviewDialog(it,maskDisplay(file.name,mask)){expanded=false}}
}
