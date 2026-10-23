package dev.agentdeck.app

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.*

internal data class ComposerKey(val hostId:String,val conversation:String)
internal data class ComposerSkill(val id:String,val name:String)
internal data class ComposerDraft(
    val text:String="",
    val mode:String?=null,
    val attachments:List<ChatAttachment> = emptyList(),
    val skills:List<ComposerSkill> = emptyList(),
    val reading:Boolean=false,
    val revision:Long=0,
)

/** Application-memory drafts only: attachment bytes never enter Bundle, Room or preferences. */
internal class ComposerDrafts {
    private var values by mutableStateOf(mapOf<ComposerKey,ComposerDraft>())
    private val jobs=mutableMapOf<ComposerKey,Job>()
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
    operator fun get(key:ComposerKey)=values[key]?:ComposerDraft()
    fun edit(key:ComposerKey,change:(ComposerDraft)->ComposerDraft){
        val old=get(key)
        values=values+(key to change(old).copy(revision=old.revision+1))
    }
    fun entries(hostId:String)=values.entries.filter{(key,draft)->key.hostId==hostId&&(draft.text.isNotBlank()||draft.attachments.isNotEmpty()||draft.skills.isNotEmpty()||draft.reading)}.map{it.key to it.value}
    fun discard(key:ComposerKey,expectedRevision:Long):Boolean{
        val current=get(key)
        if(current.revision!=expectedRevision||current.reading)return false
        values=values-key
        return true
    }
    fun accepted(key:ComposerKey,sent:ComposerDraft,target:ComposerKey){
        // An acknowledgment must not remove edits made while the request was in flight.
        if(get(key).revision==sent.revision)values=values-key
        if(get(target).mode==null)edit(target){it.copy(mode=sent.mode)}
    }
    fun forget(hostId:String){
        jobs.keys.filter{it.hostId==hostId}.toList().forEach{jobs.remove(it)?.cancel()}
        values=values.filterKeys{it.hostId!=hostId}
    }
    fun read(context:Context,key:ComposerKey,uris:List<Uri>,onError:(String)->Unit){
        if(uris.isEmpty()||get(key).reading)return
        edit(key){it.copy(reading=true)}
        jobs[key]=scope.launch{
            try{
                val existing=get(key).attachments
                val added=withContext(Dispatchers.IO){readChatAttachments(context.applicationContext,uris,existing)}
                // Attachment removal during provider IO must not resurrect removed entries.
                edit(key){it.copy(attachments=it.attachments+added)}
            }catch(e:CancellationException){throw e}
            catch(e:Exception){onError(e.message?:"无法读取附件")}
            finally{if(values.containsKey(key))edit(key){it.copy(reading=false)};jobs.remove(key)}
        }
    }
}
