package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*
import java.time.Instant

@Composable internal fun QuestionCard(approval:Approval,disabled:Boolean,onAnswer:(Approval,Map<String,String>)->Unit,onCancel:()->Unit){
    var answers by rememberSaveable(approval.approvalId){mutableStateOf(mapOf<String,String>())}
    var expired by remember(approval.expiresAt){mutableStateOf(false)}
    LaunchedEffect(approval.expiresAt){while(!expired){expired=runCatching{!Instant.parse(approval.expiresAt).isAfter(Instant.now())}.getOrDefault(true);kotlinx.coroutines.delay(1000)}}
    val enabled=!disabled&&!expired&&approval.status=="pending"
    val questions=approval.context["questions"]?.jsonArray.orEmpty()
    OutlinedCard{Column(Modifier.fillMaxWidth().padding(18.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
        Text("Codex 需要你的回答",style=MaterialTheme.typography.titleSmall)
        questions.forEach{item->
            val q=item.jsonObject
            val id=q.getValue("id").jsonPrimitive.content
            Text(q.getValue("question").jsonPrimitive.content)
            q["options"]?.takeIf{it!=JsonNull}?.jsonArray?.forEach{option->
                val value=option.jsonObject
                val label=value.getValue("label").jsonPrimitive.content
                val description=value["description"]?.jsonPrimitive?.content.orEmpty()
                FilterChip(selected=answers[id]==label,onClick={answers=answers+(id to label)},enabled=enabled,label={Column{Text(label);if(description.isNotBlank())Text(description,style=MaterialTheme.typography.bodySmall)}})
            }
            OutlinedTextField(value=answers[id].orEmpty(),onValueChange={if(it.length<=16000)answers=answers+(id to it)},enabled=enabled,label={Text("输入回答")},modifier=Modifier.fillMaxWidth(),visualTransformation=if(q["isSecret"]?.jsonPrimitive?.booleanOrNull==true)PasswordVisualTransformation()else VisualTransformation.None)
        }
        if(expired)Text("问题已过期")
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
            TextButton(onClick=onCancel,enabled=enabled){Text("跳过")}
            Button(onClick={onAnswer(approval,answers)},enabled=enabled&&questions.isNotEmpty()&&questions.all{!answers[it.jsonObject.getValue("id").jsonPrimitive.content].isNullOrBlank()}){Text("提交回答")}
        }
    }}
}
