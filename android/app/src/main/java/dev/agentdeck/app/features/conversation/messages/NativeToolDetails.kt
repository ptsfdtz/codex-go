package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

/** Native metadata is display content. Paths and commands here never execute on Android. */
@Composable internal fun NativeToolBody(entry:ChatEntry,mask:String){
    var reading by remember(entry.id){mutableStateOf<Pair<String,String>?>(null)}
    var filesPage by remember(entry.id){mutableIntStateOf(0)}
    reading?.let{(title,text)->LoadedTextReader(title,text,mask){reading=null}}
    val agentSessions=LocalNativeAgentSessions.current
    val navigate=LocalNativeSessionNavigation.current
    val openFile=LocalNativeFilePreview.current
    val item=remember(entry.detail){runCatching{wire.parseToJsonElement(entry.detail) as? JsonObject}.getOrNull()}
    fun value(key:String)=(item?.get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()
    @Composable fun field(label:String,text:String){if(text.isNotBlank())Column(verticalArrangement=Arrangement.spacedBy(4.dp)){
        Text(label,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        SelectionContainer{Text(maskDisplay(text,mask).take(24000),style=MaterialTheme.typography.bodySmall,fontFamily=FontFamily.Monospace)}
        if(text.length>24000)TextButton(onClick={reading=label to text}){Text("阅读已加载完整内容")}
    }}
    Column(Modifier.fillMaxWidth().padding(14.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
        if(value("method")=="turn/plan/updated"&&item!=null){NativePlanProgress(item,mask);return@Column}
        if(value("method")=="turn/diff/updated"){
            Text("本轮累计差异",style=MaterialTheme.typography.titleSmall)
            MessageCodeBlock(MessageBlock(maskDisplay(entry.text,mask).take(24000),"diff"))
            if(entry.text.length>24000)TextButton(onClick={reading="本轮累计差异" to entry.text}){Text("阅读已加载完整差异")}
            return@Column
        }
        when(value("type")){
            "commandExecution"->{
                field("命令",value("command"));field("工作目录",value("cwd"))
                Row(horizontalArrangement=Arrangement.spacedBy(16.dp)){
                    if(value("exitCode").isNotBlank())Text("退出码 ${value("exitCode")}",style=MaterialTheme.typography.labelSmall)
                    if(value("durationMs").isNotBlank())Text("${value("durationMs")} ms",style=MaterialTheme.typography.labelSmall)
                    if(value("processId").isNotBlank())Text("进程 ${value("processId")}",style=MaterialTheme.typography.labelSmall)
                }
                field("输出",entry.text.ifBlank{"尚无输出"})
            }
            "fileChange"->{
                val changes=(item?.get("changes") as? JsonArray).orEmpty()
                val pages=((changes.size+19)/20).coerceAtLeast(1)
                val page=filesPage.coerceIn(0,pages-1)
                if(pages>1)Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                    TextButton(onClick={filesPage=page-1},enabled=page>0){Text("上一页")}
                    Text("${page+1} / $pages · ${changes.size} 个文件",style=MaterialTheme.typography.labelSmall)
                    TextButton(onClick={filesPage=page+1},enabled=page<pages-1){Text("下一页")}
                }
                changes.drop(page*20).take(20).forEach{change->val file=change as? JsonObject
                    val path=(file?.get("path") as? JsonPrimitive)?.contentOrNull.orEmpty()
                    val kind=file?.get("kind")?.let{(it as? JsonObject)?.get("type")?:it}?.let{(it as? JsonPrimitive)?.contentOrNull}.orEmpty()
                    field(when(kind){"add"->"新增文件";"delete"->"删除文件";"update"->"修改文件";else->"文件"},path)
                    if(path.isNotBlank()&&openFile!=null&&kind!="delete")TextButton(onClick={openFile(path)}){Text("预览当前文件")}
                    if(kind=="delete")Text("此记录为删除操作；当前文件可能已不存在。",style=MaterialTheme.typography.labelSmall)
                    val movePath=((file?.get("kind") as? JsonObject)?.get("move_path") as? JsonPrimitive)?.contentOrNull
                    if(!movePath.isNullOrBlank()){
                        field("移动目标",movePath)
                        if(openFile!=null)TextButton(onClick={openFile(movePath)}){Text("预览移动目标")}
                    }
                    val diff=(file?.get("diff") as? JsonPrimitive)?.contentOrNull.orEmpty()
                    if(diff.isNotBlank())MessageCodeBlock(MessageBlock(maskDisplay(diff,mask).take(24000),"diff"))
                    if(diff.length>24000)TextButton(onClick={reading="文件差异 · $path" to diff}){Text("阅读已加载完整差异")}
                    HorizontalDivider()
                }
                Text("文件预览读取电脑当前内容，不是此步骤发生时的历史版本。",style=MaterialTheme.typography.labelSmall)
                if(changes.isEmpty())field("内容",entry.text)
            }
            "mcpToolCall","dynamicToolCall"->{
                field("服务",value("server"));field("工具",value("tool"))
                field("参数",item?.get("arguments")?.takeUnless{it==JsonNull}?.toString().orEmpty())
                if(value("status")=="inProgress"&&entry.text.isNotBlank())field("进度",entry.text)
                if(item!=null)NativeToolResults(item,mask)else field("结果",entry.text.ifBlank{"等待工具返回结果"})
            }
            "collabAgentToolCall"->{if(item!=null)NativeAgentResults(item,mask)else field("代理状态",entry.text)}
            "subAgentActivity"->{
                field("活动",when(value("kind")){"started"->"已启动";"interacted"->"已交互";"interrupted"->"已中断";"completed"->"已完成";else->value("kind")})
                field("代理路径",value("agentPath"))
                field("模型",value("model").takeUnless{it=="null"}.orEmpty());field("推理强度",value("reasoningEffort").takeUnless{it=="null"}?.let(::effortLabel).orEmpty())
                val id=value("agentThreadId")
                field("原生代理会话",id)
                val session=agentSessions[id]
                if(session!=null)TextButton(onClick={navigate?.invoke(session.sessionId)},enabled=navigate!=null){Text("打开代理会话 · "+maskDisplay(session.title,mask))}
                else Text("此代理会话尚未同步或不在当前授权项目中，暂不能打开。",style=MaterialTheme.typography.labelSmall)
                Text("活动记录不表示代理当前仍在运行。",style=MaterialTheme.typography.labelSmall)
            }
            "enteredReviewMode","exitedReviewMode"->{
                Text(if(value("type")=="enteredReviewMode")"已进入审查" else "审查结果",style=MaterialTheme.typography.titleSmall)
                MarkdownText(maskDisplay(value("review"),mask).take(24000),fontSizeSp=13f)
                if(value("review").length>24000)TextButton(onClick={reading="审查结果" to value("review")}){Text("阅读已加载完整审查结果")}
            }
            "webSearch"->NativeWebSearch(item,entry.text,mask)
            "reasoning"->{if(entry.text.isBlank())Text("等待思考内容",style=MaterialTheme.typography.bodySmall)else MarkdownText(maskDisplay(entry.text,mask).take(24000),fontSizeSp=13f)}
            else->field("内容",if(entry.status=="failed")userFacingError(raw=entry.text.ifBlank{entry.detail})else entry.text.ifBlank{entry.title})
        }
        if(entry.status=="failed"&&value("type") in listOf("mcpToolCall","dynamicToolCall","commandExecution","fileChange"))Text("此步骤失败，请核对结果及完整记录。",color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.labelSmall)
    }
}
