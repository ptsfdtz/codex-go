package dev.agentdeck.app

/** Caller serializes access with the cache lock. Advance only after durable event storage. */
internal class EventCheckpoint(initial: String = "0") {
    @Volatile var value: String = initial
        private set

    fun reset(cursor: String) { value = cursor }

    suspend fun commit(eventId: String, persist: suspend () -> Unit): Boolean {
        if (eventId.toLong() <= value.toLong()) return false
        persist()
        value = eventId
        return true
    }
}
