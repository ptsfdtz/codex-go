package dev.agentdeck.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Coordinator must crash/restart the local test process after the READY_TO_CRASH marker. */
@RunWith(AndroidJUnit4::class)
class PhysicalRestartTest {
    @Test fun abruptBridgeRestartRestoresTrustworthyState() = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("physicalLan") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val repo = (context.applicationContext as DeckApplication).repository
        val host = requireNotNull(Vault(context).read())
        withTimeout(30000) { repo.state.first { !it.stale && it.connection == "已连接" } }
        var transport = DeckTransport(host)
        suspend fun connect() {
            transport.connect()
            transport.request("system.hello", buildJsonObject { put("client", "physical-restart"); put("version", 1) })
        }
        connect()
        try {
            val snapshot = wire.decodeFromJsonElement(Snapshot.serializer(), transport.request("snapshot.get"))
            val session = wire.decodeFromJsonElement(Session.serializer(), transport.request("sessions.create", payload("projectId" to snapshot.projects.last().projectId, "title" to "Abrupt restart pending approval test")).getValue("session"))
            val turn = wire.decodeFromJsonElement(Turn.serializer(), transport.request("turn.start", payload("sessionId" to session.sessionId, "text" to "Controlled crash recovery test. Request human approval with sandbox_permissions=require_escalated for exactly Write-Output AGENTDECK_APPROVAL_OK in PowerShell, justification=\"AgentDeck crash recovery test\". Do not run any other commands, read or modify files, or use the network. Wait for the human decision.")).getValue("turn"))
            val approval = withTimeout(90000) {
                var found: Approval? = null
                while (found == null) {
                    found = transport.request("approvals.list", payload("sessionId" to session.sessionId)).getValue("approvals").jsonArray
                        .map { wire.decodeFromJsonElement(Approval.serializer(), it) }.firstOrNull { it.turnId == turn.turnId }
                    if (found == null) delay(400)
                }
                found
            }
            File(context.getExternalFilesDir(null), "physical-restart-stage.json").writeText(buildJsonObject {
                put("stage", "READY_TO_CRASH"); put("sessionId", session.sessionId); put("turnId", turn.turnId)
            }.toString())
            withTimeout(60000) { repo.state.first { it.stale && it.connection != "已连接" } }
            assertFalse(repo.state.value.snapshot.sessions.any { it.sessionId == session.sessionId && it.status == "completed" })
            File(context.getExternalFilesDir(null), "physical-restart-stage.json").writeText("{\"stage\":\"OBSERVED_DISCONNECTED\"}")
            transport.close()
            withTimeout(180000) { repo.state.first { !it.stale && it.connection == "已连接" && it.snapshot.host?.status == "connected" } }
            assertEquals(host.hostId, repo.state.value.snapshot.host?.hostId)
            assertTrue(repo.state.value.snapshot.sessions.any { it.sessionId == session.sessionId })
            transport = DeckTransport(host); connect()
            val detail = transport.request("sessions.detail", buildJsonObject { put("sessionId", session.sessionId); put("limit", 500) })
            val recovered = detail.getValue("turns").jsonArray.map { wire.decodeFromJsonElement(Turn.serializer(), it) }.first { it.turnId == turn.turnId }
            assertTrue("Pending approval must never become a fabricated success", recovered.status in listOf("unknown", "interrupted", "failed"))
            assertTrue(transport.request("approvals.list", payload("sessionId" to session.sessionId)).getValue("approvals").jsonArray.isEmpty())
            try {
                transport.request("approvals.decide", payload("sessionId" to session.sessionId, "turnId" to turn.turnId, "approvalId" to approval.approvalId, "decision" to "reject"))
                fail("Pre-crash approval remained usable")
            } catch (e: DeckException) { assertEquals("APPROVAL_STALE", e.code) }
            if (recovered.status == "unknown") {
                try { transport.request("turn.start", payload("sessionId" to session.sessionId, "text" to "Must stay blocked until reconciled")); fail("Unknown session accepted another turn") }
                catch (e: DeckException) { assertEquals("CONFLICT", e.code) }
            }
            val continuedSession = snapshot.sessions.first { it.status == "completed" }
            val continued = wire.decodeFromJsonElement(Turn.serializer(), transport.request("turn.start", payload("sessionId" to continuedSession.sessionId, "text" to "Reply exactly AGENTDECK_PAD_RESTART_RESUME_OK. No tools or file access.")).getValue("turn"))
            withTimeout(120000) {
                while (true) {
                    val data = transport.request("sessions.detail", buildJsonObject { put("sessionId", continuedSession.sessionId); put("limit", 500) })
                    val current = data.getValue("turns").jsonArray.map { wire.decodeFromJsonElement(Turn.serializer(), it) }.first { it.turnId == continued.turnId }
                    if (current.status in listOf("completed", "failed", "interrupted")) { assertEquals("completed", current.status); break }
                    delay(500)
                }
            }
            File(context.getExternalFilesDir(null), "physical-restart-result.json").writeText(buildJsonObject {
                put("result", "PASS"); put("source", "Physical Pad Wi-Fi; actual abrupt Bridge process exit and restart")
                put("observedOffline", true); put("savedCredentialReused", true); put("recoveredPendingTurn", recovered.status)
                put("staleApprovalRejected", true); put("existingThreadResumedAndCompleted", true)
                put("sessionId", session.sessionId); put("turnId", turn.turnId)
            }.toString())
        } finally { transport.close() }
    }
}
