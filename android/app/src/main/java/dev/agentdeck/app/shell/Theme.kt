package dev.agentdeck.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Neutral surfaces and a single near-black accent, matching the mobile assistant
// reference: white canvas, soft grey composer, no Material tint.
private val lightDeckColors=lightColorScheme(
    primary=Color(0xFF0D0D0D),onPrimary=Color.White,
    primaryContainer=Color(0xFF0D0D0D),onPrimaryContainer=Color.White,
    secondary=Color(0xFF5D5D5D),onSecondary=Color.White,
    secondaryContainer=Color(0xFFF4F4F4),onSecondaryContainer=Color(0xFF0D0D0D),
    tertiary=Color(0xFF5D5D5D),onTertiary=Color.White,
    background=Color.White,onBackground=Color(0xFF0D0D0D),
    surface=Color.White,onSurface=Color(0xFF0D0D0D),
    surfaceVariant=Color(0xFFF4F4F4),onSurfaceVariant=Color(0xFF676767),
    surfaceContainerLowest=Color.White,surfaceContainerLow=Color(0xFFFAFAFA),
    surfaceContainer=Color(0xFFF4F4F4),surfaceContainerHigh=Color(0xFFEDEDED),
    surfaceContainerHighest=Color(0xFFE8E8E8),surfaceTint=Color.Transparent,
    inverseSurface=Color(0xFF2F2F2F),inverseOnSurface=Color.White,inversePrimary=Color.White,
    outline=Color(0xFFE3E3E3),outlineVariant=Color(0xFFF0F0F0),scrim=Color.Black,
)
private val darkDeckColors=darkColorScheme(
    primary=Color(0xFFF3F3F3),onPrimary=Color(0xFF0D0D0D),
    primaryContainer=Color(0xFFF3F3F3),onPrimaryContainer=Color(0xFF0D0D0D),
    secondary=Color(0xFFB4B4B4),onSecondary=Color(0xFF0D0D0D),
    secondaryContainer=Color(0xFF303030),onSecondaryContainer=Color(0xFFECECEC),
    tertiary=Color(0xFFB4B4B4),onTertiary=Color(0xFF0D0D0D),
    background=Color(0xFF212121),onBackground=Color(0xFFECECEC),
    surface=Color(0xFF212121),onSurface=Color(0xFFECECEC),
    surfaceVariant=Color(0xFF303030),onSurfaceVariant=Color(0xFFB4B4B4),
    surfaceContainerLowest=Color(0xFF171717),surfaceContainerLow=Color(0xFF1E1E1E),
    surfaceContainer=Color(0xFF303030),surfaceContainerHigh=Color(0xFF363636),
    surfaceContainerHighest=Color(0xFF3A3A3A),surfaceTint=Color.Transparent,
    inverseSurface=Color(0xFFECECEC),inverseOnSurface=Color(0xFF212121),inversePrimary=Color(0xFF0D0D0D),
    outline=Color(0xFF3C3C3C),outlineVariant=Color(0xFF2B2B2B),scrim=Color.Black,
)
@Composable fun DeckTheme(theme:String="system",content:@Composable ()->Unit){
    val dark=theme=="dark"||theme=="system"&&isSystemInDarkTheme()
    MaterialTheme(
        colorScheme=if(dark)darkDeckColors else lightDeckColors,
        typography=Typography(
            displaySmall=TextStyle(fontFamily=FontFamily.SansSerif,fontSize=28.sp,lineHeight=34.sp,fontWeight=FontWeight.SemiBold),
            headlineSmall=TextStyle(fontFamily=FontFamily.SansSerif,fontSize=24.sp,lineHeight=30.sp,fontWeight=FontWeight.SemiBold),
            titleLarge=TextStyle(fontFamily=FontFamily.SansSerif,fontSize=20.sp,lineHeight=26.sp,fontWeight=FontWeight.SemiBold),
            titleMedium=TextStyle(fontFamily=FontFamily.SansSerif,fontSize=17.sp,lineHeight=24.sp,fontWeight=FontWeight.SemiBold),
            bodyLarge=TextStyle(fontFamily=FontFamily.SansSerif,fontSize=16.sp,lineHeight=25.sp),
            bodyMedium=TextStyle(fontFamily=FontFamily.SansSerif,fontSize=14.sp,lineHeight=21.sp),
            bodySmall=TextStyle(fontFamily=FontFamily.SansSerif,fontSize=12.sp,lineHeight=18.sp),
            labelLarge=TextStyle(fontFamily=FontFamily.SansSerif,fontSize=15.sp,lineHeight=20.sp,fontWeight=FontWeight.Medium),
            labelMedium=TextStyle(fontFamily=FontFamily.SansSerif,fontSize=12.sp,lineHeight=16.sp,fontWeight=FontWeight.Medium),
            labelSmall=TextStyle(fontFamily=FontFamily.SansSerif,fontSize=11.sp,lineHeight=15.sp),
        ),content=content,
    )
}
