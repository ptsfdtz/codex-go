package dev.agentdeck.app

import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class PairingAddressTest {
    private fun qr(version:Int=2,name:String?="127.0.0.1")=PairQr(version,"https://192.168.1.20:49321","a".repeat(64),"b".repeat(43),Instant.now().plusSeconds(60).toString(),"host-original",name)
    @Test fun legacyAndStableInvitationsHaveDifferentVerificationNames(){
        val legacy=qr(1,null).validated()
        assertEquals(legacy.endpoint,serviceOrigin(legacy.endpoint,legacy.tlsServerName))
        val stable=qr().validated()
        assertEquals("https://127.0.0.1:49321",serviceOrigin(stable.endpoint,stable.tlsServerName))
        assertEquals(qr().hostId,stable.hostId)
    }
    @Test fun neitherVersionAllowsArbitraryVerificationNamesOrUrlCredentials(){
        for(invalid in listOf(qr(name="attacker.invalid"),qr(1,"127.0.0.1"),qr().copy(endpoint="https://user:secret@192.168.1.20:49321"),qr().copy(endpoint="https://192.168.1.20:0"))){
            try{invalid.validated();fail("Invalid pairing accepted")}catch(_:IllegalArgumentException){}
        }
    }
    @Test fun existingSavedDeviceIdentityAndCredentialRemainUnchanged(){
        val host=wire.decodeFromString(Host.serializer(),"""{"endpoint":"https://192.168.1.20:49321","fingerprint":"original-pin","hostId":"original-host","deviceId":"original-device","credential":"original-credential"}""")
        assertNull(host.tlsServerName)
        assertEquals("original-device",host.deviceId)
        assertEquals("original-credential",host.credential)
    }
}
