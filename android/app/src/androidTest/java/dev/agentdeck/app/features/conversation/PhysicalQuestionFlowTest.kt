package dev.agentdeck.app

import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** No Espresso idling dependency: exercises the real app, model and accessibility controls. */
@RunWith(AndroidJUnit4::class)
class PhysicalQuestionFlowTest {
    @Test fun nativeReply()=runBlocking{runFlow(false)}
    @Test fun asyncReply()=runBlocking{runFlow(true)}

    private suspend fun runFlow(async:Boolean){
        assumeTrue(InstrumentationRegistry.getArguments().getString("physicalQuestions")=="true")
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val context=instrumentation.targetContext
        val repo=(context.applicationContext as DeckApplication).repository
        fun stage(value:String){File(context.getExternalFilesDir(null),"question-flow-stage.txt").writeText(value)}
        stage("starting")
        try{withTimeout(60000){repo.state.first{!it.stale&&it.snapshot.projects.any{p->p.enabled}}}}
        catch(e:Exception){stage("connection: "+repo.state.value.connection+"; error="+repo.state.value.error+"; computers="+repo.state.value.computerConnections.values);throw e}
        var before=repo.state.value;val host=requireNotNull(before.host)
        // Use the app's authenticated connection, including its selected cloud route.
        val connections=DeckRepository::class.java.getDeclaredField("connections").apply{isAccessible=true}.get(repo) as ComputerConnections
        val connection=requireNotNull(connections.get(host.hostId)?.transport)
        val fresh=requireNotNull(connections.get(host.hostId)).refreshSnapshot(connection)
        before=repo.state.value.copy(snapshot=fresh)
        File(context.getExternalFilesDir(null),"question-source-sessions.txt").writeText(fresh.sessions.joinToString("\n"){"${it.title}\t${it.upstreamThreadId}\t${it.status}\tarchived=${it.archived}"})
        var testId:String?=null
        var restoreArchive:String?=null
        try{
            InstrumentationRegistry.getArguments().getString("questionTheme")?.let{theme->withContext(Dispatchers.Main){repo.setTheme(theme)}}
            val session:Session
            var entry:ChatEntry?=null
            if(async){
                val sourceThread=InstrumentationRegistry.getArguments().getString("sourceThreadId")
                val source=if(sourceThread!=null)requireNotNull(before.snapshot.sessions.singleOrNull{it.upstreamThreadId==sourceThread}){"Source missing: "+before.snapshot.sessions.joinToString{it.title+":"+it.upstreamThreadId}}.sessionId else requireNotNull(before.selectedSession)
                stage("reading source "+source)
                var cursor:String?=null
                var sourceEntry:ChatEntry?=null
                var pages=0
                do{
                    val page=repo.readUpstreamHistory(source,cursor,"desc")
                    sourceEntry=page.entries.map{persistedChatEntry(source,it)}.firstOrNull{messageQuestions(it).isNotEmpty()}
                    cursor=page.nextCursor;pages++;stage("finding async question: page $pages")
                }while(sourceEntry==null&&cursor!=null&&pages<120)
                requireNotNull(sourceEntry){"Open a real conversation with an async question first"}
                stage("forking source question "+sourceEntry.sourceItem)
                if(InstrumentationRegistry.getArguments().getString("answerInPlace")=="true"){
                    val original=before.snapshot.sessions.single{it.sessionId==source}
                    session=if(original.archived==1){
                        require(InstrumentationRegistry.getArguments().getString("restoreForTest")=="true"){"Source is archived; use an editable source"}
                        restoreArchive=source
                        wire.decodeFromJsonElement(Session.serializer(),connection.request("sessions.restore",payload("sessionId" to source)).getValue("session"))
                    }else original
                }else{
                    session=wire.decodeFromJsonElement(Session.serializer(),connection.request("sessions.fork",payload("sessionId" to source,"lastTurnId" to requireNotNull(sourceEntry.sourceTurn))).getValue("session"))
                    connection.request("sessions.rename",payload("sessionId" to session.sessionId,"title" to "异步追问实机验收"))
                }
            }else{
                val existing=InstrumentationRegistry.getArguments().getString("questionSession")
                session=if(existing!=null)before.snapshot.sessions.single{it.sessionId==existing}else wire.decodeFromJsonElement(Session.serializer(),connection.request("sessions.create",payload("projectId" to before.snapshot.projects.first{it.enabled}.projectId,"title" to "追问交互实机验收")).getValue("session"))
                if(existing==null)connection.request("turn.start",payload("sessionId" to session.sessionId,"mode" to "plan","permissionMode" to "workspace","text" to "这是用户授权的真实界面验收。禁止读取或修改文件、运行命令、访问网络。请立即在同一次 request_user_input 工具调用的 questions 数组中放入恰好两个简短选择题，分别询问简洁或详细、中文或英文，每题两个选项。务必一次调用包含两题，不要分次提问。回答后只回复 QUESTION_REPLY_OK 及选择摘要，不要再次提问。"))
            }
            testId=session.sessionId;stage("created "+session.sessionId)
            requireNotNull(connections.get(host.hostId)).refreshSnapshot(connection)
            withTimeout(30000){repo.state.first{it.snapshot.sessions.any{s->s.sessionId==session.sessionId}&&!it.busy}}
            withContext(Dispatchers.Main){repo.selectSession(session.sessionId)}
            val key:QuestionKey
            if(async){
                val loaded=withTimeout(60000){repo.state.first{it.selectedSession==session.sessionId&&it.timelineHistory.loaded}}
                entry=conversationTimeline(session.sessionId,loaded.events,loaded.timelineHistory.entries,loaded.snapshot.turns).last{messageQuestions(it).isNotEmpty()}
                key=QuestionKey(host.hostId,session.sessionId,entry.id)
            }else{
                val loaded=withTimeout(180000){repo.state.first{it.snapshot.approvals.any{a->a.sessionId==session.sessionId&&a.method=="item/tool/requestUserInput"}}}
                val approval=loaded.snapshot.approvals.first{it.sessionId==session.sessionId&&it.method=="item/tool/requestUserInput"}
                key=QuestionKey(host.hostId,session.sessionId,approval.approvalId)
            }
            val draftKey=ComposerKey(host.hostId,session.sessionId)
            withContext(Dispatchers.Main){repo.composerDrafts.edit(draftKey){it.copy(text="主输入框草稿保持不变")}}
            stage("ready "+key.requestId)
            suspend fun node(text:String):AccessibilityNodeInfo{
                return withTimeout(60000){
                    var result:AccessibilityNodeInfo?=null
                    while(result==null){
                        fun find(n:AccessibilityNodeInfo?):AccessibilityNodeInfo?{
                            if(n==null)return null
                            if(n.text?.toString()?.lineSequence()?.any{it==text}==true||n.contentDescription?.toString()==text)return n
                            for(i in 0 until n.childCount)find(n.getChild(i))?.let{return it}
                            return null
                        }
                        result=find(instrumentation.uiAutomation.rootInActiveWindow)
                        if(result==null){
                            run{
                                val root=instrumentation.uiAutomation.rootInActiveWindow
                                val screen=android.graphics.Rect();root?.getBoundsInScreen(screen)
                                fun scroll(n:AccessibilityNodeInfo?):Boolean{
                                    if(n==null)return false
                                    val bounds=android.graphics.Rect();n.getBoundsInScreen(bounds)
                                    val direction=if(text=="提交回答"||text=="下一题")AccessibilityNodeInfo.ACTION_SCROLL_FORWARD else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
                                    if(n.isScrollable&&bounds.left>screen.width()/5&&bounds.height()>200&&n.performAction(direction))return true
                                    for(i in 0 until n.childCount)if(scroll(n.getChild(i)))return true
                                    return false
                                }
                                scroll(root)
                            }
                            delay(300)
                        }
                    };result
                }
            }
            suspend fun click(text:String){stage("clicking $text");var n:AccessibilityNodeInfo?=node(text);while(n!=null&&!n.isClickable)n=n.parent;check(n?.performAction(AccessibilityNodeInfo.ACTION_CLICK)==true){"Cannot click $text"};delay(500)}
            if(async){
                // Bring the actual historical question into view through the production viewport.
                val questions=messageQuestions(requireNotNull(entry))
                val answer="这是界面验收回答，不表示公网配对已完成。不要使用工具或执行操作，只回复 ASYNC_REPLY_OK，然后结束这个分支。"
                var field:AccessibilityNodeInfo?=node(if(questions.first().options.isEmpty())"你的回答" else "其他回答")
                fun editable(n:AccessibilityNodeInfo?):AccessibilityNodeInfo?{
                    if(n==null)return null
                    if(n.actionList.any{it.id==AccessibilityNodeInfo.ACTION_SET_TEXT})return n
                    for(i in 0 until n.childCount)editable(n.getChild(i))?.let{return it}
                    return null
                }
                while(field!=null&&editable(field)==null)field=field.parent
                field=editable(field)
                screenshot("question-async-edit.png")
                check(field?.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,Bundle().apply{putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,answer)})==true){"Cannot edit question answer"}
                withTimeout(5000){repo.questionReplies.state.first{it[key]?.answers?.values?.contains(answer)==true}}
                delay(300)
            }else{
                val approval=repo.state.value.snapshot.approvals.first{it.approvalId==key.requestId}
                val questions=approvalQuestions(approval)
                assertEquals("Verify real two-page navigation",2,questions.size)
                questions.forEachIndexed{index,q->click(q.options.first().label);if(index<questions.lastIndex)click("下一题")}
            }
            screenshot(if(async)"question-async-before.png" else "question-native-before.png")
            click("提交回答")
            assertFalse(repo.state.value.busy)
            assertEquals("主输入框草稿保持不变",repo.composerDrafts[draftKey].text)
            before.selectedSession?.let{withContext(Dispatchers.Main){repo.selectSession(it)}}
            withTimeout(60000){repo.questionReplies.state.first{it[key]?.phase!=ReplyPhase.Sending}}
            assertEquals(ReplyPhase.Sent,repo.questionReplies.state.value[key]?.phase)
            withContext(Dispatchers.Main){repo.selectSession(session.sessionId)}
            val marker=if(async)"ASYNC_REPLY_OK" else "QUESTION_REPLY_OK"
            withTimeout(180000){repo.state.first{s->conversationTimeline(session.sessionId,s.events,s.timelineHistory.entries,s.snapshot.turns).any{it.kind=="assistant"&&it.text.contains(marker)}}}
            assertNull(repo.state.value.error)
            assertEquals("主输入框草稿保持不变",repo.composerDrafts[draftKey].text)
            screenshot(if(async)"question-async-after.png" else "question-native-after.png")
            stage("PASS "+session.sessionId)
        }catch(e:Exception){stage("FAILED session=$testId: ${e.javaClass.simpleName}: ${e.message}");throw e}
        finally{
            restoreArchive?.let{connection.request("sessions.archive",payload("sessionId" to it))}
            withContext(Dispatchers.Main){repo.setTheme(before.preferences.theme)}
            before.selectedSession?.let{withContext(Dispatchers.Main){repo.selectSession(it)}}
        }
    }
    private fun screenshot(name:String){val i=InstrumentationRegistry.getInstrumentation();val b=i.uiAutomation.takeScreenshot();File(i.targetContext.getExternalFilesDir(null),name).outputStream().use{b.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)};b.recycle()}
}
