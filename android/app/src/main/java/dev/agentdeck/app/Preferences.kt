package dev.agentdeck.app

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

data class DeckPreferences(val theme:String="system",val notifications:Boolean=false)
class PreferenceStore(context:Context){
    private val prefs=context.getSharedPreferences("agentdeck_preferences",Context.MODE_PRIVATE)
    fun read()=DeckPreferences(prefs.getString("theme","system")?.takeIf{it in listOf("system","light","dark")}?:"system",prefs.getBoolean("notifications",false))
    fun save(value:DeckPreferences){require(value.theme in listOf("system","light","dark"));prefs.edit().putString("theme",value.theme).putBoolean("notifications",value.notifications).apply()}
}
class DeckNotifications(private val application:DeckApplication){
    private val manager=application.getSystemService(NotificationManager::class.java)
    fun permitted()=Build.VERSION.SDK_INT<33||application.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED
    fun publish(event:DeckEvent,enabled:Boolean){
        if(!enabled||application.foreground||!permitted()||!manager.areNotificationsEnabled())return
        val title=when(event.action){"approval.requested"->"Codex 请求人工审批";"turn.completed"->"Codex 任务已完成";"turn.failed"->"Codex 任务失败";"turn.interrupted"->"Codex 任务已中断";else->return}
        manager.createNotificationChannel(NotificationChannel("agentdeck_tasks","任务与审批",NotificationManager.IMPORTANCE_DEFAULT))
        val intent=PendingIntent.getActivity(application,0,Intent(application,MainActivity::class.java),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        // Do not place prompts, paths, model output, or credentials on the lock screen.
        try{manager.notify(event.eventId.hashCode() and Int.MAX_VALUE,Notification.Builder(application,"agentdeck_tasks").setSmallIcon(dev.agentdeck.app.R.drawable.ic_agentdeck).setContentTitle(title).setContentText("打开 AgentDeck 查看当前权威状态").setContentIntent(intent).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build())}catch(_:SecurityException){/* Permission may be revoked between checking and publishing. */}
    }
}
