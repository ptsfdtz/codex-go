package dev.agentdeck.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assume.assumeTrue
import org.junit.Assert.*
import org.junit.runner.RunWith
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import java.io.File

@RunWith(AndroidJUnit4::class)
class PhysicalLanTest {
    @Test fun pinnedLanPairingAndRealTasks()=runBlocking {
        assumeTrue("Explicit physical LAN harness only",InstrumentationRegistry.getArguments().getString("physicalLan")=="true")
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val context=instrumentation.targetContext
        val qr=instrumentation.uiAutomation.executeShellCommand("cat /sdcard/Download/agentdeck-test-qr.json").use{descriptor->java.io.FileInputStream(descriptor.fileDescriptor).bufferedReader().use{it.readText()}}
        val repository=(context.applicationContext as DeckApplication).repository
        repository.beginPair(qr)
        val paired=withTimeout(150000){repository.state.first{it.error!=null||it.host!=null&&!it.stale}}
        check(paired.error==null){"Physical pairing failed: ${paired.error}"}
        assertEquals("已连接",paired.connection);assertEquals(2,paired.snapshot.projects.size)
        val host=requireNotNull(paired.host);val transport=DeckTransport(host)
        val events=mutableListOf<DeckEvent>()
        transport.connect();transport.request("system.hello",payload("client" to "physical-instrumentation").let{JsonObject(it+mapOf("version" to JsonPrimitive(1)))})
        val collector=launch{for(packet in transport.events)events.add(wire.decodeFromJsonElement(DeckEvent.serializer(),packet))}
        try{
            val sessions=paired.snapshot.projects.mapIndexed{index,project->
                val created=transport.request("sessions.create",payload("projectId" to project.projectId,"title" to "Physical Pad task $index"));wire.decodeFromJsonElement(Session.serializer(),created.getValue("session"))
            }
            val turns=sessions.mapIndexed{index,session->
                val response=transport.request("turn.start",payload("sessionId" to session.sessionId,"text" to "Reply exactly AGENTDECK_PHYSICAL_${index}_OK. Do not run commands or read files."));wire.decodeFromJsonElement(Turn.serializer(),response.getValue("turn"))
            }
            withTimeout(120000){while(turns.any{t->events.none{e->e.turnId==t.turnId&&e.action=="turn.completed"}})delay(100)}
            assertTrue(events.any{it.action=="turn.progress"})
            for(session in sessions)assertTrue(events.filter{it.sessionId==session.sessionId}.all{e->turns.any{it.sessionId==session.sessionId&&it.turnId==e.turnId}||e.turnId==null})
            val git=transport.request("git.status",payload("projectId" to paired.snapshot.projects.first().projectId));val file=git.getValue("files").jsonArray.first().jsonObject
            val diff=transport.request("git.diff",payload("projectId" to paired.snapshot.projects.first().projectId,"fileId" to file.getValue("fileId").jsonPrimitive.content));assertTrue(diff.getValue("text").jsonPrimitive.content.contains("predates the Codex task"))
            repository.refresh()
            File(context.getExternalFilesDir(null),"physical-lan-result.json").writeText(buildJsonObject{put("result","PASS");put("transport","physical Xiaomi Wi-Fi pinned TLS/WSS");put("humanWindowsPairing",true);put("completedRealTurns",2);put("eventCount",events.size);put("gitDiff",true)}.toString())
        }finally{collector.cancel();transport.close()}
    }
}
