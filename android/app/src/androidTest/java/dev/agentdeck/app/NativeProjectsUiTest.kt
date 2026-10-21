package dev.agentdeck.app

import androidx.activity.compose.setContent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Controlled reads only; never contacts or pairs a computer. */
@RunWith(AndroidJUnit4::class)
class NativeProjectsUiTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    @Test fun refreshFailureRetainsProjectAndOffersExplicitRetry(){
        var calls=0
        val read:suspend(String?)->NativeProjectPage={NativeProjectPage("view",listOf(entry("one","Project stays visible")),null)}
        val refresh:suspend()->Unit={calls++;if(calls==1)throw DeckException("CONFLICT","同步忙碌，请重试")}
        compose.runOnUiThread{compose.activity.setContent{DeckTheme{NativeProjectsViewer("fixture",read,{},refreshSessions=refresh)}}}
        compose.onNodeWithText("同步会话").performClick()
        compose.onNodeWithText("同步忙碌，请重试").assertIsDisplayed()
        compose.onNodeWithText("Project stays visible").assertIsDisplayed()
        compose.onNodeWithText("同步会话").performClick()
        compose.onNodeWithText("同步忙碌，请重试").assertDoesNotExist()
        compose.runOnIdle{assertEquals(2,calls)}
    }
    private fun entry(id:String,name:String)=buildJsonObject{
        put("project",buildJsonObject{put("id",id);put("name",name);put("roots",buildJsonArray{add(buildJsonObject{put("path","C:/fixture/$id")})});put("metadata",buildJsonObject{put("marker","complete-metadata")})})
        put("rootGrants",buildJsonArray{add(buildJsonObject{put("rootIndex",0);put("projectId","grant-$id")})})
    }
    @Test fun opensOnlyAssociatedSessionsAndDisablesOfflineNavigation(){
        val target=entry("one","Native project")
        val sessions=listOf(
            Session("matched","grant-one","native-thread","Linked task","idle",upstream=buildJsonObject{put("projectId","one")}),
            Session("different","grant-one","other-thread","Wrong project task","idle",upstream=buildJsonObject{put("projectId","different")})
        )
        var opened:String?=null
        val read:suspend(String?)->NativeProjectPage={NativeProjectPage("view",listOf(target),null)}
        compose.runOnUiThread{compose.activity.setContent{DeckTheme{NativeProjectsViewer("fixture",read,{},sessions=sessions,onOpenSession={_,id->opened=id})}}}
        compose.onNodeWithText("Wrong project task",substring=true).assertDoesNotExist()
        compose.onNodeWithText("Linked task",substring=true).performClick()
        compose.runOnIdle{assertEquals("matched",opened)}
        compose.runOnUiThread{compose.activity.setContent{DeckTheme{NativeProjectsViewer("fixture",read,{},sessions=sessions,navigationEnabled=false)}}}
        compose.onNodeWithText("Linked task",substring=true).assertIsNotEnabled()
    }
    @Test fun expiredContinuationClearsOldContentAndRefreshStartsWithoutCursor(){
        val calls=mutableListOf<String?>()
        var initialReads=0
        val read:suspend(String?)->NativeProjectPage={cursor->
            calls.add(cursor)
            if(cursor!=null)throw DeckException("INVALID_CURSOR","分页已过期，请刷新")
            initialReads++
            NativeProjectPage("view-$initialReads",listOf(entry("one",if(initialReads==1)"Original project" else "Refreshed project")),if(initialReads==1)"a".repeat(43) else null)
        }
        compose.runOnUiThread{compose.activity.setContent{DeckTheme{NativeProjectsViewer("fixture-host",read,{})}}}
        compose.onNodeWithText("Original project").assertIsDisplayed()
        compose.onNodeWithText("查看完整详情").performClick()
        compose.onNodeWithText("complete-metadata",substring=true).assertExists()
        compose.onNodeWithText("下一页").performClick()
        compose.onNodeWithText("Original project").assertDoesNotExist()
        compose.onNodeWithText("分页已过期，请刷新").assertIsDisplayed()
        compose.onNodeWithText("刷新",useUnmergedTree=true).performClick()
        compose.onNodeWithText("Refreshed project").assertIsDisplayed()
        compose.onNodeWithText("下一页").assertDoesNotExist()
        compose.runOnIdle{assertEquals(listOf(null,"a".repeat(43),null),calls)}
    }
    @Test fun changedViewIdentityCannotDisplayTheNextPage(){
        val read:suspend(String?)->NativeProjectPage={cursor->
            if(cursor==null)NativeProjectPage("original",listOf(entry("one","Original project")),"a".repeat(43))
            else NativeProjectPage("different",listOf(entry("two","Wrong view project")),null)
        }
        compose.runOnUiThread{compose.activity.setContent{DeckTheme{NativeProjectsViewer("fixture-host",read,{})}}}
        compose.onNodeWithText("下一页").performClick()
        compose.onNodeWithText("Wrong view project").assertDoesNotExist()
        compose.onNodeWithText("Original project").assertDoesNotExist()
        compose.onNodeWithText("项目分页已变化，请刷新").assertIsDisplayed()
    }
}
