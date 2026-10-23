package dev.agentdeck.app

/** Device memory only; no message content or cross-computer state. */
internal data class ConversationViewport(val anchor:String?,val index:Int,val offset:Int,val follow:Boolean)
internal class ConversationViewports {
    private val values=linkedMapOf<ComposerKey,ConversationViewport>()
    operator fun get(key:ComposerKey)=values[key]
    fun save(key:ComposerKey,value:ConversationViewport){
        if(key.hostId.isBlank()||key.conversation.startsWith("new:"))return
        values.remove(key);values[key]=value
        while(values.size>100)values.remove(values.keys.first())
    }
    fun forget(hostId:String){values.keys.removeAll{it.hostId==hostId}}
}
