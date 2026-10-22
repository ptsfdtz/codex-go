package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

internal fun skillText(row:JsonObject,key:String)=(row[key] as? JsonPrimitive)?.contentOrNull.orEmpty()
internal fun skillScope(value:String)=when(value){"user"->"用户";"repo"->"项目";"system"->"系统";"admin"->"管理员";else->value.ifBlank{"未报告范围"}}
internal fun matchesSkill(row:JsonObject,query:String,mask:String):Boolean{
    val body=maskDisplay(listOf("name","displayName","shortDescription","description").joinToString(" "){skillText(row,it)},mask)
    return query.trim().split(Regex("\\s+")).filter{it.isNotBlank()}.all{body.contains(it,true)}
}
@Composable internal fun SkillDetails(row:JsonObject,mask:String,onClose:()->Unit){
    AlertDialog(onDismissRequest=onClose,title={Text(maskDisplay(skillText(row,"displayName").ifBlank{skillText(row,"name")},mask))},text={Column(Modifier.heightIn(max=480.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)){
        Text("${if(row["enabled"]?.jsonPrimitive?.booleanOrNull==true)"已启用" else "已禁用"} · ${skillScope(skillText(row,"scope"))}",style=MaterialTheme.typography.labelSmall)
        SelectionContainer{Text(maskDisplay(skillText(row,"name"),mask),style=MaterialTheme.typography.bodySmall)}
        val short=skillText(row,"shortDescription")
        val description=skillText(row,"description")
        if(short.isNotBlank())SelectionContainer{Text(maskDisplay(short,mask),style=MaterialTheme.typography.bodyMedium)}
        if(description.isNotBlank()&&description!=short)SelectionContainer{Text(maskDisplay(description,mask),style=MaterialTheme.typography.bodySmall)}
        if(short.isBlank()&&description.isBlank())Text("原生目录未提供技能说明。")
        Text("说明来自电脑技能目录，可能为有界摘要；不读取完整指令、不安装或执行技能。启用状态以刷新及发送时电脑核验为准。",style=MaterialTheme.typography.labelSmall)
    }},confirmButton={TextButton(onClick=onClose){Text("关闭")}})
}
