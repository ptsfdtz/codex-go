package dev.agentdeck.app

import android.text.method.LinkMovementMethod
import android.widget.TextView
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import io.noties.markwon.Markwon
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.MarkwonConfiguration
import io.noties.markwon.LinkResolver
import io.noties.markwon.ext.tables.TablePlugin

@Composable
internal fun MarkdownText(text: String, modifier: Modifier = Modifier, fontSizeSp: Float = 16f) {
    val context = LocalContext.current
    val handler by rememberUpdatedState(LocalMessageLinkHandler.current)
    var pending by remember{mutableStateOf<String?>(null)}
    var failure by remember{mutableStateOf<String?>(null)}
    val markwon = remember(context) {
        Markwon.builder(context)
            .usePlugin(TablePlugin.create(context))
            .usePlugin(object:AbstractMarkwonPlugin(){
                override fun configureConfiguration(builder:MarkwonConfiguration.Builder){
                    builder.linkResolver(LinkResolver{_,link->if(handler?.invoke(link)!=true){pending=link;failure=null}})
                }
            })
            .build()
    }
    val blocks=remember(markwon,text){messageBlocks(markwon.parse(text))}
    Column(modifier){blocks.forEachIndexed{index,block->key(index,block.language){
        if(block.language!=null)MessageCodeBlock(block)
        else block.node?.let{RenderMarkdown(markwon,it,fontSizeSp)}
    }}}

    pending?.let{link->
        val uri=runCatching{java.net.URI(link)}.getOrNull()
        val external=link.length<=8192&&link.none{it.isISOControl()}&&uri?.scheme?.lowercase() in listOf("https","http")&&!uri?.host.isNullOrBlank()&&uri?.rawUserInfo==null
        AlertDialog(onDismissRequest={pending=null},title={Text(if(external)"打开网页链接？" else "无法打开此链接")},text={Text(failure?:if(external)link else "此链接没有可用的项目文件或网页打开方式。")},confirmButton={
            if(external)TextButton(onClick={try{context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(link)));pending=null}catch(_:Exception){failure="没有可用的浏览器，或系统拒绝打开此链接。"}}){Text("在浏览器打开")}else TextButton(onClick={pending=null}){Text("关闭")}
        },dismissButton={if(external)TextButton(onClick={pending=null}){Text("取消")}})
    }
}

@Composable private fun RenderMarkdown(markwon:Markwon,node:org.commonmark.node.Node,fontSizeSp:Float){
    val textColor = MaterialTheme.colorScheme.onSurface
    val linkColor = MaterialTheme.colorScheme.primary
    val rendered=remember(markwon,node){markwon.render(node)}
    AndroidView(
        modifier = Modifier.fillMaxWidth().wrapContentHeight(),
        factory = { viewContext ->
            TextView(viewContext).apply {
                setTextIsSelectable(true)
                movementMethod = LinkMovementMethod.getInstance()
                includeFontPadding = false
                setPadding(0, 0, 0, 0)
                setLineSpacing(0f, 1.18f)
            }
        },
        update = { view ->
            view.setTextColor(textColor.toArgb())
            view.setLinkTextColor(linkColor.toArgb())
            view.textSize = fontSizeSp
            markwon.setParsedMarkdown(view, rendered)
        },
    )
}
