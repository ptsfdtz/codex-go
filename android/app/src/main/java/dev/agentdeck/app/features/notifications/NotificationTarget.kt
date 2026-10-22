package dev.agentdeck.app

internal data class NotificationTarget(val hostId:String,val sessionId:String) {
    fun session(state:DeckState):Session? {
        if(state.stale||state.host?.hostId!=hostId||state.snapshot.host?.hostId!=hostId)return null
        return state.snapshot.sessions.find{it.sessionId==sessionId}
    }

    companion object {
        fun parse(hostId:String?,sessionId:String?):NotificationTarget? {
            if(hostId.isNullOrBlank()||sessionId.isNullOrBlank()||hostId.length>512||sessionId.length>512)return null
            return NotificationTarget(hostId,sessionId)
        }
    }
}
