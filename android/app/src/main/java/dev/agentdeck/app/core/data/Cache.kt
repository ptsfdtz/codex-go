package dev.agentdeck.app

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Entity(tableName="host_cache") data class CachedHost(@PrimaryKey val hostId:String,val snapshot:String,val cursor:String,val syncedAt:String)
@Entity(tableName="event_cache",primaryKeys=["hostId","eventId"],indices=[Index(value=["hostId","sessionId","eventId"])]) data class CachedEvent(val hostId:String,val eventId:Long,val sessionId:String?,val json:String)
@Dao interface CacheDao {
    @Query("SELECT * FROM host_cache WHERE hostId=:hostId") suspend fun host(hostId:String):CachedHost?
    @Insert(onConflict=OnConflictStrategy.REPLACE) suspend fun saveHost(host:CachedHost)
    @Insert(onConflict=OnConflictStrategy.REPLACE) suspend fun saveEvents(events:List<CachedEvent>)
    @Query("SELECT * FROM event_cache WHERE hostId=:hostId AND sessionId=:sessionId ORDER BY eventId DESC LIMIT :limit") fun events(hostId:String,sessionId:String,limit:Int=2000):Flow<List<CachedEvent>>
    @Query("DELETE FROM event_cache WHERE hostId=:hostId AND eventId < (SELECT COALESCE(MAX(eventId),0)-20000 FROM event_cache WHERE hostId=:hostId)") suspend fun trim(hostId:String)
    @Query("DELETE FROM event_cache WHERE hostId=:hostId AND sessionId=:sessionId") suspend fun removeSession(hostId:String,sessionId:String)
    @Query("DELETE FROM host_cache WHERE hostId=:hostId") suspend fun removeHost(hostId:String)
    @Query("DELETE FROM event_cache WHERE hostId=:hostId") suspend fun removeEvents(hostId:String)
}
@Database(entities=[CachedHost::class,CachedEvent::class],version=1,exportSchema=true)
abstract class DeckDatabase:RoomDatabase(){abstract fun cache():CacheDao}
