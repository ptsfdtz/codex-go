package dev.agentdeck.app

import androidx.activity.compose.setContent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Local fixtures only: no provider requests or changes to paired computers. */
@RunWith(AndroidJUnit4::class)
class SettingsNavigationTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun codexArchiveIsReachedFromSettingsAndOfflineRestoreIsDisabled() {
        val repo = (compose.activity.application as DeckApplication).repository
        val fixture = DeckState(
            host = Host("https://localhost:49321", "a".repeat(64), "settings-fixture", "fixture-device", "not-a-credential"),
            snapshot = Snapshot(projects = listOf(Project("project", "Fixture project", "/fixture")), sessions = listOf(
                Session("active", "project", "active-thread", "Active Codex fixture", "idle"),
                Session("archived", "project", "archived-thread", "Archived Codex fixture", "idle", archived = 1),
            )), stale = true,
        )
        compose.runOnUiThread { compose.activity.setContent { DeckTheme { DeckApp(fixture, repo) } } }
        compose.onNodeWithText("已归档").assertDoesNotExist()
        compose.onNodeWithText("Archived Codex fixture").assertDoesNotExist()
        compose.onNodeWithContentDescription("更多操作").performClick()
        compose.onAllNodesWithTag("codex-open-settings").onLast().performClick()
        compose.onNodeWithText("查看已归档会话").performClick()
        compose.onNodeWithText("Archived Codex fixture").assertIsDisplayed()
        compose.onNodeWithText("恢复").assertIsNotEnabled()
        compose.onNodeWithText("关闭").performClick()
        compose.onNodeWithText("已归档会话").assertDoesNotExist()
        compose.onNodeWithContentDescription("返回对话").performClick()
        compose.onNodeWithContentDescription("返回对话").assertDoesNotExist()
    }
}
