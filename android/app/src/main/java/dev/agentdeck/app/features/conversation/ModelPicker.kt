package dev.agentdeck.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

@Composable fun CodexModelPicker(state:DeckState,repo:DeckRepository,enabled:Boolean){
    var open by remember(state.host?.hostId){mutableStateOf(false)}
    val selected=state.models.find{it.model==state.selectedModel}?:state.models.firstOrNull{state.selectedModel.isEmpty()&&it.isDefault}
    val effort=state.selectedEffort.ifEmpty{selected?.defaultReasoningEffort.orEmpty()}
    val colors=MaterialTheme.colorScheme
    val shape=RoundedCornerShape(16.dp)
    Box{
        TextButton(onClick={open=true},enabled=enabled,contentPadding=PaddingValues(horizontal=8.dp)){
            Text(maskDisplay(selected?.displayName?:state.selectedModel.ifEmpty{"默认模型"},state.displayMask),fontSize=12.sp,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.weight(1f,fill=false).widthIn(max=140.dp))
            if(effort.isNotEmpty())Text(" · "+effortLabel(effort),fontSize=12.sp,maxLines=1)
            Icon(Icons.Outlined.ExpandMore,null,Modifier.size(16.dp))
        }
        DropdownMenu(
            expanded=open,onDismissRequest={open=false},shape=shape,
            containerColor=colors.surfaceContainerLow,tonalElevation=0.dp,shadowElevation=6.dp,
            modifier=Modifier.width(280.dp),
        ){
            Column(Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=4.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                val models=state.models
                if(models.isEmpty())Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                    Text("尚未获取模型",Modifier.weight(1f),style=MaterialTheme.typography.bodySmall,color=colors.onSurfaceVariant)
                    IconButton(onClick=repo::refreshModels,enabled=enabled){Icon(Icons.Outlined.Refresh,"刷新模型",Modifier.size(16.dp))}
                }
                else ComposerChoiceSlider(
                    label="模型",options=models.map{maskDisplay(it.displayName,state.displayMask)},
                    selected=models.indexOfFirst{it.model==selected?.model},enabled=enabled,onRefresh=repo::refreshModels,
                ){repo.selectModel(models[it])}
                val efforts=selected?.supportedReasoningEfforts.orEmpty()
                if(efforts.isNotEmpty()){
                    // A model change must reset an in-progress drag even when its effort labels match.
                    key(selected?.model){ComposerChoiceSlider(
                        label="思考强度",options=efforts.map{effortLabel(it.reasoningEffort)},
                        selected=efforts.indexOfFirst{it.reasoningEffort==effort},enabled=enabled,
                    ){repo.selectEffort(efforts[it].reasoningEffort)}}
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun ComposerChoiceSlider(label:String,options:List<String>,selected:Int,enabled:Boolean,onRefresh:(()->Unit)?=null,onSelect:(Int)->Unit){
    var position by remember(options,selected){mutableFloatStateOf(selected.coerceIn(options.indices).toFloat())}
    val index=position.roundToInt().coerceIn(options.indices)
    val colors=MaterialTheme.colorScheme
    val activeColor=colors.onSurface.copy(alpha=if(enabled)1f else .38f)
    val inactiveColor=colors.onSurface.copy(alpha=.14f)
    val rtl=LocalLayoutDirection.current==LayoutDirection.Rtl
    Column(Modifier.fillMaxWidth()){
        Row(Modifier.fillMaxWidth().heightIn(min=32.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
            Text(label,style=MaterialTheme.typography.labelMedium,color=colors.onSurfaceVariant)
            if(onRefresh!=null)IconButton(onClick=onRefresh,enabled=enabled,modifier=Modifier.size(32.dp)){
                Icon(Icons.Outlined.Refresh,"刷新模型",Modifier.size(14.dp),tint=colors.onSurfaceVariant)
            }
            Text(options[index],Modifier.weight(1f),fontSize=14.sp,fontWeight=FontWeight.Medium,color=activeColor,maxLines=1,overflow=TextOverflow.Ellipsis,textAlign=TextAlign.End)
        }
        if(options.size>1){
            Slider(
                value=position,onValueChange={position=it},
                onValueChangeFinished={onSelect(index)},enabled=enabled,
                valueRange=0f..options.lastIndex.toFloat(),steps=(options.size-2).coerceAtLeast(0),
                modifier=Modifier.fillMaxWidth().heightIn(min=48.dp).semantics{
                    contentDescription=label
                    stateDescription=options[index]
                },
                thumb={
                    Box(Modifier.size(14.dp).background(activeColor,CircleShape))
                },
                track={slider->
                    Canvas(Modifier.fillMaxWidth().height(14.dp)){
                        val fraction=(slider.value/options.lastIndex).coerceIn(0f,1f)
                        fun point(value:Float)=Offset(if(rtl)size.width*(1f-value) else size.width*value,center.y)
                        drawLine(inactiveColor,point(0f),point(1f),3.dp.toPx(),StrokeCap.Round)
                        drawLine(activeColor,point(0f),point(fraction),3.dp.toPx(),StrokeCap.Round)
                    }
                },
            )
        }else Spacer(Modifier.height(8.dp))
    }
}
