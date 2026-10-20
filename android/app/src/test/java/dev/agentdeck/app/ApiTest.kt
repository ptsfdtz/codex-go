package dev.agentdeck.app

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.*
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.TimeUnit

class ApiTest{
    private fun config(base:String="https://api.example.test/v1")=ApiConfig(base,"fixture-key-not-a-real-secret","fixture-model","high")
    private suspend fun failure(block:suspend()->Unit):Exception{try{block()}catch(e:Exception){return e};error("Expected rejection")}
    private fun server():Pair<MockWebServer,ApiClient>{
        val certificate=HeldCertificate.Builder().commonName("localhost").addSubjectAlternativeName("localhost").addSubjectAlternativeName("127.0.0.1").addSubjectAlternativeName("::1").build()
        val serverTls=HandshakeCertificates.Builder().heldCertificate(certificate).build()
        val clientTls=HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        val server=MockWebServer();server.useHttps(serverTls.sslSocketFactory(),false);server.start()
        return server to ApiClient(OkHttpClient.Builder().sslSocketFactory(clientTls.sslSocketFactory(),clientTls.trustManager).followRedirects(false).followSslRedirects(false).readTimeout(2,TimeUnit.SECONDS).build())
    }
    private fun response(text:String)=MockResponse().setHeader("Content-Type","text/event-stream").setBody("data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"$text\"},\"finish_reason\":null}]}\n\ndata: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
    @Test fun apiAddressAndSecrets(){
        for(url in listOf("http://localhost/v1","https://user:password@example.test/v1","https://example.test/v1?key=bad","https://example.test/v1#bad","https://example.test/v1/chat/completions"))assertTrue(runCatching{apiBase(url)}.isFailure)
        assertFalse(config().toString().contains(config().key));assertEquals("api.example.test",apiBase(config().baseUrl).host)
    }
    @Test fun requestContainsOnlyCompletedTextHistory(){
        val body=apiRequest(config(),listOf(ApiMessage("1","user","hello"),ApiMessage("2","assistant","partial","failed")))
        assertEquals("high",body["reasoning_effort"]?.jsonPrimitive?.content);assertEquals(1,body["messages"]?.jsonArray?.size);assertNull(body["api_key"])
        assertNull(apiRequest(config().copy(effort=""),emptyList())["reasoning_effort"])
    }
    @Test fun streamDecoderRequiresTerminalAndRejectsTools(){
        val parts=mutableListOf<String>();val decoder=ChatStreamDecoder(parts::add)
        decoder.line(": keepalive");decoder.line("data: {\"choices\":[{\"delta\":{\"content\":\"你好\"},\"finish_reason\":\"stop\"}]}");decoder.line("")
        assertEquals(listOf("你好"),parts);assertFalse(decoder.done);decoder.line("data: [DONE]");assertTrue(decoder.line(""));assertEquals("stop",decoder.finishReason)
        val tools=ChatStreamDecoder{};tools.line("data: {\"choices\":[{\"delta\":{\"tool_calls\":[]}}]}");assertTrue(runCatching{tools.line("")}.isFailure)
        assertTrue(runCatching{ChatStreamDecoder{}.line("data:"+"x".repeat(256*1024))}.isFailure)
    }
    @Test fun realHttpsFixtureStreamsAndUsesConfiguredEndpoint()=runBlocking{
        val (server,client)=server();server.use{
            server.enqueue(response("hello"));val parts=mutableListOf<String>()
            client.chat(config(server.url("/custom/v1").toString()),listOf(ApiMessage("u","user","test")),{},parts::add)
            assertEquals("hello",parts.joinToString(""));val request=server.takeRequest();assertEquals("/custom/v1/chat/completions",request.path);assertEquals("Bearer "+config().key,request.getHeader("Authorization"))
            val body=wire.parseToJsonElement(request.body.readUtf8()).jsonObject;assertEquals("fixture-model",body["model"]?.jsonPrimitive?.content)
        }
    }
    @Test fun rejectsEarlyEofHttpErrorsAndRedirects()=runBlocking{
        val (server,client)=server();server.use{
            val config=config(server.url("/v1").toString());val messages=listOf(ApiMessage("u","user","test"))
            server.enqueue(MockResponse().setHeader("Content-Type","text/event-stream").setBody("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n"))
            failure{client.chat(config,messages,{},{})}
            server.enqueue(MockResponse().setResponseCode(401).setBody(config.key));assertFalse(failure{client.chat(config,messages,{},{})}.message.orEmpty().contains(config.key))
            server.enqueue(MockResponse().setResponseCode(302).setHeader("Location","https://other.example.test/stolen"));failure{client.chat(config,messages,{},{})};assertEquals(3,server.requestCount)
        }
    }
    @Test fun modelListIsReadFromRealHttpsFixture()=runBlocking{
        val (server,client)=server();server.use{server.enqueue(MockResponse().setBody("{\"data\":[{\"id\":\"model-b\"},{\"id\":\"model-a\"}]}"));assertEquals(listOf("model-a","model-b"),client.models(config(server.url("/v1").toString())){});assertEquals("/v1/models",server.takeRequest().path)}
    }
    private class MemoryStore(@Volatile var doc:ApiDocument=ApiDocument()):ApiPersistence{
        override fun read()=doc
        override fun write(value:ApiDocument){doc=value}
    }
    @Test fun configuringWithoutModelDiscoversSelectsAndPersistsModels()=runBlocking{
        val (server,client)=server();server.use{
            val memory=MemoryStore();val repo=ApiRepository(memory,client)
            withTimeout(5000){repo.state.first{it.storageReady}}
            server.enqueue(MockResponse().setBody("{\"data\":[{\"id\":\"model-b\"},{\"id\":\"\"},{\"id\":\"model-a\"},{\"id\":\"model-b\"}]}"))
            repo.configure(server.url("/custom/v1").toString(),config().key,"","")
            val discovered=withTimeout(5000){repo.state.first{!it.busy}}
            assertNull(discovered.error);assertEquals("model-a",discovered.config.model)
            assertEquals(listOf("model-a","model-b"),discovered.models)
            val request=server.takeRequest();assertEquals("/custom/v1/models",request.path)
            assertEquals("Bearer "+config().key,request.getHeader("Authorization"))
            repo.chooseModel("model-b");withTimeout(5000){repo.state.first{!it.busy}}
            val reloaded=ApiRepository(memory,client)
            val restored=withTimeout(5000){reloaded.state.first{it.storageReady}}
            assertEquals("model-b",restored.config.model);assertEquals(discovered.models,restored.models)
            assertEquals(memory.doc,wire.decodeFromString(ApiDocument.serializer(),wire.encodeToString(ApiDocument.serializer(),memory.doc)))
            assertEquals(emptyList<String>(),wire.decodeFromString(ApiDocument.serializer(),"{}").models)
            assertEquals(1,server.requestCount)
        }
    }
    @Test fun unsupportedDiscoveryKeepsManualModelAndRefreshAddsRemoteModels()=runBlocking{
        val (server,client)=server();server.use{
            val memory=MemoryStore(ApiDocument(config(server.url("/old/v1").toString()),models=listOf("old-model")))
            val repo=ApiRepository(memory,client);withTimeout(5000){repo.state.first{it.storageReady}}
            server.enqueue(MockResponse().setResponseCode(404))
            repo.configure(server.url("/new/v1").toString(),config().key,"manual-model","")
            val saved=withTimeout(5000){repo.state.first{!it.busy}}
            assertNull(saved.error);assertNotNull(saved.modelNotice)
            assertEquals(listOf("manual-model"),memory.doc.models)
            server.enqueue(MockResponse().setBody("{\"data\":[{\"id\":\"remote-model\"}]}"))
            repo.models();val refreshed=withTimeout(5000){repo.state.first{!it.busy}}
            assertNull(refreshed.error);assertEquals("manual-model",refreshed.config.model)
            assertEquals(listOf("manual-model","remote-model"),memory.doc.models)
            assertEquals("/new/v1/models",server.takeRequest().path)
            assertEquals("/new/v1/models",server.takeRequest().path)
        }
    }
    @Test fun failedDiscoveryWithoutManualModelPreservesPreviousConfigurationAndCache()=runBlocking{
        val (server,client)=server();server.use{
            val original=ApiDocument(config(),models=listOf("old-model"))
            val memory=MemoryStore(original);val repo=ApiRepository(memory,client)
            withTimeout(5000){repo.state.first{it.storageReady}}
            server.enqueue(MockResponse().setResponseCode(401))
            repo.configure(server.url("/v1").toString(),config().key,"","")
            val failed=withTimeout(5000){repo.state.first{!it.busy}}
            assertNotNull(failed.error);assertEquals(original,memory.doc)
            server.enqueue(MockResponse().setBody("{\"data\":[]}"))
            assertTrue(failure{client.models(config(server.url("/v1").toString())){}}.message.orEmpty().contains("未返回可用模型"))
        }
    }
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun stoppingBeforeNetworkPersistsInterruptedInsteadOfCompleted()=runBlocking{
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try{
            val (server,client)=server();server.use{
                val memory=object:ApiPersistence{@Volatile var doc=ApiDocument(config(server.url("/v1").toString()));override fun read()=doc;override fun write(value:ApiDocument){doc=value}}
                val repo=ApiRepository(memory,client);withTimeout(5000){repo.state.first{it.storageReady}}
                repo.send("cancel before network"){repo.stop()}
                val final=withTimeout(5000){repo.state.first{!it.busy&&it.conversations.isNotEmpty()}}
                assertEquals("interrupted",final.conversations[0].messages.last().status)
                assertEquals("interrupted",memory.doc.conversations[0].messages.last().status)
                assertEquals(0,server.requestCount)
            }
        }finally{Dispatchers.resetMain()}
    }
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun repositoryPersistsAndRecoversUnknownWithoutOverwritingKey()=runBlocking{
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try{
            val memory=object:ApiPersistence{var doc=ApiDocument(config(),listOf(ApiConversation("c","old",messages=listOf(ApiMessage("a","assistant","partial","running")))));override fun read()=doc;override fun write(value:ApiDocument){doc=value}}
            val repo=ApiRepository(memory);withTimeout(5000){repo.state.first{it.storageReady}}
            assertEquals("unknown",repo.state.value.conversations[0].messages[0].status)
            repo.configure("https://other.example.test/v1","","model","");withTimeout(5000){repo.state.first{!it.busy}}
            assertEquals(config().key,memory.doc.config.key);assertEquals(config().baseUrl,memory.doc.config.baseUrl);assertNotNull(repo.state.value.error)
            repo.manage("c","rename","new");withTimeout(5000){repo.state.first{!it.busy}};assertEquals("new",memory.doc.conversations[0].title)
            repo.manage("c","archive");withTimeout(5000){repo.state.first{!it.busy}};assertTrue(memory.doc.conversations[0].archived)
            repo.manage("c","delete");withTimeout(5000){repo.state.first{!it.busy}};assertTrue(memory.doc.conversations.isEmpty())
        }finally{Dispatchers.resetMain()}
    }
}
