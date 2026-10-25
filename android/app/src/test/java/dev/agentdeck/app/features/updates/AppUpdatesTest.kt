package dev.agentdeck.app

import org.junit.Assert.*
import org.junit.Test

class AppUpdatesTest {
    private fun manifest(file:String="releases/test-3/AgentDeck-android.apk",sha:String="a".repeat(64),code:Int=3)="""{"versionName":"0.3.1","versionCode":$code,"file":"$file","sha256":"$sha"}"""
    @Test fun validManifest(){assertEquals(3,parseAppRelease(manifest()).versionCode)}
    @Test fun rejectUntrustedDownloads(){
        for(file in listOf("https://evil.test/a.apk","releases/../AgentDeck-android.apk","releases/a/other.apk")){
            assertTrue(runCatching{parseAppRelease(manifest(file=file))}.isFailure)
        }
        assertTrue(runCatching{parseAppRelease(manifest(sha="invalid"))}.isFailure)
        assertTrue(runCatching{parseAppRelease(manifest(code=0))}.isFailure)
    }
}
