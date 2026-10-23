package dev.agentdeck.app

import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ConnectionRecoveryTest {
    @Test fun firstRetryIsImmediateThenFailuresBackOff() {
        assertEquals(listOf(0L,1000L,2000L,5000L,10000L,30000L,30000L), (1..7).map(::reconnectDelayMillis))
    }

    @Test fun networkRecoveryInterruptsLongBackoffAndCoalescesCallbacks() = runTest {
        val recovery=ConnectionRecovery { 0 }
        val waiting=async { recovery.pause(8) }
        runCurrent();advanceTimeBy(100)
        assertFalse(waiting.isCompleted)
        repeat(20){recovery.wake()}
        runCurrent();assertTrue(waiting.isCompleted)
        recovery.connected()
        val next=async { recovery.pause(8) }
        runCurrent();assertFalse(next.isCompleted)
        advanceTimeBy(30000);runCurrent();assertTrue(next.isCompleted)
    }

    @Test fun switchingHostCancelsRetryWithoutStartingAnotherAttempt() = runTest {
        val recovery=ConnectionRecovery { 0 }
        var resumed=false
        val waiting=async { recovery.pause(6);resumed=true }
        runCurrent();waiting.cancelAndJoin();recovery.wake();runCurrent()
        assertFalse(resumed)
    }
}
