package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

/** Literal presentation-only masking. Never apply to an approval's authoritative operation. */
fun maskDisplay(text:String,mask:String):String=if(mask.length in 3..256)text.replace(mask,"[本地遮盖]")else text

@Composable internal fun DisplayMaskAction(mask:String,onChange:(String)->Unit){
    var open by remember{mutableStateOf(false)}
    DropdownMenuItem(text={Text(if(mask.isEmpty())"遮盖敏感文字" else "管理文字遮盖")},leadingIcon={Icon(Icons.Outlined.VisibilityOff,null)},onClick={open=true})
    if(open){
        // Do not use rememberSaveable: a user-entered sensitive fragment must not enter saved state.
        var draft by remember{mutableStateOf("")}
        AlertDialog(onDismissRequest={open=false},title={Text("本地临时遮盖")},text={Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
            Text("仅遮盖事件和 Diff 中完全相同的文字，不修改原始记录、缓存或审批内容。规则仅留在内存；应用进程重启后需重新设置。")
            if(mask.isNotEmpty()){Text("临时遮盖已启用");TextButton(onClick={onChange("");open=false}){Text("清除遮盖")}}
            OutlinedTextField(value=draft,onValueChange={if(it.length<=256)draft=it},label={Text("要遮盖的原文片段")},supportingText={Text("3–256 个字符，区分大小写；不作为正则表达式执行。")},singleLine=true,visualTransformation=PasswordVisualTransformation(),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Password,autoCorrectEnabled=false),modifier=Modifier.fillMaxWidth())
        }},confirmButton={Button(onClick={onChange(draft);open=false},enabled=draft.length in 3..256){Text(if(mask.isEmpty())"启用遮盖" else "替换遮盖")}},dismissButton={TextButton(onClick={open=false}){Text("取消")}})
    }
}
