package dev.agentdeck.app

import org.junit.Assert.*
import org.junit.Test

class HostBookTest{
    private val first=Host("https://192.168.1.10:49321","a".repeat(64),"first","device-one","one",name="工作电脑")
    private val second=Host("https://192.168.1.20:49321","b".repeat(64),"second","device-two","two",name="家里电脑")

    @Test fun pairingAndSwitchingKeepsBothCredentialsAndRemembersSelection(){
        val book=HostBook().paired(first).paired(second).selected(first.hostId)
        val restored=wire.decodeFromString(HostBook.serializer(),wire.encodeToString(HostBook.serializer(),book))
        assertEquals(listOf(first,second),restored.hosts)
        assertEquals(first,restored.active)
        assertEquals(second,restored.selected(second.hostId).active)
    }

    @Test fun rePairingReplacesOnlyThatComputerAndKeepsItsName(){
        val replacement=first.copy(endpoint="https://192.168.1.30:49321",credential="renewed",deviceId="new-device",name="")
        val book=HostBook().paired(first).paired(second).paired(replacement)
        assertEquals(2,book.hosts.size)
        assertEquals(second,book.hosts.find{it.hostId==second.hostId})
        assertEquals(replacement.copy(name=first.name),book.active)
    }

    @Test fun sameEndpointDoesNotMergeDifferentComputers(){
        val book=HostBook().paired(first).paired(second.copy(endpoint=first.endpoint))
        assertEquals(2,book.hosts.size)
        assertEquals(first,book.selected(first.hostId).active)
    }

    @Test fun removingOnlyCurrentComputerSelectsRemainingAndLastRemovalUnpairs(){
        val book=HostBook().paired(first).paired(second)
        assertEquals(HostBook(listOf(first),first.hostId),book.removed(second.hostId))
        assertEquals(second,book.removed(first.hostId).active)
        assertNull(book.removed(second.hostId).removed(first.hostId).active)
        assertEquals(first.copy(name="办公室"),book.renamed(first.hostId," 办公室 ").hosts.first())
    }

    @Test(expected=IllegalArgumentException::class) fun cannotSelectAnUnpairedComputer(){HostBook().paired(first).selected("unknown")}

    @Test fun switchingClearsOldComputerDataEvenIfSessionIdsOverlap(){
        val old=DeckState(host=first,hosts=listOf(first,second),selectedProject="same-project",selectedSession="same-session",
            snapshot=Snapshot(host=HostState(first.hostId,"ready","test"),projects=listOf(Project("same-project","private project","C:/private"))),
            git=GitStatus(available=true),diff=Diff(text="private diff"),models=listOf(CodexModel("old-model","old-model")),selectedModel="old-model",
            diagnostics=payload("secret" to "old diagnostics"),pairingCode="123456",lastSynced="old",displayMask="old mask",preferences=DeckPreferences(theme="dark"))
        val next=old.forHost(HostBook(listOf(first,second),second.hostId))
        assertEquals(second,next.host)
        assertEquals(old.hosts,next.hosts)
        assertEquals(old.preferences,next.preferences)
        assertEquals(Snapshot(),next.snapshot)
        assertNull(next.selectedProject);assertNull(next.selectedSession)
        assertTrue(next.events.isEmpty());assertNull(next.git);assertNull(next.diff)
        assertTrue(next.models.isEmpty());assertEquals("",next.selectedModel)
        assertNull(next.diagnostics);assertNull(next.pairingCode);assertNull(next.lastSynced)
        assertTrue(next.stale);assertEquals("正在连接",next.connection)
    }

    @Test fun oldSerializedHostStillLoadsWithoutAName(){
        val old="""{"endpoint":"https://localhost:49321","fingerprint":"fp","hostId":"legacy","deviceId":"d","credential":"c"}"""
        val host=wire.decodeFromString(Host.serializer(),old)
        assertEquals("",host.name)
        assertEquals("localhost:49321",host.label)
    }
}
