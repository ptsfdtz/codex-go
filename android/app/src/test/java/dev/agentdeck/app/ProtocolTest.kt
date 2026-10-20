package dev.agentdeck.app

import org.junit.Test
import org.junit.Assert.*
import java.time.Instant
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate

class ProtocolTest {
    private fun qr(endpoint:String="https://192.168.1.2:49321",expiresAt:String=Instant.now().plusSeconds(120).toString())=PairQr(1,endpoint,"a".repeat(64),"b".repeat(43),expiresAt,"host")
    @Test fun acceptsValidPinnedHttpsInvitation(){assertEquals(1,qr().validated().v)}
    @Test fun rejectsCleartextAndEmbeddedCredentials(){for(endpoint in listOf("http://192.168.1.2:49321","https://user:password@host:49321","https://host:49321/extra","https://host:49321?token=value")){assertThrows(IllegalArgumentException::class.java){qr(endpoint).validated()}}}
    @Test fun rejectsExpiredInvitation(){assertThrows(IllegalArgumentException::class.java){qr(expiresAt=Instant.now().minusSeconds(1).toString()).validated()}}
    @Test fun preservesUnknownOutcomeSeparatelyFromCompletion(){assertNotEquals(statusLabel("unknown"),statusLabel("completed"));assertNotEquals(statusLabel("interrupted"),statusLabel("failed"))}
    @Test fun pinChecksExactPublicCertificate(){val cert=CertificateFactory.getInstance("X.509").generateCertificate(javaClass.getResourceAsStream("/bridge.crt")) as X509Certificate;val pin=MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString(""){"%02x".format(it)};PinnedTrust(pin).checkServerTrusted(arrayOf(cert),"RSA");assertThrows(java.security.cert.CertificateException::class.java){PinnedTrust("0".repeat(64)).checkServerTrusted(arrayOf(cert),"RSA")}}
    @Test fun rejectsMissingCertificate(){assertThrows(java.security.cert.CertificateException::class.java){PinnedTrust("0".repeat(64)).checkServerTrusted(emptyArray(),"RSA")}}
    @Test fun decodesAuthoritativeStatusAndUnknownAdditiveFields(){val raw="""{"cursor":"10","host":{"hostId":"h","status":"connected","codexVersion":"0.159.2"},"sessions":[{"sessionId":"s","projectId":"p","upstreamThreadId":"t","title":"Task","status":"unknown","newField":true}],"futureField":42}""";assertEquals("unknown",wire.decodeFromString(Snapshot.serializer(),raw).sessions.single().status)}
    @Test fun coalescesOnlySameItemAndTurnWithoutChangingDurableIds(){
        fun event(id:String,turn:String,text:String)=DeckEvent(eventId=id,seq=id.toLong(),sessionId="s",turnId=turn,action="turn.progress",payload=wire.parseToJsonElement("""{"method":"item/agentMessage/delta","itemId":"message","delta":"$text"}"""),ts="now")
        val events=listOf(event("1","turn-one","Hello"),event("2","turn-one"," world"),event("3","turn-two","Next"));val rendered=timelineEvents(events);assertEquals(2,rendered.size);assertEquals("Hello world",eventText(rendered.first()));assertEquals("1",rendered.first().eventId);assertEquals(3,events.size)
    }
}
