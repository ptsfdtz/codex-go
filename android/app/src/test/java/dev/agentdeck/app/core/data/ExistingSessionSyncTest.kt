package dev.agentdeck.app

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.*
import org.junit.Test

class ExistingSessionSyncTest {
    @Test fun retriesStartupContentionWithoutSendingOrCreatingThreads()=runTest {
        var calls=0
        val pauses=mutableListOf<Long>()
        val expected=buildJsonObject{}
        val result=refreshExistingSessionIndex(pause={pauses+=it}){
            calls++
            if(calls<3)throw DeckException("CONFLICT","index already refreshing")
            expected
        }
        assertSame(expected,result)
        assertEquals(3,calls)
        assertEquals(listOf(500L,1000L),pauses)
    }
    @Test fun stopsRetryingAndPreservesFailure()=runTest {
        var calls=0
        val failure=DeckException("UPSTREAM_UNAVAILABLE","not ready")
        try{
            refreshExistingSessionIndex(pause={}){calls++;throw failure}
            fail("must report incomplete sync")
        }catch(e:DeckException){assertSame(failure,e)}
        assertEquals(4,calls)
    }
    @Test fun doesNotRetryAuthorizationFailuresOrCancellation()=runTest {
        for(failure in listOf(DeckException("WORKSPACE_FORBIDDEN","not granted"),CancellationException("host changed"))){
            var calls=0
            try{
                refreshExistingSessionIndex(pause={fail("must not retry")}){calls++;throw failure}
                fail("must preserve failure")
            }catch(e:Exception){assertSame(failure,e)}
            assertEquals(1,calls)
        }
    }
}
