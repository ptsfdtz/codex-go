package dev.agentdeck.app

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.accessibility.AccessibilityNodeInfo
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.runner.RunWith
import java.io.File

/** Only the isolated application ID may receive the short-lived synthetic test credential. */
@RunWith(AndroidJUnit4::class)
class ComposerBootstrapTest {
    @Test fun bootstrapIsolatedHost(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        assertEquals("dev.agentdeck.composertest",context.packageName)
        val file=File(context.filesDir,"composer-host.json")
        Vault(context).save(wire.decodeFromString(Host.serializer(),file.readText()))
        file.delete()
    }
}

@RunWith(AndroidJUnit4::class)
class PhysicalComposerTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    @Test fun realFilesPlanQuestionsDefaultAndGoal(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("physicalComposer")=="true")
        assertEquals("dev.agentdeck.composertest",compose.activity.packageName)
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val repo=(compose.activity.application as DeckApplication).repository
        compose.waitUntil(60000){!repo.state.value.stale&&repo.state.value.snapshot.projects.size==1}
        compose.runOnUiThread{repo.selectProject(repo.state.value.snapshot.projects.single().projectId);repo.setFullAccess(false)}
        fun mode(label:String){compose.onNodeWithContentDescription("更多操作").performClick();compose.onNodeWithText(label).performClick()}
        fun send(text:String){compose.onNodeWithTag("chat-input").performTextReplacement(text);compose.onNodeWithContentDescription("发送消息").performClick()}
        fun completed(marker:String){
            compose.waitUntil(180000){val s=repo.state.value;s.error!=null||(s.selectedSession!=null&&s.snapshot.sessions.any{it.sessionId==s.selectedSession&&it.status=="completed"}&&conversationEntries(s.events).any{it.kind=="assistant"&&it.text.contains(marker)})}
            assertNull(repo.state.value.error)
            assertTrue(conversationEntries(repo.state.value.events).any{it.kind=="assistant"&&it.text.contains(marker)})
        }
        fun clickSystem(vararg labels:String):Boolean{
            fun find(node:AccessibilityNodeInfo?):Boolean{
                if(node==null)return false
                if(labels.any{label->node.text?.toString()?.equals(label,true)==true||node.contentDescription?.toString()?.equals(label,true)==true}){
                    var target:AccessibilityNodeInfo?=node
                    while(target!=null){if(target.isClickable)return target.performAction(AccessibilityNodeInfo.ACTION_CLICK);target=target.parent}
                }
                for(i in 0 until node.childCount)if(find(node.getChild(i)))return true
                return false
            }
            return find(instrumentation.uiAutomation.rootInActiveWindow)
        }
        // Real Android document picker -> ContentResolver -> production composer -> physical WSS.
        compose.onNodeWithContentDescription("更多操作").performClick()
        compose.onNodeWithText("上传文件或图片").performClick()
        Thread.sleep(1200)
        if(!clickSystem("composer-note.txt")){
            clickSystem("Show roots","显示根目录","打开导航抽屉","显示存储空间")
            Thread.sleep(500)
            check(clickSystem("Downloads","下载")){"Document picker Downloads entry missing"}
            Thread.sleep(700)
            check(clickSystem("composer-note.txt")){"Document picker test file missing"}
        }
        compose.waitUntil(10000){compose.onAllNodesWithText("composer-note.txt").fetchSemanticsNodes().isNotEmpty()}
        send("Only read the attached composer-note.txt in this isolated test project and reply with its exact marker. Do not read any other files or change files.")
        completed("PHYSICAL_ATTACHMENT_OK")
        mode("Plan · 先制定计划")
        send("Synthetic Plan acceptance test. Do not implement anything. First use request_user_input to ask one question with id approach and options A and B. Then write a short proposed plan including PHYSICAL_PLAN_OK. Do not run commands or inspect files.")
        compose.waitUntil(120000){repo.state.value.error!=null||repo.state.value.snapshot.approvals.any{it.method=="item/tool/requestUserInput"&&it.status=="pending"}}
        assertNull(repo.state.value.error)
        compose.onNodeWithTag("execution-timeline").performScrollToNode(hasText("Codex 需要你的回答"))
        val question=repo.state.value.snapshot.approvals.first{it.method=="item/tool/requestUserInput"&&it.status=="pending"}
        val label=question.context.getValue("questions").let{it as kotlinx.serialization.json.JsonArray}.first().let{it as kotlinx.serialization.json.JsonObject}.getValue("options").let{it as kotlinx.serialization.json.JsonArray}.first().let{it as kotlinx.serialization.json.JsonObject}.getValue("label").let{it as kotlinx.serialization.json.JsonPrimitive}.content
        compose.onNodeWithText(label).performClick()
        compose.onNodeWithText("提交回答").performClick()
        completed("PHYSICAL_PLAN_OK")
        mode("默认 · 直接执行")
        send("Reply exactly PHYSICAL_DEFAULT_OK. Do not use tools or inspect files.")
        completed("PHYSICAL_DEFAULT_OK")
        assertEquals("default",repo.state.value.snapshot.sessions.first{it.sessionId==repo.state.value.selectedSession}.mode)
        mode("Goal · 持续完成目标")
        send("Synthetic Goal acceptance in an isolated directory. Reply PHYSICAL_GOAL_OK and mark this goal complete using the goal tool. Do not inspect or change files or run commands.")
        completed("PHYSICAL_GOAL_OK")
        compose.runOnUiThread{
            val view=compose.activity.window.decorView
            val bitmap=Bitmap.createBitmap(view.width,view.height,Bitmap.Config.ARGB_8888)
            view.draw(Canvas(bitmap))
            File(compose.activity.getExternalFilesDir(null),"physical-composer.png").outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)}
            bitmap.recycle()
        }
        File(compose.activity.getExternalFilesDir(null),"physical-composer-result.json").writeText("""{"result":"PASS","transport":"physical Xiaomi USB reverse + pinned TLS/WSS","scope":"separate app and isolated synthetic grant; original app unchanged","filePicker":true,"realAttachmentRead":true,"nativePlanQuestionAnsweredViaUI":true,"defaultReset":true,"nativeGoalCompleted":true}""")
    }
}
