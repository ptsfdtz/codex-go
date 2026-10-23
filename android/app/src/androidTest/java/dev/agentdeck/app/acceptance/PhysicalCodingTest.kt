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

@RunWith(AndroidJUnit4::class)
class PhysicalCodingTest {
    @Test fun actualCodexEditAppearsInRealGitDiff() = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("physicalLan") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val transport = DeckTransport(requireNotNull(Vault(context).read()))
        try {
            transport.connect()
            transport.request("system.hello", buildJsonObject { put("client", "physical-code-edit"); put("version", 1) })
            val snapshot = wire.decodeFromJsonElement(Snapshot.serializer(), transport.request("snapshot.get"))
            val project = snapshot.projects.last()
            val session = wire.decodeFromJsonElement(Session.serializer(), transport.request("sessions.create", payload("projectId" to project.projectId, "title" to "Real Pad coding acceptance")).getValue("session"))
            val turn = wire.decodeFromJsonElement(Turn.serializer(), transport.request("turn.start", payload("sessionId" to session.sessionId, "text" to "Use apply_patch to create agentdeck-produced.txt in the current workspace with exactly one line AGENTDECK_REAL_CODE_EDIT_OK followed by a newline. Do not read or change other files, run commands, use network, or request extra permissions. Report completion only after the file was created.")).getValue("turn"))
            withTimeout(120000) {
                while (true) {
                    val detail = transport.request("sessions.detail", buildJsonObject { put("sessionId", session.sessionId); put("limit", 500) })
                    val current = detail.getValue("turns").jsonArray.map { wire.decodeFromJsonElement(Turn.serializer(), it) }.first { it.turnId == turn.turnId }
                    if (current.status in listOf("completed", "failed", "interrupted")) { assertEquals("completed", current.status); break }
                    delay(500)
                }
            }
            val git = wire.decodeFromJsonElement(GitStatus.serializer(), transport.request("git.status", payload("projectId" to project.projectId)))
            val file = git.files.first { it.path == "agentdeck-produced.txt" }
            val diff = wire.decodeFromJsonElement(Diff.serializer(), transport.request("git.diff", payload("projectId" to project.projectId, "fileId" to file.fileId)))
            assertEquals("AGENTDECK_REAL_CODE_EDIT_OK\n", diff.text)
            assertTrue(file.untracked); assertFalse(diff.truncated)
            File(context.getExternalFilesDir(null),"physical-coding-result.json").writeText(buildJsonObject {
                put("result", "PASS"); put("source", "Physical Pad initiated real Codex apply_patch and read actual Windows Git diff")
                put("terminal", "completed"); put("exactFileContentVerified", true); put("sessionId",session.sessionId); put("turnId",turn.turnId)
            }.toString())
        } finally { transport.close() }
    }
}
