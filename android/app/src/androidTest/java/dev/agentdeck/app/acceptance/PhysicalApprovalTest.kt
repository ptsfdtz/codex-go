package dev.agentdeck.app

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Human must operate the actual tablet approval dialog. No automated approval/rejection. */
@RunWith(AndroidJUnit4::class)
class PhysicalApprovalTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    @Test fun humanDecidesRealCommandOnTablet() = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("physicalLan") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val repo = (context.applicationContext as DeckApplication).repository
        val host = requireNotNull(Vault(context).read())
        val transport = DeckTransport(host)
        transport.connect()
        transport.request("system.hello", buildJsonObject { put("client", "physical-human-approval"); put("version", 1) })
        try {
            val snap = wire.decodeFromJsonElement(Snapshot.serializer(), transport.request("snapshot.get"))
            val session = wire.decodeFromJsonElement(Session.serializer(), transport.request("sessions.create", payload("projectId" to snap.projects.first().projectId, "title" to "Pad human approval test")).getValue("session"))
            val turn = wire.decodeFromJsonElement(Turn.serializer(), transport.request("turn.start", payload("sessionId" to session.sessionId, "text" to "This is a controlled approval transport test. Use your shell tool to run exactly Write-Output AGENTDECK_APPROVAL_OK in PowerShell in the current workspace. Request sandbox_permissions=require_escalated and justification=\"AgentDeck human approval transport verification\" so the human can review the request. Do not read files, use network, modify files, or execute any other command. If rejected, stop and report rejection.")).getValue("turn"))
            val approval = withTimeout(90000) {
                var found: Approval? = null
                while (found == null) {
                    found = transport.request("approvals.list", payload("sessionId" to session.sessionId)).getValue("approvals").jsonArray
                        .map { wire.decodeFromJsonElement(Approval.serializer(), it) }.firstOrNull { it.turnId == turn.turnId }
                    if (found == null) delay(300)
                }
                found
            }
            assertEquals("item/commandExecution/requestApproval", approval.method)
            repo.refresh()
            compose.waitUntil(15000) { repo.state.value.snapshot.sessions.any { it.sessionId == session.sessionId } && !repo.state.value.stale }
            repo.selectSession(session.sessionId)
            compose.onNodeWithText("工作台").performClick()
            if (compose.onAllNodesWithText("审批 (1)").fetchSemanticsNodes().isNotEmpty()) compose.onNodeWithText("审批 (1)").performClick()
            else if (compose.onAllNodesWithText("审批").fetchSemanticsNodes().isNotEmpty()) compose.onNodeWithText("审批").performClick()
            compose.onNodeWithText("检查并允许一次").assertIsEnabled()
            File(context.getExternalFilesDir(null), "physical-approval-stage.json").writeText("{\"stage\":\"WAITING_FOR_TABLET_HUMAN\"}")
            // Only the human may press the product's approval controls and final confirmation.
            var resolved: JsonObject? = null
            var terminal: Turn? = null
            withTimeout(270000) {
                while (resolved == null || terminal == null) {
                    val detail = transport.request("sessions.detail", buildJsonObject { put("sessionId", session.sessionId); put("limit", 500) })
                    resolved = detail.getValue("events").jsonArray.map { wire.decodeFromJsonElement(DeckEvent.serializer(), it) }
                        .firstOrNull { it.action == "approval.resolved" && it.payload.jsonObject["approvalId"]?.jsonPrimitive?.content == approval.approvalId }?.payload?.jsonObject
                    terminal = detail.getValue("turns").jsonArray.map { wire.decodeFromJsonElement(Turn.serializer(), it) }
                        .firstOrNull { it.turnId == turn.turnId && it.status in listOf("completed", "failed", "interrupted") }
                    if (resolved == null || terminal == null) delay(600)
                }
            }
            val status = requireNotNull(resolved).getValue("status").jsonPrimitive.content
            assertTrue("A real human decision is required, expiry is not acceptance", status in listOf("approved", "rejected"))
            val decision = if (status == "approved") "approve" else "reject"
            try {
                transport.request("approvals.decide", payload("sessionId" to session.sessionId, "turnId" to turn.turnId, "approvalId" to approval.approvalId, "decision" to decision))
                fail("Repeated decision was accepted")
            } catch (e: DeckException) { assertEquals("APPROVAL_STALE", e.code) }
            File(context.getExternalFilesDir(null), "physical-approval-result.json").writeText(buildJsonObject {
                put("result", "PASS"); put("source", "physical Pad Wi-Fi pinned WSS; human-operated real approval UI")
                put("humanDecision", status); put("terminal", requireNotNull(terminal).status); put("duplicateRejected", true)
                put("sessionId", session.sessionId); put("turnId", turn.turnId); put("approvalId", approval.approvalId)
            }.toString())
        } finally { transport.close() }
    }
}
