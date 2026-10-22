package dev.agentdeck.app

import androidx.compose.runtime.*

internal data class WorkspaceDestination(val projectId:String,val sessionId:String?=null,val threadId:String?=null)
private data class WorkspaceTrail(val entries:List<WorkspaceDestination>,val index:Int)
/** Navigation metadata only, bounded and isolated by paired computer. */
internal class WorkspaceNavigation {
    private var trails by mutableStateOf(mapOf<String,WorkspaceTrail>())
    fun visit(host:String,target:WorkspaceDestination){
        val old=trails[host]?:WorkspaceTrail(emptyList(),-1)
        if(old.entries.getOrNull(old.index)==target)return
        val entries=(old.entries.take(old.index+1)+target).takeLast(80)
        trails=trails+(host to WorkspaceTrail(entries,entries.lastIndex))
    }
    fun destination(host:String,direction:Int,snapshot:Snapshot):WorkspaceDestination?{
        val trail=trails[host]?:return null
        var index=trail.index+direction
        while(index in trail.entries.indices){
            val target=trail.entries[index]
            if(snapshot.projects.any{it.projectId==target.projectId&&it.enabled}&&(target.sessionId==null||snapshot.sessions.any{it.sessionId==target.sessionId&&it.projectId==target.projectId&&it.upstreamThreadId==target.threadId}))return target
            index+=direction
        }
        return null
    }
    fun move(host:String,direction:Int,snapshot:Snapshot):WorkspaceDestination?{
        val target=destination(host,direction,snapshot)?:return null
        val old=trails[host]?:return null
        var index=old.index+direction
        while(index in old.entries.indices){if(old.entries[index]==target){trails=trails+(host to old.copy(index=index));return target};index+=direction}
        return null
    }
    fun forget(host:String){trails=trails-host}
}
