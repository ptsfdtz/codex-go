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
    let mut features = json!({
        "nativeProjectReadViews": protocol == crate::rpc::ProtocolVersion::DesktopBaseline,
        "executionConfigView": true,
        "projectSkillCatalog": true,
        "composerSkills": true,
        "nativeQueueSkills": protocol == crate::rpc::ProtocolVersion::DesktopBaseline,
        "nativeQueueResourceEdit": protocol == crate::rpc::ProtocolVersion::DesktopBaseline,
        "accountSummary": true,
        "sessionManagement": true,
        "nativeQueue": protocol == crate::rpc::ProtocolVersion::DesktopBaseline,
        "nativeQueueStart": protocol == crate::rpc::ProtocolVersion::DesktopBaseline,
        "nativeQueueAttachments": protocol == crate::rpc::ProtocolVersion::DesktopBaseline,
        "nativeQueueEvents": protocol == crate::rpc::ProtocolVersion::DesktopBaseline,
        "sessionHistoryRevert": true,
        "sessionResourceRevision": true,
        "sessionSkillRevision": true,
        "sessionHistoryEvents": true,
        "sessionFork": true,
        "sessionForkAtTurn": true,
        "activeTurnSteering": true,
        "latestUpstreamTurn": true,
        "activeTurnInterruption": true,
        "threadIndexImport": true,
        "threadIndexRefresh": true,
        "externalThreadMetadataSync": attached,
        "externalThreadDeletionEvents": attached,
        "externalThreadObservation": attached,
        "upstreamHistoryPages": true,
        "upstreamHistoryOrdering": true,
        "upstreamHistoryContent": true,
        "sessionImages": true,
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
    });
    features["gitBranchCompare"] = Value::Bool(true);
    features["multipleDevices"] = Value::Bool(true);
    features["hostUpdateCheck"] = Value::Bool(true);
    features["hostUpdateManage"] = Value::Bool(true);
    features["projectlessChat"] = Value::Bool(true);
    features["codexWorkspaceDiscovery"] = Value::Bool(true);
    features["stableTlsIdentity"] = Value::Bool(true);
    features["pairingV2"] = Value::Bool(true);
    features["projectFileBrowser"] = Value::Bool(true);
    features["projectImagePreview"] = Value::Bool(true);
    features["projectTextPreview"] = Value::Bool(true);
    features["fileReferenceInputs"] = Value::Bool(true);
    features["projectFileReference"] = Value::Bool(true);
    features["skillConfiguration"] = Value::Bool(true);
    features["outputDefaultsWrite"] = Value::Bool(true);
    features["modelDefaultsWrite"] = Value::Bool(true);
    features["sessionTokenUsage"] = Value::Bool(true);
    features["sessionCompaction"] = Value::Bool(true);
    features["sessionGoalResume"] = Value::Bool(true);
    features["sessionGoalClear"] = Value::Bool(true);
    features["sessionGoalEdit"] = Value::Bool(true);
    features["sessionGoalView"] = Value::Bool(true);
    json!({
        "protocolVersion": 1,
        "capabilitiesVersion": 1,
        "codexVersion": protocol.version(),
        "concurrency": crate::service::MAX_CONCURRENT_TASKS,
        "approvals": ["command", "fileChange", "permissions"],
        "sandboxVerified": sandbox_verified,
        "upstreamReady": upstream_ready,
        "runtime": {
            "mode": if attached { "attached-local-ws" } else { "managed-stdio" },
            "sessionScope": "bridge-created-and-imported",
            "sharedDesktopRuntime": false,
            "externalThreadSync": false
        },
        "features": features,
        "limits": {"attachmentCount": 4, "attachmentBytes": 524288, "attachmentTotalBytes": 2097152}
    })
}
