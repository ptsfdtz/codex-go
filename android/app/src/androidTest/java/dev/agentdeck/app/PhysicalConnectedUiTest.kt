package dev.agentdeck.app

import android.app.UiAutomation
import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileInputStream

@RunWith(AndroidJUnit4::class)
class PhysicalConnectedUiTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    @Test fun connectedRotationGitAndWifiRecovery() = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("physicalLan") == "true")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val repo = (context.applicationContext as DeckApplication).repository
        val automation = instrumentation.uiAutomation
        fun shell(command: String): String = automation.executeShellCommand(command).use { descriptor ->
            FileInputStream(descriptor.fileDescriptor).bufferedReader().use { it.readText() }
        }
        withTimeout(30000) { repo.state.first { !it.stale && it.connection == "已连接" } }
        val host = requireNotNull(repo.state.value.host)
        val project = repo.state.value.snapshot.projects.first()
        assertTrue(repo.state.value.snapshot.sessions.size >= 2)
        try {
            compose.onNodeWithText("审查").performClick()
            repo.selectProject(project.projectId); repo.refreshGit()
            compose.waitUntil(15000) { repo.state.value.git?.files?.any { it.path == "external-change.txt" } == true }
            for ((rotation,name) in listOf(UiAutomation.ROTATION_FREEZE_90 to "landscape", UiAutomation.ROTATION_FREEZE_0 to "portrait")) {
                assertTrue(automation.setRotation(rotation))
                compose.waitUntil(10000) { runCatching { val view=compose.activity.window.decorView; if(name=="landscape")view.width>view.height else view.height>view.width }.getOrDefault(false) }
                compose.onNodeWithText("已连接").assertIsDisplayed()
                if (compose.onAllNodesWithText("筛选文件路径").fetchSemanticsNodes().isNotEmpty()) {
                    compose.onNodeWithText("筛选文件路径").performTextReplacement("external-change")
                    compose.onNodeWithText("external-change.txt").performClick()
                }
                compose.waitUntil(15000) { repo.state.value.diff?.text?.contains("predates the Codex task") == true }
                compose.onNodeWithTag("git-diff-lines").assertExists()
                compose.runOnUiThread {
                    val view=compose.activity.window.decorView
                    val bitmap=Bitmap.createBitmap(view.width,view.height,Bitmap.Config.ARGB_8888)
                    view.draw(Canvas(bitmap))
                    File(context.getExternalFilesDir(null),"connected-$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) }
                    bitmap.recycle()
                }
            }
            assertEquals("1", shell("settings get global wifi_on").trim())
            try {
                shell("svc wifi disable")
                withTimeout(60000) { repo.state.first { it.stale && it.connection != "已连接" } }
                compose.onNodeWithText("离线缓存", substring=true).assertIsDisplayed()
            } finally { shell("svc wifi enable") }
            withTimeout(90000) { repo.state.first { !it.stale && it.connection == "已连接" } }
            assertEquals(host.hostId, repo.state.value.host?.hostId)
            assertTrue(repo.state.value.snapshot.projects.any { it.projectId == project.projectId })
            compose.activityRule.scenario.recreate()
            compose.onNodeWithText("已连接").assertIsDisplayed()
            File(context.getExternalFilesDir(null),"physical-connected-ui-result.json").writeText("{\"result\":\"PASS\",\"source\":\"physical connected Compose assertions over real LAN\",\"realGitBothOrientations\":true,\"wifiOffOfflineBanner\":true,\"wifiRestoredReconnected\":true,\"recreation\":true}")
        } finally { automation.setRotation(UiAutomation.ROTATION_UNFREEZE) }
    }
}
