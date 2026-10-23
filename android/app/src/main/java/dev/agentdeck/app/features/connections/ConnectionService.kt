package dev.agentdeck.app

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/** User-enabled connection maintenance; Android can still stop the process. */
class ConnectionService:Service(){
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
    private val repository get()=(application as DeckApplication).repository
    override fun onBind(intent:Intent?):IBinder?=null
    override fun onCreate(){
        super.onCreate()
        val manager=getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL,"后台电脑连接",NotificationManager.IMPORTANCE_LOW))
        val initial=notification(0,0)
        if(Build.VERSION.SDK_INT>=29)startForeground(ID,initial,ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)else startForeground(ID,initial)
        scope.launch{repository.state.map{state->Triple(state.preferences.backgroundConnections,state.computerConnections.count{it.value.connection=="已连接"},state.hosts.size)}.distinctUntilChanged().collect{(enabled,online,total)->
            if(!enabled){stopSelf();return@collect}
            manager.notify(ID,notification(online,total))
        }}
    }
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int{
        if(intent?.action==STOP){repository.setBackgroundConnections(false);stopSelf();return START_NOT_STICKY}
        if(!repository.state.value.preferences.backgroundConnections){stopSelf();return START_NOT_STICKY}
        repository.checkConnection();return START_STICKY
    }
    override fun onDestroy(){scope.cancel();stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy()}
    private fun notification(online:Int,total:Int):Notification {
        val open=PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop=PendingIntent.getService(this,1,Intent(this,ConnectionService::class.java).setAction(STOP),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this,CHANNEL).setSmallIcon(R.drawable.ic_agentdeck).setContentTitle("AgentDeck 连接已保持")
            .setContentText("$online / $total 台电脑在线").setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE).addAction(Notification.Action.Builder(null,"停止后台保持",stop).build()).build()
    }
    companion object{private const val CHANNEL="agentdeck_connections";private const val ID=301;private const val STOP="dev.agentdeck.app.STOP_CONNECTIONS"}
}
