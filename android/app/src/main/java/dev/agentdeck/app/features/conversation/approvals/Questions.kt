package dev.agentdeck.app

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*
import java.time.Instant

@Composable internal fun QuestionCard(approval:Approval,disabled:Boolean,onAnswer:(Approval,Map<String,String>)->Unit,onCancel:()->Unit,mask:String=""){
    // User answers, including secrets, must not be serialized into saved-instance state.
    var answers by remember(approval.sessionId,approval.approvalId){mutableStateOf(mapOf<String,String>())}
    var current by remember(approval.sessionId,approval.approvalId){mutableIntStateOf(0)}
    var reviewing by remember(approval.sessionId,approval.approvalId){mutableStateOf(false)}
    var optionQuery by remember(approval.approvalId,current){mutableStateOf("")}
    var optionPage by remember(approval.approvalId,current,optionQuery){mutableIntStateOf(0)}
    var reviewPage by remember(approval.approvalId){mutableIntStateOf(0)}
    var reader by remember(approval.approvalId){mutableStateOf<Pair<String,String>?>(null)}
    var expired by remember(approval.expiresAt){mutableStateOf(false)}
    LaunchedEffect(approval.expiresAt){while(!expired){expired=runCatching{!Instant.parse(approval.expiresAt).isAfter(Instant.now())}.getOrDefault(true);if(!expired)kotlinx.coroutines.delay(1000)}}
    val enabled=!disabled&&!expired&&approval.status=="pending"
    val questions=(approval.context["questions"] as? JsonArray).orEmpty().mapNotNull{it as? JsonObject}
    val ids=questions.mapNotNull{(it["id"] as? JsonPrimitive)?.contentOrNull}
    val complete=questions.isNotEmpty()&&ids.size==questions.size&&ids.all{!answers[it].isNullOrBlank()}
    val answered=ids.count{!answers[it].isNullOrBlank()}
    LaunchedEffect(expired,approval.status){if(expired||approval.status!="pending"){answers=emptyMap();reviewing=false;reader=null}}
    OutlinedCard{Column(Modifier.fillMaxWidth().padding(18.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
        Text("Codex 需要你的回答",style=MaterialTheme.typography.titleSmall)
        if(questions.isEmpty())Text("当前请求未提供可回答的问题，请刷新会话核对。")
        else{
            Text("已回答 $answered / ${questions.size}",style=MaterialTheme.typography.labelMedium)
            if(questions.size>1)Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)){
                questions.forEachIndexed{index,question->val id=(question["id"] as? JsonPrimitive)?.contentOrNull.orEmpty()
                    FilterChip(selected=!reviewing&&current==index,onClick={current=index;reviewing=false},label={Text("${index+1}${if(!answers[id].isNullOrBlank())" ✓" else ""}")})
                }
            }
            if(reviewing){
                Text("检查回答",style=MaterialTheme.typography.titleMedium)
                val reviewCount=((questions.size+7)/8).coerceAtLeast(1)
                val reviewIndex=reviewPage.coerceIn(0,reviewCount-1)
                if(reviewCount>1)Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                    TextButton(onClick={reviewPage=reviewIndex-1},enabled=reviewIndex>0){Text("上一页")};Text("${reviewIndex+1} / $reviewCount");TextButton(onClick={reviewPage=reviewIndex+1},enabled=reviewIndex+1<reviewCount){Text("下一页")}
                }
                questions.drop(reviewIndex*8).take(8).forEachIndexed{offset,q->
                    val index=reviewIndex*8+offset
                    val id=q["id"]?.jsonPrimitive?.content.orEmpty()
                    val secret=q["isSecret"]?.jsonPrimitive?.booleanOrNull==true
                    OutlinedCard(Modifier.fillMaxWidth()) {Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
                        Text(maskDisplay("${index+1}. ${q["question"]?.jsonPrimitive?.content.orEmpty()}",mask).take(1800),maxLines=8,style=MaterialTheme.typography.bodyMedium)
                        Text(if(secret&&!answers[id].isNullOrEmpty())"已填写敏感回答（内容隐藏）" else maskDisplay(answers[id].orEmpty().ifBlank{"尚未回答"},mask).take(1800),maxLines=8,style=MaterialTheme.typography.bodySmall)
                        if(!secret&&(answers[id].orEmpty().length>1800||answers[id].orEmpty().count{it=='\n'}>=8))TextButton(onClick={reader="回答 ${index+1}" to answers[id].orEmpty()}){Text("阅读完整回答")}
                        TextButton(onClick={reader="问题正文" to q["question"]?.jsonPrimitive?.content.orEmpty()}){Text("阅读完整问题")}
                        TextButton(onClick={current=index;reviewing=false},enabled=enabled){Text("修改这一题")}
                    }}
                }
            }else{
                val q=questions[current.coerceIn(questions.indices)]
                val id=q["id"]?.jsonPrimitive?.content.orEmpty()
                val secret=q["isSecret"]?.jsonPrimitive?.booleanOrNull==true
                q["header"]?.jsonPrimitive?.contentOrNull?.takeIf{it.isNotBlank()}?.let{Text(maskDisplay(it,mask),style=MaterialTheme.typography.labelMedium)}
                val question=q["question"]?.jsonPrimitive?.content.orEmpty()
                Text(maskDisplay(question,mask).take(3000),maxLines=15)
                if(question.length>3000||question.count{it=='\n'}>=15)TextButton(onClick={reader="问题正文" to question}){Text("阅读完整问题")}
                val options=(q["options"] as? JsonArray).orEmpty().mapNotNull{it as? JsonObject}
                if(options.size>12)OutlinedTextField(optionQuery,{optionQuery=it.take(200)},Modifier.fillMaxWidth(),label={Text("搜索选项")},singleLine=true)
                val filtered=options.filter{maskDisplay(it.toString(),mask).contains(optionQuery,true)}
                val optionCount=((filtered.size+11)/12).coerceAtLeast(1)
                val optionIndex=optionPage.coerceIn(0,optionCount-1)
                if(options.size>12)Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                    TextButton(onClick={optionPage=optionIndex-1},enabled=optionIndex>0){Text("上一页")};Text("${optionIndex+1} / $optionCount · ${filtered.size} 项");TextButton(onClick={optionPage=optionIndex+1},enabled=optionIndex+1<optionCount){Text("下一页")}
                }
                if(options.isNotEmpty()&&filtered.isEmpty())Text("没有匹配的选项，仍可输入回答。")
                filtered.drop(optionIndex*12).take(12).forEach{value->
                    val label=value["label"]?.jsonPrimitive?.content.orEmpty()
                    val description=value["description"]?.jsonPrimitive?.content.orEmpty()
                    OutlinedCard(onClick={answers=answers+(id to label)},enabled=enabled,modifier=Modifier.fillMaxWidth()){
                        Row(Modifier.padding(10.dp)){
                            RadioButton(selected=answers[id]==label,onClick=null)
                            Column(Modifier.weight(1f).padding(start=8.dp)){
                                Text(maskDisplay(label,mask).take(1000),maxLines=5)
                                if(description.isNotBlank())Text(maskDisplay(description,mask).take(1800),maxLines=8,style=MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                    if(label.length>1000||description.length>1800)TextButton(onClick={reader="选项详情" to (label+"\n\n"+description)}){Text("阅读完整选项")}
                }
                OutlinedTextField(value=answers[id].orEmpty(),onValueChange={if(it.length<=16000)answers=answers+(id to it)},enabled=enabled,label={Text(if(secret)"敏感回答" else "输入回答")},modifier=Modifier.fillMaxWidth(),maxLines=6,keyboardOptions=if(secret)KeyboardOptions(keyboardType=KeyboardType.Password,autoCorrectEnabled=false)else KeyboardOptions.Default,visualTransformation=if(secret)PasswordVisualTransformation()else VisualTransformation.None)
                if(secret)Text("仅在当前界面内存保留，离开后可能需要重新填写。",style=MaterialTheme.typography.labelSmall)
                if(questions.size>1)Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                    TextButton(onClick={current--},enabled=current>0){Text("上一题")}
                    if(current<questions.lastIndex)TextButton(onClick={current++}){Text("下一题")}
                    else TextButton(onClick={reviewing=true},enabled=complete){Text("检查全部回答")}
                }
            }
        }
        if(expired)Text("问题已过期")
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
            TextButton(onClick=onCancel,enabled=enabled){Text("跳过")}
            Button(onClick={if(questions.size>1&&!reviewing)reviewing=true else onAnswer(approval,answers.filterKeys{it in ids})},enabled=enabled&&complete){Text(if(questions.size>1&&!reviewing)"检查回答" else "提交回答")}
        }
    }}
    reader?.let{(title,text)->LoadedTextReader(title,text,mask){reader=null}}
}
