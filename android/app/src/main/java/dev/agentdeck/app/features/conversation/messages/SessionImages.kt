package dev.agentdeck.app

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

@Composable internal fun NativeMessage(entry:ChatEntry,mask:String,repo:DeckRepository,sessionId:String,extraActions:@Composable (()->Unit)->Unit = {}){
    var viewing by remember(repo.state.value.host?.hostId,sessionId,entry.id){mutableStateOf<Int?>(null)}
    val parts=remember(entry.detail){
        val item=runCatching{wire.parseToJsonElement(entry.detail).jsonObject}.getOrNull()
        when((item?.get("type") as? JsonPrimitive)?.contentOrNull){
            "imageView","imageGeneration"->listOf(0)
            "userMessage"->(item?.get("content") as? JsonArray).orEmpty().mapIndexedNotNull{index,part->if((part as? JsonObject)?.get("type")?.jsonPrimitive?.contentOrNull=="localImage")index else null}
            else->emptyList()
        }
    }
    NativeMessageLinks(repo,sessionId){Column{
        ChatMessage(entry,mask)
        if(entry.kind in listOf("user","assistant","plan"))MessageActions(entry,mask,repo,sessionId,extraActions)
        AssistantSources(entry,mask)
        AssistantQuestions(entry,mask,repo,sessionId)
        if(entry.kind=="user")NativeUserReferences(entry,mask)
        if(entry.sourceTurn!=null&&entry.sourceItem!=null&&repo.state.value.capabilities?.supports("sessionImages")==true)parts.forEachIndexed{index,part->
            TextButton(onClick={viewing=part},enabled=!repo.state.value.stale){Text(if(parts.size==1)"查看图片" else "查看图片 ${index+1}")}
        }
    }}
    viewing?.let{part->SessionImageDialog(repo,sessionId,entry.sourceTurn!!,entry.sourceItem!!,part){viewing=null}}
}

@Composable private fun SessionImageDialog(repo:DeckRepository,sessionId:String,turnId:String,itemId:String,index:Int,onClose:()->Unit){
    var bitmap by remember{mutableStateOf<ImageBitmap?>(null)}
    var error by remember{mutableStateOf<String?>(null)}
    var revision by remember{mutableIntStateOf(0)}
    var loading by remember{mutableStateOf(true)}
    LaunchedEffect(sessionId,turnId,itemId,index,revision){
        loading=true;error=null;bitmap=null
        try{
            val bytes=repo.readSessionImage(sessionId,turnId,itemId,index)
            bitmap=withContext(Dispatchers.Default){
                val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true}
                BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
                require(bounds.outWidth>0&&bounds.outHeight>0&&bounds.outWidth.toLong()*bounds.outHeight<=100_000_000){"图片尺寸无效或过大"}
                var sample=1
                while(bounds.outWidth/sample>2048||bounds.outHeight/sample>2048)sample*=2
                val decoded=BitmapFactory.decodeByteArray(bytes,0,bytes.size,BitmapFactory.Options().apply{inSampleSize=sample})?:error("无法解码图片")
                decoded.asImageBitmap()
            }
        }catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"图片读取失败"}finally{loading=false}
    }
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false)){
        Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)){
            Column(Modifier.padding(16.dp)){
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text("会话图片",style=MaterialTheme.typography.titleLarge);TextButton(onClick=onClose){Text("关闭")}}
                if(loading)LinearProgressIndicator(Modifier.fillMaxWidth())
                error?.let{Text(it,color=MaterialTheme.colorScheme.error);TextButton(onClick={revision++}){Text("重新读取")}}
                bitmap?.let{picture->ZoomableImage(picture,"会话中的图片",Modifier.fillMaxWidth().weight(1f))}
                Text("从电脑授权项目读取 · 大图按屏幕尺寸缩放",style=MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/** All image viewers operate on an already decoded, bounded bitmap. No resource reads here. */
@Composable internal fun ZoomableImage(picture:ImageBitmap,description:String,modifier:Modifier=Modifier){
    var zoom by remember(picture){mutableFloatStateOf(1f)}
    var pan by remember(picture){mutableStateOf(Offset.Zero)}
    var viewport by remember(picture){mutableStateOf(IntSize.Zero)}
    fun bound(offset:Offset,scale:Float):Offset{
        if(viewport.width==0||viewport.height==0)return Offset.Zero
        val fit=minOf(viewport.width.toFloat()/picture.width,viewport.height.toFloat()/picture.height)
        val x=((picture.width*fit*scale-viewport.width)/2f).coerceAtLeast(0f)
        val y=((picture.height*fit*scale-viewport.height)/2f).coerceAtLeast(0f)
        return Offset(offset.x.coerceIn(-x,x),offset.y.coerceIn(-y,y))
    }
    Column(modifier){
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.Center){
            TextButton(onClick={zoom=(zoom/1.5f).coerceAtLeast(1f);pan=bound(pan,zoom)},enabled=zoom>1f){Text("缩小")}
            TextButton(onClick={zoom=1f;pan=Offset.Zero}){Text("${(zoom*100).toInt()}% · 还原")}
            TextButton(onClick={zoom=(zoom*1.5f).coerceAtMost(8f);pan=bound(pan,zoom)},enabled=zoom<8f){Text("放大")}
        }
        Box(Modifier.fillMaxWidth().weight(1f).clipToBounds().onSizeChanged{viewport=it;pan=bound(pan,zoom)}
            .pointerInput(picture){detectTapGestures(onDoubleTap={zoom=if(zoom>1f)1f else 2f;pan=Offset.Zero})}
            .pointerInput(picture){detectTransformGestures{_,move,factor,_->zoom=(zoom*factor).coerceIn(1f,8f);pan=bound(pan+move,zoom)}}){
            Image(picture,description,Modifier.fillMaxSize().graphicsLayer{scaleX=zoom;scaleY=zoom;translationX=pan.x;translationY=pan.y},contentScale=ContentScale.Fit)
        }
    }
}

@Composable internal fun ImagePreviewDialog(picture:ImageBitmap,title:String,onClose:()->Unit){
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false)){
        Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)){
            Column(Modifier.padding(16.dp)){
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text(title,Modifier.weight(1f),style=MaterialTheme.typography.titleMedium);TextButton(onClick=onClose){Text("关闭")}}
                ZoomableImage(picture,title,Modifier.fillMaxWidth().weight(1f))
                Text("双指缩放、拖动或双击还原 · 解码后的静态预览",style=MaterialTheme.typography.labelSmall)
            }
        }
    }
}
