package dev.agentdeck.app

import androidx.compose.runtime.*
import java.net.URI
import java.net.URLDecoder

internal val LocalMessageLinkHandler=staticCompositionLocalOf<((String)->Boolean)?>{null}
internal val LocalNativeFilePreview=staticCompositionLocalOf<((String)->Unit)?>{null}
internal val LocalNativeAgentSessions=staticCompositionLocalOf<Map<String,Session>>{emptyMap()}
internal val LocalNativeSessionNavigation=staticCompositionLocalOf<((String)->Unit)?>{null}
internal data class ProjectLink(val path:String,val line:Int?=null,val endLine:Int?=null)

/** Navigation hint only. The PC still validates the granted root and actual file handle. */
internal fun projectMessageLink(link:String,root:String):ProjectLink?{
    if(link.length>8192||link.any{it.isISOControl()})return null
    var raw=link
    var line:Int?=null
    var end:Int?=null
    val fragment=raw.substringAfter('#',"")
    if('#' in raw){
        val range=Regex("L([1-9][0-9]*)(?:-L?([1-9][0-9]*))?").matchEntire(fragment)?:return null
        line=range.groupValues[1].toIntOrNull()?:return null
        end=range.groupValues[2].takeIf{it.isNotEmpty()}?.toIntOrNull()
        if(range.groupValues[2].isNotEmpty()&&end==null)return null
        if(end!=null&&end<line)return null
        raw=raw.substringBefore('#')
    }
    if(raw.startsWith("file:",true)){
        val uri=runCatching{URI(raw)}.getOrNull()?:return null
        if(!uri.authority.isNullOrEmpty()||uri.rawQuery!=null)return null
        raw=uri.rawPath?:return null
        if(Regex("^/[A-Za-z]:/.*").matches(raw))raw=raw.drop(1)
    }
    raw=runCatching{URLDecoder.decode(raw.replace("+","%2B"),"UTF-8")}.getOrNull()?:return null
    fun normalized(value:String)=value.replace('\\','/').removePrefix("//?/").trimEnd('/')
    var path=normalized(raw)
    val base=normalized(root)
    if(base.isEmpty()||path.isEmpty()||path.any{it.isISOControl()})return null
    // Desktop also emits path:line and path:line:column links.
    if(line==null){
        val suffix=Regex("^(.+?):([1-9][0-9]*)(?::[1-9][0-9]*)?$").matchEntire(path)
        if(suffix!=null){path=suffix.groupValues[1];line=suffix.groupValues[2].toIntOrNull()?:return null}
    }
    if(Regex("^[A-Za-z][A-Za-z0-9+.-]*:").containsMatchIn(path)&&!Regex("^[A-Za-z]:/.*").matches(path))return null
    val absolute=path.startsWith('/')||Regex("^[A-Za-z]:/").containsMatchIn(path)
    if(absolute){
        val windows=Regex("^[A-Za-z]:/").containsMatchIn(base)||base.startsWith("//")
        if(!path.startsWith("$base/",ignoreCase=windows))return null
        path=path.substring(base.length+1)
    }
    val parts=path.split('/')
    if(parts.any{it.isEmpty()||it=="."||it==".."||':' in it}||path.length>4096)return null
    return ProjectLink(path,line,end)
}

@Composable internal fun NativeMessageLinks(repo:DeckRepository,sessionId:String,content:@Composable ()->Unit){
    val state by repo.state.collectAsState()
    var preview by remember(state.host?.hostId,sessionId){mutableStateOf<ProjectLink?>(null)}
    val session=state.snapshot.sessions.find{it.sessionId==sessionId}
    val project=state.snapshot.projects.find{it.projectId==session?.projectId}
    val handler:(String)->Boolean={link->
        if(link.startsWith("https://",true)||link.startsWith("http://",true))false
        else{
            val target=project?.let{projectMessageLink(link,it.canonicalPath)}
            if(target==null)repo.showMessage("链接不是当前授权项目内可预览的文件。")
            else if(state.capabilities?.supports("projectTextPreview")!=true)repo.showMessage("当前电脑不支持文件预览。")
            else if(state.stale)repo.showMessage("连接电脑后可读取文件。")
            else preview=target
            true
        }
    }
    val agentSessions=remember(state.snapshot.sessions,state.snapshot.projects){
        val allowed=state.snapshot.projects.filter{it.enabled}.map{it.projectId}.toSet()
        state.snapshot.sessions.filter{it.projectId in allowed&&it.upstreamThreadId.isNotBlank()}.associateBy{it.upstreamThreadId}
    }
    val openFile:((String)->Unit)?=if(project!=null&&state.capabilities?.supports("projectTextPreview")==true){path->
        // Tool paths are literal filenames, not Markdown links: escape URI delimiters first.
        val encoded=path.replace("%","%25").replace("#","%23").replace("?","%3F").replace(" ","%20")
        val target=projectMessageLink(encoded,project.canonicalPath)
        if(target==null)repo.showMessage("文件不在当前授权项目内，无法预览。")
        else if(state.stale)repo.showMessage("连接电脑后可读取当前文件。")
        else preview=target
    }else null
    val navigate:(String)->Unit={id->
        val expected=agentSessions.values.find{it.sessionId==id}
        val now=repo.state.value
        if(expected!=null&&!now.busy&&now.host?.hostId==state.host?.hostId&&now.snapshot.sessions.any{it.sessionId==id&&it.upstreamThreadId==expected.upstreamThreadId&&it.projectId==expected.projectId}&&now.snapshot.projects.any{it.projectId==expected.projectId&&it.enabled})repo.selectSession(id)
        else repo.showMessage("会话、电脑或项目授权已变化，请重新选择。")
    }
    CompositionLocalProvider(LocalNativeFilePreview provides openFile,LocalMessageLinkHandler provides handler,LocalNativeAgentSessions provides agentSessions,LocalNativeSessionNavigation provides navigate){content()}
    preview?.let{target->project?.let{project->key(state.host?.hostId,sessionId,target){ProjectTextPreview(repo,state,project.projectId,target.path,target.line,target.endLine,onReference=if(session!=null&&session.archived!=1){{reference->
        val current=repo.state.value
        val key=ComposerKey(state.host?.hostId.orEmpty(),sessionId)
        val old=repo.composerDrafts[key]
        val updated=old.text+(if(old.text.isBlank()||old.text.endsWith("\n"))"" else "\n")+reference+" "
        if(current.host?.hostId!=state.host?.hostId||current.snapshot.sessions.none{it.sessionId==sessionId&&it.projectId==project.projectId&&it.archived!=1}){repo.showMessage("会话已变化，无法加入引用。");false}
        else if(updated.length>64000){repo.showMessage("加入引用后超过 64000 字符，请先缩短草稿。");false}
        else{repo.composerDrafts.edit(key){it.copy(text=updated)};true}
    }}else null){preview=null}}}}
}
