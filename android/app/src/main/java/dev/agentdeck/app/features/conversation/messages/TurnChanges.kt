package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

internal data class ChangedFile(val path:String,val added:Int,val removed:Int,val diffs:List<String>)
internal data class TurnChanges(val records:List<ChatEntry>,val files:Int,val added:Int,val removed:Int,val partial:Boolean,val details:List<ChangedFile>)
internal fun turnChanges(entries:List<ChatEntry>):TurnChanges?{
    val paths=linkedSetOf<String>()
    val details=linkedMapOf<String,ChangedFile>()
    var added=0;var removed=0
    val records=entries.distinctBy{it.id}.filter{entry->
        val item=runCatching{wire.parseToJsonElement(entry.detail).jsonObject}.getOrNull()
        item?.get("type")?.jsonPrimitive?.contentOrNull=="fileChange"&&entry.status !in listOf("failed","inProgress","running")&&item["status"]?.jsonPrimitive?.contentOrNull !in listOf("failed","inProgress","declined")
    }
    for(entry in records){
        val item=wire.parseToJsonElement(entry.detail).jsonObject
        for(change in (item["changes"] as? JsonArray).orEmpty()){
            val file=change as? JsonObject?:continue
            val path=file["path"]?.jsonPrimitive?.contentOrNull?.takeIf{it.isNotBlank()}?:continue
            paths.add(path)
            val lines=diffLines(file["diff"]?.jsonPrimitive?.contentOrNull.orEmpty())
            added+=lines.count{it.kind==DiffLineKind.ADDED}
            removed+=lines.count{it.kind==DiffLineKind.REMOVED}
            val old=details[path]
            details[path]=ChangedFile(path,(old?.added?:0)+lines.count{it.kind==DiffLineKind.ADDED},(old?.removed?:0)+lines.count{it.kind==DiffLineKind.REMOVED},old?.diffs.orEmpty()+file["diff"]?.jsonPrimitive?.contentOrNull.orEmpty())
        }
    }
    return if(paths.isEmpty())null else TurnChanges(records,paths.size,added,removed,records.any{it.truncated},details.values.toList())
}

@Composable internal fun TurnChangesBadge(changes:TurnChanges,mask:String,partialHistory:Boolean){
    var open by remember{mutableStateOf(false)}
    Surface(onClick={open=true},shape=RoundedCornerShape(12.dp),color=MaterialTheme.colorScheme.surfaceContainerHigh,modifier=Modifier.padding(vertical=6.dp)){
        Row(Modifier.padding(horizontal=12.dp,vertical=8.dp),horizontalArrangement=Arrangement.spacedBy(5.dp)){
            Text("${changes.files} 个文件改动",style=MaterialTheme.typography.labelSmall)
            Text("+${changes.added}",color=Color(0xFF35AD75),style=MaterialTheme.typography.labelSmall)
            Text("−${changes.removed}",color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.labelSmall)
        }
    }
    if(open)TurnChangesDialog(changes,mask,partialHistory,null){open=false}
}

@Composable private fun ChangeCounts(added:Int,removed:Int){
    Row(horizontalArrangement=Arrangement.spacedBy(6.dp)){
        Text("+$added",color=Color(0xFF35AD75),style=MaterialTheme.typography.labelSmall)
        Text("−$removed",color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.labelSmall)
    }
}

@Composable internal fun TurnChangesCard(changes:TurnChanges,mask:String,partialHistory:Boolean){
    var expanded by remember{mutableStateOf(false)}
    var viewing by remember{mutableStateOf<String?>(null)}
    var open by remember{mutableStateOf(false)}
    OutlinedCard(Modifier.fillMaxWidth().padding(vertical=8.dp),shape=RoundedCornerShape(12.dp)){
        Row(Modifier.fillMaxWidth().padding(start=12.dp,end=4.dp),verticalAlignment=Alignment.CenterVertically){
            Icon(Icons.Outlined.Difference,null,Modifier.size(20.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
            Column(Modifier.weight(1f).padding(horizontal=10.dp,vertical=10.dp)){
                Text("修改了 ${changes.files} 个文件",style=MaterialTheme.typography.labelLarge)
                ChangeCounts(changes.added,changes.removed)
            }
            TextButton(onClick={viewing=null;open=true}){Text("查看改动",style=MaterialTheme.typography.labelSmall)}
        }
        changes.details.take(if(expanded)changes.details.size else 3).forEach{file->
            HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant.copy(alpha=0.4f))
            Row(Modifier.fillMaxWidth().clickable{viewing=file.path;open=true}.padding(horizontal=12.dp,vertical=9.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)){
                Text(maskDisplay(file.path,mask),Modifier.weight(1f),maxLines=1,overflow=TextOverflow.StartEllipsis,style=MaterialTheme.typography.bodySmall)
                ChangeCounts(file.added,file.removed)
            }
        }
        if(changes.files>3)TextButton(onClick={expanded=!expanded},contentPadding=PaddingValues(horizontal=12.dp,vertical=0.dp)){
            Text(if(expanded)"收起文件列表" else "再显示 ${changes.files-3} 个文件",style=MaterialTheme.typography.labelSmall)
            Icon(if(expanded)Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,null,Modifier.size(16.dp))
        }
        if(partialHistory||changes.partial)Text("仅含已加载的改动",Modifier.padding(horizontal=12.dp,vertical=6.dp),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if(open)TurnChangesDialog(changes,mask,partialHistory,viewing){open=false}
}

@Composable private fun TurnChangesDialog(changes:TurnChanges,mask:String,partialHistory:Boolean,initialPath:String?,onClose:()->Unit){
    var selected by remember{mutableStateOf(initialPath?:changes.details.first().path)}
    val file=changes.details.firstOrNull{it.path==selected}?:changes.details.first()
    val diff=remember(file){Diff(path=maskDisplay(file.path,mask),text=file.diffs.joinToString("\n\n"),truncated=changes.partial,attribution="turn-steps")}
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false)){
        Surface(Modifier.fillMaxWidth().fillMaxHeight(0.88f).windowInsetsPadding(WindowInsets.safeDrawing),shape=RoundedCornerShape(20.dp)){
            Column{
                Row(Modifier.fillMaxWidth().padding(start=16.dp,end=6.dp,top=4.dp),verticalAlignment=Alignment.CenterVertically){
                    Text("文件改动",Modifier.weight(1f),style=MaterialTheme.typography.titleMedium)
                    ChangeCounts(changes.added,changes.removed)
                    IconButton(onClick=onClose){Icon(Icons.Outlined.Close,"关闭改动详情")}
                }
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal=12.dp),horizontalArrangement=Arrangement.spacedBy(6.dp)){
                    changes.details.forEach{entry->FilterChip(selected=entry.path==file.path,onClick={selected=entry.path},label={Text(maskDisplay(entry.path.substringAfterLast('/').substringAfterLast('\\'),mask),maxLines=1)})}
                }
                Text(if(partialHistory||changes.partial)"已加载步骤累计 · 记录不完整" else "本轮步骤累计 · 非工作区净差异",Modifier.padding(horizontal=16.dp,vertical=4.dp),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                if(file.diffs.all{it.isBlank()})Text("此记录没有可显示的文本差异",Modifier.padding(16.dp),style=MaterialTheme.typography.bodySmall)
                else key(file.path){DiffPane(diff,Modifier.weight(1f).fillMaxWidth(),mask)}
            }
        }
    }
}
