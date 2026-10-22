package dev.agentdeck.app

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

internal data class MessageBlock(val text:String="",val language:String?=null,val node:org.commonmark.node.Node?=null)

/** Split the parsed document: links already resolved, nested fences remain inside their container. */
internal fun messageBlocks(document:org.commonmark.node.Node):List<MessageBlock>{
    val blocks=mutableListOf<MessageBlock>()
    var group=org.commonmark.node.Document()
    fun flush(){if(group.firstChild!=null){blocks+=MessageBlock(node=group);group=org.commonmark.node.Document()}}
    var child=document.firstChild
    while(child!=null){
        val next=child.next
        if(child is org.commonmark.node.FencedCodeBlock){
            flush()
            blocks+=MessageBlock(child.literal,child.info.orEmpty().take(120))
        }else group.appendChild(child)
        child=next
    }
    flush()
    return blocks
}
@Composable internal fun MessageCodeBlock(block:MessageBlock){
    val clipboard=LocalClipboardManager.current
    var expanded by remember(block.language){mutableStateOf(false)}
    var copied by remember(block){mutableStateOf(false)}
    fun copy(){clipboard.setText(AnnotatedString(block.text));copied=true}
    OutlinedCard(Modifier.fillMaxWidth().padding(vertical=6.dp)){
        Column{
            Row(Modifier.fillMaxWidth().padding(start=12.dp,end=4.dp),horizontalArrangement=Arrangement.SpaceBetween){
                Text(block.language.orEmpty().ifBlank{"代码"},Modifier.weight(1f).padding(top=14.dp),style=MaterialTheme.typography.labelSmall)
                TextButton(onClick={expanded=true}){Text("展开")}
                TextButton(onClick=::copy){Text(if(copied)"已复制" else "复制代码")}
            }
            HorizontalDivider()
            SelectionContainer(Modifier.fillMaxWidth().heightIn(max=260.dp).verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).padding(12.dp)){
                Text(block.text.ifEmpty{" "},fontFamily=FontFamily.Monospace,style=MaterialTheme.typography.bodySmall,softWrap=false)
            }
        }
    }
    if(expanded)Dialog(onDismissRequest={expanded=false},properties=DialogProperties(usePlatformDefaultWidth=false)){
        Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)){
            Column{
                Row(Modifier.fillMaxWidth().padding(start=16.dp),horizontalArrangement=Arrangement.SpaceBetween){
                    Text(block.language.orEmpty().ifBlank{"代码"},Modifier.weight(1f).padding(top=16.dp),style=MaterialTheme.typography.titleMedium)
                    TextButton(onClick=::copy){Text(if(copied)"已复制" else "复制代码")}
                    TextButton(onClick={expanded=false}){Text("关闭")}
                }
                HorizontalDivider()
                SelectionContainer(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).padding(16.dp)){
                    Text(block.text.ifEmpty{" "},fontFamily=FontFamily.Monospace,style=MaterialTheme.typography.bodySmall,softWrap=false)
                }
            }
        }
    }
}
