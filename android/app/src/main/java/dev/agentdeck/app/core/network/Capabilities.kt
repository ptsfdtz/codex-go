package dev.agentdeck.app

import kotlinx.serialization.Serializable

/** Missing fields from older hosts remain unknown; never infer desktop parity. */
@Serializable data class BridgeRuntime(
    val mode:String="unknown",
    val sessionScope:String="unknown",
    val sharedDesktopRuntime:Boolean=false,
    val externalThreadSync:Boolean=false,
)
@Serializable data class BridgeCapabilities(
    val protocolVersion:Int,
    val capabilitiesVersion:Int=0,
    val codexVersion:String="",
    val upstreamReady:Boolean=false,
    val sandboxVerified:Boolean=false,
    val runtime:BridgeRuntime=BridgeRuntime(),
    val features:Map<String,Boolean> = emptyMap(),
    val limits:Map<String,Long> = emptyMap(),
) {
    fun supports(feature:String)=features[feature]==true
}
