package dev.agentdeck.app

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull

/** Serial, bounded authority checks. Parent cancellation must abort delivery. */
internal suspend fun deliverReplayNotifications(
    events:List<DeckEvent>,
    isCurrent:()->Boolean,
    nativeSupported:()->Boolean,
    session:(String?)->Session?,
    readLatest:suspend (Session)->LatestTurn,
    publish:(DeckEvent)->Unit,
    refresh:(DeckEvent)->DeckEvent?={it},
) {
    var reads=0
    for(event in events){
        if(!isCurrent())return
        if(event.action=="upstream.turn.completed"){
            if(!nativeSupported()||reads>=8)continue
            val before=session(event.sessionId)?:continue
            reads++
            val latest=try{
                withTimeoutOrNull(4000){readLatest(before)}?:continue
            }catch(e:CancellationException){throw e}catch(_:Exception){continue}
            if(!isCurrent())return
            val after=session(event.sessionId)?:continue
            if(after.upstreamThreadId!=before.upstreamThreadId||after.projectId!=before.projectId)continue
            if(!latest.confirms(event))continue
        }
        if(!isCurrent())return
        val updated=refresh(event)?:continue
        if(isCurrent())publish(updated)
    }
}
