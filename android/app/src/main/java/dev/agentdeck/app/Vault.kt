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

class Vault(context:Context){
    private val prefs=context.getSharedPreferences("agentdeck_secure",Context.MODE_PRIVATE)
    private val alias="AgentDeck.device.v1"
    private fun key():SecretKey {
        val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
        (store.getKey(alias,null) as? SecretKey)?.let{return it}
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply{init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build())}.generateKey()
    }
    fun save(host:Host){val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());val bytes=cipher.doFinal(wire.encodeToString(Host.serializer(),host).toByteArray());check(prefs.edit().putString("iv",Base64.encodeToString(cipher.iv,Base64.NO_WRAP)).putString("host",Base64.encodeToString(bytes,Base64.NO_WRAP)).commit())}
    fun read():Host?{val data=prefs.getString("host",null)?:return null;val iv=prefs.getString("iv",null)?:return null;val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,Base64.decode(iv,Base64.NO_WRAP)));return wire.decodeFromString(Host.serializer(),cipher.doFinal(Base64.decode(data,Base64.NO_WRAP)).toString(Charsets.UTF_8))}
    fun clear(){prefs.edit().clear().commit()}
}
