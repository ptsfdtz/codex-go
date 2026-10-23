package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.TrackChanges
import androidx.compose.material.icons.outlined.OpenInFull
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*

/** Reads native goal statistics; selecting a draft mode never creates or resumes a goal. */
@Composable internal fun GoalComposerSummary(session:Session,state:DeckState,repo:DeckRepository,entries:List<ChatEntry>){
    if(state.capabilities?.supports("sessionGoalView")!=true)return
    var goal by remember{mutableStateOf<JsonObject?>(null)}
    var error by remember{mutableStateOf<String?>(null)}
    var details by remember{mutableStateOf(false)}
    val changed=state.events.lastOrNull{it.sessionId==session.sessionId&&it.action=="goal.updated"}
    LaunchedEffect(state.connection,state.stale,changed?.eventId,session.status){
        if(state.stale)return@LaunchedEffect
        error=null
        try{goal=repo.readSessionGoal(session)["goal"] as? JsonObject}
        catch(e:CancellationException){throw e}
        catch(e:Exception){error=e.message?:"目标读取失败"}
    }
    val current=goal
    if(current==null){
        if(session.mode=="goal"&&error!=null)Text("Goal · $error",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.error)
        return
    }
    fun value(key:String)=(current[key] as? JsonPrimitive)?.contentOrNull.orEmpty()
    val seconds=(current["timeUsedSeconds"] as? JsonPrimitive)?.longOrNull?.takeIf{it>=0}
    val duration=seconds?.let{if(it>=60)"${it/60} 分 ${it%60} 秒" else "$it 秒"}?:"时间未报告"
    val result=if(value("status")=="complete"&&session.mode=="goal")entries.lastOrNull{isFinalAnswer(it)}?.text else null
    CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides 0.dp){
    Surface(onClick={details=true},shape=RectangleShape,color=MaterialTheme.colorScheme.surfaceContainerHigh,modifier=Modifier.fillMaxWidth()){
        Row(Modifier.heightIn(min=36.dp).padding(horizontal=12.dp,vertical=6.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
            Icon(Icons.Outlined.TrackChanges,null,Modifier.size(14.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
            Text(goalStatus(value("status")),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurface)
            Text(maskDisplay(result?.takeIf{it.isNotBlank()}?:value("objective"),state.displayMask),style=MaterialTheme.typography.labelSmall,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.weight(1f),color=MaterialTheme.colorScheme.onSurfaceVariant)
            Text(duration,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            if(state.stale||error!=null)Text(if(state.stale)"离线" else "未更新",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Icon(Icons.Outlined.OpenInFull,"查看目标详情",Modifier.size(14.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    }
    if(details)SessionGoalDialog(session,state,repo){details=false}
}
