package dev.agentdeck.app

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import java.io.ByteArrayOutputStream

data class ChatAttachment(val name:String,val data:String,val size:Int)

/** Read a bounded amount even when the document provider reports an incorrect size. */
internal fun readChatAttachments(context:Context,uris:List<Uri>,existing:List<ChatAttachment>):List<ChatAttachment>{
    require(existing.size+uris.size<=4){"最多添加 4 个附件"}
    var remaining=512*1024-existing.sumOf{it.size}
    return uris.map{uri->
        val displayName=context.contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use{cursor->
            if(cursor.moveToFirst())cursor.getString(0) else null
        }?:"attachment"
        val name=displayName.replace(Regex("[\\x00-\\x1f<>:\"/\\\\|?*]"),"_").take(120).trimEnd('.',' ').ifBlank{"attachment"}
        val bytes=context.contentResolver.openInputStream(uri)?.use{stream->
            val output=ByteArrayOutputStream()
            val buffer=ByteArray(8192)
            while(output.size()<=remaining){
                val count=stream.read(buffer,0,minOf(buffer.size,remaining+1-output.size()))
                if(count<0)break
                if(count==0)error("无法读取附件")
                output.write(buffer,0,count)
            }
            output.toByteArray()
        }?:error("无法读取附件")
        require(bytes.size<=remaining){"附件总大小不能超过 512 KB"}
        remaining-=bytes.size
        ChatAttachment(name,Base64.encodeToString(bytes,Base64.NO_WRAP),bytes.size)
    }
}
