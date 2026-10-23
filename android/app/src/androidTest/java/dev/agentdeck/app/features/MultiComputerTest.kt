package dev.agentdeck.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.activity.compose.setContent
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.room.Room
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

@RunWith(AndroidJUnit4::class)
class MultiComputerTest{
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    private val one=Host("https://192.0.2.1:49321","a".repeat(64),"multi-one","one","fixture-one",name="办公室电脑")
    private val two=Host("https://192.0.2.2:49321","b".repeat(64),"multi-two","two","fixture-two",name="家里电脑")

    @Test fun pickerSelectsSavedComputerAndCanAddAnother(){
        val selected=mutableStateOf(one);var adding=false
        compose.runOnUiThread{compose.activity.setContent{DeckTheme{ComputerPickerDialog(DeckState(host=selected.value,hosts=listOf(one,two)),onSelect={id->selected.value=listOf(one,two).first{it.hostId==id}},onAdd={adding=true},onDismiss={},onRename={id,name->if(selected.value.hostId==id)selected.value=selected.value.copy(name=name)})}}}
        compose.onNodeWithText("办公室电脑").assertIsDisplayed()
        compose.onNodeWithText("家里电脑").assertIsDisplayed()
        compose.onNodeWithTag("computer-multi-one").assertIsSelected()
        compose.onNodeWithTag("computer-multi-two").performClick()
        compose.onNodeWithTag("computer-multi-two").assertIsSelected()
        compose.onNodeWithTag("computer-multi-one").assertIsNotSelected()
        compose.onNodeWithText("添加电脑").performClick()
        compose.runOnIdle{assertTrue(adding)}
    }

    @Test fun draftsStayWithTheirComputerWhenProjectIdsMatch(){
        val selected=mutableStateOf(one)
        val repo=(compose.activity.application as DeckApplication).repository
        compose.runOnUiThread{compose.activity.setContent{DeckTheme{ChatWorkspace(DeckState(host=selected.value,selectedProject="shared-id",stale=true),repo,onInterrupt={})}}}
        compose.onNodeWithTag("chat-input").performTextInput("办公室草稿")
        compose.runOnIdle{selected.value=two}
        compose.onNodeWithTag("chat-input").assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.EditableText,androidx.compose.ui.text.AnnotatedString("")))
        compose.onNodeWithTag("chat-input").performTextInput("家里草稿")
        compose.runOnIdle{selected.value=one}
        compose.onNodeWithTag("chat-input").assertTextContains("办公室草稿")
        compose.onNodeWithContentDescription("发送消息").assertIsNotEnabled()
    }

    @Test fun removingOneComputersCacheKeepsTheOthersWithMatchingIds()=runBlocking{
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val db=Room.inMemoryDatabaseBuilder(context,DeckDatabase::class.java).build()
        try{
            val dao=db.cache()
            dao.saveHost(CachedHost(one.hostId,"first snapshot","1","now"))
            dao.saveHost(CachedHost(two.hostId,"second snapshot","1","now"))
            dao.saveEvents(listOf(CachedEvent(one.hostId,1,"same-session","first event"),CachedEvent(two.hostId,1,"same-session","second event")))
            assertEquals("first event",dao.events(one.hostId,"same-session").first().single().json)
            assertEquals("second event",dao.events(two.hostId,"same-session").first().single().json)
            dao.removeHost(one.hostId);dao.removeEvents(one.hostId)
            assertNull(dao.host(one.hostId))
            assertEquals("second snapshot",dao.host(two.hostId)?.snapshot)
            assertEquals("second event",dao.events(two.hostId,"same-session").first().single().json)
        }finally{db.close()}
    }

    @Test fun legacyEncryptedPairMigratesAndOtherComputerSurvivesRemoval(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val prefsName="agentdeck_multi_computer_test"
        val prefs=context.getSharedPreferences(prefsName,Context.MODE_PRIVATE)
        val vault=Vault(context,prefsName)
        vault.clear()
        try{
            val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
            val key=(store.getKey("AgentDeck.device.v1",null) as? SecretKey)?:KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply{
                init(KeyGenParameterSpec.Builder("AgentDeck.device.v1",KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
            }.generateKey()
            val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply{init(Cipher.ENCRYPT_MODE,key)}
            val bytes=cipher.doFinal(wire.encodeToString(Host.serializer(),one).toByteArray())
            assertTrue(prefs.edit().putString("iv",Base64.encodeToString(cipher.iv,Base64.NO_WRAP)).putString("host",Base64.encodeToString(bytes,Base64.NO_WRAP)).commit())
            assertEquals(one,vault.readBook().active)
            assertFalse(prefs.contains("host"));assertFalse(prefs.contains("iv"))
            vault.save(two)
            vault.saveBook(vault.readBook().selected(one.hostId))
            assertEquals(one,Vault(context,prefsName).read())
            assertEquals(2,Vault(context,prefsName).readBook().hosts.size)
            assertFalse(prefs.getString("hosts","")!!.contains("fixture-one"))
            vault.saveBook(vault.readBook().removed(one.hostId))
            assertEquals(two,Vault(context,prefsName).read())
        }finally{vault.clear()}
    }
}
