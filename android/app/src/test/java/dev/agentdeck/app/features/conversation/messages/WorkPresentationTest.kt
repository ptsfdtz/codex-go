package dev.agentdeck.app

import org.junit.Assert.*
import org.junit.Test
import kotlinx.serialization.json.jsonObject

class WorkPresentationTest {
    @Test fun planResultsStayOutsideCollapsedExecution(){
        val plan=nativeItemEntry("plan",wire.parseToJsonElement("""{"id":"p","type":"plan","text":"1. Inspect\n2. Implement"}""").jsonObject)
        assertEquals("plan",plan.kind)
        assertFalse(isWorkEntry(plan))
        assertTrue(plan.text.contains("Implement"))
        assertTrue(isWorkEntry(ChatEntry("tool","tool","command output")))
        assertTrue(isWorkEntry(ChatEntry("commentary","assistant","Reading",detail="""{"phase":"commentary"}""")))
        assertFalse(isWorkEntry(ChatEntry("final","assistant","Result",detail="""{"phase":"final_answer"}""")))
    }
}
