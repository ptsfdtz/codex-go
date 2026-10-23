package dev.agentdeck.app

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Explicitly enabled, read-only pagination against the user's connected session. */
@RunWith(AndroidJUnit4::class)
class PhysicalTimelineTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()

    @Test fun olderPagesRetainVisibleMessagesAndTheirOrder(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("physicalTimeline")=="true")
        val repo=(compose.activity.application as DeckApplication).repository
        compose.waitUntil(60000){val s=repo.state.value;!s.stale&&s.selectedSession!=null&&s.timelineHistory.loaded&&!s.timelineHistory.loading}
        val session=requireNotNull(repo.state.value.selectedSession)
        fun rows():List<ChatEntry>{val s=repo.state.value;assertEquals(session,s.selectedSession);return conversationTimeline(session,s.events,s.timelineHistory.entries,s.snapshot.turns)}
        var pages=0
        repeat(12){
            val before=rows().filter{it.kind in listOf("user","assistant")&&it.sourceItem!=null&&it.status in listOf("completed","saved")}
            assertTrue("No real conversation messages available",before.isNotEmpty())
            val old=repo.state.value.timelineHistory
            if(old.nextCursor==null)return@repeat
            compose.runOnUiThread{repo.olderHistory()}
            compose.waitUntil(60000){val h=repo.state.value.timelineHistory;!h.loading&&(h.nextCursor!=old.nextCursor||h.error!=null)}
            assertNull(repo.state.value.timelineHistory.error)
            val after=rows()
            val positions=before.map{row->
                val index=after.indexOfFirst{it.id==row.id}
                assertTrue("Pagination removed ${row.id}",index>=0)
                assertEquals("Pagination changed ${row.id}",row.text,after[index].text)
                index
            }
            assertEquals("Pagination reordered existing messages: before="+before.joinToString { it.id+"="+it.text.take(90) }+"; after="+after.filter{it.kind in listOf("user","assistant")}.joinToString { it.id+"="+it.text.take(90) },positions.sorted(),positions)
            pages++
        }
        assertTrue("Session has no older pages to verify",pages>0)
    }
}
