package dev.agentdeck.app

import android.content.Intent
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlin.random.Random
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.collect
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Opt-in production cloud + real model + tablet composer. Two real turns;
 * never creates an auxiliary LAN transport or alters project files. */
@RunWith(AndroidJUnit4::class)
class PhysicalCloudConversationTest {
    @Test fun realTwoTurnConversationAndCloudRecovery()=runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("physicalCloudConversation")=="true")
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val context=instrumentation.targetContext
        val repo=(context.applicationContext as DeckApplication).repository
        instrumentation.runOnMainSync{context.startActivity(Intent(context,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))}
        val hostId="host_0ae4c00c-32b3-49be-bd79-0f5b1a0feb49"
        fun cloudReady(s:DeckState)=s.host?.hostId==hostId&&s.host.routePolicy=="cloud"&&
            s.cloud.origin=="https://agent.ptsfdtz.top"&&!s.stale&&
            s.computerConnections[hostId]?.route=="云端"
        val before=withTimeout(90000){repo.state.first{cloudReady(it)&&!it.busy&&it.snapshot.projects.any{p->p.enabled}}}
        val project=before.snapshot.projects.first{it.enabled}
        val draftKey=ComposerKey(hostId,"new:${project.projectId}")
        val original=repo.composerDrafts[draftKey]
        var disconnected=0
        var wasConnected=true
        var deliberateReconnect=false
        var testSession:String?=null
        val streamedEvents=mutableSetOf<String>()
        val monitor=launch {
            repo.state.collect{s->
                val connected=cloudReady(s)
                if(wasConnected&&!connected&&!deliberateReconnect)disconnected++
                wasConnected=connected
                s.events.filter{it.sessionId==testSession&&(it.payload as? JsonObject)?.get("method")?.jsonPrimitive?.contentOrNull=="item/agentMessage/delta"}.forEach{streamedEvents.add(it.eventId)}
            }
        }
        val output=File(context.getExternalFilesDir(null),"cloud-conversation-result.json")
        val recoveryOnly=InstrumentationRegistry.getArguments().getString("cloudRecoveryOnly")=="true"
        val report=if(recoveryOnly)wire.parseToJsonElement(output.readText()).jsonObject.toMutableMap()
            else buildJsonObject{put("result","RUNNING");put("route","云端")}.toMutableMap()
        fun save(){output.writeText(JsonObject(report).toString())}
        fun stage(name:String){println("CLOUD_CONVERSATION_STAGE: $name");report["stage"]=JsonPrimitive(name);save()}
        fun entries(s:DeckState,id:String)=conversationTimeline(id,s.events,s.timelineHistory.entries,s.snapshot.turns)
        suspend fun completed(id:String,marker:String):String {
            val state=withTimeout(240000){repo.state.first{s->
                s.error!=null||s.snapshot.turns.any{it.sessionId==id&&it.status=="failed"}||
                    (s.snapshot.sessions.any{it.sessionId==id&&it.status=="completed"}&&
                        entries(s,id).any{it.kind=="assistant"&&it.text.contains(marker)})
            }}
            check(state.error==null){state.error?:"Client error"}
            check(state.snapshot.turns.none{it.sessionId==id&&it.status=="failed"}){
                state.snapshot.turns.firstOrNull{it.sessionId==id&&it.status=="failed"}?.error?:"Model turn failed"
            }
            check(cloudReady(state)){"Conversation left cloud route"}
            return entries(state,id).last{it.kind=="assistant"&&it.text.contains(marker)}.text
        }
        suspend fun node(predicate:(AccessibilityNodeInfo)->Boolean):AccessibilityNodeInfo=withTimeout(20000){
            fun find(n:AccessibilityNodeInfo?):AccessibilityNodeInfo?{
                if(n==null)return null
                if(predicate(n))return n
                for(i in 0 until n.childCount)find(n.getChild(i))?.let{return it}
                return null
            }
            var result:AccessibilityNodeInfo?=null
            while(result==null){result=find(instrumentation.uiAutomation.rootInActiveWindow);if(result==null)delay(200)}
            requireNotNull(result)
        }
        suspend fun send(text:String){
            stage("findingTabletComposer")
            val input=node{it.className?.toString()=="android.widget.EditText"&&it.isEnabled}
            check(input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,Bundle().apply{putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,text)})){"Tablet composer rejected text"}
            stage("findingTabletSendButton")
            val send=node{it.contentDescription?.toString()=="发送消息"&&it.isEnabled}
            var clickable:AccessibilityNodeInfo?=send
            while(clickable!=null&&!clickable.isClickable)clickable=clickable.parent
            check(clickable?.performAction(AccessibilityNodeInfo.ACTION_CLICK)==true){"Tablet send button was unavailable"}
        }
        try {
            val id:String
            val firstMarker:String
            val secondMarker:String
            if(recoveryOnly){
                check(report["firstTurnCompleted"]?.jsonPrimitive?.boolean==true&&report["secondTurnCompleted"]?.jsonPrimitive?.boolean==true)
                id=report.getValue("sessionId").jsonPrimitive.content
                firstMarker=report.getValue("firstReply").jsonPrimitive.content.lineSequence().last{it.startsWith("CLOUD_REAL_")}
                secondMarker=report.getValue("secondReply").jsonPrimitive.content.lineSequence().last{it.startsWith("CLOUD_REAL_")}
                instrumentation.runOnMainSync{repo.selectSession(id)}
            }else{
            instrumentation.runOnMainSync{
                repo.selectProject(project.projectId)
                repo.composerDrafts.edit(draftKey){it.copy(text="",mode="default",attachments=emptyList(),skills=emptyList())}
            }
            val a=Random.nextInt(1000,9000);val b=Random.nextInt(1000,9000)
            val marker="CLOUD_REAL_${System.currentTimeMillis()}"
            firstMarker="$marker:${a+b}"
            secondMarker="${marker}_FOLLOWUP:${a+b+1}"
            stage("sendingFirstViaTabletUI")
            send("云端真实对话验收。请不要使用任何工具、读取文件或修改项目。先计算 $a + $b 并记住结果；然后用中文六段、每段约80字解释远程对话中断线恢复的含义。最后一行严格输出 $marker: 后紧跟计算结果。")
            val started=withTimeout(90000){repo.state.first{it.error!=null||(!it.busy&&it.selectedSession!=null&&it.selectedSession!=before.selectedSession)}}
            check(started.error==null){started.error?:"First send failed"}
            id=requireNotNull(started.selectedSession)
            testSession=id
            report["sessionId"]=JsonPrimitive(id);stage("waitingFirstModelReply")
            val first=completed(id,firstMarker)
            report["firstReply"]=JsonPrimitive(first)
            report["firstTurnCompleted"]=JsonPrimitive(true)
            stage("sendingFollowupViaTabletUI")
            send("继续刚才的对话，不使用工具。把你上一轮记住的计算结果加1，最后一行输出 ${marker}_FOLLOWUP: 后紧跟新结果；前面用三句话说明为什么重连时不能自动重复发送消息。")
            val second=completed(id,secondMarker)
            report["secondReply"]=JsonPrimitive(second)
            report["secondTurnCompleted"]=JsonPrimitive(true)
            }
            stage("reconnectingAndReloadingHistory")
            deliberateReconnect=true
            repo.reconnect()
            withTimeout(30000){repo.state.first{it.stale}}
            withTimeout(90000){repo.state.first{cloudReady(it)}}
            instrumentation.runOnMainSync{repo.selectSession(id)}
            val restored=withTimeout(90000){repo.state.first{s->s.timelineHistory.loaded&&
                entries(s,id).any{it.kind=="assistant"&&it.text.contains(firstMarker)}&&
                entries(s,id).any{it.kind=="assistant"&&it.text.contains(secondMarker)}}}
            assertTrue(cloudReady(restored))
            val answers=entries(restored,id).filter{it.kind=="assistant"&&(it.text.contains(firstMarker)||it.text.contains(secondMarker))}
            assertEquals(2,answers.mapNotNull{it.sourceTurn}.distinct().size)
            val session=restored.snapshot.sessions.single{it.sessionId==id}
            assertEquals("completed",repo.readLatestSessionTurn(session).status)
            delay(1000)
            assertNull("Recovered cloud reads must not leave a stale network error",repo.state.value.error)
            deliberateReconnect=false
            val monitorSeconds=InstrumentationRegistry.getArguments().getString("cloudMonitorSeconds")?.toIntOrNull()?.coerceIn(0,900)?:0
            stage("monitoringRecoveredConversation")
            repeat(monitorSeconds){
                delay(1000)
                if(it%15==0&&cloudReady(repo.state.value))repo.readLatestSessionTurn(session)
            }
            report["monitorSeconds"]=JsonPrimitive(monitorSeconds)
            report[if(recoveryOnly)"recoveryUnexpectedDisconnects" else "unexpectedDisconnects"]=JsonPrimitive(disconnected)
            assertEquals("Unexpected cloud disconnections",0,disconnected)
            val bitmap=instrumentation.uiAutomation.takeScreenshot()
            File(context.getExternalFilesDir(null),"cloud-conversation.png").outputStream().use{bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
            bitmap.recycle()
            report[if(recoveryOnly)"recoveryUnexpectedDisconnects" else "unexpectedDisconnects"]=JsonPrimitive(disconnected)
            if(!recoveryOnly)report["streamedDeltaEvents"]=JsonPrimitive(streamedEvents.size)
            report["historyRecovered"]=JsonPrimitive(true)
            report.remove("error")
            report["result"]=JsonPrimitive("PASS")
            stage("complete")
        }catch(e:Throwable){
            if(!recoveryOnly){report["unexpectedDisconnects"]=JsonPrimitive(disconnected);report["streamedDeltaEvents"]=JsonPrimitive(streamedEvents.size)}
            val screenshot=instrumentation.uiAutomation.takeScreenshot()
            File(context.getExternalFilesDir(null),"cloud-conversation-failure.png").outputStream().use{screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
            screenshot.recycle()
            report["result"]=JsonPrimitive("FAIL");report["error"]=JsonPrimitive(e.message?:e.javaClass.simpleName);save();throw e
        }finally{
            monitor.cancel()
            instrumentation.runOnMainSync{repo.composerDrafts.edit(draftKey){original}}
        }
    }
}
