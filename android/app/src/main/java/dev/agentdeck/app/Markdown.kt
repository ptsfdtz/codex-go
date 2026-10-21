package dev.agentdeck.app

import android.text.method.LinkMovementMethod
import android.widget.TextView
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import io.noties.markwon.Markwon
import io.noties.markwon.ext.tables.TablePlugin

@Composable
internal fun MarkdownText(text: String, modifier: Modifier = Modifier, fontSizeSp: Float = 15f) {
    val context = LocalContext.current
    val textColor = MaterialTheme.colorScheme.onSurface
    val linkColor = MaterialTheme.colorScheme.primary
    val markwon = remember(context) {
        Markwon.builder(context)
            .usePlugin(TablePlugin.create(context))
            .build()
    }
    val rendered = remember(markwon, text) { markwon.toMarkdown(text) }

    AndroidView(
        modifier = modifier.fillMaxWidth().wrapContentHeight(),
        factory = { viewContext ->
            TextView(viewContext).apply {
                setTextIsSelectable(true)
                movementMethod = LinkMovementMethod.getInstance()
                includeFontPadding = false
                setPadding(0, 0, 0, 0)
                setLineSpacing(0f, 1.18f)
            }
        },
        update = { view ->
            view.setTextColor(textColor.toArgb())
            view.setLinkTextColor(linkColor.toArgb())
            view.textSize = fontSizeSp
            markwon.setParsedMarkdown(view, rendered)
        },
    )
}
