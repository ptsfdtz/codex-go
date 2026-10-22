package dev.agentdeck.app

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.serialization.json.*
import java.time.Instant

private fun approvalCurrent(approval:Approval)=approval.status=="pending"&&runCatching{Instant.parse(approval.expiresAt).isAfter(Instant.now())}.getOrDefault(false)

/** Preview bounds affect rendering only; the full received request stays available in the reader. */
@Composable internal fun ApprovalCard(approval:Approval,disabled:Boolean,onDecision:(Approval,String)->Unit,mask:String=""){
    var confirm by remember(approval.sessionId,approval.approvalId){mutableStateOf(false)}
    var reader by remember(approval.sessionId,approval.approvalId){mutableStateOf<Pair<String,String>?>(null)}
    var current by remember(approval.expiresAt,approval.status){mutableStateOf(approvalCurrent(approval))}
    LaunchedEffect(approval.expiresAt,approval.status){while(true){current=approvalCurrent(approval);if(!current){confirm=false;break};delay(1000)}}
    val enabled=!disabled&&current
    val fields=remember(approval.context){approval.context.filterKeys{it !in setOf("threadId","turnId","itemId")}.filterValues{it!=JsonNull}.entries.toList()}
    var page by remember(approval.approvalId){mutableIntStateOf(0)}
    val pageCount=((fields.size+7)/8).coerceAtLeast(1)
    val index=page.coerceIn(0,pageCount-1)
    val pretty=remember{Json{prettyPrint=true}}
    val full=remember(approval.context){pretty.encodeToString(JsonObject.serializer(),approval.context)}
    fun decide(decision:String){if(!disabled&&approvalCurrent(approval)&&(decision!="approve"||"approve" in approval.allowedDecisions))onDecision(approval,decision)}
    OutlinedCard{Column(Modifier.fillMaxWidth().padding(18.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Icon(Icons.Outlined.Security,null,Modifier.size(18.dp));Text("需要你的确认",style=MaterialTheme.typography.titleSmall)}
        Text(when{approval.method.contains("commandExecution")->"Codex 请求执行以下命令";approval.method.contains("fileChange")->"Codex 请求修改文件";else->"Codex 请求额外权限"},style=MaterialTheme.typography.bodyMedium)
        fields.drop(index*8).take(8).forEach{(key,value)->
            val title=when(key){"command"->"命令";"cwd"->"执行目录";"reason"->"原因";"permissions"->"请求的权限";"grantRoot"->"授权目录";"availableDecisions"->"可用决定";else->key}
            val text=(value as? JsonPrimitive)?.contentOrNull?:pretty.encodeToString(JsonElement.serializer(),value)
            Column(verticalArrangement=Arrangement.spacedBy(4.dp)){
                Text(maskDisplay(title,mask),style=MaterialTheme.typography.labelSmall)
                SelectionContainer{Text(maskDisplay(text,mask).take(1800),maxLines=10,fontFamily=FontFamily.Monospace,style=MaterialTheme.typography.bodySmall)}
                if(text.length>1800||text.count{it=='\n'}>=10)Text("预览已折叠，请阅读完整内容后决定。",style=MaterialTheme.typography.labelSmall)
                TextButton(onClick={reader=title to text}){Text("阅读完整字段")}
            }
        }
        if(pageCount>1)Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
            TextButton(onClick={page=index-1},enabled=index>0){Text("上一页")};Text("${index+1} / $pageCount");TextButton(onClick={page=index+1},enabled=index+1<pageCount){Text("下一页")}
        }
        TextButton(onClick={reader="完整审批请求" to full}){Text("阅读完整请求")}
        Text(if(!current)"请求已过期或已处理" else if(disabled)"连接恢复且操作结束后才能处理" else "仅决定这一次请求，不会自动批准后续请求。",style=MaterialTheme.typography.labelSmall)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
            OutlinedButton(onClick={decide("reject")},enabled=enabled){Text("拒绝")}
            Button(onClick={if(approvalCurrent(approval))confirm=true},enabled=enabled&&"approve" in approval.allowedDecisions){Text("检查并允许一次")}
        }
    }}
    if(confirm)AlertDialog(onDismissRequest={confirm=false},title={Text("允许这一次操作？")},text={
        Column(Modifier.heightIn(max=400.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)){
            Text("请核对电脑、命令、路径与权限范围。此决定仅针对当前请求。")
            Text("到期时间：${approval.expiresAt}",style=MaterialTheme.typography.labelSmall)
            SelectionContainer{Text(maskDisplay(full,mask).take(6000),style=MaterialTheme.typography.bodySmall,fontFamily=FontFamily.Monospace)}
            if(full.length>6000)Text("此处仅预览前 6000 字符；完整内容可分段查找。",style=MaterialTheme.typography.labelSmall)
            TextButton(onClick={reader="完整审批请求" to full}){Text("阅读完整请求")}
        }
    },confirmButton={TextButton(onClick={confirm=false;decide("approve")},enabled=enabled&&"approve" in approval.allowedDecisions){Text("允许一次")}},dismissButton={TextButton(onClick={confirm=false}){Text("取消")}})
    reader?.let{(title,text)->LoadedTextReader(title,text,mask){reader=null}}
}
