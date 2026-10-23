package dev.agentdeck.app

import org.junit.Assert.*
import org.junit.Test
import kotlinx.serialization.json.*

class TurnChangesTest {
    private fun change(id:String,path:String,status:String="completed")=nativeItemEntry(id,buildJsonObject{
        put("id",id);put("type","fileChange");put("status",status)
        put("changes",buildJsonArray{add(buildJsonObject{put("path",path);put("diff","--- a/$path\n+++ b/$path\n@@ -1 +1,2 @@\n-old\n+new\n+extra\n")})})
    })
    @Test fun countsUniqueFilesAndHunkLinesWithoutCountingHeadersOrFailedSteps(){
        val a=change("a","file.kt")
        val result=turnChanges(listOf(a,a,change("b","file.kt"),change("c","other.kt"),change("d","failed.kt","failed")))!!
        assertEquals(2,result.files)
        assertEquals(6,result.added)
        assertEquals(3,result.removed)
        assertEquals(3,result.records.size)
        assertNull(turnChanges(listOf(change("x","failed.kt","failed"))))
    }
}
