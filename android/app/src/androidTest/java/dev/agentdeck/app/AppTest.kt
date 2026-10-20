package dev.agentdeck.app

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.Assert.*
import androidx.room.Room
import kotlinx.coroutines.runBlocking
import android.app.UiAutomation
import android.graphics.Bitmap
import android.graphics.Canvas
import java.io.File
import java.io.FileOutputStream
import androidx.activity.compose.setContent
import androidx.compose.runtime.collectAsState
import kotlinx.serialization.json.*

@RunWith(AndroidJUnit4::class)
class AppTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    private fun unpaired(){compose.runOnUiThread{val repo=(compose.activity.application as DeckApplication).repository;compose.activity.setContent{DeckTheme{DeckApp(DeckState(),repo)}}}}
    private fun settings(){if(compose.onAllNodesWithContentDescription("设置").fetchSemanticsNodes().isNotEmpty())compose.onNodeWithContentDescription("设置").performClick()else compose.onNodeWithText("设置").performClick()}
    @Test fun launchesWithoutDemoAndSurvivesRecreation(){unpaired();compose.onNodeWithText("AgentDeck").assertIsDisplayed();compose.onNodeWithText("配对 Windows 主机").assertExists();compose.activityRule.scenario.recreate();unpaired();compose.onNodeWithText("配对 Windows 主机").assertExists();compose.onNodeWithTag("chat-input").assertDoesNotExist();compose.onNodeWithText("工作总览").assertDoesNotExist()}
    @Test fun pairingDialogExplainsLocalConfirmation(){unpaired();compose.onNodeWithText("配对 Windows 主机").performClick();compose.onNodeWithText("安全配对 Windows").assertIsDisplayed();compose.onNodeWithText("扫描配对二维码").assertExists();compose.onNodeWithText("关闭").performClick();compose.onNodeWithText("配对 Windows 主机").assertExists()}
    @Test fun keystoreRoundTripAndRoomTransaction(){val context=InstrumentationRegistry.getInstrumentation().targetContext;val vault=Vault(context);val original=vault.read();val db=Room.inMemoryDatabaseBuilder(context,DeckDatabase::class.java).build();try{val host=Host("https://localhost:49321","a".repeat(64),"test-host","test-device","b".repeat(43));vault.save(host);assertEquals(host,vault.read());runBlocking{db.cache().saveHost(CachedHost(host.hostId,"{}","19","now"));assertEquals("19",db.cache().host(host.hostId)?.cursor);db.cache().saveEvents(listOf(CachedEvent(host.hostId,19,"s","{}")));db.cache().removeEvents(host.hostId)}}finally{if(original!=null)vault.save(original)else vault.clear();db.close()}}
    @Test fun physicalRotationKeepsPairingReachable(){
        val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
        try{for((rotation,name) in listOf(UiAutomation.ROTATION_FREEZE_90 to "landscape",UiAutomation.ROTATION_FREEZE_0 to "portrait")){
            assertTrue(automation.setRotation(rotation));compose.waitForIdle()
            compose.waitUntil(10000){runCatching{val view=compose.activity.window.decorView;if(name=="landscape")view.width>view.height else view.height>view.width}.getOrDefault(false)}
            unpaired();compose.onNodeWithText("配对 Windows 主机").assertIsDisplayed()
            compose.runOnUiThread{val view=compose.activity.window.decorView;val image=Bitmap.createBitmap(view.width,view.height,Bitmap.Config.ARGB_8888);view.draw(Canvas(image));FileOutputStream(File(compose.activity.getExternalFilesDir(null),"acceptance-$name.png")).use{image.compress(Bitmap.CompressFormat.PNG,100,it)};image.recycle()}
        }}finally{automation.setRotation(UiAutomation.ROTATION_UNFREEZE)}
    }
    @Test fun settingsThemePersistsAndNotificationsRemainOptIn(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val preferences=PreferenceStore(context);val original=preferences.read()
        try{
            settings()
            compose.onNodeWithText("设置与诊断").assertIsDisplayed()
            compose.onNodeWithText("浅色").performClick()
            compose.onNodeWithText("浅色").assertIsSelected()
            assertEquals("light",preferences.read().theme)
            compose.activityRule.scenario.recreate()
            compose.onNodeWithText("设置与诊断").assertIsDisplayed()
            compose.onNodeWithText("浅色").assertIsSelected()
            assertEquals(original.notifications,preferences.read().notifications)
        }finally{preferences.save(original);val repository=(context.applicationContext as DeckApplication).repository;repository.setTheme(original.theme)}
    }
    @Test fun temporaryMaskHidesLogsAndDiffButKeepsApprovalContext(){
        // Explicit isolated view data. No upstream approvals, network or real sensitive content.
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val repo=(context.applicationContext as DeckApplication).repository
        val originalMask=repo.state.value.displayMask
        val approval=Approval("ui-approval","ui-session","ui-turn","item/commandExecution/requestApproval","pending",buildJsonObject{put("command","UI_SECRET_FIXTURE command")},expiresAt="2099-01-01T00:00:00Z",allowedDecisions=listOf("approve","reject"))
        val fixture=DeckState(host=Host("https://localhost:49321","a".repeat(64),"ui-host","ui-device","not-a-real-credential"),stale=true,selectedProject="ui-project",selectedSession="ui-session",events=listOf(DeckEvent(eventId="1",seq=1,sessionId="ui-session",turnId="ui-turn",action="turn.progress",payload=buildJsonObject{put("method","item/agentMessage/delta");put("itemId","ui-item");put("delta","prefix UI_SECRET_FIXTURE suffix")},ts="now")),snapshot=Snapshot(projects=listOf(Project("ui-project","Privacy UI fixture","C:/fixture")),sessions=listOf(Session("ui-session","ui-project","ui-thread","Privacy UI fixture task","waitingApproval")),approvals=listOf(approval)),git=GitStatus(available=true,files=listOf(GitFile("f","masked.txt",untracked=true))),diff=Diff(path="masked.txt",text="UI_SECRET_FIXTURE",untracked=true))
        try{
            repo.setDisplayMask("")
            compose.runOnUiThread{compose.activity.setContent{val live=repo.state.collectAsState().value;DeckTheme{DeckApp(fixture.copy(displayMask=live.displayMask),repo)}}}
            compose.onNodeWithContentDescription("临时遮盖敏感文字").performClick()
            compose.onNodeWithText("要遮盖的原文片段").performTextInput("ab")
            compose.onNodeWithText("启用遮盖").assertIsNotEnabled()
            compose.onNodeWithText("要遮盖的原文片段").performTextReplacement("UI_SECRET_FIXTURE")
            compose.onNodeWithText("启用遮盖").performClick()
            if(compose.onAllNodesWithText("返回对话").fetchSemanticsNodes().isNotEmpty())compose.onNodeWithText("返回对话").performClick()
            if(compose.onAllNodesWithTag("execution-timeline").fetchSemanticsNodes().isEmpty())compose.onNodeWithText("执行时间线").performClick()
            compose.onNodeWithTag("execution-timeline").performScrollToNode(hasText("prefix [本地遮盖] suffix"))
            compose.onNodeWithText("prefix [本地遮盖] suffix").assertExists()
            compose.onNodeWithText("prefix UI_SECRET_FIXTURE suffix").assertDoesNotExist()
            if(compose.onAllNodesWithContentDescription("审查").fetchSemanticsNodes().isNotEmpty())compose.onNodeWithContentDescription("审查").performClick()
            if(compose.onAllNodesWithTag("git-diff-lines").fetchSemanticsNodes().isEmpty())compose.onNodeWithText("masked.txt").performClick()
            compose.onNodeWithText("[本地遮盖]").assertExists()
            compose.onNodeWithTag("diff-new-0").assertTextEquals("1")
            if(compose.onAllNodesWithText("返回对话").fetchSemanticsNodes().isNotEmpty())compose.onNodeWithText("返回对话").performClick()
            if(compose.onAllNodesWithText("审批 (1)").fetchSemanticsNodes().isNotEmpty())compose.onNodeWithText("审批 (1)").performClick()
            else if(compose.onAllNodesWithText("审批").fetchSemanticsNodes().isNotEmpty())compose.onNodeWithText("审批").performClick()
            compose.onNodeWithTag("execution-timeline").performScrollToIndex(2)
            compose.onNodeWithText("UI_SECRET_FIXTURE command").assertExists()
            compose.onNodeWithText("检查并允许一次").assertIsNotEnabled()
            assertEquals("UI_SECRET_FIXTURE",repo.state.value.displayMask)
            assertFalse(context.getSharedPreferences("agentdeck_preferences",android.content.Context.MODE_PRIVATE).all.values.any{it.toString().contains("UI_SECRET_FIXTURE")})
            compose.activityRule.scenario.recreate()
            compose.onNodeWithContentDescription("管理已启用的临时遮盖").performClick()
            compose.onNodeWithText("临时遮盖已启用").assertExists()
            compose.onNodeWithText("清除遮盖").performClick()
            assertEquals("",repo.state.value.displayMask)
        }finally{repo.setDisplayMask(originalMask)}
    }
    @Test fun gitReviewFiltersRenameAndDisplaysSourceLineNumbersInBothOrientations(){
        // Isolated view fixture; no pairing, network traffic, project grant or Git command.
        val files=listOf(GitFile("renamed","src/New Name.kt","legacy/Old Name.kt",index="R"),GitFile("notes","docs/notes.md",worktree="M"))
        val state=DeckState(host=Host("https://localhost:49321","a".repeat(64),"ui-host","ui-device","not-a-real-credential"),stale=true,selectedProject="ui-project",snapshot=Snapshot(projects=listOf(Project("ui-project","UI fixture Git","C:/fixture"))),git=GitStatus(available=true,files=files),diff=Diff(path="src/New Name.kt",text="@@ -10 +20 @@\n-previous source\n+current source\n"))
        val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
        try{for(rotation in listOf(UiAutomation.ROTATION_FREEZE_90,UiAutomation.ROTATION_FREEZE_0)){
            assertTrue(automation.setRotation(rotation));compose.waitForIdle()
            compose.waitUntil(10000){runCatching{val view=compose.activity.window.decorView;if(rotation==UiAutomation.ROTATION_FREEZE_90)view.width>view.height else view.height>view.width}.getOrDefault(false)}
            compose.runOnUiThread{val repo=(compose.activity.application as DeckApplication).repository;compose.activity.setContent{DeckTheme{DeckApp(state,repo)}}}
            if(compose.onAllNodesWithContentDescription("审查").fetchSemanticsNodes().isNotEmpty())compose.onNodeWithContentDescription("审查").performClick()
            compose.onNodeWithText("筛选文件路径").performTextClearance()
            compose.onNodeWithText("筛选文件路径").performTextInput("OLD NAME")
            compose.onNodeWithText("原路径 legacy/Old Name.kt").assertExists()
            compose.onNodeWithText("docs/notes.md").assertDoesNotExist()
            compose.onNodeWithText("筛选文件路径").performTextReplacement("no-such-file")
            compose.onNodeWithTag("git-files").performScrollToNode(hasText("没有匹配的文件"))
            compose.onNodeWithText("没有匹配的文件").assertExists()
            compose.onNodeWithText("筛选文件路径").performTextReplacement("New Name")
            if(compose.onAllNodesWithTag("git-diff-lines").fetchSemanticsNodes().isEmpty())compose.onNodeWithText("src/New Name.kt").performClick()
            compose.onNodeWithTag("diff-old-1").assertTextEquals("10")
            compose.onNodeWithTag("diff-new-1").assertTextEquals("")
            compose.onNodeWithTag("diff-old-2").assertTextEquals("")
            compose.onNodeWithTag("diff-new-2").assertTextEquals("20")
            compose.onNodeWithText("+current source").assertExists()
        }}finally{automation.setRotation(UiAutomation.ROTATION_UNFREEZE)}
    }
    @Test fun offlineWorkbenchRendersLongLogsAndDisablesApprovalInBothOrientations(){
        // Explicit UI fixture only. No device provisioning, network calls or upstream approvals.
        val events=(1..6000).map{index->DeckEvent(eventId=index.toString(),seq=index.toLong(),sessionId="ui-session",turnId="ui-turn",action="turn.progress",payload=buildJsonObject{put("method","item/agentMessage/delta");put("itemId","item-$index");put("delta","UI fixture log $index")},ts="2026-10-20T05:00:00Z")}
        val state=DeckState(connection="重新连接中",host=Host("https://localhost:49321","a".repeat(64),"ui-host","ui-device","not-a-real-credential"),selectedProject="ui-project",selectedSession="ui-session",events=events,stale=true,snapshot=Snapshot(projects=listOf(Project("ui-project","UI fixture project","C:/fixture")),sessions=listOf(Session("ui-session","ui-project","ui-thread","UI fixture task","waitingApproval")),approvals=listOf(Approval("ui-approval","ui-session","ui-turn","item/commandExecution/requestApproval","pending",buildJsonObject{put("command","UI fixture only")},expiresAt="2099-01-01T00:00:00Z",allowedDecisions=listOf("approve","reject")))))
        val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
        try{for(rotation in listOf(UiAutomation.ROTATION_FREEZE_90,UiAutomation.ROTATION_FREEZE_0)){
            assertTrue(automation.setRotation(rotation));compose.waitForIdle()
            compose.waitUntil(10000){runCatching{val view=compose.activity.window.decorView;if(rotation==UiAutomation.ROTATION_FREEZE_90)view.width>view.height else view.height>view.width}.getOrDefault(false)}
            compose.runOnUiThread{val repo=(compose.activity.application as DeckApplication).repository;compose.activity.setContent{DeckTheme{DeckApp(state,repo)}}}
            if(compose.onAllNodesWithText("返回对话").fetchSemanticsNodes().isNotEmpty())compose.onNodeWithText("返回对话").performClick()
            if(compose.onAllNodesWithTag("execution-timeline").fetchSemanticsNodes().isEmpty())compose.onNodeWithText("执行时间线").performClick()
            compose.onNodeWithTag("execution-timeline").performScrollToIndex(6000)
            compose.onNodeWithText("UI fixture log 6000").assertIsDisplayed()
            compose.onNodeWithTag("execution-timeline").performScrollToIndex(1)
            compose.onNodeWithText("UI fixture log 1").assertIsDisplayed()
            compose.onNodeWithContentDescription("中断任务").assertIsNotEnabled()
            val approvalTab=compose.onAllNodesWithText("审批 (1)").fetchSemanticsNodes()
            if(approvalTab.isNotEmpty())compose.onNodeWithText("审批 (1)").performClick()
            else if(compose.onAllNodesWithText("审批").fetchSemanticsNodes().isNotEmpty())compose.onNodeWithText("审批").performClick()
            compose.onNodeWithTag("execution-timeline").performScrollToIndex(6001)
            compose.onNodeWithText("检查并允许一次").assertIsNotEnabled()
        }}finally{automation.setRotation(UiAutomation.ROTATION_UNFREEZE)}
    }
    @Test fun chatComposerKeepsSeparateDraftsAndNeverSendsOffline(){
        val selected=androidx.compose.runtime.mutableStateOf("one")
        val repo=(compose.activity.application as DeckApplication).repository
        val fixture=DeckState(host=Host("https://localhost:49321","a".repeat(64),"fixture","fixture","not-a-credential"),stale=true,snapshot=Snapshot(projects=listOf(Project("one","First project","C:/one"),Project("two","Second project","C:/two"))))
        compose.runOnUiThread{compose.activity.setContent{DeckTheme{DeckApp(fixture.copy(selectedProject=selected.value),repo)}}}
        compose.onNodeWithTag("chat-input").performTextInput("Keep my first draft")
        compose.onNodeWithContentDescription("发送消息").assertIsNotEnabled()
        compose.runOnUiThread{selected.value="two"}
        compose.onNodeWithTag("chat-input").performTextInput("Second draft")
        compose.runOnUiThread{selected.value="one"}
        compose.onNodeWithTag("chat-input").assertTextContains("Keep my first draft")
        compose.onNodeWithText("工作总览").assertDoesNotExist()
        compose.onNodeWithText("新建编程任务").assertDoesNotExist()
    }
    @Test fun realChatComposerCompletesAndRestoresDraft(){
        org.junit.Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("physicalLan")=="true")
        val repo=(compose.activity.application as DeckApplication).repository
        compose.waitUntil(60000){!repo.state.value.stale&&repo.state.value.snapshot.projects.isNotEmpty()}
        compose.runOnUiThread{repo.selectProject(repo.state.value.snapshot.projects.last().projectId)}
        compose.onNodeWithTag("chat-input").performTextInput("Do not use tools. Reply with exactly AGENTDECK_CHAT_UX_OK.")
        compose.onNodeWithContentDescription("发送消息").performClick()
        compose.waitUntil(120000){val state=repo.state.value;state.selectedSession!=null&&state.snapshot.sessions.any{it.sessionId==state.selectedSession&&it.status=="completed"}&&conversationEntries(state.events).any{it.kind=="assistant"&&it.text.contains("AGENTDECK_CHAT_UX_OK")}}
        compose.onNodeWithTag("execution-timeline").performScrollToNode(hasText("AGENTDECK_CHAT_UX_OK"))
        compose.onNodeWithText("AGENTDECK_CHAT_UX_OK").assertIsDisplayed()
        compose.onNodeWithText("item/agentMessage/delta").assertDoesNotExist()
        compose.onNodeWithTag("chat-input").performTextInput("Retained real UI draft")
        compose.activityRule.scenario.recreate()
        compose.waitUntil(20000){!repo.state.value.stale}
        compose.onNodeWithTag("chat-input").assertTextContains("Retained real UI draft")
        val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
        try{for((rotation,name) in listOf(UiAutomation.ROTATION_FREEZE_90 to "landscape",UiAutomation.ROTATION_FREEZE_0 to "portrait")){
            automation.setRotation(rotation);compose.waitForIdle()
            compose.waitUntil(10000){runCatching{val v=compose.activity.window.decorView;if(name=="landscape")v.width>v.height else v.height>v.width}.getOrDefault(false)}
            compose.onNodeWithTag("chat-input").assertTextContains("Retained real UI draft")
            compose.runOnUiThread{val view=compose.activity.window.decorView;val bitmap=Bitmap.createBitmap(view.width,view.height,Bitmap.Config.ARGB_8888);view.draw(Canvas(bitmap));FileOutputStream(File(compose.activity.getExternalFilesDir(null),"chat-real-$name.png")).use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle()}
            if(name=="portrait"){compose.onNodeWithContentDescription("打开会话列表").performClick();compose.onNodeWithText("新对话").assertIsDisplayed();androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)}
        }}finally{automation.setRotation(UiAutomation.ROTATION_UNFREEZE)}
        compose.onNodeWithTag("chat-input").performTextClearance()
        File(compose.activity.getExternalFilesDir(null),"chat-real-result.json").writeText(buildJsonObject{put("result","PASS");put("sessionId",repo.state.value.selectedSession);put("source","Physical Pad normal Compose composer through paired TLS Bridge and real Codex");put("terminal","completed");put("draftRecreation",true);put("orientationDraft",true)}.toString())
    }
    @Test fun conversationRendersMarkdownAndKeepsExecutionCollapsed(){
        val events=listOf(
            DeckEvent(eventId="1",seq=1,sessionId="s",turnId="t",action="turn.progress",payload=wire.parseToJsonElement("""{"method":"item/agentMessage/delta","itemId":"a","delta":"## Result\n**Done** with `sample.kt`\n```kotlin\nval safe = true\n```"}"""),ts="now"),
            DeckEvent(eventId="2",seq=2,sessionId="s",turnId="t",action="turn.progress",payload=wire.parseToJsonElement("""{"method":"item/completed","item":{"id":"c","type":"commandExecution","command":"git status","aggregatedOutput":"COLLAPSED_OUTPUT_FIXTURE","status":"completed"}}"""),ts="now"))
        val fixture=DeckState(host=Host("https://localhost:49321","a".repeat(64),"ui","ui","not-a-credential"),selectedProject="p",selectedSession="s",events=events,snapshot=Snapshot(projects=listOf(Project("p","Markdown fixture","C:/fixture")),sessions=listOf(Session("s","p","thread","Markdown fixture","completed"))))
        compose.runOnUiThread{val repo=(compose.activity.application as DeckApplication).repository;compose.activity.setContent{DeckTheme{DeckApp(fixture,repo)}}}
        compose.onNodeWithTag("execution-timeline").performScrollToNode(hasText("Done with sample.kt"))
        compose.onNodeWithText("Done with sample.kt").assertIsDisplayed()
        compose.onNodeWithText("val safe = true").assertExists()
        compose.onNodeWithContentDescription("复制代码").assertExists()
        compose.onNodeWithText("COLLAPSED_OUTPUT_FIXTURE",substring=true).assertDoesNotExist()
        compose.onNodeWithTag("execution-timeline").performScrollToNode(hasText("git status"))
        compose.onNodeWithText("git status").performClick()
        compose.onNodeWithText("COLLAPSED_OUTPUT_FIXTURE",substring=true).assertExists()
    }
}
