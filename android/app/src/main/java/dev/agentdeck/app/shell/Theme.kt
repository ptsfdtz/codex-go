package dev.agentdeck.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Explicit neutral roles avoid Material's default violet tint in secondary text and controls.
private val lightDeckColors=lightColorScheme(
    primary=Color(0xFF0D0D0D),onPrimary=Color.White,
    primaryContainer=Color(0xFFECECEC),onPrimaryContainer=Color(0xFF0D0D0D),
    secondary=Color(0xFF5D5D5D),onSecondary=Color.White,
    secondaryContainer=Color(0xFFECECEC),onSecondaryContainer=Color(0xFF0D0D0D),
    tertiary=Color(0xFF5D5D5D),onTertiary=Color.White,
    background=Color.White,onBackground=Color(0xFF0D0D0D),
    surface=Color.White,onSurface=Color(0xFF0D0D0D),
    surfaceVariant=Color(0xFFF3F3F3),onSurfaceVariant=Color(0xFF6E6E6E),
    surfaceContainerLowest=Color.White,surfaceContainerLow=Color(0xFFF9F9F9),
    surfaceContainer=Color(0xFFF4F4F4),surfaceContainerHigh=Color(0xFFEFEFEF),
    surfaceContainerHighest=Color(0xFFECECEC),surfaceTint=Color.Transparent,
    inverseSurface=Color(0xFF2F2F2F),inverseOnSurface=Color.White,inversePrimary=Color.White,
    outline=Color(0xFFD1D1D1),outlineVariant=Color(0xFFE5E5E5),scrim=Color.Black,
)
private val darkDeckColors=darkColorScheme(
    primary=Color(0xFFF3F3F3),onPrimary=Color(0xFF0D0D0D),
    primaryContainer=Color(0xFF303030),onPrimaryContainer=Color(0xFFF3F3F3),
    secondary=Color(0xFFB4B4B4),onSecondary=Color(0xFF0D0D0D),
    secondaryContainer=Color(0xFF303030),onSecondaryContainer=Color(0xFFF3F3F3),
    tertiary=Color(0xFFB4B4B4),onTertiary=Color(0xFF0D0D0D),
    background=Color(0xFF212121),onBackground=Color(0xFFECECEC),
    surface=Color(0xFF212121),onSurface=Color(0xFFECECEC),
    surfaceVariant=Color(0xFF303030),onSurfaceVariant=Color(0xFFB4B4B4),
    surfaceContainerLowest=Color(0xFF171717),surfaceContainerLow=Color(0xFF171717),
    surfaceContainer=Color(0xFF303030),surfaceContainerHigh=Color(0xFF353535),
    surfaceContainerHighest=Color(0xFF2F2F2F),surfaceTint=Color.Transparent,
    inverseSurface=Color(0xFFECECEC),inverseOnSurface=Color(0xFF212121),inversePrimary=Color(0xFF0D0D0D),
    outline=Color(0xFF565656),outlineVariant=Color(0xFF3C3C3C),scrim=Color.Black,
)
@Composable fun DeckTheme(theme:String="system",content:@Composable ()->Unit){
    val dark=theme=="dark"||theme=="system"&&isSystemInDarkTheme()
    MaterialTheme(
        colorScheme=if(dark)darkDeckColors else lightDeckColors,
        typography=Typography(
            bodyLarge=TextStyle(fontSize=16.sp,lineHeight=26.sp),
            bodyMedium=TextStyle(fontSize=14.sp,lineHeight=22.sp),
            titleMedium=TextStyle(fontWeight=FontWeight.SemiBold,fontSize=18.sp,lineHeight=24.sp),
            labelLarge=TextStyle(fontWeight=FontWeight.Medium,fontSize=14.sp,lineHeight=20.sp),
        ),content=content,
    )
}
