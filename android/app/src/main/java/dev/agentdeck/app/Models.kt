package dev.agentdeck.app

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import java.net.URI
import java.time.Instant

val wire = Json { ignoreUnknownKeys = true; encodeDefaults = true }
@Serializable data class Host(val endpoint:String,val fingerprint:String,val hostId:String,val deviceId:String,val credential:String,val name:String="")
@Serializable data class PairQr(val v:Int,val endpoint:String,val fingerprint:String,val token:String,val expiresAt:String,val hostId:String) {
    fun validated():PairQr {
        val uri=URI(endpoint)
        require(v==1 && uri.scheme=="https" && !uri.host.isNullOrBlank() && uri.userInfo==null && uri.query==null && uri.fragment==null && (uri.path.isNullOrEmpty()||uri.path=="/")) { "无效的 Bridge HTTPS 地址" }
        require(Regex("[a-f0-9]{64}").matches(fingerprint) && Regex("[A-Za-z0-9_-]{43}").matches(token)) { "配对信息格式错误" }
        require(Instant.parse(expiresAt).isAfter(Instant.now())) { "二维码已过期，请在 Windows 重新生成" }
        return this
    }
}
@Serializable data class Project(val projectId:String,val name:String,val canonicalPath:String,val enabled:Boolean=true,val createdAt:String="")
@Serializable data class Session(val sessionId:String,val projectId:String,val upstreamThreadId:String,val title:String,val status:String,val createdAt:String="",val updatedAt:String="",val archived:Int=0,val pinned:Int=0,val model:String="",val effort:String="",val mode:String="default",val upstream:JsonObject?=null)
@Serializable data class ReasoningOption(val reasoningEffort:String,val description:String="")
@Serializable data class CodexModel(val model:String,val displayName:String,val isDefault:Boolean=false,val defaultReasoningEffort:String="",val supportedReasoningEfforts:List<ReasoningOption> = emptyList())
@Serializable data class Turn(val turnId:String,val sessionId:String,val upstreamTurnId:String?=null,val status:String,val startedAt:String="",val endedAt:String?=null,val error:String?=null)
@Serializable data class Approval(val approvalId:String,val sessionId:String,val turnId:String,val method:String,val status:String,val context:JsonObject=JsonObject(emptyMap()),val createdAt:String="",val expiresAt:String,val allowedDecisions:List<String> = emptyList())
@Serializable data class HostState(val hostId:String,val status:String,val codexVersion:String)
@Serializable data class Snapshot(val cursor:String="0",val host:HostState?=null,val projects:List<Project> = emptyList(),val sessions:List<Session> = emptyList(),val turns:List<Turn> = emptyList(),val approvals:List<Approval> = emptyList())
@Serializable data class DeckEvent(val v:Int=1,val type:String="event",val eventId:String,val seq:Long,val sessionId:String?=null,val turnId:String?=null,val action:String,val payload:JsonElement=JsonNull,val ts:String)
@Serializable data class GitFile(val fileId:String,val path:String,val oldPath:String?=null,val index:String="",val worktree:String="",val untracked:Boolean=false,val link:Boolean=false)
@Serializable data class GitStatus(val available:Boolean=false,val files:List<GitFile> = emptyList(),val truncated:Boolean=false,val attribution:String="working-tree",val baseline:String?=null)
@Serializable data class Diff(val path:String="",val text:String="",val binary:Boolean=false,val truncated:Boolean=false,val attribution:String="working-tree",val untracked:Boolean=false)
@Serializable data class Retention(val days:Int=30,val maxMiB:Int=256)
data class DeckState(val connection:String="未配对",val host:Host?=null,val hosts:List<Host> = emptyList(),val snapshot:Snapshot=Snapshot(),val selectedProject:String?=null,val selectedSession:String?=null,val events:List<DeckEvent> = emptyList(),val git:GitStatus?=null,val diff:Diff?=null,val error:String?=null,val busy:Boolean=false,val stale:Boolean=true,val pairingCode:String?=null,val pairingName:String?=null,val lastSynced:String?=null,val preferences:DeckPreferences=DeckPreferences(),val retention:Retention=Retention(),val diagnostics:JsonObject?=null,val displayMask:String="",val models:List<CodexModel> = emptyList(),val selectedModel:String="",val selectedEffort:String="",val fullAccess:Boolean=true,val capabilities:BridgeCapabilities?=null,val observationPendingSession:String?=null)
class DeckException(val code:String,override val message:String):Exception(message)
fun payload(vararg pairs:Pair<String,String>):JsonObject=buildJsonObject { pairs.forEach { (key,value)->put(key,value) } }
fun statusLabel(status:String):String=when(status){"idle"->"就绪";"queued"->"正在提交";"running","inProgress"->"执行中";"waitingApproval"->"等待审批";"completed"->"已完成";"failed"->"失败";"interrupted"->"已中断";"unknown"->"状态未知 · 等待核对";else->status}
