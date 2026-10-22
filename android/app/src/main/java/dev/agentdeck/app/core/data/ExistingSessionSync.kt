package dev.agentdeck.app

import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject

/** Startup and another phone can already be indexing. Retry only read-only sync;
 * never reuse this policy for sending messages or other uncertain mutations. */
internal suspend fun refreshExistingSessionIndex(
    pause:suspend (Long)->Unit={delay(it)},
    read:suspend ()->JsonObject,
):JsonObject {
    for(attempt in 0..3){
        try{return read()}
        catch(e:DeckException){
            if(e.code !in setOf("CONFLICT","SYNC_CONFLICT","UPSTREAM_UNAVAILABLE")||attempt==3)throw e
            pause(500L shl attempt)
        }
    }
    error("会话同步未完成")
}
