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

/** Physical, explicitly enabled probes; optionally selects the cloud route.
 * Never exports credentials or creates model tasks. */
@RunWith(AndroidJUnit4::class)
class CloudStabilityTest {
    @Test fun inspectAndProbePublicCloud() = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("cloudStability") == "true")
        val nonce = requireNotNull(args.getString("probeNonce"))
        require(Regex("[a-f0-9]{64}").matches(nonce))
        val repo = (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as DeckApplication).repository
        // Reuse the repository's account mutex and rotating session. A second
        // CloudAccount over the same saved refresh token would invalidate it.
        val cloudField = DeckRepository::class.java.getDeclaredField("cloud").apply { isAccessible = true }
        val cloud = cloudField.get(repo) as CloudAccount
        withContext(Dispatchers.IO) {
            Socket("127.0.0.1", requireNotNull(args.getString("probePort")).toInt()).use { socket ->
                socket.soTimeout = 900_000
                val input = socket.getInputStream().bufferedReader()
                val output = socket.getOutputStream().bufferedWriter()
                fun send(value: JsonObject) { output.write(value.toString()); output.newLine(); output.flush() }
                fun receive() = wire.parseToJsonElement(requireNotNull(input.readLine())).jsonObject
                send(buildJsonObject { put("nonce", nonce) })
                withTimeout(30_000) { repo.state.first { it.hosts.isNotEmpty() && it.cloud.signedIn } }
                cloud.refreshDirectory()
                val state = repo.state.value
                send(buildJsonObject {
                    put("stage", "inventory"); put("origin", cloud.state.value.origin)
                    put("hosts", buildJsonArray { state.hosts.forEach { host -> add(buildJsonObject {
                        put("hostId", host.hostId); put("name", host.name); put("cloud", host.cloud != null)
                        put("policy", host.routePolicy); put("route", state.computerConnections[host.hostId]?.route)
                        put("online", cloud.state.value.computers.any { it.hostId == host.hostId && it.online })
                    }) } })
                })
                val config = receive()
                if (config["action"]?.jsonPrimitive?.content == "inspect") return@use
                val host = state.hosts.single { it.hostId == config.getValue("hostId").jsonPrimitive.content }
                val binding = requireNotNull(host.cloud)
                if(config["selectCloud"]?.jsonPrimitive?.booleanOrNull==true){
                    repo.selectHost(host.hostId)
                    withTimeout(30_000){repo.state.first{it.host?.hostId==host.hostId&&!it.busy}}
                    repo.setRoutePolicy(host.hostId,"cloud")
                    val connected=withTimeout(90_000){repo.state.first{
                        it.host?.hostId==host.hostId&&it.host.routePolicy=="cloud"&&!it.stale&&
                            it.computerConnections[host.hostId]?.route=="云端"
                    }}
                    send(buildJsonObject{put("stage","routeSelected");put("policy",connected.host?.routePolicy);put("route",connected.computerConnections[host.hostId]?.route)})
                }
                val seconds = config.getValue("seconds").jsonPrimitive.int.coerceIn(10, 600)
                var transport: DeckTransport? = null
                var attempts = 0
                var reads = 0
                var failures = 0
                val end = System.nanoTime() + seconds * 1_000_000_000L
                try {
                    while (System.nanoTime() < end) {
                        try {
                            if (transport == null) {
                                attempts++
                                transport = DeckTransport(host, 45_000, routeFactory = RelaySocketFactory(cloud, binding, host.hostId))
                                transport.connect()
                                transport.request("system.hello", buildJsonObject { put("client", "AgentDeck cloud stability"); put("version", 1) })
                            }
                            val current = requireNotNull(transport)
                            val snapshot = current.request("snapshot.get")
                            check(snapshot["host"]?.jsonObject?.get("hostId")?.jsonPrimitive?.content == host.hostId)
                            reads++
                            send(buildJsonObject { put("stage", "read"); put("reads", reads); put("attempts", attempts); put("bytes", snapshot.toString().toByteArray().size) })
                            // Drain real events so the bounded delivery queue can recover.
                            val until = System.nanoTime() + 3_000_000_000L
                            while (System.nanoTime() < until) withTimeoutOrNull(250) { current.events.receive() }
                        } catch (e: CancellationException) { throw e }
                        catch (e: Exception) {
                            failures++
                            send(buildJsonObject { put("stage", "failure"); put("attempts", attempts)
                                put("causes", buildJsonArray { generateSequence<Throwable>(e) { it.cause }.take(6).forEach {
                                    add(it.javaClass.simpleName + ": " + (it.message ?: "").take(240))
                                } })
                            })
                            transport?.close(); transport = null; delay(2000)
                        }
                    }
                } finally { transport?.close() }
                send(buildJsonObject { put("stage", "complete"); put("reads", reads); put("attempts", attempts); put("failures", failures) })
            }
        }
    }
}
