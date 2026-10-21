//! Describes implemented Bridge behavior, not the desktop application's feature set.
use serde_json::{json, Value};

pub fn describe(upstream_ready: bool, sandbox_verified: bool) -> Value {
    describe_runtime(upstream_ready, sandbox_verified, false)
}
pub fn describe_runtime(upstream_ready: bool, sandbox_verified: bool, attached: bool) -> Value {
    describe_profile(
        upstream_ready,
        sandbox_verified,
        attached,
        crate::rpc::ProtocolVersion::Managed,
    )
}
pub fn describe_profile(
    upstream_ready: bool,
    sandbox_verified: bool,
    attached: bool,
    protocol: crate::rpc::ProtocolVersion,
) -> Value {
    json!({
        "protocolVersion": 1,
        "capabilitiesVersion": 1,
        "codexVersion": protocol.version(),
        "concurrency": 2,
        "approvals": ["command", "fileChange", "permissions"],
        "sandboxVerified": sandbox_verified,
        "upstreamReady": upstream_ready,
        "runtime": {
            "mode": if attached { "attached-local-ws" } else { "managed-stdio" },
            "sessionScope": "bridge-created-and-imported",
            "sharedDesktopRuntime": false,
            "externalThreadSync": false
        },
        "features": {
            "sessionManagement": true,
            "activeTurnSteering": true,
            "activeTurnInterruption": true,
            "threadIndexImport": true,
            "externalThreadMetadataSync": attached,
            "externalThreadDeletionEvents": attached,
            "externalThreadObservation": attached,
            "upstreamHistoryPages": true,
            "upstreamHistoryContent": true,
            "modelSelection": true,
            "plan": true,
            "goal": true,
            "attachments": true,
            "gitRead": true,
            "fullHistoryRead": false,
            "gitWrite": false,
            "fileEditor": false,
            "terminal": false,
            "browser": false,
            "automationManagement": false
        },
        "limits": {"attachmentCount": 4, "attachmentTotalBytes": 524288}
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn readiness_does_not_claim_desktop_sharing() {
        for ready in [false, true] {
            let value = super::describe(ready, ready);
            assert_eq!(value["upstreamReady"], ready);
            assert_eq!(value["sandboxVerified"], ready);
            assert_eq!(value["runtime"]["sharedDesktopRuntime"], false);
            assert_eq!(value["runtime"]["externalThreadSync"], false);
            assert_eq!(
                value["runtime"]["sessionScope"],
                "bridge-created-and-imported"
            );
            assert_eq!(value["features"]["fullHistoryRead"], false);
            assert_eq!(value["features"]["externalThreadMetadataSync"], false);
            assert_eq!(value["features"]["externalThreadDeletionEvents"], false);
        }
        let attached = super::describe_runtime(true, false, true);
        assert_eq!(attached["runtime"]["mode"], "attached-local-ws");
        assert_eq!(attached["runtime"]["sharedDesktopRuntime"], false);
        assert_eq!(attached["features"]["externalThreadMetadataSync"], true);
        assert_eq!(attached["features"]["externalThreadDeletionEvents"], true);
        let desktop = super::describe_profile(
            true,
            true,
            true,
            crate::rpc::ProtocolVersion::DesktopBaseline,
        );
        assert_eq!(desktop["codexVersion"], "0.163.0-alpha.10.2");
        assert_eq!(desktop["runtime"]["sharedDesktopRuntime"], false);
    }
}
