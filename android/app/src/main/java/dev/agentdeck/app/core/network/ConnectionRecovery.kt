package dev.agentdeck.app

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.random.Random

internal fun reconnectDelayMillis(failures: Int): Long = when {
    failures <= 1 -> 0
    failures == 2 -> 1_000
    failures == 3 -> 2_000
    failures == 4 -> 5_000
    failures == 5 -> 10_000
    else -> 30_000
}

/** Only wakes connection establishment. Never stores or retries user requests. */
internal class ConnectionRecovery(private val jitter: () -> Long = { Random.nextLong(250) }) {
    private val wakeups = Channel<Unit>(Channel.CONFLATED)
    fun wake() { wakeups.trySend(Unit) }
    fun connected() { while (wakeups.tryReceive().isSuccess) { /* discard old network changes */ } }
    suspend fun pause(failures: Int) {
        val delay = reconnectDelayMillis(failures)
        if (delay > 0) withTimeoutOrNull(delay + jitter()) { wakeups.receive() }
    }
}
