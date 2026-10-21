use agentdeck_service::rpc::{validate_for, ProtocolVersion};
use serde_json::json;

#[test]
fn response_validators_do_not_share_cache_entries_between_versions() {
    let response = json!({"imageGeneration":false,"webSearch":false});
    // namespaceTools was required in 0.159.2, removed in the desktop baseline.
    for _ in 0..2 {
        assert!(validate_for(
            ProtocolVersion::DesktopBaseline,
            "v2/ModelProviderCapabilitiesReadResponse",
            &response
        )
        .is_ok());
        assert!(validate_for(
            ProtocolVersion::Managed,
            "v2/ModelProviderCapabilitiesReadResponse",
            &response
        )
        .is_err());
    }
    let invalid = json!({"imageGeneration":"false","webSearch":false});
    assert!(validate_for(
        ProtocolVersion::DesktopBaseline,
        "v2/ModelProviderCapabilitiesReadResponse",
        &invalid
    )
    .is_err());
}

#[test]
fn new_request_is_only_available_in_its_own_protocol() {
    let request = json!({"id":"probe","method":"thread/attachmentOwner/list","params":{"attachmentType":"probe","identityKey":"isolated"}});
    assert!(validate_for(ProtocolVersion::Managed, "ClientRequest", &request).is_err());
    assert!(validate_for(ProtocolVersion::DesktopBaseline, "ClientRequest", &request).is_ok());
    let invalid = json!({"id":"probe","method":"thread/attachmentOwner/list","params":{}});
    assert!(validate_for(ProtocolVersion::DesktopBaseline, "ClientRequest", &invalid).is_err());
    assert!(validate_for(ProtocolVersion::DesktopBaseline, "not/a/schema", &json!({})).is_err());
}

#[test]
fn plan_uses_its_versioned_experimental_contract() {
    use agentdeck_service::composer::validate_turn_for;
    let plan = json!({"threadId":"isolated", "input":[{"type":"text","text":"Plan the change","text_elements":[]}],
        "collaborationMode":{"mode":"plan","settings":{"model":"probe","reasoning_effort":null,"developer_instructions":null}}});
    for version in [ProtocolVersion::Managed, ProtocolVersion::DesktopBaseline] {
        assert!(validate_turn_for(version, &plan).is_ok());
        let mut invalid = plan.clone();
        invalid["collaborationMode"]["mode"] = json!("invented-mode");
        assert!(validate_turn_for(version, &invalid).is_err());
    }
}

#[test]
fn goal_origin_is_explicit_and_automatic_work_never_claims_user_authorization() {
    use agentdeck_service::composer::{goal_params, GoalOrigin};
    let params = json!({"threadId":"isolated","status":"paused"});
    let old = goal_params(ProtocolVersion::Managed, params.clone(), GoalOrigin::User);
    assert_eq!(old, params);
    for (origin, expected) in [
        (GoalOrigin::User, "user"),
        (GoalOrigin::Automatic, "automatic"),
    ] {
        let new = goal_params(ProtocolVersion::DesktopBaseline, params.clone(), origin);
        assert_eq!(new["origin"], expected);
        assert!(new.get("parentTurnId").is_none());
        assert!(validate_for(
            ProtocolVersion::DesktopBaseline,
            "ClientRequest",
            &json!({"id":"probe","method":"thread/goal/set","params":new})
        )
        .is_ok());
    }
}

#[test]
fn approval_decisions_keep_turn_only_scope_in_both_profiles() {
    use agentdeck_service::approval::{choices_for, response_for};
    let context = json!({"availableDecisions":["accept","acceptForSession","decline","cancel"]});
    for version in [ProtocolVersion::Managed, ProtocolVersion::DesktopBaseline] {
        let method = "item/commandExecution/requestApproval";
        assert_eq!(
            choices_for(version, method, &context).unwrap(),
            vec!["approve", "reject", "cancel"]
        );
        assert_eq!(
            response_for(version, method, "approve", &context).unwrap(),
            json!({"decision":"accept"})
        );
        assert!(response_for(version, method, "acceptForSession", &context).is_err());
        let permissions = response_for(
            version,
            "item/permissions/requestApproval",
            "approve",
            &json!({"permissions":{"network":{"enabled":true}}}),
        )
        .unwrap();
        assert_eq!(permissions["scope"], "turn");
    }
}
