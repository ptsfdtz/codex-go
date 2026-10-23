package dev.agentdeck.app

import org.junit.Assert.*
import org.junit.Test
import org.commonmark.parser.Parser
import org.commonmark.node.*

class CodeBlocksTest{
    @Test fun fencesPreserveCodeAndDocumentLinksWithoutFlatteningNestedContent(){
        fun blocks(text:String)=messageBlocks(Parser.builder().build().parse(text))
        val parts=blocks("[Before][target]\n\n````kotlin\n  val x = 1\n```\n````\n\nAfter\n\n[target]: https://example.com")
        assertEquals(listOf(null,"kotlin",null),parts.map{it.language})
        assertEquals("  val x = 1\n```\n",parts[1].text)
        val link=parts.first().node!!.firstChild.firstChild as Link
        assertEquals("https://example.com",link.destination)
        assertTrue(parts.last().node!!.firstChild is Paragraph)
        val unfinished=blocks("~~~sh\r\nprintf 'hello'\r\n").single()
        assertEquals("sh",unfinished.language)
        assertEquals("printf 'hello'\n",unfinished.text)
        val nested=blocks("- List\n\n    ```kt\n    text\n    ```\n\n> ```\n> quote\n> ```").single()
        assertNull(nested.language)
        assertTrue(nested.node!!.firstChild is BulletList)
        assertTrue(nested.node.lastChild is BlockQuote)
    }
}
