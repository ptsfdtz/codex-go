package dev.agentdeck.app

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import kotlinx.serialization.json.*

internal fun allowedWebLink(url:String):Boolean{
    if(url.length>8192||url.any{it.isISOControl()})return false
    val parsed=runCatching{java.net.URI(url)}.getOrNull()?:return false
    return parsed.scheme?.lowercase() in listOf("https","http")&&!parsed.host.isNullOrBlank()&&parsed.rawUserInfo==null
}

@Composable internal fun WebLinkButton(url:String,mask:String,label:String="打开网页"){
    val context=LocalContext.current
    var confirming by remember(url){mutableStateOf(false)}
    var error by remember(url){mutableStateOf<String?>(null)}
    if(!allowedWebLink(url))return
    TextButton(onClick={error=null;confirming=true}){Text(label)}
    if(confirming)AlertDialog(onDismissRequest={confirming=false},title={Text("打开网页链接？")},text={Column{
        SelectionContainer{Text(maskDisplay(url,mask),style=MaterialTheme.typography.bodySmall)}
        error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
    }},confirmButton={TextButton(onClick={try{context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(url)));confirming=false}catch(_:Exception){error="没有可用的浏览器，或系统拒绝打开此链接。"}}){Text("在浏览器打开")}},dismissButton={TextButton(onClick={confirming=false}){Text("取消")}})
}

@Composable internal fun NativeWebSearch(item:JsonObject?,fallback:String,mask:String){
    fun value(obj:JsonObject?,key:String)=(obj?.get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()
    @Composable fun field(label:String,text:String){if(text.isNotBlank()){
        Text(label,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        SelectionContainer{Text(maskDisplay(text,mask).take(24000),style=MaterialTheme.typography.bodySmall)}
        if(text.length>24000)Text("此项预览已截断，完整内容可查看原始记录。",style=MaterialTheme.typography.labelSmall)
    }}
    val action=item?.get("action") as? JsonObject
    when(value(action,"type")){
        "search"->{
            Text("搜索网页",style=MaterialTheme.typography.titleSmall)
            val queries=(listOf(value(item,"query"),value(action,"query"))+(action?.get("queries") as? JsonArray).orEmpty().mapNotNull{(it as? JsonPrimitive)?.contentOrNull}).filter{it.isNotBlank()}.distinct()
            if(queries.isEmpty())Text("上游未报告搜索词。",style=MaterialTheme.typography.bodySmall)
            queries.take(40).forEachIndexed{index,query->field("查询 ${index+1}",query)}
            if(queries.size>40)Text("显示前 40 条查询，完整内容可查看原始记录。",style=MaterialTheme.typography.labelSmall)
        }
        "openPage","findInPage"->{
            val finding=value(action,"type")=="findInPage"
            Text(if(finding)"页内查找" else "打开网页",style=MaterialTheme.typography.titleSmall)
            val url=value(action,"url")
            field("来源地址",url)
            if(finding)field("查找内容",value(action,"pattern"))
            if(url.isNotBlank()){
                WebLinkButton(url,mask,"在浏览器查看来源")
                if(!allowedWebLink(url))Text("此来源地址不支持在浏览器打开。",style=MaterialTheme.typography.labelSmall)
            }
        }
        else->{
            field("搜索词",value(item,"query"))
            field("搜索记录",action?.toString()?:fallback)
        }
    }
    // Some sources add results beyond the locked contract. Preserve, but do not invent a result schema.
    item?.get("results")?.takeUnless{it==JsonNull}?.let{field("原生附加结果",it.toString())}
}
