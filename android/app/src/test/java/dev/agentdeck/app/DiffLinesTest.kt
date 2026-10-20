package dev.agentdeck.app

import org.junit.Test
import org.junit.Assert.*

class DiffLinesTest{
    @Test fun localMaskTreatsMetacharactersAsLiteralAndLeavesOriginalDataUntouched(){
        val original="x.* is text; x123 must remain; x.*"
        assertEquals("[本地遮盖] is text; x123 must remain; [本地遮盖]",maskDisplay(original,"x.*"))
        assertEquals("x.* is text; x123 must remain; x.*",original)
        assertEquals(original,maskDisplay(original,""))
        assertEquals(original,maskDisplay(original,".*"))
        assertEquals(original,maskDisplay(original,"x".repeat(257)))
    }
    @Test fun numbersBothSidesAcrossHunksAndConcatenatedDiffs(){
        val rows=diffLines("diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -10,3 +20,3 @@ scope\n same\n-removed\n+added\n tail\n@@ -50 +60 @@\n-old\n+new\n\\ No newline at end of file\ndiff --git a/f b/f\n@@ -1,0 +1 @@\n+another\n")
        assertEquals(listOf(10 to 20,11 to null,null to 21,12 to 22,50 to null,null to 60,null to 1),rows.filter{it.kind!=DiffLineKind.META}.map{it.oldLine to it.newLine})
        assertTrue(rows.take(4).all{it.oldLine==null&&it.newLine==null})
    }
    @Test fun doesNotTreatHeaderLikeSourceAsMetadataInsideHunk(){
        val rows=diffLines("@@ -1 +1 @@\n---literal old\n+++literal new\n")
        assertEquals(DiffLine(1,null,"---literal old",DiffLineKind.REMOVED),rows[1])
        assertEquals(DiffLine(null,1,"+++literal new",DiffLineKind.ADDED),rows[2])
    }
    @Test fun malformedAndOverflowingHunksNeverInventSourceNumbers(){
        for(header in listOf("@@ malformed @@","@@ -2147483647,2 +1 @@","@@ -99999999999999 +1 @@")){
            assertTrue(diffLines("$header\n-old\n+new").all{it.oldLine==null&&it.newLine==null})
        }
        val rows=diffLines("@@ -0,0 +1 @@\n+one\n+outside declared hunk")
        assertEquals(1,rows[1].newLine);assertNull(rows[2].newLine)
    }
    @Test fun untrackedContentIsPlainSourceAndEmptyFileHasNoPhantomRow(){
        val rows=diffLines("@@ -1 +100 @@\n+literal\n",true)
        assertEquals(listOf(1,2),rows.map{it.newLine});assertTrue(rows.all{it.oldLine==null})
        assertTrue(diffLines("",true).isEmpty())
    }
    @Test fun filtersCurrentAndOriginalRenamePathsWithoutInterpretingInput(){
        val files=listOf(GitFile("one","src/New Name.kt","legacy/Old Name.kt"),GitFile("two","docs/readme.md"))
        assertEquals(files.take(1),filterGitFiles(files," OLD name "))
        assertEquals(files.drop(1),filterGitFiles(files,"README"))
        assertTrue(filterGitFiles(files,"../*").isEmpty());assertEquals(files,filterGitFiles(files," "))
    }
}
