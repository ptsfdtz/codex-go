package dev.agentdeck.app

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import android.net.Uri
import androidx.core.content.FileProvider
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request

internal const val UPDATE_ORIGIN = "https://agent.ptsfdtz.top"
internal data class AppRelease(val versionName:String,val versionCode:Int,val file:String,val sha256:String)
internal fun parseAppRelease(text:String):AppRelease {
    val json=Json.parseToJsonElement(text).jsonObject
    val release=AppRelease(json.getValue("versionName").jsonPrimitive.content,json.getValue("versionCode").jsonPrimitive.int,json.getValue("file").jsonPrimitive.content,json.getValue("sha256").jsonPrimitive.content)
    require(release.versionCode>0 && release.versionName.length in 1..80)
    require(Regex("releases/[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}/AgentDeck-android.apk").matches(release.file) && !release.file.contains(".."))
    require(Regex("[a-f0-9]{64}").matches(release.sha256))
    return release
}

private val updateClient=OkHttpClient.Builder().connectTimeout(15,TimeUnit.SECONDS).readTimeout(60,TimeUnit.SECONDS).callTimeout(10,TimeUnit.MINUTES).followRedirects(false).followSslRedirects(false).build()
private fun requestUpdate(path:String)=updateClient.newCall(Request.Builder().url("$UPDATE_ORIGIN/$path").header("Cache-Control","no-cache").build()).execute().also{if(!it.isSuccessful){it.close();error("更新服务器暂时不可用（HTTP ${it.code}）")}}
private fun checkRelease():AppRelease=requestUpdate("android/stable.json").use{response->
    val bytes=java.io.ByteArrayOutputStream()
    requireNotNull(response.body).byteStream().use{input->
        val buffer=ByteArray(4096)
        while(true){val count=input.read(buffer);if(count<0)break;require(bytes.size()+count<=16384){"更新信息过大"};bytes.write(buffer,0,count)}
    }
    parseAppRelease(bytes.toString("UTF-8"))
}

private fun downloadRelease(context:Context,release:AppRelease):File {
    val directory=File(context.cacheDir,"updates").apply{mkdirs()}
    val file=File.createTempFile("update-",".apk",directory)
    try {
        val digest=MessageDigest.getInstance("SHA-256")
        requestUpdate(release.file).use{response->requireNotNull(response.body).byteStream().use{input->file.outputStream().use{output->
            val buffer=ByteArray(65536);var total=0L
            while(true){val count=input.read(buffer);if(count<0)break;total+=count;require(total<=256L*1024*1024){"更新包过大"};digest.update(buffer,0,count);output.write(buffer,0,count)}
        }}}
        require(digest.digest().joinToString(""){"%02x".format(it)}==release.sha256){"更新包校验失败"}
        @Suppress("DEPRECATION")
        val archive=context.packageManager.getPackageArchiveInfo(file.absolutePath,PackageManager.GET_SIGNING_CERTIFICATES)?:error("无效的安装包")
        @Suppress("DEPRECATION")
        val installed=context.packageManager.getPackageInfo(context.packageName,PackageManager.GET_SIGNING_CERTIFICATES)
        require(archive.packageName==context.packageName && archive.longVersionCode==release.versionCode.toLong() && archive.longVersionCode>installed.longVersionCode){"安装包身份或版本不匹配"}
        val signers=archive.signingInfo?.apkContentsSigners.orEmpty()
        val current=installed.signingInfo?.apkContentsSigners.orEmpty()
        require(signers.isNotEmpty() && signers.toSet()==current.toSet()){"更新包签名与当前应用不同，无法保留数据覆盖更新；请联系发布者"}
        return file
    } catch(e:Exception){file.delete();throw e}
}

@Composable fun AppUpdatesCard(){
    val context=LocalContext.current
    val scope=rememberCoroutineScope()
    var busy by remember{mutableStateOf(false)}
    var message by remember{mutableStateOf("")}
    var release by remember{mutableStateOf<AppRelease?>(null)}
    var apk by remember{mutableStateOf<File?>(null)}
    OutlinedCard{Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
        Text("应用更新",style=MaterialTheme.typography.titleMedium)
        Text("当前版本 ${BuildConfig.VERSION_NAME}（${BuildConfig.VERSION_CODE}）")
        Text("从 AgentDeck 官方服务器下载，校验完整性与应用签名，安装由 Android 系统确认。",style=MaterialTheme.typography.bodySmall)
        if(message.isNotBlank())Text(message)
        Button(enabled=!busy,onClick={scope.launch{
            busy=true;message="正在检查更新…";release=null;apk=null
            try{val latest=withContext(Dispatchers.IO){checkRelease()};if(latest.versionCode>BuildConfig.VERSION_CODE){release=latest;message="发现新版本 ${latest.versionName}（${latest.versionCode}）"}else message="当前已是最新版本"}
            catch(e:CancellationException){throw e}catch(_:Exception){message="检查失败，请检查网络或稍后重试"}finally{busy=false}
        }}){Text(if(busy)"请稍候…" else "检查更新")}
        release?.let{latest->Button(enabled=!busy,onClick={scope.launch{
            busy=true
            try{
                if(!context.packageManager.canRequestPackageInstalls()){
                    message="请允许此应用安装更新，然后返回点击下载并安装"
                    context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:${context.packageName}")))
                }else{
                    message="正在下载并校验…"
                    val file=apk?:withContext(Dispatchers.IO){downloadRelease(context,latest)}.also{apk=it}
                    val uri=FileProvider.getUriForFile(context,"${context.packageName}.updates",file)
                    context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                    message="请在系统窗口确认安装；取消后可再次点击安装"
                }
            }catch(e:CancellationException){throw e}catch(e:Exception){message=e.message?:"下载或安装失败，请重试"}finally{busy=false}
        }}){Text(if(apk==null)"下载并安装" else "安装更新")}}
    }}
}
