package dev.agentdeck.app

import org.junit.Assert.*
import org.junit.Test

class CapabilitiesTest {
    @Test fun legacyHostDoesNotImplyDesktopSharing() {
        val value=wire.decodeFromString(BridgeCapabilities.serializer(),"""{"protocolVersion":1,"codexVersion":"0.159.2","concurrency":2}""")
        assertEquals(0,value.capabilitiesVersion)
        assertEquals("unknown",value.runtime.mode)
        assertFalse(value.runtime.sharedDesktopRuntime)
        assertFalse(value.supports("terminal"))
    }
    @Test fun additiveCapabilitiesRemainForwardCompatible() {
        val value=wire.decodeFromString(BridgeCapabilities.serializer(),"""{"protocolVersion":1,"capabilitiesVersion":1,"upstreamReady":true,"runtime":{"mode":"managed-stdio","sessionScope":"bridge-created","sharedDesktopRuntime":false,"future":42},"features":{"attachments":true,"terminal":false,"futureFeature":true},"limits":{"attachmentTotalBytes":524288},"future":42}""")
        assertTrue(value.upstreamReady)
        assertFalse(value.runtime.sharedDesktopRuntime)
        assertTrue(value.supports("attachments"))
        assertFalse(value.supports("terminal"))
        assertEquals(524288L,value.limits["attachmentTotalBytes"])
    }
}
