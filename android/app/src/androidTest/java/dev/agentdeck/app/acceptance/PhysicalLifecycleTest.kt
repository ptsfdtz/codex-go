package dev.agentdeck.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Opted-in physical LAN checks. Uses an already human-paired test host; never grants access. */
@RunWith(AndroidJUnit4::class)
class PhysicalLifecycleTest {
    @Test fun continueInterruptReplayAndSecurity() = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("physicalLan") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val host = requireNotNull(Vault(context).read()) { "Human pairing is required first" }
        val checks = mutableListOf<String>()
        suspend fun connect(value: Host = host): DeckTransport {
            val transport = DeckTransport(value)
            try {
                transport.connect()
                transport.request("system.hello", buildJsonObject { put("client", "physical-lifecycle"); put("version", 1) })
                return transport
            } catch (e: Exception) { transport.close(); throw e }
        }
        val badPin = host.copy(fingerprint = "0".repeat(64))
        try { connect(badPin).close(); fail("Wrong certificate pin was accepted") }
        catch (e: Exception) { assertTrue(e.toString().contains("SSL") || e.toString().contains("Certificate")) }
        checks += "wrong TLS pin rejected"
        try { connect(host.copy(credential = "a".repeat(43))).close(); fail("Unpaired device was accepted") }
        catch (e: Exception) { assertTrue(e.toString().contains("401")) }
        checks += "unpaired WSS device rejected"
        var transport = connect()
        try {
            val snapshot = wire.decodeFromJsonElement(Snapshot.serializer(), transport.request("snapshot.get"))
            val session = snapshot.sessions.first { it.status == "completed" }
            try {
                transport.request("git.status", payload("projectId" to "unauthorized-project"))
                fail("Unauthorized project accepted")
            } catch (e: DeckException) { assertEquals("WORKSPACE_FORBIDDEN", e.code) }
            checks += "unauthorized project rejected"
            suspend fun start(text: String): Turn = wire.decodeFromJsonElement(Turn.serializer(), transport.request("turn.start", payload("sessionId" to session.sessionId, "text" to text)).getValue("turn"))
            suspend fun terminal(id: String): Turn = withTimeout(120000) {
                while (true) {
                    val detail = transport.request("sessions.detail", buildJsonObject { put("sessionId", session.sessionId); put("limit", 500) })
                    val turn = detail.getValue("turns").jsonArray.map { wire.decodeFromJsonElement(Turn.serializer(), it) }.first { it.turnId == id }
                    if (turn.status in listOf("completed", "failed", "interrupted")) return@withTimeout turn
                    delay(500)
                }
                @Suppress("UNREACHABLE_CODE") error("unreachable")
            }
            val continued = start("Reply exactly AGENTDECK_PAD_CONTINUE_OK. Do not run commands or read files.")
            assertEquals("completed", terminal(continued.turnId).status)
            checks += "continued real thread completed"
            val interrupted = start("Produce a numbered list of 2000 software test ideas. Do not use tools or read files.")
            transport.request("turn.interrupt", payload("sessionId" to session.sessionId, "turnId" to interrupted.turnId))
            assertEquals("interrupted", terminal(interrupted.turnId).status)
            checks += "upstream confirmed interruption"
            val before = transport.request("snapshot.get").getValue("cursor").jsonPrimitive.content
            val disconnected = start("Reply exactly AGENTDECK_PAD_RECONNECT_OK. Do not run commands or read files.")
            transport.close()
            transport = connect()
            assertEquals("completed", terminal(disconnected.turnId).status)
            val replay = transport.request("events.replay", buildJsonObject { put("cursor", before); put("limit", 500) }).getValue("events").jsonArray
                .map { wire.decodeFromJsonElement(DeckEvent.serializer(), it) }
            assertEquals(replay.size, replay.map { it.eventId }.toSet().size)
            assertTrue(replay.zipWithNext().all { (a,b) -> a.eventId.toLong() < b.eventId.toLong() })
            assertTrue(replay.any { it.turnId == disconnected.turnId && it.action == "turn.completed" })
            checks += "reconnect with saved credential and ordered terminal event replay"
            val report = buildJsonObject {
                put("result", "PASS"); put("source", "physical Pad Wi-Fi; real Codex; no automatic approval")
                put("checks", JsonArray(checks.map(::JsonPrimitive))); put("replayedEvents", replay.size)
            }
            File(context.getExternalFilesDir(null), "physical-lifecycle-result.json").writeText(report.toString())
        } finally { transport.close() }
    }
}
