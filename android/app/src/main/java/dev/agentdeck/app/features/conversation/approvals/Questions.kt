package dev.agentdeck.app

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.time.Instant

@Composable internal fun QuestionCard(approval:Approval,state:DeckState,repo:DeckRepository){
    val key=QuestionKey(state.host?.hostId.orEmpty(),approval.sessionId,approval.approvalId)
    val replies by repo.questionReplies.state.collectAsState()
    var expired by remember(approval.expiresAt){mutableStateOf(false)}
    LaunchedEffect(approval.expiresAt){while(!expired){expired=runCatching{!Instant.parse(approval.expiresAt).isAfter(Instant.now())}.getOrDefault(true);if(!expired)kotlinx.coroutines.delay(1000)}}
    QuestionPanel(key,approvalQuestions(approval),replies[key]?:QuestionReply(),state.stale||expired||approval.status!="pending",state.displayMask,true,
        onEdit={id,value->repo.questionReplies.edit(key,id,value)},onSubmit={repo.answerQuestions(key,approval)},onSkip={repo.answerQuestions(key,approval,true)},onRefresh={repo.checkQuestionReply(key)},
        unavailable=if(expired)"问题已过期" else null)
}

@Composable internal fun QuestionPanel(
    key:QuestionKey,questions:List<ReplyQuestion>,reply:QuestionReply,disabled:Boolean,mask:String,requireAll:Boolean,
    onEdit:(String,String)->Unit,onSubmit:()->Unit,onSkip:(()->Unit)?=null,onRefresh:()->Unit={},unavailable:String?=null,
){
    var current by remember(key){mutableIntStateOf(0)}
    var expanded by remember(key){mutableStateOf(true)}
    var query by remember(key,current){mutableStateOf("")}
    var page by remember(key,current,query){mutableIntStateOf(0)}
    var reader by remember(key){mutableStateOf<Pair<String,String>?>(null)}
    var typingCustom by remember(key,current){mutableStateOf(false)}
    val focus=LocalFocusManager.current
    val keyboard=LocalSoftwareKeyboardController.current
    val editing=reply.phase==ReplyPhase.Editing
    val enabled=editing&&!disabled
    val filled=questions.count{!reply.answers[it.id].isNullOrBlank()}
    val answered=filled+reply.submittedIds.size
    val complete=questions.isNotEmpty()&&if(requireAll)answered==questions.size else filled>0
    LaunchedEffect(reply.phase,reply.error){if(reply.phase!=ReplyPhase.Editing)expanded=false else if(reply.error!=null)expanded=true}
    fun submit(){focus.clearFocus();keyboard?.hide();onSubmit()}
    val caption=when(reply.phase){
        ReplyPhase.Editing->unavailable?:if(disabled)"连接恢复后可提交" else if(questions.size>1)"$answered / ${questions.size} 已回答" else "请选择或填写回答"
        ReplyPhase.Sending->"正在发送…"
        ReplyPhase.Sent->"已提交"
        ReplyPhase.Unknown->"等待确认"
        ReplyPhase.Unavailable->"已结束"
    }
    Surface(Modifier.fillMaxWidth().padding(vertical=6.dp).testTag("question-${key.requestId}").animateContentSize(),
        shape=RoundedCornerShape(20.dp),color=MaterialTheme.colorScheme.surfaceContainerLow,
        border=BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant.copy(alpha=.5f))){
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
            Row(Modifier.fillMaxWidth().clickable(enabled=reply.phase!=ReplyPhase.Sent){expanded=!expanded},verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)){
                if(reply.phase==ReplyPhase.Sending)CircularProgressIndicator(Modifier.size(18.dp),strokeWidth=2.dp)
                else Icon(if(reply.phase==ReplyPhase.Sent)Icons.Outlined.CheckCircle else Icons.Outlined.ChatBubbleOutline,null,Modifier.size(20.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
                Column(Modifier.weight(1f)){
                    Text(if(reply.phase==ReplyPhase.Sent)"已回答 Codex 的问题" else "Codex 需要你的回答",style=MaterialTheme.typography.titleSmall)
                    Text(caption,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if(reply.phase!=ReplyPhase.Sent)Icon(if(expanded)Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,if(expanded)"收起问题" else "展开问题",Modifier.size(20.dp))
            }
            if(expanded&&questions.isNotEmpty()&&reply.phase!=ReplyPhase.Sent){
                val index=current.coerceIn(questions.indices)
                val question=questions[index]
                val questionEnabled=enabled&&question.id !in reply.submittedIds
                if(questions.size>1)Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                    Text("${index+1} / ${questions.size}",Modifier.weight(1f),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    IconButton(onClick={current=index-1},enabled=index>0,modifier=Modifier.size(36.dp)){Icon(Icons.Outlined.ChevronLeft,"上一题")}
                    IconButton(onClick={current=index+1},enabled=index<questions.lastIndex,modifier=Modifier.size(36.dp)){Icon(Icons.Outlined.ChevronRight,"下一题")}
                }
                if(question.header.isNotBlank())Text(maskDisplay(question.header,mask),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                Text(maskDisplay(question.title,mask).take(3000),style=MaterialTheme.typography.bodyLarge,maxLines=15)
                if(question.title.length>3000||question.title.count{it=='\n'}>=15)TextButton(onClick={reader="问题正文" to question.title}){Text("阅读完整问题")}
                if(question.options.size>12)OutlinedTextField(query,{query=it.take(200)},Modifier.fillMaxWidth(),label={Text("搜索选项")},singleLine=true)
                val options=question.options.filter{maskDisplay(it.label+" "+it.description,mask).contains(query,true)}
                val pages=((options.size+11)/12).coerceAtLeast(1)
                val selectedPage=page.coerceIn(0,pages-1)
                options.drop(selectedPage*12).take(12).forEach{option->
                    val selected=reply.answers[question.id]==option.label
                    Surface(onClick={typingCustom=false;onEdit(question.id,option.label)},enabled=questionEnabled,shape=RoundedCornerShape(12.dp),
                        color=if(selected)MaterialTheme.colorScheme.surfaceContainerHighest else MaterialTheme.colorScheme.surface,
                        border=BorderStroke(1.dp,if(selected)MaterialTheme.colorScheme.onSurface.copy(alpha=.5f) else MaterialTheme.colorScheme.outlineVariant.copy(alpha=.5f))){
                        Row(Modifier.fillMaxWidth().padding(12.dp),horizontalArrangement=Arrangement.spacedBy(10.dp),verticalAlignment=Alignment.CenterVertically){
                            Icon(if(selected)Icons.Outlined.RadioButtonChecked else Icons.Outlined.RadioButtonUnchecked,null,Modifier.size(20.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
                            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){
                                Text(maskDisplay(option.label,mask).take(1000),style=MaterialTheme.typography.bodyMedium,fontWeight=if(selected)FontWeight.Medium else FontWeight.Normal,maxLines=5)
                                if(option.description.isNotBlank())Text(maskDisplay(option.description,mask).take(1800),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=8)
                            }
                        }
                    }
                    if(option.label.length>1000||option.description.length>1800)TextButton(onClick={reader="选项详情" to (option.label+"\n\n"+option.description)}){Text("阅读完整选项")}
                }
                if(pages>1)Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                    TextButton(onClick={page=selectedPage-1},enabled=selectedPage>0){Text("上一页")}
                    Text("${selectedPage+1} / $pages",style=MaterialTheme.typography.labelSmall)
                    TextButton(onClick={page=selectedPage+1},enabled=selectedPage<pages-1){Text("下一页")}
                }
                val answer=reply.answers[question.id].orEmpty()
                val custom=if(typingCustom)answer else answer.takeUnless{value->question.options.any{it.label==value}}.orEmpty()
                if(question.id in reply.submittedIds)Text("此题已提交",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                else OutlinedTextField(value=custom,onValueChange={typingCustom=true;onEdit(question.id,it)},enabled=questionEnabled,
                    label={Text(if(question.secret)"敏感回答" else if(question.options.isEmpty())"你的回答" else "其他回答")},
                    modifier=Modifier.fillMaxWidth().testTag("question-answer-${question.id}"),shape=RoundedCornerShape(12.dp),maxLines=6,
                    keyboardOptions=if(question.secret)KeyboardOptions(keyboardType=KeyboardType.Password,autoCorrectEnabled=false)else KeyboardOptions.Default,
                    visualTransformation=if(question.secret)PasswordVisualTransformation()else VisualTransformation.None)
                if(question.secret)Text("敏感内容仅保留在内存中",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
                    if(onSkip!=null)TextButton(onClick={focus.clearFocus();keyboard?.hide();onSkip()},enabled=enabled){Text("跳过")}
                    Spacer(Modifier.weight(1f))
                    if(questions.size>1&&index<questions.lastIndex&&!complete)TextButton(onClick={current=index+1}){Text("下一题")}
                    Button(onClick=::submit,enabled=enabled&&complete,shape=RoundedCornerShape(50)){Text("提交回答")}
                }
            }
            if(questions.isEmpty()&&editing)Text("当前问题暂不可用，请刷新会话。",style=MaterialTheme.typography.bodySmall)
            reply.error?.let{Text(maskDisplay(it,mask),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
            if(reply.phase==ReplyPhase.Unknown)TextButton(onClick=onRefresh,enabled=!disabled){Text("核对会话")}
        }
    }
    reader?.let{(title,text)->LoadedTextReader(title,text,mask){reader=null}}
}
