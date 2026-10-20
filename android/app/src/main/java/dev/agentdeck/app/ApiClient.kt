package dev.agentdeck.app

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

@Serializable data class ApiConfig(val baseUrl:String="https://api.openai.com/v1",val key:String="",val model:String="",val effort:String=""){
    override fun toString()="ApiConfig(baseUrl=$baseUrl, key=[REDACTED], model=$model, effort=$effort)"
}
@Serializable data class ApiMessage(val id:String,val role:String,val text:String,val status:String="completed")
@Serializable data class ApiConversation(val id:String,val title:String,val archived:Boolean=false,val pinned:Boolean=false,val updatedAt:String="",val messages:List<ApiMessage> = emptyList())
@Serializable data class ApiDocument(val config:ApiConfig=ApiConfig(),val conversations:List<ApiConversation> = emptyList(),val models:List<String> = emptyList())

fun apiBase(raw:String):HttpUrl {
    val url=raw.trim().toHttpUrl()
    require(url.isHttps&&url.username.isEmpty()&&url.password.isEmpty()&&url.query==null&&url.fragment==null){"API 基础地址必须是 HTTPS，不能包含凭据、查询或片段"}
    require(!url.encodedPath.trimEnd('/').endsWith("/chat/completions")){"请输入基础地址（通常以 /v1 结尾），不要填写 /chat/completions"}
    return url
}
fun apiRequest(config:ApiConfig,messages:List<ApiMessage>):JsonObject=buildJsonObject{
    require(config.model.isNotBlank()){"请填写或选择 API 模型"}
    put("model",config.model);put("stream",true)
    if(config.effort.isNotEmpty())put("reasoning_effort",config.effort)
    putJsonArray("messages"){messages.filter{it.status=="completed"&&it.role in listOf("user","assistant")}.forEach{message->add(buildJsonObject{put("role",message.role);put("content",message.text)})}}
}

/** OpenAI-compatible text Chat Completions. Never executes tools or renders hidden reasoning. */
class ApiClient(private val client:OkHttpClient=OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).connectTimeout(15,TimeUnit.SECONDS).readTimeout(90,TimeUnit.SECONDS).callTimeout(5,TimeUnit.MINUTES).build()){
    private fun request(config:ApiConfig,resource:String):Request.Builder{
        require(config.key.isNotBlank()&&!config.key.contains('\n')&&!config.key.contains('\r')){"请配置有效的 API 密钥"}
        val base=apiBase(config.baseUrl)
        val url=base.newBuilder().encodedPath(base.encodedPath.trimEnd('/')+"/"+resource).build()
        return Request.Builder().url(url).header("Authorization","Bearer "+config.key)
    }
    suspend fun models(config:ApiConfig,onCall:(Call)->Unit):List<String> = withContext(Dispatchers.IO){
        val call=client.newCall(request(config,"models").get().build());onCall(call);currentCoroutineContext().ensureActive()
        call.execute().use{response->
            check(response.isSuccessful){"模型列表请求失败（HTTP ${response.code}）"}
            val body=response.body?:error("API 返回空内容")
            val source=body.source();source.request(1024L*1024+1);require(source.buffer.size<=1024*1024){"模型列表过大"}
            wire.parseToJsonElement(source.readUtf8()).jsonObject["data"]?.jsonArray?.mapNotNull{it.jsonObject["id"]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf(String::isNotEmpty)}?.distinct()?.sorted()?.takeIf{it.isNotEmpty()}?:error("对端未返回可用模型，请手动填写模型 ID")
        }
    }
    suspend fun chat(config:ApiConfig,messages:List<ApiMessage>,onCall:(Call)->Unit,onDelta:(String)->Unit):Unit=withContext(Dispatchers.IO){
        val body=apiRequest(config,messages).toString().toRequestBody("application/json".toMediaType())
        val call=client.newCall(request(config,"chat/completions").post(body).build());onCall(call);currentCoroutineContext().ensureActive()
        call.execute().use{response->
            check(response.isSuccessful){"API 请求失败（HTTP ${response.code}），请检查地址、密钥、模型及思考强度"}
            val source=response.body?.source()?:error("API 返回空内容")
            var total=0
            fun emit(text:String){total+=text.length;require(total<=512*1024){"回复超过显示上限，已停止接收"};if(text.isNotEmpty())onDelta(text)}
            fun finish(reason:String?){check(reason in listOf("stop","length","content_filter")){"API 未提供支持的完成状态（不支持工具调用）"};check(reason=="stop"){if(reason=="length")"回复达到长度上限，内容不完整" else "内容被服务商过滤"}}
            if(response.header("Content-Type")?.contains("text/event-stream")==true){
                val decoder=ChatStreamDecoder(::emit)
                while(!source.exhausted()){
                    val line=source.readUtf8LineStrict(256L*1024)
                    if(decoder.line(line))break
                }
                finish(decoder.finishReason)
                check(decoder.done){"连接提前结束，回复状态未知"}
            }else{
                source.request(1024L*1024+1);require(source.buffer.size<=1024*1024){"API 响应过大"}
                val value=wire.parseToJsonElement(source.readUtf8()).jsonObject
                val choice=value["choices"]?.jsonArray?.firstOrNull()?.jsonObject?:error("API 响应格式不兼容")
                val message=choice["message"]?.jsonObject?:error("API 未返回消息")
                check(message["tool_calls"]==null&&message["function_call"]==null){"chat 不执行工具调用"}
                emit(message["content"]?.jsonPrimitive?.contentOrNull?:"")
                finish(choice["finish_reason"]?.jsonPrimitive?.contentOrNull)
            }
        }
    }
}

/** Bounded SSE event decoder; usage-only chunks do not establish completion. */
class ChatStreamDecoder(private val onDelta:(String)->Unit){
    var finishReason:String?=null;private set
    var done=false;private set
    private val data=StringBuilder()
    fun line(line:String):Boolean{
        require(line.length<=256*1024){"API 流事件过大"}
        if(line.isEmpty()){
            if(data.isEmpty())return false
            val raw=data.toString().trim();data.setLength(0)
            if(raw=="[DONE]"){done=true;return true}
            val packet=wire.parseToJsonElement(raw).jsonObject
            check(packet["error"]==null){"API 返回流错误，回复未完成"}
            val choices=packet["choices"]?.jsonArray?:error("API 流格式不兼容")
            val choice=choices.firstOrNull()?.jsonObject?:return false
            check(choice["index"]?.jsonPrimitive?.intOrNull in listOf(null,0)){"不支持多个回复选项"}
            choice["finish_reason"]?.jsonPrimitive?.contentOrNull?.let{finishReason=it}
            choice["delta"]?.jsonObject?.let{delta->
                check(delta["tool_calls"]==null&&delta["function_call"]==null){"chat 不执行工具调用"}
                delta["content"]?.jsonPrimitive?.contentOrNull?.let(onDelta)
            }
        }else if(line.startsWith("data:")){
            data.append(line.substring(5).trimStart()).append('\n');require(data.length<=256*1024){"API 流事件过大"}
        }
        return false
    }
}
