package dev.agentdeck.app

import androidx.compose.runtime.*

@Composable internal fun AssistantQuestions(entry:ChatEntry,mask:String,repo:DeckRepository,sessionId:String){
    val questions=remember(entry.detail){messageQuestions(entry)}
    if(questions.isEmpty())return
    val state by repo.state.collectAsState()
    val key=QuestionKey(state.host?.hostId.orEmpty(),sessionId,entry.id)
    val replies by repo.questionReplies.state.collectAsState()
    val session=state.snapshot.sessions.find{it.sessionId==sessionId}
    QuestionPanel(key,questions,replies[key]?:QuestionReply(),state.stale||session==null||session.archived==1,mask,false,
        onEdit={id,value->repo.questionReplies.edit(key,id,value)},onSubmit={repo.answerMessageQuestions(key,entry)},onRefresh={repo.checkQuestionReply(key)},
        unavailable=if(session==null)"原会话已不可用" else if(session.archived==1)"此会话已归档" else null)
}
