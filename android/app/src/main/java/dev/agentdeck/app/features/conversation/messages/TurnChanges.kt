package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

internal data class TurnChanges(val records:List<ChatEntry>,val files:Int,val added:Int,val removed:Int,val partial:Boolean)
internal fun turnChanges(entries:List<ChatEntry>):TurnChanges?{
    val paths=linkedSetOf<String>()
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
        }
    }
    return if(paths.isEmpty())null else TurnChanges(records,paths.size,added,removed,records.any{it.truncated})
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
    if(open)AlertDialog(onDismissRequest={open=false},title={Text("本轮文件改动")},text={
        LazyColumn(Modifier.fillMaxWidth().heightIn(max=520.dp)){
            item{Text("按已加载的成功文件修改步骤统计；同一文件计一次，增删行数为步骤累计，可能不同于最终净差异。",style=MaterialTheme.typography.bodySmall)}
            if(partialHistory||changes.partial)item{Text("记录未全部加载或已截断，当前统计不完整。",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.error)}
            items(changes.records,key={it.id}){NativeToolBody(it,mask)}
        }
    },confirmButton={TextButton(onClick={open=false}){Text("关闭")}})
}
