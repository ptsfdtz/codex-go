package dev.agentdeck.app

import androidx.activity.compose.setContent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Isolated local UI/storage fixtures: never makes provider calls or approves Codex requests. */
@RunWith(AndroidJUnit4::class)
class ApiUiTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    @Test fun apiModeIsAvailableWithoutPairing(){
        compose.runOnUiThread{val repo=(compose.activity.application as DeckApplication).repository;compose.activity.setContent{DeckTheme{DeckApp(DeckState(),repo)}}}
        compose.onNodeWithText("chat").performClick()
        compose.onNodeWithTag("api-open-settings").assertIsDisplayed().performClick()
        compose.onNodeWithTag("api-base").assertExists()
        compose.onNodeWithTag("api-settings").performScrollToNode(hasTestTag("api-key"))
        compose.onNodeWithTag("api-key").performTextInput("fixture-only-key")
        compose.onNodeWithTag("api-key").assert(SemanticsMatcher.keyIsDefined(androidx.compose.ui.semantics.SemanticsProperties.Password))
        compose.onNodeWithText("返回对话").performClick()
        compose.onNodeWithText("Codex").performClick()
        compose.onNodeWithText("配对 Windows 主机").assertExists()
    }
    @Test fun apiRenameArchiveRestoreAndDeleteRequireConfirmation(){
        val memory=object:ApiPersistence{
            var doc=ApiDocument(conversations=listOf(ApiConversation("fixture","Local fixture")))
            override fun read()=doc
            override fun write(value:ApiDocument){doc=value}
        }
        val repo=ApiRepository(memory)
        compose.waitUntil(5000){repo.state.value.storageReady};repo.select("fixture")
        compose.runOnUiThread{compose.activity.setContent{DeckTheme{ApiWorkspace(repo){}}}}
        fun manage(label:String){compose.onNodeWithContentDescription("管理 chat 会话").performClick();compose.onNodeWithText(label,useUnmergedTree=true).performClick()}
        manage("重命名")
        compose.onNode(hasSetTextAction() and hasText("Local fixture")).performTextReplacement("Renamed fixture")
        compose.onNodeWithText("确认").performClick();compose.waitUntil(5000){!repo.state.value.busy&&repo.state.value.conversations[0].title=="Renamed fixture"}
        manage("归档");compose.onNodeWithText("确认").performClick();compose.waitUntil(5000){!repo.state.value.busy&&repo.state.value.conversations[0].archived}
        compose.onNodeWithContentDescription("发送 API 消息").assertIsNotEnabled()
        manage("恢复会话");compose.onNodeWithText("确认").performClick();compose.waitUntil(5000){!repo.state.value.busy&&!repo.state.value.conversations[0].archived}
        manage("删除");compose.onNodeWithText("取消").performClick();assertEquals(1,repo.state.value.conversations.size)
        manage("删除");compose.onNodeWithText("确认").performClick();compose.waitUntil(5000){!repo.state.value.busy&&repo.state.value.conversations.isEmpty()}
        assertTrue(memory.doc.conversations.isEmpty())
    }
    @Test fun apiKeystoreEncryptsKeyAndHistoryInIsolatedTestContext(){
        val context=InstrumentationRegistry.getInstrumentation().context
        val file=File(context.filesDir,"api-conversations.encrypted")
        assertFalse("Test fixture must never replace existing records",file.exists())
        try{
            val store=ApiSecureStore(context)
            val document=ApiDocument(ApiConfig(key="fixture-secret-unique"),listOf(ApiConversation("f","fixture",messages=listOf(ApiMessage("m","user","fixture-sensitive-text")))))
            store.write(document);assertEquals(document,store.read())
            val raw=file.readBytes().toString(Charsets.ISO_8859_1)
            assertFalse(raw.contains("fixture-secret-unique"));assertFalse(raw.contains("fixture-sensitive-text"))
        }finally{file.delete();File(file.path+".bak").delete()}
    }
}
