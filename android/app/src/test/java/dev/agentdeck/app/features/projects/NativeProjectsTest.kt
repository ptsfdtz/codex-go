package dev.agentdeck.app

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class NativeProjectsTest {
    @Test fun linksOnlyExactNativeIdentityWithinExplicitRootGrants(){
        val entry=page().getValue("data").jsonArray[0].jsonObject
        fun session(id:String,grant:String,native:String?,pinned:Int=0,archived:Int=0)=Session(id,grant,"thread-$id",id,"idle",pinned=pinned,archived=archived,upstream=native?.let{buildJsonObject{put("projectId",it)}})
        val linked=nativeProjectSessions(entry,listOf(
            session("same-directory-other-project","local-grant","different-native"),
            session("missing-project-metadata","local-grant",null),
            session("ungranted-root","other-grant","native-id"),
            session("archived","local-grant","native-id",archived=1),
            session("pinned","local-grant","native-id",pinned=1)
        ))
        assertEquals(listOf("pinned","archived"),linked.map{it.sessionId})
        assertEquals(1,linked.last().archived)
        assertTrue(nativeProjectSessions(JsonObject(emptyMap()),linked).isEmpty())
    }
    private fun page()=wire.parseToJsonElement("""{"contractVersion":1,"source":"upstream-native-projects","consistency":"bounded-read-view","viewId":"view-one","nextCursor":null,"data":[{"project":{"id":"native-id","name":"Original","roots":[{"path":"C:/fixture"}],"metadata":{"future":[1,true]}},"rootGrants":[{"rootIndex":0,"projectId":"local-grant"}]}]}""").jsonObject
    @Test fun preservesNativeIdentityMetadataAndSeparateGrant(){
        val source=page();val decoded=decodeNativeProjectPage(source)
        assertEquals(source.getValue("data").jsonArray[0],decoded.entries.single())
        assertEquals("native-id",decoded.entries.single().getValue("project").jsonObject.getValue("id").jsonPrimitive.content)
        assertEquals("local-grant",decoded.entries.single().getValue("rootGrants").jsonArray[0].jsonObject.getValue("projectId").jsonPrimitive.content)
        assertNull(decoded.nextCursor)
    }
    @Test fun rejectsWrongContractPartialGrantAndSourceCursor(){
        val base=page()
        val badEntry=JsonObject(base.getValue("data").jsonArray[0].jsonObject+ ("rootGrants" to JsonArray(emptyList())))
        for(bad in listOf(JsonObject(base+("contractVersion" to JsonPrimitive(2))),JsonObject(base+("nextCursor" to JsonPrimitive("raw-source"))),JsonObject(base+("data" to JsonArray(listOf(badEntry)))))){
            assertTrue(runCatching{decodeNativeProjectPage(bad)}.isFailure)
        }
        assertFalse(BridgeCapabilities(protocolVersion=1).supports("nativeProjectReadViews"))
    }
}
