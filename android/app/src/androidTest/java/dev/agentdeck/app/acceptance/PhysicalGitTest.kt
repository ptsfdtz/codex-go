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
class PhysicalGitTest {
    @Test fun realWorkingTreeRenameBinaryAndTruncation() = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("physicalLan") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val host = requireNotNull(Vault(context).read())
        val transport = DeckTransport(host)
        try {
            transport.connect()
            transport.request("system.hello", buildJsonObject { put("client", "physical-git"); put("version", 1) })
            val snapshot = wire.decodeFromJsonElement(Snapshot.serializer(), transport.request("snapshot.get"))
            val project = snapshot.projects.first()
            val git = wire.decodeFromJsonElement(GitStatus.serializer(), transport.request("git.status", payload("projectId" to project.projectId)))
            assertTrue(git.available); assertEquals("working-tree; may include external changes", git.attribution)
            suspend fun diff(file: GitFile) = wire.decodeFromJsonElement(Diff.serializer(), transport.request("git.diff", payload("projectId" to project.projectId, "fileId" to file.fileId)))
            val rename = git.files.first { it.path == "renamed-name.txt" }
            assertEquals("original-name.txt", rename.oldPath); assertEquals("R", rename.index)
            assertTrue(diff(rename).text.contains("rename from original-name.txt"))
            assertTrue(diff(git.files.first { it.path == "tracked-binary.bin" }).binary)
            val large = diff(git.files.first { it.path == "large-external.txt" })
            assertTrue(large.truncated); assertTrue(large.untracked); assertTrue(large.text.length <= 262144)
            val external = diff(git.files.first { it.path == "external-change.txt" })
            assertTrue(external.untracked); assertTrue(external.text.contains("predates the Codex task"))
            assertEquals("working-tree", external.attribution)
            File(context.getExternalFilesDir(null), "physical-git-result.json").writeText(buildJsonObject {
                put("result", "PASS"); put("source", "Real temporary Windows Git working tree read by physical Pad over pinned WSS")
                put("stagedRename", true); put("trackedBinary", true); put("oversizeTruncated", true)
                put("externalUntrackedChange", true); put("attribution", "working-tree")
            }.toString())
        } finally { transport.close() }
    }
}
