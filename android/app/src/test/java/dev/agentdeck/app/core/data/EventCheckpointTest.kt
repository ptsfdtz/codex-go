package dev.agentdeck.app

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class EventCheckpointTest {
    @Test fun failedTransactionLeavesEventRetryable() = runTest {
        val checkpoint=EventCheckpoint("41")
        try {
            checkpoint.commit("42") { throw IllegalStateException("commit failed") }
            fail("Storage failure must propagate")
        } catch (_: IllegalStateException) { }
        assertEquals("41",checkpoint.value)
        var persisted=false
        assertTrue(checkpoint.commit("42") { persisted=true })
        assertTrue(persisted)
        assertEquals("42",checkpoint.value)
    }

    @Test fun cancellationDoesNotAdvanceAndDuplicateDoesNotPersist() = runTest {
        val checkpoint=EventCheckpoint("9")
        try {
            checkpoint.commit("10") { throw CancellationException("transaction cancelled") }
            fail("Cancellation must propagate")
        } catch (_: CancellationException) { }
        assertEquals("9",checkpoint.value)
        assertTrue(checkpoint.commit("10") {})
        assertFalse(checkpoint.commit("10") { fail("Duplicate stored") })
        assertFalse(checkpoint.commit("9") { fail("Older event stored") })
    }

    @Test fun snapshotResetAndNumericOrderingDoNotSkipNextEvent() = runTest {
        val checkpoint=EventCheckpoint("100")
        checkpoint.reset("9")
        assertTrue(checkpoint.commit("10") { assertEquals("9",checkpoint.value) })
        assertEquals("10",checkpoint.value)
    }
}
