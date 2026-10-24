package dev.agentdeck.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.net.Socket
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Opt-in physical migration using existing client sign-ins. Pairing material
 * travels over a one-use ADB reverse socket, never test output. No model tasks. */
@RunWith(AndroidJUnit4::class)
class CloudMigrationTest {
    @Test fun migrateAndVerifyCloud() = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("Explicit physical cloud migration only", args.getString("cloudMigration") == "true")
        val port = requireNotNull(args.getString("migrationPort")).toInt()
        val nonce = requireNotNull(args.getString("migrationNonce"))
        require(port in 1024..65535 && Regex("[a-f0-9]{64}").matches(nonce))
        val repo = (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as DeckApplication).repository
        withContext(Dispatchers.IO) {
            Socket("127.0.0.1", port).use { socket ->
                socket.soTimeout = 900_000
                val input = socket.getInputStream().bufferedReader()
                val output = socket.getOutputStream().bufferedWriter()
                fun send(value: JsonObject) { output.write(value.toString()); output.newLine(); output.flush() }
                fun receive() = wire.parseToJsonElement(requireNotNull(input.readLine())).jsonObject
                send(buildJsonObject { put("nonce", nonce) })
                require(receive()["origin"]?.jsonPrimitive?.content == "https://agent.ptsfdtz.top")
                val signedIn = withTimeout(900_000) { repo.state.first { it.cloud.signedIn && !it.cloud.mustChangePassword &&
                    it.cloud.origin == "https://agent.ptsfdtz.top" && it.cloud.username == "ptsfdtz" } }
                send(buildJsonObject { put("stage", "signedIn"); put("origin", signedIn.cloud.origin) })
                val qr = receive().getValue("qr").jsonObject
                val hostId = qr.getValue("hostId").jsonPrimitive.content
                repo.beginPair(qr.toString())
                val pending = withTimeout(60_000) { repo.state.first { it.pairingCode != null || it.error != null } }
                check(pending.error == null) { "Public pairing request failed" }
                send(buildJsonObject { put("stage", "confirmation"); put("code", pending.pairingCode); put("hostId", hostId) })
                withTimeout(90_000) { repo.state.first { !it.busy && it.host?.hostId == hostId && it.host.cloud != null } }
                repo.setRoutePolicy(hostId, "cloud")
                suspend fun verify(): DeckState = withTimeout(90_000) {
                    repo.state.first { it.host?.hostId == hostId && it.host.routePolicy == "cloud" &&
                        !it.stale && it.computerConnections[hostId]?.route == "云端" && it.snapshot.host?.hostId == hostId }
                }
                val connected = verify()
                send(buildJsonObject { put("stage", "cloudConnected"); put("routePolicy", "cloud");
                    put("route", connected.computerConnections[hostId]?.route); put("hostId", hostId);
                    put("projects", connected.snapshot.projects.size); put("sessions", connected.snapshot.sessions.size) })
                require(receive()["action"]?.jsonPrimitive?.content == "expectDisconnect")
                withTimeout(60_000) { repo.state.first { it.stale } }
                send(buildJsonObject { put("stage", "disconnected") })
                require(receive()["action"]?.jsonPrimitive?.content == "verifyReconnect")
                repo.checkConnection()
                val restored = verify()
                repo.refresh()
                send(buildJsonObject { put("stage", "reconnected"); put("routePolicy", restored.host?.routePolicy);
                    put("route", restored.computerConnections[hostId]?.route); put("hostId", hostId) })
            }
        }
    }
}
