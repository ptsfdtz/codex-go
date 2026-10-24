package dev.agentdeck.app

/** Transport metadata only: never log packets, URLs, credentials, or remote error text. */
internal object ConnectionDiagnostics {
    fun record(event:String,error:Throwable?=null){
        if(!BuildConfig.DEBUG)return
        val causes=error?.let{generateSequence(it){cause->cause.cause}.take(6).joinToString("/"){cause->
            cause.javaClass.simpleName+if(cause is DeckException&&cause.code.matches(Regex("[A-Z_]{1,64}")))":${cause.code}" else ""
        }}.orEmpty()
        runCatching{android.util.Log.i("DeckConnection","$event $causes")}
    }
}
