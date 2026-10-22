package dev.agentdeck.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.SideEffect
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.core.view.WindowCompat

class MainActivity:ComponentActivity(){
    override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);openNotification(intent);enableEdgeToEdge();setContent{val model:DeckViewModel=viewModel();val state by model.state.collectAsStateWithLifecycle();val dark=state.preferences.theme=="dark"||state.preferences.theme=="system"&&isSystemInDarkTheme();SideEffect{WindowCompat.getInsetsController(window,window.decorView).apply{isAppearanceLightStatusBars=!dark;isAppearanceLightNavigationBars=!dark}};DeckTheme(theme=state.preferences.theme){DeckApp(state,model.repository)}}}
    override fun onNewIntent(intent:android.content.Intent){super.onNewIntent(intent);setIntent(intent);openNotification(intent)}
    private fun openNotification(intent:android.content.Intent?){
        if(intent?.action!="dev.agentdeck.app.OPEN_TASK")return
        val target=NotificationTarget.parse(intent.getStringExtra("notificationHost"),intent.getStringExtra("notificationSession"))?:return
        intent.action=null
        (application as DeckApplication).repository.openNotification(target)
    }
}
