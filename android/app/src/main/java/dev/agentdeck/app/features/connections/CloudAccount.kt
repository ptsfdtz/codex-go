package dev.agentdeck.app

import java.io.IOException
import java.security.SecureRandom
import java.time.Instant
import java.util.Base64
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

@Serializable data class CloudBinding(val origin:String,val accountId:String)
@Serializable data class CloudComputer(val hostId:String,val displayName:String,val online:Boolean=false)
data class CloudAccountState(val origin:String="",val username:String="",val accountId:String="",val signedIn:Boolean=false,val mustChangePassword:Boolean=false,val computers:List<CloudComputer> = emptyList(),val error:String?=null){
    val binding:CloudBinding? get()=if(signedIn)CloudBinding(origin,accountId)else null
}
@Serializable internal class CloudTokens(val accessToken:String,val refreshToken:String,val accessExpiresIn:Long,val accountId:String,val username:String,val cloudDeviceId:String,val mustChangePassword:Boolean)
@Serializable internal class CloudSaved(val origin:String,val installationId:String,val expiresAt:Long,val tokens:CloudTokens)
internal class CloudTunnel(val url:String,val access:String,val ticket:String)

internal fun cloudOrigin(value:String):String {
    val url=value.toHttpUrl()
    require(url.isHttps&&url.username.isEmpty()&&url.password.isEmpty()&&url.encodedPath=="/"&&url.query==null&&url.fragment==null){"请输入不含路径或凭据的 HTTPS 服务器地址"}
    return url.toString().trimEnd('/')
}
internal fun connectionToken():String=Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also{SecureRandom().nextBytes(it)})

internal class CloudAccount(
    private val read:()->String?,private val save:(String?)->Unit,
    private val scope:CoroutineScope,
    private val installationId:()->String=::connectionToken,
    internal val client:OkHttpClient=OkHttpClient.Builder().connectTimeout(10,TimeUnit.SECONDS).readTimeout(25,TimeUnit.SECONDS).callTimeout(30,TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).pingInterval(20,TimeUnit.SECONDS).build(),
){
    private val lock=Mutex()
    private var saved:CloudSaved?=null
    private val mutable=MutableStateFlow(CloudAccountState())
    val state:StateFlow<CloudAccountState> = mutable.asStateFlow()
    suspend fun load(){
        try{lock.withLock{read()?.let{raw->val value=wire.decodeFromString(CloudSaved.serializer(),raw);cloudOrigin(value.origin);saved=value;identity(value)}}}
        catch(e:CancellationException){throw e}catch(_:Exception){mutable.value=CloudAccountState(error="云端凭据无法读取，请重新登录；局域网连接不受影响")}
        scope.launch{while(isActive){try{refreshDirectory()}catch(e:CancellationException){throw e}catch(e:Exception){mutable.update{it.copy(error=cloudError(e))}};delay(30_000)}}
    }
    private fun identity(value:CloudSaved){mutable.value=CloudAccountState(value.origin,value.tokens.username,value.tokens.accountId,true,value.tokens.mustChangePassword)}
    suspend fun login(origin:String,username:String,password:String){lock.withLock{
        check(saved==null){"请先退出当前云端账户"}
        val issuer=cloudOrigin(origin);require(username.isNotBlank()&&username.length<=80&&password.length<=1024)
        val installation=installationId()
        val result=call("$issuer/api/v1/auth/login","POST",buildJsonObject{put("username",username);put("password",password);put("installationId",installation);put("deviceName","${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".trim().ifBlank{"AgentDeck mobile"}.take(80));put("kind","mobile")})
        val tokens=wire.decodeFromJsonElement(CloudTokens.serializer(),result)
        val value=CloudSaved(issuer,installation,Instant.now().epochSecond+tokens.accessExpiresIn.coerceIn(0,600),tokens)
        persist(value);saved=value;identity(value)
    };refreshDirectory()}
    private fun persist(value:CloudSaved?){save(value?.let{wire.encodeToString(CloudSaved.serializer(),it)})}
    private fun forget(message:String?=null){persist(null);saved=null;mutable.update{it.copy(signedIn=false,mustChangePassword=false,computers=emptyList(),error=message)}}
    private suspend fun accessLocked():CloudSaved {
        var current=saved?:throw DeckException("CLOUD_LOGIN_REQUIRED","请先登录云端账户")
        if(current.expiresAt<=Instant.now().epochSecond+60){
            val result=try{call("${current.origin}/api/v1/auth/refresh","POST",payload("refreshToken" to current.tokens.refreshToken))}
            catch(e:DeckException){if(e.code in listOf("UNAUTHORIZED","FORBIDDEN"))forget("登录已失效，请重新登录");throw e}
            val tokens=wire.decodeFromJsonElement(CloudTokens.serializer(),result)
            if(tokens.accountId!=current.tokens.accountId||tokens.cloudDeviceId!=current.tokens.cloudDeviceId){forget("账户或设备身份发生变化，请重新登录");throw DeckException("CLOUD_IDENTITY_MISMATCH","账户或设备身份发生变化")}
            current=CloudSaved(current.origin,current.installationId,Instant.now().epochSecond+tokens.accessExpiresIn.coerceIn(0,600),tokens)
            try{persist(current)}catch(e:Exception){saved=null;mutable.update{it.copy(signedIn=false,computers=emptyList(),error="无法安全保存云端登录信息")};throw e}
            saved=current;mutable.update{it.copy(mustChangePassword=tokens.mustChangePassword)}
        }
        return current
    }
    suspend fun logout(){
        val previous=lock.withLock{val value=saved;forget();value}
        if(previous!=null)scope.launch{
            try{call("${previous.origin}/api/v1/auth/logout","POST",auth=previous.tokens.accessToken)}
            catch(e:CancellationException){throw e}catch(_:Exception){lock.withLock{if(saved==null)mutable.update{it.copy(error="本机已退出，云端会话撤销尚未确认")}}}
        }
    }
    suspend fun changePassword(old:String,new:String){lock.withLock{
        require(new.toByteArray().size in 12..1024&&old.length<=1024){"新密码至少需要 12 字节"}
        val current=accessLocked()
        call("${current.origin}/api/v1/auth/password","POST",payload("oldPassword" to old,"newPassword" to new),current.tokens.accessToken)
        forget("密码已修改，请重新登录")
    }}
    suspend fun refreshDirectory(){lock.withLock{
        if(saved==null||saved?.tokens?.mustChangePassword==true)return@withLock
        val current=accessLocked()
        val response=try{call("${current.origin}/api/v1/hosts","GET",auth=current.tokens.accessToken)}
        catch(e:DeckException){if(e.code in listOf("UNAUTHORIZED","FORBIDDEN"))forget("登录已失效，请重新登录");throw e}
        val computers=wire.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(CloudComputer.serializer()),response.getValue("hosts"))
        mutable.update{it.copy(computers=computers,error=null)}
    }}
    suspend fun tunnel(binding:CloudBinding,hostId:String):CloudTunnel=lock.withLock{
        val current=accessLocked()
        if(binding.origin!=current.origin||binding.accountId!=current.tokens.accountId)throw DeckException("CLOUD_IDENTITY_MISMATCH","电脑与当前云端账户不匹配")
        if(current.tokens.mustChangePassword)throw DeckException("PASSWORD_CHANGE_REQUIRED","请先修改初始密码")
        val result=try{call("${current.origin}/api/v1/relay/tunnels","POST",payload("hostId" to hostId),current.tokens.accessToken)}
        catch(e:DeckException){if(e.code in listOf("UNAUTHORIZED","FORBIDDEN"))forget("登录或设备授权已失效，请重新登录");throw e}
        require(result["version"]?.jsonPrimitive?.int==1){"云端转发协议不兼容"}
        val id=result.getValue("tunnelId").jsonPrimitive.content;java.util.UUID.fromString(id)
        val ticket=result.getValue("clientTicket").jsonPrimitive.content;require(Regex("[A-Za-z0-9_-]{43}").matches(ticket))
        require(Instant.parse(result.getValue("expiresAt").jsonPrimitive.content).isAfter(Instant.now())){"云端连接票据已过期"}
        CloudTunnel(current.origin.replaceFirst("https://","wss://")+"/api/v1/relay/tunnels/$id/client",current.tokens.accessToken,ticket)
    }
    private suspend fun call(url:String,method:String,body:JsonObject?=null,auth:String?=null):JsonObject {
        val request=Request.Builder().url(url).apply{if(auth!=null)header("Authorization","Bearer $auth")}.method(method,if(method=="GET")null else (body?:JsonObject(emptyMap())).toString().toRequestBody("application/json".toMediaType())).build()
        return suspendCancellableCoroutine{continuation->val call=client.newCall(request);continuation.invokeOnCancellation{call.cancel()};call.enqueue(object:Callback{
            override fun onFailure(call:Call,e:IOException){if(continuation.isActive)continuation.resumeWithException(IOException("无法连接云端服务",e))}
            override fun onResponse(call:Call,response:Response){response.use{try{
                val source=it.body?.source()?:throw IOException("云端响应为空");source.request(256*1024+1L);require(source.buffer.size<=256*1024){"云端响应过大"}
                val result=wire.parseToJsonElement(source.readUtf8()).jsonObject
                if(!it.isSuccessful)throw DeckException(result["code"]?.jsonPrimitive?.content?:"CLOUD_UNAVAILABLE",when(it.code){401->"登录已失效或账号密码无效";403->if(result["code"]?.jsonPrimitive?.content=="PASSWORD_CHANGE_REQUIRED")"请先修改初始密码"else"无权访问该电脑或账户";409->"电脑不在线或已绑定其他账户";429->"已达到请求或设备配额，请稍后重试";else->"云端服务暂时不可用"})
                if(continuation.isActive)continuation.resume(result)
            }catch(e:Exception){if(continuation.isActive)continuation.resumeWithException(e)}}}
        })}
    }
}
internal fun cloudError(error:Throwable):String=when(error){is DeckException->error.message;is IOException->"无法连接云端服务，正在等待网络恢复";else->"云端操作未完成，请重新检查"}
