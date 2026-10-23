package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.ui.Alignment
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.serialization.json.*
import java.time.Instant

internal fun isFinalAnswer(entry:ChatEntry):Boolean = entry.kind=="assistant"&&runCatching{
    wire.parseToJsonElement(entry.detail).jsonObject["phase"]?.jsonPrimitive?.contentOrNull=="final_answer"
}.getOrDefault(false)

internal fun isReasoningEntry(entry:ChatEntry):Boolean = entry.kind=="tool"&&runCatching{wire.parseToJsonElement(entry.detail).jsonObject["type"]?.jsonPrimitive?.contentOrNull=="reasoning"}.getOrDefault(false)

internal fun isWorkEntry(entry:ChatEntry):Boolean = entry.kind=="tool"||
    entry.kind=="assistant"&&runCatching{wire.parseToJsonElement(entry.detail).jsonObject["phase"]?.jsonPrimitive?.contentOrNull=="commentary"}.getOrDefault(false)

// Do not hide the process between turn completion and delivery of its final answer.
internal fun defaultWorkExpanded(status:String,hasFinalAnswer:Boolean):Boolean =
    status in listOf("queued","running","waitingApproval","unknown")||status=="completed"&&!hasFinalAnswer

/** Only explicit turn boundaries supply timing; historical item order is not a clock. */
@Composable internal fun WorkDuration(nativeTurn:String?,state:DeckState,expanded:Boolean,onToggle:()->Unit){
    val turn=state.snapshot.turns.lastOrNull{it.sessionId==state.selectedSession&&(it.upstreamTurnId==nativeTurn||it.turnId==nativeTurn)}
    val events=remember(state.events,state.selectedSession,nativeTurn,turn?.turnId){state.events.filter{event->
        if(event.sessionId!=state.selectedSession)false else {
            val p=event.payload as? JsonObject
            val native=(p?.get("upstreamTurnId") as? JsonPrimitive)?.contentOrNull
            event.turnId==turn?.turnId&&turn!=null||native==nativeTurn&&nativeTurn!=null||
                (p?.get("turn") as? JsonObject)?.get("id")?.jsonPrimitive?.contentOrNull==nativeTurn&&nativeTurn!=null
        }
    }}
    fun instant(value:String?)=runCatching{Instant.parse(value)}.getOrNull()
    val history=state.timelineHistory.takeIf{it.sessionId==state.selectedSession}
    val recorded=remember(history?.entries,nativeTurn){history?.entries.orEmpty().filter{it["turnId"]?.jsonPrimitive?.contentOrNull==nativeTurn}}
    val recordedStart=recorded.filter{(it["item"] as? JsonObject)?.get("type")?.jsonPrimitive?.contentOrNull!="userMessage"}.mapNotNull{it["startedAtMs"]?.jsonPrimitive?.longOrNull?.takeIf{n->n>=0}}.minOrNull()?.let{Instant.ofEpochMilli(it)}
    val recordedEnd=recorded.lastOrNull{(it["item"] as? JsonObject)?.get("phase")?.jsonPrimitive?.contentOrNull=="final_answer"}?.get("completedAtMs")?.jsonPrimitive?.longOrNull?.takeIf{it>=0}?.let{Instant.ofEpochMilli(it)}
    val start=instant(turn?.startedAt)?:events.firstOrNull{event->
        event.action=="turn.started"||(event.payload as? JsonObject)?.get("method")?.jsonPrimitive?.contentOrNull=="turn/started"
    }?.ts?.let(::instant)?:recordedStart
    val end=instant(turn?.endedAt)?:events.lastOrNull{it.action in listOf("turn.completed","turn.failed","turn.interrupted","upstream.turn.completed")}?.ts?.let(::instant)?:recordedEnd
    val running=turn?.status in listOf("running","waitingApproval")&&end==null&&!state.stale
    var now by remember(nativeTurn){mutableStateOf(Instant.now())}
    LaunchedEffect(nativeTurn,running){while(running){now=Instant.now();delay(1000)}}
    val seconds=if(start!=null&&(end!=null||running))java.time.Duration.between(start,end?:now).seconds.coerceAtLeast(0) else null
    val duration=seconds?.let{if(it>=60)"${it/60} 分 ${it%60} 秒" else "$it 秒"}
    val label=when{
        running&&duration!=null->"正在工作 · $duration"
        end!=null&&duration!=null->if(turn==null&&history?.nextCursor!=null)"已加载工作记录 · $duration" else "已工作 $duration"
        state.stale&&turn?.status in listOf("running","waitingApproval","unknown")->"运行记录 · 等待重连核对"
        else->"运行记录 · 时长未记录"
    }
    Row(Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClick=onToggle).padding(horizontal=8.dp,vertical=10.dp),verticalAlignment=Alignment.CenterVertically){
        Text(label,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        Icon(if(expanded)Icons.Outlined.ExpandMore else Icons.Outlined.ChevronRight,if(expanded)"收起运行过程" else "展开运行过程",Modifier.padding(start=4.dp).size(16.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
