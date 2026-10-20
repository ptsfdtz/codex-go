package dev.agentdeck.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import okhttp3.Call
import java.io.File
import java.security.KeyStore
import java.time.Instant
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface ApiPersistence { fun read():ApiDocument; fun write(value:ApiDocument) }
class ApiSecureStore(context:Context):ApiPersistence{
    private val file=AtomicFile(File(context.filesDir,"api-conversations.encrypted"))
    private fun key():SecretKey{
        val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
        (store.getKey("AgentDeck.api.v1",null) as? SecretKey)?.let{return it}
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply{init(KeyGenParameterSpec.Builder("AgentDeck.api.v1",KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())}.generateKey()
    }
    @Synchronized override fun read():ApiDocument{
        if(!file.baseFile.exists())return ApiDocument()
        require(file.baseFile.length()<=4*1024*1024){"API 本地记录超过上限"}
        val data=file.readFully();require(data.size>12)
        val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,data.copyOfRange(0,12)))
        return wire.decodeFromString(ApiDocument.serializer(),cipher.doFinal(data.copyOfRange(12,data.size)).toString(Charsets.UTF_8))
    }
    @Synchronized override fun write(value:ApiDocument){
        val bytes=wire.encodeToString(ApiDocument.serializer(),value).toByteArray(Charsets.UTF_8)
        require(bytes.size<=3*1024*1024){"API 历史空间已满，请删除旧会话后重试"}
        val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());val data=cipher.iv+cipher.doFinal(bytes)
        val output=file.startWrite();try{output.write(data);file.finishWrite(output)}catch(e:Exception){file.failWrite(output);throw e}
    }
}
data class ApiState(val config:ApiConfig=ApiConfig(),val conversations:List<ApiConversation> = emptyList(),val selected:String?=null,val models:List<String> = emptyList(),val busy:Boolean=false,val loading:Boolean=true,val running:String?=null,val error:String?=null,val storageReady:Boolean=false,val modelNotice:String?=null)

class ApiRepository(private val store:ApiPersistence,private val client:ApiClient=ApiClient()){
    constructor(context:Context):this(ApiSecureStore(context))
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private val mutable=MutableStateFlow(ApiState())
    val state:StateFlow<ApiState> = mutable.asStateFlow()
    @Volatile private var call:Call?=null
    private var job:Job?=null
    init{scope.launch{try{val doc=store.read();val chats=doc.conversations.map{chat->chat.copy(messages=chat.messages.map{if(it.status=="running")it.copy(status="unknown") else it})};store.write(doc.copy(conversations=chats));mutable.value=ApiState(config=doc.config,conversations=chats,models=doc.models,loading=false,storageReady=true)}catch(_:Exception){mutable.value=ApiState(loading=false,error="无法解密 API 本地数据。记录未被覆盖，请检查设备 Keystore。")}}}
    private fun persist(){val current=mutable.value;store.write(ApiDocument(current.config,current.conversations,current.models))}
    private fun action(block:suspend()->Unit){synchronized(this){if(mutable.value.busy||!mutable.value.storageReady)return;mutable.update{it.copy(busy=true,error=null)};job=scope.launch{try{block()}catch(_:CancellationException){throw CancellationException()}catch(e:Exception){mutable.update{it.copy(error=safeError(e))}}finally{call=null;runCatching{persist()}.onFailure{mutable.update{it.copy(error="API 记录保存失败，请清理旧会话后重试")}};mutable.update{it.copy(busy=false,running=null)}}}}}
    private fun safeError(e:Exception)=when(e){is javax.net.ssl.SSLException->"API TLS 证书校验失败";is java.io.IOException->"API 网络中断或超时，回复可能未完成";is IllegalArgumentException,is IllegalStateException->e.message?.takeIf{!it.contains(mutable.value.config.key.takeIf(String::isNotEmpty)?:"\u0000") }?.take(180)?:"API 请求未完成";else->"API 请求未完成，请检查配置"}
    fun configure(base:String,key:String,model:String,effort:String){action{
        val normalized=apiBase(base).toString().trimEnd('/')
        val previous=mutable.value.config
        require(key.isNotBlank()||normalized==previous.baseUrl.trimEnd('/')){"更换 API 地址时请重新输入密钥，避免将旧密钥发送到另一主机"}
        require(effort in listOf("","none","minimal","low","medium","high","xhigh"))
        var config=ApiConfig(normalized,key.ifBlank{previous.key},model.trim(),effort)
        require(config.key.isNotBlank()){"请填写 API 密钥"}
        var notice:String?=null
        val models=try{client.models(config){call=it}}catch(e:Exception){
            if(e is CancellationException)throw e
            if(config.model.isBlank())throw IllegalStateException("获取对端模型失败，请检查地址和密钥，或手动填写模型 ID")
            notice="获取模型失败，已保留手动模型；可在模型菜单重试。"
            if(config.baseUrl==previous.baseUrl&&config.key==previous.key)mutable.value.models else emptyList()
        }
        currentCoroutineContext().ensureActive()
        if(config.model.isBlank())config=config.copy(model=models.first())
        val available=(models+config.model).distinct().sorted()
        store.write(ApiDocument(config,mutable.value.conversations,available))
        mutable.update{it.copy(config=config,models=available,modelNotice=notice?:"已获取并添加 ${models.size} 个对端模型")}
    }}
    fun models(){action{
        val config=mutable.value.config
        val models=client.models(config){call=it}
        currentCoroutineContext().ensureActive()
        mutable.update{it.copy(config=if(config.model.isBlank())config.copy(model=models.first()) else config,models=(models+listOfNotNull(config.model.takeIf(String::isNotBlank))).distinct().sorted(),modelNotice="已获取并添加 ${models.size} 个对端模型")}
    }}
    fun chooseModel(model:String){action{require(model in mutable.value.models);mutable.update{it.copy(config=it.config.copy(model=model))}}}
    fun chooseEffort(effort:String){action{require(effort in listOf("","none","minimal","low","medium","high","xhigh"));mutable.update{it.copy(config=it.config.copy(effort=effort))}}}
    fun select(id:String?){if(mutable.value.busy)return;mutable.update{it.copy(selected=id,error=null)}}
    fun manage(id:String,operation:String,title:String=""){action{
        mutable.update{state->state.copy(conversations=state.conversations.mapNotNull{chat->if(chat.id!=id)chat else when(operation){"rename"->{require(title.trim().length in 1..160);chat.copy(title=title.trim())};"archive"->chat.copy(archived=!chat.archived);"pin"->chat.copy(pinned=!chat.pinned);"delete"->null;else->error("不支持的会话操作")}},selected=if(operation=="delete"&&state.selected==id)null else state.selected)}
    }}
    fun send(text:String,onAccepted:()->Unit={}){action{
        require(text.trim().length in 1..64000)
        val config=mutable.value.config;require(config.key.isNotBlank()&&config.model.isNotBlank()){"请先配置 API 地址、密钥和模型"}
        val selected=mutable.value.selected
        val existing=mutable.value.conversations.find{it.id==selected}
        require(existing?.archived!=true){"请先恢复已归档会话"}
        require(existing!=null||mutable.value.conversations.size<100){"最多保留 100 个 chat 会话，请删除旧会话"}
        val chat=existing?:ApiConversation(UUID.randomUUID().toString(),text.take(40))
        require(chat.messages.size<500){"单个 chat 会话最多 500 条消息，请新建会话"}
        val user=ApiMessage(UUID.randomUUID().toString(),"user",text)
        val reply=ApiMessage(UUID.randomUUID().toString(),"assistant","",status="running")
        val updated=chat.copy(updatedAt=Instant.now().toString(),messages=chat.messages+user+reply)
        store.write(ApiDocument(config,mutable.value.conversations.filterNot{it.id==chat.id}+updated,mutable.value.models))
        mutable.update{it.copy(selected=chat.id,running=reply.id,conversations=it.conversations.filterNot{c->c.id==chat.id}+updated)}
        fun update(status:String?=null,delta:String=""){mutable.update{state->state.copy(conversations=state.conversations.map{c->if(c.id==chat.id)c.copy(messages=c.messages.map{m->if(m.id==reply.id)m.copy(text=m.text+delta,status=status?:m.status) else m}) else c})}}
        try{withContext(Dispatchers.Main){onAccepted()};client.chat(config,chat.messages+user,{call=it},{update(delta=it)});currentCoroutineContext().ensureActive();update(status="completed")}
        catch(e:Exception){update(status=if(e is CancellationException||call?.isCanceled()==true)"interrupted" else "failed");throw e}
    }}
    fun stop(){call?.cancel();job?.cancel()}
    fun clearError(){mutable.update{it.copy(error=null)}}
}
