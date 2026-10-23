package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import kotlinx.serialization.json.*

internal fun sessionParents(session:Session):List<Pair<String,String>>{
    fun text(value:JsonElement?)=(value as? JsonPrimitive)?.contentOrNull?.takeUnless{it.isBlank()}
    val metadata=session.upstream
    val spawn=((metadata?.get("source") as? JsonObject)?.get("subAgent") as? JsonObject)?.get("thread_spawn") as? JsonObject
    return listOfNotNull(
        text(metadata?.get("forkedFromId"))?.let{"分叉来源" to it},
        text(metadata?.get("parentThreadId"))?.let{"父会话" to it},
        text(spawn?.get("parent_thread_id"))?.let{"代理父会话" to it}
    ).filter{it.second!=session.upstreamThreadId}.distinctBy{it.second}
}

internal data class SessionRelation(val kind:String,val label:String,val nativeId:String,val target:Session?,val depth:Int)

/** Traverse only the already granted index. A visited set prevents malformed source cycles. */
internal fun indexedSessionRelations(session:Session,sessions:List<Session>):List<SessionRelation>{
    val byNative=sessions.filter{it.upstreamThreadId.isNotBlank()}.associateBy{it.upstreamThreadId}
    val result=mutableListOf<SessionRelation>()
    val parents=sessions.associate{it.upstreamThreadId to sessionParents(it)}
    val children=mutableMapOf<String,MutableList<Session>>()
    sessions.forEach{child->sessionParents(child).forEach{(_,parent)->children.getOrPut(parent){mutableListOf()}.add(child)}}
    val ancestors=ArrayDeque<Pair<Session,Int>>()
    val visited=mutableSetOf(session.upstreamThreadId)
    ancestors.add(session to 0)
    while(ancestors.isNotEmpty()){
        val (node,depth)=ancestors.removeFirst()
        sessionParents(node).forEach{(label,id)->if(visited.add(id)){
            val target=byNative[id]
            result+=SessionRelation("parents",if(depth==0)label else "祖先会话",id,target,depth+1)
            if(target!=null)ancestors.add(target to depth+1)
        }}
    }
    val descendants=ArrayDeque<Pair<String,Int>>()
    visited.clear();visited.add(session.upstreamThreadId);descendants.add(session.upstreamThreadId to 0)
    while(descendants.isNotEmpty()){
        val (id,depth)=descendants.removeFirst()
        children[id].orEmpty().sortedByDescending{it.updatedAt}.forEach{child->if(visited.add(child.upstreamThreadId)){
            result+=SessionRelation("children",if(depth==0)"派生会话" else "后代会话",child.upstreamThreadId,child,depth+1)
            descendants.add(child.upstreamThreadId to depth+1)
        }}
    }
    val direct=sessionParents(session).map{it.second}.toSet()
    sessions.filter{it.sessionId!=session.sessionId&&parents[it.upstreamThreadId].orEmpty().any{link->link.second in direct}}.sortedByDescending{it.updatedAt}.forEach{
        result+=SessionRelation("siblings","同来源会话",it.upstreamThreadId,it,1)
    }
    return result
}

@Composable internal fun SessionRelationsDialog(session:Session,state:DeckState,repo:DeckRepository,onClose:()->Unit){
    val allowed=state.snapshot.projects.filter{it.enabled}.map{it.projectId}.toSet()
    val sessions=state.snapshot.sessions.filter{it.projectId in allowed}
    val source=sessions.find{it.sessionId==session.sessionId}?:session
    val relations=remember(source,sessions){indexedSessionRelations(source,sessions)}
    var query by remember(state.host?.hostId,session.sessionId){mutableStateOf("")}
    var filter by remember(state.host?.hostId,session.sessionId){mutableStateOf("all")}
    var reading by remember(state.host?.hostId,session.sessionId,state.displayMask){mutableStateOf<String?>(null)}
    val terms=query.trim().split(Regex("\\s+")).filter{it.isNotBlank()}
    val visible=relations.filter{row->(filter=="all"||row.kind==filter)&&terms.all{term->maskDisplay(row.label+" "+row.nativeId+" "+row.target?.title.orEmpty()+" "+state.snapshot.projects.find{it.projectId==row.target?.projectId}?.name.orEmpty(),state.displayMask).contains(term,true)}}
    Dialog(onDismissRequest=onClose,properties=androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth=false)){
        Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).imePadding()){
            Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
                Row(Modifier.fillMaxWidth()){Text("会话关系与来源",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge);TextButton(onClick=onClose){Text("关闭")}}
                Text(maskDisplay(source.title,state.displayMask),style=MaterialTheme.typography.bodyMedium)
                OutlinedTextField(query,{query=it.take(200)},Modifier.fillMaxWidth(),singleLine=true,label={Text("搜索关联会话、项目或线程 ID")})
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)){
                    listOf("all" to "全部","parents" to "父级与祖先","children" to "派生与后代","siblings" to "同来源").forEach{(id,label)->FilterChip(selected=filter==id,onClick={filter=id},label={Text(label)})}
                }
                Text("${visible.size} / ${relations.size} 个关联记录",style=MaterialTheme.typography.labelSmall)
                LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(10.dp)){
                    item{
                        SelectionContainer{Text("原生线程："+maskDisplay(source.upstreamThreadId,state.displayMask),style=MaterialTheme.typography.bodySmall)}
                        source.upstream?.get("originator")?.let{value->Text("来源应用："+maskDisplay((value as? JsonPrimitive)?.contentOrNull?:value.toString(),state.displayMask),style=MaterialTheme.typography.bodySmall)}
                        source.upstream?.get("source")?.takeUnless{it==JsonNull}?.let{value->TextButton(onClick={reading=value.toString()}){Text("阅读原生来源记录")}}
                    }
                    items(visible,key={it.kind+":"+it.nativeId}){row->
                        OutlinedCard(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
                            Text(row.label+(if(row.kind!="siblings")" · 距离 ${row.depth} 层" else ""),style=MaterialTheme.typography.labelSmall)
                            val target=row.target
                            if(target!=null){
                                Text(maskDisplay(target.title,state.displayMask),style=MaterialTheme.typography.titleSmall)
                                Text(maskDisplay(state.snapshot.projects.find{it.projectId==target.projectId}?.name.orEmpty(),state.displayMask)+(if(target.archived==1)" · 已归档" else ""),style=MaterialTheme.typography.bodySmall)
                                Text(statusLabel(target.status),style=MaterialTheme.typography.labelSmall)
                                TextButton(onClick={
                                    val now=repo.state.value
                                    if(now.host?.hostId==state.host?.hostId&&now.snapshot.sessions.any{it.sessionId==target.sessionId&&it.upstreamThreadId==row.nativeId}&&now.snapshot.projects.any{it.projectId==target.projectId&&it.enabled}){repo.selectSession(target.sessionId);onClose()}
                                    else repo.showMessage("会话或授权已变化，请刷新后重新选择。")
                                },enabled=!state.busy){Text("打开原会话")}
                            }else Text("尚未同步或不在当前授权项目中，无法继续展开或打开。",style=MaterialTheme.typography.bodySmall)
                            SelectionContainer{Text(maskDisplay(row.nativeId,state.displayMask),style=MaterialTheme.typography.labelSmall)}
                        }}
                    }
                    if(visible.isEmpty())item{Text(if(relations.isEmpty())"已同步索引中未报告关联会话。" else "没有匹配的关系记录。")}
                }
                Text("仅遍历当前电脑已同步且授权的原生关系，不是完整上游关系树。离线时为缓存；不会导入线程或扩大授权。",style=MaterialTheme.typography.labelSmall)
            }
        }
    }
    reading?.let{LoadedTextReader("原生来源记录",it,state.displayMask){reading=null}}
}
