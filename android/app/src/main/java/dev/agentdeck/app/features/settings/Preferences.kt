package dev.agentdeck.app

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import java.time.Instant
import java.time.Duration
import kotlinx.serialization.json.*

data class DeckPreferences(val theme:String="system",val notifications:Boolean=false)
class PreferenceStore(context:Context){
    private val prefs=context.getSharedPreferences("agentdeck_preferences",Context.MODE_PRIVATE)
    fun read()=DeckPreferences(prefs.getString("theme","system")?.takeIf{it in listOf("system","light","dark")}?:"system",prefs.getBoolean("notifications",false))
    fun save(value:DeckPreferences){require(value.theme in listOf("system","light","dark"));prefs.edit().putString("theme",value.theme).putBoolean("notifications",value.notifications).apply()}
}
class DeckNotifications(private val application:DeckApplication){
    private val manager=application.getSystemService(NotificationManager::class.java)
    fun permitted()=Build.VERSION.SDK_INT<33||application.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED
    fun publish(hostId:String,event:DeckEvent,enabled:Boolean){
        if(event.action=="approval.resolved"){
            val id=((event.payload as? JsonObject)?.get("approvalId") as? JsonPrimitive)?.takeIf{it.isString}?.content
            if(id!=null)cancelApprovals(hostId){it==id}
            return
        }
        if(!enabled||application.foreground||!permitted()||!manager.areNotificationsEnabled())return
        val now=Instant.now()
        val title=taskNotificationTitle(event,now)?:return
        val approval=pendingNotificationApproval(event,now)
        manager.createNotificationChannel(NotificationChannel("agentdeck_tasks","任务与审批",NotificationManager.IMPORTANCE_DEFAULT))
        val target=NotificationTarget.parse(hostId,event.sessionId)?:return
        val destination=taskNotificationIntent(application,target,event.eventId)
        val intent=PendingIntent.getActivity(application,0,destination,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        // Do not place prompts, paths, model output, or credentials on the lock screen.
        val builder=Notification.Builder(application,"agentdeck_tasks")
        if(approval!=null){
            builder.addExtras(android.os.Bundle().apply{putString("approvalHost",hostId);putString("approvalId",approval.approvalId)})
            builder.setTimeoutAfter(Duration.between(now,Instant.parse(approval.expiresAt)).toMillis().coerceAtLeast(1))
        }
        try{manager.notify(destination.data.toString(),0,builder.setSmallIcon(dev.agentdeck.app.R.drawable.ic_agentdeck).setContentTitle(title).setContentText("打开 AgentDeck 查看当前权威状态").setContentIntent(intent).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build())}catch(_:SecurityException){/* Permission may be revoked between checking and publishing. */}
    }
    fun reconcileApprovals(hostId:String,snapshot:Snapshot){
        if(snapshot.host?.hostId!=hostId)return
        val now=Instant.now()
        val active=snapshot.approvals.filter{notificationApprovalActive(it,now)}.map{it.approvalId}.toSet()
        cancelApprovals(hostId){it !in active}
    }
    private fun cancelApprovals(hostId:String,remove:(String)->Boolean){
        try{manager.activeNotifications.forEach{notification->
            val extras=notification.notification.extras
            val approval=extras.getString("approvalId")
            if(extras.getString("approvalHost")==hostId&&approval!=null&&remove(approval))manager.cancel(notification.tag,notification.id)
        }}catch(_:SecurityException){/* Notification access can change while reconciling. */}
    }
}

internal fun taskNotificationIntent(context:Context,target:NotificationTarget,eventId:String)=Intent(context,MainActivity::class.java).apply{
    action="dev.agentdeck.app.OPEN_TASK"
    data=android.net.Uri.Builder().scheme("agentdeck").authority("notification").appendPath(target.hostId).appendPath(target.sessionId).appendPath(eventId).build()
    putExtra("notificationHost",target.hostId);putExtra("notificationSession",target.sessionId)
    flags=Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
}
