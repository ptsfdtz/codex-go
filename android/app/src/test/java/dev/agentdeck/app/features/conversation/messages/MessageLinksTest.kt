package dev.agentdeck.app

import org.junit.Assert.*
import org.junit.Test

class MessageLinksTest{
    @Test fun fileLinksStayWithinTheSelectedProjectAndKeepLineRanges(){
        val root="\\\\?\\C:\\work\\Project"
        assertEquals(ProjectLink("src/a.kt",12,20),projectMessageLink("C:/WORK/Project/src/a.kt#L12-L20",root))
        assertEquals(ProjectLink("src/a b.kt",4),projectMessageLink("file:///C:/work/Project/src/a%20b.kt#L4",root))
        assertEquals(ProjectLink("src/a+b.kt",4),projectMessageLink("src/a+b.kt:4:2",root))
        assertEquals(ProjectLink("README.md",4),projectMessageLink("README.md:4:2",root))
        assertNull(projectMessageLink("C:/work/Project-other/a.kt",root))
        assertNull(projectMessageLink("src/%2e%2e/secret",root))
        assertNull(projectMessageLink("file://remote/C:/work/Project/a.kt",root))
        assertNull(projectMessageLink("https://example.com/a.kt",root))
        assertNull(projectMessageLink("javascript:alert(1)",root))
        assertNull(projectMessageLink("src/a.kt#L10-L2",root))
        assertNull(projectMessageLink("src/a.kt#L9999999999999999999999999",root))
        assertNull(projectMessageLink("src/a.kt%00",root))
    }
}
