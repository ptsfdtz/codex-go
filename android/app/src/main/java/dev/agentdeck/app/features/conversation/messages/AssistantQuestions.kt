package dev.agentdeck.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

/** Async message questions have no approval identity. Answers become an explicitly reviewed draft. */
@Composable internal fun AssistantQuestions(entry:ChatEntry,mask:String,repo:DeckRepository,sessionId:String){
    if(entry.kind!="assistant")return
    val questions=remember(entry.detail){runCatching{(wire.parseToJsonElement(entry.detail) as? JsonObject)?.get("questions") as? JsonArray}.getOrNull()}.orEmpty()
    if(questions.isEmpty())return
    val state=repo.state.value
    val key=ComposerKey(state.host?.hostId.orEmpty(),sessionId)
    var answers by remember(key,entry.id,questions){mutableStateOf(mapOf<Int,String>())}
    var current by remember(key,entry.id,questions){mutableIntStateOf(0)}
    var expanded by remember(key,entry.id){mutableStateOf(true)}
    val rows=questions.mapNotNull{it as? JsonObject}
    if(rows.isEmpty())return
    var optionSearch by remember(key,entry.id,current){mutableStateOf("")}
    var optionPage by remember(key,entry.id,current,optionSearch){mutableIntStateOf(0)}
    var reviewing by remember(key,entry.id,questions){mutableStateOf(false)}
    var reviewText by remember(key,entry.id,mask){mutableStateOf<Pair<String,String>?>(null)}
    val index=current.coerceIn(rows.indices)
    val question=rows[index]
    val title=(question["title"] as? JsonPrimitive)?.contentOrNull.orEmpty()
    OutlinedCard(Modifier.fillMaxWidth().padding(vertical=6.dp)){
        Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
            TextButton(onClick={expanded=!expanded}){Text("${if(expanded)"收起" else "展开"}异步问题 · ${questions.size}")}
            if(expanded){
                Text("问题 ${index+1} / ${rows.size} · 已填 ${answers.count{it.value.isNotBlank()}}",style=MaterialTheme.typography.labelMedium)
                Text(maskDisplay(title,mask),style=MaterialTheme.typography.bodyMedium)
                val options=(question["options"] as? JsonArray).orEmpty()
                if(options.size>12)OutlinedTextField(optionSearch,{optionSearch=it.take(200)},Modifier.fillMaxWidth(),singleLine=true,label={Text("查找本题选项")})
                val visible=options.mapNotNull{(it as? JsonPrimitive)?.contentOrNull}.filter{maskDisplay(it,mask).contains(optionSearch,true)}
                val pages=((visible.size+11)/12).coerceAtLeast(1)
                val selectedPage=optionPage.coerceIn(0,pages-1)
                if(pages>1)Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                    TextButton(onClick={optionPage=selectedPage-1},enabled=selectedPage>0){Text("上页选项")}
                    Text("${selectedPage+1} / $pages · ${visible.size} 项",style=MaterialTheme.typography.labelSmall)
                    TextButton(onClick={optionPage=selectedPage+1},enabled=selectedPage<pages-1){Text("下页选项")}
                }
                if(visible.isEmpty()&&options.isNotEmpty())Text("没有匹配选项，仍可自行填写。",style=MaterialTheme.typography.labelSmall)
                visible.drop(selectedPage*12).take(12).forEach{option->
                    FilterChip(selected=answers[index]==option,onClick={answers=answers+(index to option)},label={Text(maskDisplay(option,mask))})
                }
                OutlinedTextField(value=answers[index].orEmpty(),onValueChange={if(it.length<=16000)answers=answers+(index to it)},label={Text("准备回答")},modifier=Modifier.fillMaxWidth(),maxLines=5)
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                    TextButton(onClick={current=index-1},enabled=index>0){Text("上一题")}
                    TextButton(onClick={current=index+1},enabled=index<rows.lastIndex){Text("下一题")}
                }
                Text("这是消息中的异步问题。加入草稿不会提交审批或自动发送；请检查草稿，再发送或追加到当前任务。",style=MaterialTheme.typography.labelSmall)
                Button(onClick={reviewing=true},enabled=answers.any{it.key in rows.indices&&it.value.isNotBlank()}&&state.snapshot.sessions.any{it.sessionId==sessionId&&it.archived!=1}){Text("检查已填回答")}

            }
        }
    }
    if(reviewing)AlertDialog(onDismissRequest={reviewing=false},title={Text("检查异步问题回答")},text={
        LazyColumn(Modifier.fillMaxWidth().heightIn(max=420.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
            item{Text("仅将已填回答加入原会话草稿，不自动发送。空题保留未回答状态。",style=MaterialTheme.typography.bodySmall)}
            itemsIndexed(rows){i,row->
                val heading=(row["title"] as? JsonPrimitive)?.contentOrNull.orEmpty()
                Text("${i+1}. "+maskDisplay(heading,mask),style=MaterialTheme.typography.labelMedium)
                Text(maskDisplay(answers[i].orEmpty().ifBlank{"尚未回答"},mask).take(2000),style=MaterialTheme.typography.bodySmall)
                Row{
                    TextButton(onClick={current=i;reviewing=false}){Text("修改此题")}
                    if(answers[i].orEmpty().length>2000)TextButton(onClick={reviewText=heading to answers[i].orEmpty()}){Text("阅读完整回答")}
                }
            }
        }
    },confirmButton={TextButton(onClick={
        val now=repo.state.value
        if(now.host?.hostId!=key.hostId||now.snapshot.sessions.none{it.sessionId==sessionId&&it.archived!=1})repo.showMessage("原电脑或会话已变化，请重新核对。")
        else{
            val response=answers.filter{it.key in rows.indices&&it.value.isNotBlank()}.toSortedMap().entries.joinToString("\n\n"){(i,answer)->val heading=(rows[i]["title"] as? JsonPrimitive)?.contentOrNull.orEmpty();"$heading\n$answer"}
            val old=repo.composerDrafts[key]
            val merged=old.text+(if(old.text.isBlank()||old.text.endsWith("\n"))"" else "\n\n")+response
            if(merged.length>64000)repo.showMessage("回答与现有草稿合计超过 64000 字符，请先缩短内容。")
            else{repo.composerDrafts.edit(key){it.copy(text=merged)};answers=emptyMap();expanded=false;reviewing=false;repo.showMessage("回答已加入本会话草稿，请检查后发送。")}
        }
    },enabled=answers.any{it.value.isNotBlank()}){Text("加入原会话草稿")}},dismissButton={TextButton(onClick={reviewing=false}){Text("返回修改")}})

    reviewText?.let{(title,text)->LoadedTextReader(title,text,mask){reviewText=null}}

}
