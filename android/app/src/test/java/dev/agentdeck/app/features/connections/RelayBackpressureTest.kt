package dev.agentdeck.app

import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.ByteString.Companion.toByteString
import org.junit.Assert.*
import org.junit.Test

class RelayBackpressureTest {
    @Test fun encryptedBurstWaitsForLocalReaderWithoutDroppingTheTunnel() {
        val server = MockWebServer()
        val client = OkHttpClient.Builder().build()
        val writer = Executors.newSingleThreadExecutor()
        val queued = CountDownLatch(1)
        val uploaded = CountDownLatch(1)
        val uploadBytes = AtomicInteger()
        val uploadIntact = AtomicBoolean(true)
        val chunk = ByteArray(64 * 1024) { (it % 251).toByte() }
        val frames = 64
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                writer.submit {
                    repeat(frames) { check(webSocket.send(chunk.toByteString())) }
                    queued.countDown()
                }
            }
            override fun onMessage(webSocket: WebSocket, bytes: okio.ByteString) {
                val start = uploadBytes.getAndAdd(bytes.size)
                for (i in 0 until bytes.size) {
                    if (bytes[i] != chunk[(start + i) % chunk.size]) uploadIntact.set(false)
                }
                Thread.sleep(1)
                if (start + bytes.size == frames * chunk.size) uploaded.countDown()
            }
        }))
        server.start()
        val listener = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
        val consumer = Socket().apply {
            receiveBufferSize = 4096
            connect(listener.localSocketAddress)
            soTimeout = 15_000
        }
        val local = listener.accept().apply { sendBufferSize = 4096 }
        val bridge = RelayBridge(local, client, CloudTunnel(server.url("/").toString(), "access", "ticket"))
        try {
            bridge.open()
            assertTrue(queued.await(5, TimeUnit.SECONDS))
            // Real socket pressure: the peer pauses while more than the bounded
            // relay queue arrives, then resumes consuming the same TLS byte stream.
            Thread.sleep(250)
            val input = consumer.getInputStream()
            val received = ByteArray(chunk.size)
            repeat(frames) {
                var offset = 0
                while (offset < received.size) {
                    val count = input.read(received, offset, received.size - offset)
                    assertTrue("Relay closed before the encrypted burst drained", count > 0)
                    offset += count
                }
                assertArrayEquals(chunk, received)
            }
            val upload = writer.submit { repeat(frames) { consumer.getOutputStream().write(chunk) } }
            upload.get(15, TimeUnit.SECONDS)
            assertTrue("Queued upload must drain through the same tunnel", uploaded.await(15, TimeUnit.SECONDS))
            assertTrue(uploadIntact.get())
        } finally {
            bridge.close(); consumer.close(); listener.close()
            client.dispatcher.executorService.shutdownNow(); client.connectionPool.evictAll()
            writer.shutdownNow(); server.close()
        }
    }
}
