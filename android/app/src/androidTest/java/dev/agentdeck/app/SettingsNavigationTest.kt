package dev.agentdeck.app

import androidx.activity.compose.setContent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Local fixtures only: no provider requests or changes to paired computers. */
@RunWith(AndroidJUnit4::class)
class SettingsNavigationTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun chatSettingsRestoresArchivedConversationAndPreservesDraft() {
        val store = object : ApiPersistence {
            @Volatile var document = ApiDocument(conversations = listOf(ApiConversation("active", "Active fixture"), ApiConversation("archived", "Archived fixture", archived = true, messages = listOf(ApiMessage("message", "assistant", "Archived body")))))
            override fun read() = document
            override fun write(value: ApiDocument) { document = value }
        }
        val repo = ApiRepository(store)
        compose.waitUntil(5000) { repo.state.value.storageReady }
        repo.select("active")
        compose.runOnUiThread { compose.activity.setContent { DeckTheme { ApiWorkspace(repo) {} } } }
        compose.onNodeWithText("Archived fixture").assertDoesNotExist()
        compose.onNodeWithTag("api-input").performTextInput("Unsaved draft")
        compose.runOnUiThread { (compose.activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).hideSoftInputFromWindow(compose.activity.window.decorView.windowToken, 0) }
        compose.onNodeWithTag("api-open-settings").performClick()
        compose.onNodeWithTag("api-settings").assertExists()
        compose.onNodeWithTag("api-input").assertDoesNotExist()
        compose.onNodeWithText("查看已归档会话").performClick()
        compose.onNodeWithText("Archived fixture").assertIsDisplayed()
        compose.onNodeWithText("Archived fixture").performClick()
        compose.onNodeWithText("Archived body").assertIsDisplayed()
        compose.onNodeWithTag("api-input").assertIsNotEnabled()
        repo.select("active")
        compose.onNodeWithTag("api-open-settings").performClick()
        compose.onNodeWithText("查看已归档会话").performClick()
        compose.onNodeWithText("恢复").performClick()
        compose.onNodeWithText("取消").performClick()
        assertTrue(store.document.conversations.first { it.id == "archived" }.archived)
        compose.onNodeWithText("恢复").performClick()
        compose.onNodeWithText("确认").performClick()
        compose.waitUntil(5000) { !repo.state.value.busy && !repo.state.value.conversations.first { it.id == "archived" }.archived }
        compose.onNodeWithText("暂无已归档会话").assertIsDisplayed()
        compose.onNodeWithText("关闭").performClick()
        compose.onNodeWithText("返回对话").performClick()
        compose.onNodeWithTag("api-input").assertTextContains("Unsaved draft")
        assertFalse(store.document.conversations.first { it.id == "archived" }.archived)
    }

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
        compose.onNodeWithTag("codex-open-settings").performClick()
        compose.onNodeWithText("查看已归档会话").performClick()
        compose.onNodeWithText("Archived Codex fixture").assertIsDisplayed()
        compose.onNodeWithText("恢复").assertIsNotEnabled()
        compose.onNodeWithText("关闭").performClick()
        compose.onNodeWithText("已归档会话").assertDoesNotExist()
        compose.onNodeWithText("返回对话").performClick()
        compose.onNodeWithText("返回对话").assertDoesNotExist()
    }
}
