package dev.agentdeck.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable internal fun DiffPane(diff:Diff?,modifier:Modifier,displayMask:String=""){
    Surface(modifier.fillMaxHeight(),shape=RoundedCornerShape(16.dp)){
        if(diff==null)Box(Modifier.fillMaxSize(),contentAlignment=Alignment.Center){Column(Modifier.padding(20.dp)){Text("选择文件查看 Diff",fontWeight=FontWeight.Medium);Text("支持暂存、未暂存和未跟踪文件。",fontSize=13.sp)}}
        else{
            val lines=remember(diff.text,diff.untracked){diffLines(diff.text,diff.untracked)}
            Column{
                Text(diff.path,fontWeight=FontWeight.SemiBold,modifier=Modifier.padding(16.dp))
                if(diff.binary)Text("二进制文件 · 不显示内容",modifier=Modifier.padding(16.dp))
                if(diff.truncated)Text("内容超过限制，已截断。请在 Windows 查看完整文件。",color=MaterialTheme.colorScheme.error,fontSize=12.sp,modifier=Modifier.padding(12.dp))
                if(!diff.binary){
                    Text(if(diff.untracked)"未跟踪文件 · 新文件行号" else "旧行 / 新行 · 工作区变化，可能包含外部修改",fontSize=11.sp,modifier=Modifier.padding(horizontal=16.dp,vertical=6.dp))
                    if(lines.isEmpty())Text("空文件",fontSize=12.sp,modifier=Modifier.padding(16.dp))
                    SelectionContainer{LazyColumn(Modifier.fillMaxSize().testTag("git-diff-lines")){
                        itemsIndexed(lines){index,line->
                            Row(Modifier.fillMaxWidth().background(when(line.kind){DiffLineKind.ADDED->Color(0x18236B56);DiffLineKind.REMOVED->Color(0x18BE3A32);else->Color.Transparent}).padding(horizontal=8.dp,vertical=2.dp)){
                                Text(line.oldLine?.toString()?:"",modifier=Modifier.width(42.dp).testTag("diff-old-$index"),textAlign=TextAlign.End,fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,fontFamily=FontFamily.Monospace)
                                Text(line.newLine?.toString()?:"",modifier=Modifier.width(42.dp).padding(end=8.dp).testTag("diff-new-$index"),textAlign=TextAlign.End,fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,fontFamily=FontFamily.Monospace)
                                Text(maskDisplay(line.text,displayMask),modifier=Modifier.weight(1f),fontSize=12.sp,fontFamily=FontFamily.Monospace,lineHeight=18.sp)
                            }
                        }
                    }}
                }
            }
        }
    }
}
