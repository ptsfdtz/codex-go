package dev.agentdeck.app

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Keep snapshot requests and their application in server order, including manual refreshes. */
internal class SnapshotReads {
    private val mutex = Mutex()

    suspend fun <T> refresh(isCurrent: () -> Boolean, read: suspend () -> T, apply: suspend (T) -> Unit) {
        mutex.withLock {
            if (!isCurrent()) throw CancellationException("Snapshot connection replaced")
            val value = read()
            if (!isCurrent()) throw CancellationException("Snapshot connection replaced")
            apply(value)
        }
    }
}
