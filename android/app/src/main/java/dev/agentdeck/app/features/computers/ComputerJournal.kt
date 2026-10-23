package dev.agentdeck.app

import androidx.room.withTransaction

/** One durable checkpoint per computer, independent of UI selection. */
internal interface ComputerJournal {
    suspend fun host(hostId:String):CachedHost?
    suspend fun snapshot(hostId:String,snapshot:Snapshot,cursor:String,at:String,reset:Boolean,removed:List<String>)
    suspend fun event(hostId:String,snapshot:Snapshot?,event:DeckEvent,at:String)
    suspend fun trim(hostId:String)
}

internal class RoomComputerJournal(private val db:DeckDatabase):ComputerJournal {
    private val dao=db.cache()
    override suspend fun host(hostId:String)=dao.host(hostId)
    override suspend fun snapshot(hostId:String,snapshot:Snapshot,cursor:String,at:String,reset:Boolean,removed:List<String>){
        db.withTransaction{
            if(reset)dao.removeEvents(hostId)
            removed.forEach{dao.removeSession(hostId,it)}
            dao.saveHost(CachedHost(hostId,wire.encodeToString(Snapshot.serializer(),snapshot),cursor,at))
        }
    }
    override suspend fun event(hostId:String,snapshot:Snapshot?,event:DeckEvent,at:String){
        db.withTransaction{
            if(event.action=="session.historyChanged"&&event.sessionId!=null)dao.removeSession(hostId,event.sessionId)
            dao.saveEvents(listOf(CachedEvent(hostId,event.eventId.toLong(),event.sessionId,wire.encodeToString(DeckEvent.serializer(),event))))
            if(snapshot!=null)dao.saveHost(CachedHost(hostId,wire.encodeToString(Snapshot.serializer(),snapshot),event.eventId,at))
        }
    }
    override suspend fun trim(hostId:String){dao.trim(hostId)}
}
