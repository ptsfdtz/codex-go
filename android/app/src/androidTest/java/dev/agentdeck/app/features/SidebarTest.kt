package dev.agentdeck.app

import android.app.UiAutomation
import android.graphics.Bitmap
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

@RunWith(AndroidJUnit4::class)
class SidebarTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()

    private fun rotate(rotation:Int){
        assertTrue(InstrumentationRegistry.getInstrumentation().uiAutomation.setRotation(rotation))
        compose.waitUntil(10000){val view=compose.activity.window.decorView;if(rotation==UiAutomation.ROTATION_FREEZE_90)view.width>view.height else view.height>view.width}
        compose.waitForIdle()
    }

    private fun assertFullHeight(tag:String){
        val root=compose.onRoot().fetchSemanticsNode().boundsInRoot
        val sidebar=compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot
        assertEquals("Sidebar must cover the top system inset",root.top,sidebar.top,1f)
        assertEquals("Sidebar must cover the bottom gesture inset",root.bottom,sidebar.bottom,1f)
    }

    private fun screenshot(name:String){
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val bitmap=requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        try{File(instrumentation.targetContext.getExternalFilesDir(null),"sidebar-$name.png").outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)}}finally{bitmap.recycle()}
    }

    @Test fun codexSidebarFillsHeightAndCollapsesInBothOrientations(){
        val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
        val repo=(compose.activity.application as DeckApplication).repository
        val fixture=DeckState(host=Host("https://localhost:49321","a".repeat(64),"ui-host","ui-device","not-a-credential"),stale=true)
        try{
            rotate(UiAutomation.ROTATION_FREEZE_90)
            compose.runOnUiThread{compose.activity.setContent{DeckTheme{DeckApp(fixture,repo)}}}
            assertFullHeight("chat-sidebar")
            screenshot("codex-expanded")
            val expandedWidth=compose.onNodeWithTag("workspace-content").fetchSemanticsNode().boundsInRoot.width
            compose.onNodeWithContentDescription("收起会话列表").performClick()
            compose.onNodeWithTag("chat-sidebar").assertDoesNotExist()
            assertTrue(compose.onNodeWithTag("workspace-content").fetchSemanticsNode().boundsInRoot.width>expandedWidth)
            screenshot("codex-collapsed")
            compose.onNodeWithContentDescription("打开会话列表").performClick()
            assertFullHeight("chat-sidebar")

            rotate(UiAutomation.ROTATION_FREEZE_0)
            compose.runOnUiThread{compose.activity.setContent{DeckTheme{DeckApp(fixture,repo)}}}
            compose.onNodeWithTag("chat-sidebar").assertDoesNotExist()
            compose.onNodeWithContentDescription("打开会话列表").performClick()
            compose.onNodeWithContentDescription("收起会话列表").assertIsDisplayed()
            assertFullHeight("chat-sidebar")
            screenshot("codex-portrait")
            compose.onNodeWithContentDescription("收起会话列表").performClick()
            compose.onNodeWithTag("chat-sidebar").assertDoesNotExist()
            compose.onNodeWithContentDescription("打开会话列表").performClick()
            InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
            compose.onNodeWithTag("chat-sidebar").assertDoesNotExist()
        }finally{automation.setRotation(UiAutomation.ROTATION_UNFREEZE)}
    }

}
