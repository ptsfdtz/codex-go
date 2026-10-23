package dev.agentdeck.app

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class SnapshotReadsTest {
    @Test fun delayedOldConnectionCannotOverwriteReconnectedSnapshot() = runTest {
        val reads = SnapshotReads()
        var connection = 1
        val delayed = CompletableDeferred<String>()
        val applied = mutableListOf<String>()
        val old = launch { reads.refresh({connection == 1}, {delayed.await()}, {applied.add(it)}) }
        runCurrent()
        connection = 2
        launch { reads.refresh({connection == 2}, {"new"}, {applied.add(it)}) }
        delayed.complete("old")
        runCurrent()
        assertTrue(old.isCancelled)
        assertEquals(listOf("new"), applied)
    }

    @Test fun manualAndScheduledReadsCannotApplyInReverseOrder() = runTest {
        val reads = SnapshotReads()
        val delayed = CompletableDeferred<Int>()
        val applied = mutableListOf<Int>()
        var secondRequested = false
        launch { reads.refresh({true}, {delayed.await()}, {applied.add(it)}) }
        runCurrent()
        launch { reads.refresh({true}, {secondRequested=true;2}, {applied.add(it)}) }
        runCurrent()
        assertFalse(secondRequested)
        delayed.complete(1)
        runCurrent()
        assertEquals(listOf(1,2), applied)
    }

    @Test fun queuedReadFromReplacedHostDoesNotReachServer() = runTest {
        val reads = SnapshotReads()
        var current = true
        val delayed = CompletableDeferred<Unit>()
        launch { reads.refresh({true}, {delayed.await()}, {}) }
        runCurrent()
        var requested = false
        val queued = launch { reads.refresh({current}, {requested=true}, {}) }
        runCurrent()
        current=false
        delayed.complete(Unit)
        runCurrent()
        assertTrue(queued.isCancelled)
        assertFalse(requested)
    }
}
