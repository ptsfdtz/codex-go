package dev.agentdeck.app

import android.app.PendingIntent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NotificationIntentTest {
    @Test fun sameEventOnDifferentComputersKeepsIndependentPendingIntents(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val first=taskNotificationIntent(context,NotificationTarget("one","same-task"),"42")
        val second=taskNotificationIntent(context,NotificationTarget("two","same-task"),"42")
        val next=taskNotificationIntent(context,NotificationTarget("one","other-task"),"42")
        assertFalse(first.filterEquals(second))
        assertFalse(first.filterEquals(next))
        assertEquals("one",first.getStringExtra("notificationHost"))
        assertEquals("same-task",first.getStringExtra("notificationSession"))
        assertEquals(setOf("notificationHost","notificationSession"),first.extras!!.keySet())
        val flags=PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val a=PendingIntent.getActivity(context,0,first,flags)
        val b=PendingIntent.getActivity(context,0,second,flags)
        try{
            assertNotEquals(a,b)
            assertEquals(a,PendingIntent.getActivity(context,0,first,flags))
        }finally{a.cancel();b.cancel()}
    }
}
