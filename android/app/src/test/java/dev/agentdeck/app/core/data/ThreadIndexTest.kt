package dev.agentdeck.app

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ThreadIndexTest {
    @Test fun legacySessionsStillDecode() {
        val value=wire.decodeFromString(Session.serializer(),"""{"sessionId":"s","projectId":"p","upstreamThreadId":"t","title":"old","status":"idle"}""")
        assertNull(value.upstream)
    }
    @Test fun sourceAndDerivationSurviveSnapshotCacheEncoding() {
        val value=wire.decodeFromString(Snapshot.serializer(),"""{"sessions":[{"sessionId":"s","projectId":"p","upstreamThreadId":"original","title":"Imported","status":"unknown","upstream":{"source":{"subAgent":{"other":"extension"}},"parentThreadId":"parent","forkedFromId":"fork","status":{"type":"active","activeFlags":[]},"futureField":42}}]}""")
        val restored=wire.decodeFromString(Snapshot.serializer(),wire.encodeToString(Snapshot.serializer(),value))
        assertEquals(value,restored)
        assertEquals("original",restored.sessions.single().upstreamThreadId)
        assertEquals("parent",restored.sessions.single().upstream?.get("parentThreadId")?.jsonPrimitive?.content)
        assertEquals(42,restored.sessions.single().upstream?.get("futureField")?.jsonPrimitive?.int)
    }
}
