package dev.agentdeck.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class Vault(context:Context,prefsName:String="agentdeck_secure"){
    private val prefs=context.getSharedPreferences(prefsName,Context.MODE_PRIVATE)
    private val alias="AgentDeck.device.v1"
    private fun key():SecretKey {
        val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
        (store.getKey(alias,null) as? SecretKey)?.let{return it}
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply{init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build())}.generateKey()
    }
    @Synchronized fun saveBook(book:HostBook){val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());val bytes=cipher.doFinal(wire.encodeToString(HostBook.serializer(),book).toByteArray());check(prefs.edit().putString("hosts_iv",Base64.encodeToString(cipher.iv,Base64.NO_WRAP)).putString("hosts",Base64.encodeToString(bytes,Base64.NO_WRAP)).remove("iv").remove("host").commit())}
    private fun decrypt(data:String,iv:String):String{val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,Base64.decode(iv,Base64.NO_WRAP)));return cipher.doFinal(Base64.decode(data,Base64.NO_WRAP)).toString(Charsets.UTF_8)}
    @Synchronized fun readBook():HostBook{
        prefs.getString("hosts",null)?.let{return wire.decodeFromString(HostBook.serializer(),decrypt(it,requireNotNull(prefs.getString("hosts_iv",null))))}
        val legacy=prefs.getString("host",null)?:return HostBook()
        val host=wire.decodeFromString(Host.serializer(),decrypt(legacy,requireNotNull(prefs.getString("iv",null))))
        return HostBook(listOf(host),host.hostId).also{saveBook(it)}
    }
    @Synchronized fun save(host:Host){saveBook(readBook().paired(host))}
    fun read():Host?=readBook().active
    @Synchronized fun clear(){check(prefs.edit().clear().commit())}
}
