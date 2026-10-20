package dev.agentdeck.app

enum class DiffLineKind { META, CONTEXT, ADDED, REMOVED }
data class DiffLine(val oldLine:Int?,val newLine:Int?,val text:String,val kind:DiffLineKind)

private val hunkHeader=Regex("^@@ -(\\d+)(?:,(\\d+))? \\+(\\d+)(?:,(\\d+))? @@.*$")

/** Source line numbers come only from valid unified hunks, never from output row positions. */
fun diffLines(text:String,untracked:Boolean=false):List<DiffLine>{
    if(text.isEmpty())return emptyList()
    val lines=text.removeSuffix("\n").split('\n')
    if(untracked)return lines.mapIndexed{index,line->DiffLine(null,index+1,line,DiffLineKind.ADDED)}
    var old=0;var new=0;var oldRemaining=0;var newRemaining=0
    return lines.map{line->
        val hunk=hunkHeader.matchEntire(line)
        if(hunk!=null){
            val values=listOf(hunk.groupValues[1],hunk.groupValues[2].ifEmpty{"1"},hunk.groupValues[3],hunk.groupValues[4].ifEmpty{"1"}).map{it.toIntOrNull()}
            val valid=values.all{it!=null} && values[0]!!.toLong()+values[1]!!<=Int.MAX_VALUE && values[2]!!.toLong()+values[3]!!<=Int.MAX_VALUE
            if(valid){old=values[0]!!;oldRemaining=values[1]!!;new=values[2]!!;newRemaining=values[3]!!}else{oldRemaining=0;newRemaining=0}
            DiffLine(null,null,line,DiffLineKind.META)
        }else when{
            line.startsWith("\\ No newline at end of file")->DiffLine(null,null,line,DiffLineKind.META)
            line.startsWith("-")&&oldRemaining>0->{oldRemaining--;DiffLine(old++,null,line,DiffLineKind.REMOVED)}
            line.startsWith("+")&&newRemaining>0->{newRemaining--;DiffLine(null,new++,line,DiffLineKind.ADDED)}
            line.startsWith(" ")&&oldRemaining>0&&newRemaining>0->{oldRemaining--;newRemaining--;DiffLine(old++,new++,line,DiffLineKind.CONTEXT)}
            else->{oldRemaining=0;newRemaining=0;DiffLine(null,null,line,DiffLineKind.META)}
        }
    }
}

fun filterGitFiles(files:List<GitFile>,query:String):List<GitFile>{
    val needle=query.trim()
    return if(needle.isEmpty())files else files.filter{it.path.contains(needle,ignoreCase=true)||it.oldPath?.contains(needle,ignoreCase=true)==true}
}
