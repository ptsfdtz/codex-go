//! Fixtures exercise the native implementation, not the compatibility service.
use agentdeck_service::{
    rpc::{self, Rpc},
    security::Certificate,
    service::Core,
    store::Store,
    *,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
struct Harness {
    core: Arc<Core>,
    _directory: tempfile::TempDir,
    _output: tokio::task::JoinHandle<()>,
    worker: Option<tokio::task::JoinHandle<()>>,
}

#[tokio::test]
async fn projectless_chat_uses_owned_workspace_and_preserves_thread_identity() {
    let h = Harness::fixture().await;
    assert!(h.core.store.projects().unwrap().is_empty());
    let create = request(
        "sessions.create",
        json!({"projectId":paths::CHAT_PROJECT,"title":"普通聊天"}),
        "chat-create",
    );
    let result = h.core.dispatch(&create, "fixture").await.unwrap();
    let session = &result["session"];
    let id = s(session, "sessionId");
    assert_eq!(session["projectId"], paths::CHAT_PROJECT);
    let root = paths::root(&h.core.store, paths::CHAT_PROJECT).unwrap();
    assert_eq!(
        root,
        paths::canonical(&h._directory.path().join("chat-workspace")).unwrap()
    );
    assert_eq!(h.core.store.projects().unwrap().len(), 1);
    for (mode, permission) in [
        ("goal", "workspace"),
        ("plan", "workspace"),
        ("default", "full"),
    ] {
        let error = h
            .core
            .start_turn_composer(id, "hello", None, None, permission, mode, None)
            .await
            .unwrap_err();
        assert_eq!(error.code, "INVALID_REQUEST");
    }
    let turn = h.core.start_turn(id, "hello").await.unwrap();
    h.wait(s(&turn, "turnId"), "completed").await;
    h.core.loaded.lock().unwrap().clear();
    let turn = h.core.start_turn(id, "hello again").await.unwrap();
    h.wait(s(&turn, "turnId"), "completed").await;
    assert_eq!(
        h.core.store.session(id).unwrap()["upstreamThreadId"],
        session["upstreamThreadId"]
    );
    let reopened = Store::open(&h._directory.path().join("test.db")).unwrap();
    assert_eq!(
        reopened.session(id).unwrap()["upstreamThreadId"],
        session["upstreamThreadId"]
    );
    let again = h.core.dispatch(&create, "fixture").await.unwrap();
    assert_ne!(again["session"]["sessionId"], session["sessionId"]);
    assert_eq!(h.core.store.projects().unwrap().len(), 1);
    std::fs::rename(&root, h._directory.path().join("previous-chat-workspace")).unwrap();
    std::fs::create_dir(&root).unwrap();
    assert_eq!(
        h.core.dispatch(&create, "fixture").await.unwrap_err().code,
        "WORKSPACE_FORBIDDEN"
    );
}

#[test]
fn remote_pairing_pins_account_and_mobile_without_consuming_wrong_scope_invitation() {
    use agentdeck_service::pairing::{Pairing, RemoteIdentity};
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("paired.db");
    let store = Store::open(&database).unwrap();
    let pairing = Pairing::default();
    let identity = RemoteIdentity {
        issuer: "https://connect.example.com".into(),
        account_id: "account-a".into(),
        device_id: "mobile-a".into(),
    };
    let qr = pairing
        .create_remote(
            &store,
            "https://127.0.0.1:49321",
            &"a".repeat(64),
            &identity.issuer,
            &identity.account_id,
        )
        .unwrap();
    assert_eq!(qr["v"], 3);
    let input =
        json!({"token":qr["token"],"displayName":"Remote mobile","nonce":security::token()});
    assert!(pairing.request(&input).is_err());
    assert!(pairing
        .request_scoped(
            &input,
            Some(&RemoteIdentity {
                account_id: "account-b".into(),
                ..identity.clone()
            })
        )
        .is_err());
    assert!(pairing
        .request_scoped(
            &input,
            Some(&RemoteIdentity {
                issuer: "https://other.example.com".into(),
                ..identity.clone()
            })
        )
        .is_err());
    let (request, _) = pairing.request_scoped(&input, Some(&identity)).unwrap();
    pairing
        .confirm(&store, s(&request, "requestId"), true)
        .unwrap();
    let claim = json!({"requestId":request["requestId"],"claimToken":request["claimToken"]});
    assert!(pairing.claim(&store, &claim).is_err());
    assert!(pairing
        .claim_scoped(
            &store,
            &claim,
            Some(&RemoteIdentity {
                device_id: "mobile-b".into(),
                ..identity.clone()
            })
        )
        .is_err());
    let grant = pairing
        .claim_scoped(&store, &claim, Some(&identity))
        .unwrap();
    let credential = s(&grant, "credential");
    assert_eq!(
        Pairing::authenticate_scoped(&store, credential, Some(&identity))
            .unwrap()
            .as_deref(),
        grant["deviceId"].as_str()
    );
    assert!(Pairing::authenticate_scoped(
        &store,
        credential,
        Some(&RemoteIdentity {
            device_id: "mobile-b".into(),
            ..identity.clone()
        })
    )
    .unwrap()
    .is_none());
    let lan = security::token();
    store
        .add_device("standalone-lan", "LAN", &digest(&lan))
        .unwrap();
    assert!(Pairing::authenticate(&store, &lan).unwrap().is_some());
    assert!(Pairing::authenticate_scoped(&store, &lan, Some(&identity))
        .unwrap()
        .is_none());
    drop(store);
    let reopened = Store::open(&database).unwrap();
    assert!(
        Pairing::authenticate_scoped(&reopened, credential, Some(&identity))
            .unwrap()
            .is_some()
    );
    Pairing::revoke(&reopened, s(&grant, "deviceId")).unwrap();
    assert!(
        Pairing::authenticate_scoped(&reopened, credential, Some(&identity))
            .unwrap()
            .is_none()
    );
    assert!(Pairing::authenticate(&reopened, &lan).unwrap().is_some());
}

#[tokio::test]
async fn compaction_preserves_original_thread_and_deduplicates_submission() {
    let h = Harness::fixture().await;
    let session = h.session("compact-source").await;
    let id = s(&session, "sessionId");
    let turn = h
        .core
        .start_turn(id, "seed compaction history")
        .await
        .unwrap();
    h.wait(s(&turn, "turnId"), "completed").await;
    let before = h.core.latest_upstream_turn(id).await.unwrap();
    let stale = request(
        "sessions.compact",
        json!({"sessionId":id,"expectedLastTurnId":"stale"}),
        "compact-stale",
    );
    assert_eq!(
        transport::handle_request(&h.core, &stale, "compact-device").await["type"],
        "error"
    );
    let call = request(
        "sessions.compact",
        json!({"sessionId":id,"expectedLastTurnId":before["turn"]["upstreamTurnId"]}),
        "compact-once",
    );
    let response = transport::handle_request(&h.core, &call, "compact-device").await;
    assert_eq!(response["type"], "response", "{response}");
    assert_eq!(response["payload"]["accepted"], true);
    assert_eq!(response["payload"]["completed"], false);
    assert_eq!(
        response["payload"]["upstreamThreadId"],
        session["upstreamThreadId"]
    );
    assert_eq!(
        transport::handle_request(&h.core, &call, "compact-device").await,
        response
    );
    let records = h
        .core
        .store
        .query(
            "SELECT action FROM events WHERE sessionId=? AND action='session.compactionRequested'",
            [id],
        )
        .unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(h.core.store.turns(Some(id)).unwrap().len(), 1);
    assert_eq!(h.core.latest_upstream_turn(id).await.unwrap(), before);
}

#[tokio::test]
async fn goal_resume_preserves_identity_and_deduplicates() {
    let h = Harness::fixture().await;
    let session = h.session("goal-resume").await;
    let id = s(&session, "sessionId");
    h.core.upstream().unwrap().request("thread/goal/set",json!({"threadId":session["upstreamThreadId"],"objective":"Preserve objective","status":"paused","tokenBudget":5000})).await.unwrap();
    let before = h.core.session_goal(id).await.unwrap();
    let stale = request(
        "sessions.goal.resume",
        json!({"sessionId":id,"expectedGoalRevision":"0".repeat(64)}),
        "resume-stale",
    );
    assert_eq!(
        transport::handle_request(&h.core, &stale, "goal-device").await["type"],
        "error"
    );
    assert!(h.core.store.turns(Some(id)).unwrap().is_empty());
    let call = request(
        "sessions.goal.resume",
        json!({"sessionId":id,"expectedGoalRevision":before["goalRevision"]}),
        "resume-once",
    );
    let response = transport::handle_request(&h.core, &call, "goal-device").await;
    assert_eq!(response["type"], "response", "{response}");
    assert_eq!(
        transport::handle_request(&h.core, &call, "goal-device").await,
        response
    );
    let turns = h.core.store.turns(Some(id)).unwrap();
    assert_eq!(turns.len(), 1);
    assert!(!s(&turns[0], "upstreamTurnId").is_empty());
    let after = h.core.session_goal(id).await.unwrap();
    for key in [
        "threadId",
        "objective",
        "tokenBudget",
        "createdAt",
        "tokensUsed",
        "timeUsedSeconds",
    ] {
        assert_eq!(after["goal"][key], before["goal"][key], "{key}");
    }
    assert_eq!(after["goal"]["status"], "active");
    assert_eq!(
        h.core
            .store
            .meta(&format!("permissionMode:{id}"))
            .unwrap()
            .as_deref(),
        Some("workspace")
    );
}

#[tokio::test]
async fn unloaded_goals_can_be_edited_and_cleared_without_resuming_the_thread() {
    let h = Harness::fixture().await;
    let session = h.session("GOAL_UNLOADED").await;
    let id = s(&session, "sessionId");
    let rpc = h.core.upstream().unwrap();
    // Persist a completed turn as a historical thread would have.
    let turn = h.core.start_turn(id, "hello").await.unwrap();
    h.wait(s(&turn, "turnId"), "completed").await;
    h.core.loaded.lock().unwrap().clear();
    for status in ["paused", "blocked", "complete"] {
        rpc.request("thread/goal/set", json!({"threadId":session["upstreamThreadId"],"objective":"Persisted goal","status":status,"tokenBudget":5000})).await.unwrap();
        let before = h.core.session_goal(id).await.unwrap();
        let edited = h.core.manage_session("sessions.goal.edit", &json!({"sessionId":id,"expectedGoalRevision":before["goalRevision"],"objective":"Updated persisted goal"})).await.unwrap();
        assert_eq!(edited["goal"]["objective"], "Updated persisted goal");
        assert_eq!(edited["goal"]["status"], status);
        let cleared = h
            .core
            .manage_session(
                "sessions.goal.clear",
                &json!({"sessionId":id,"expectedGoalRevision":edited["goalRevision"]}),
            )
            .await
            .unwrap();
        assert!(cleared["goal"].is_null());
        assert_eq!(cleared["upstreamThreadId"], session["upstreamThreadId"]);
        assert!(!h
            .core
            .loaded
            .lock()
            .unwrap()
            .contains(s(&session, "upstreamThreadId")));
        assert_eq!(h.core.store.turns(Some(id)).unwrap().len(), 1);
    }
}

#[tokio::test]
async fn goal_edits_reject_active_unloaded_in_progress_and_changing_activity() {
    for title in [
        "GOAL_ACTIVE",
        "GOAL_SYSTEM_ERROR",
        "GOAL_UNLOADED_RUNNING",
        "GOAL_ACTIVITY_RACE",
    ] {
        let h = Harness::fixture().await;
        let session = h.session(title).await;
        let id = s(&session, "sessionId");
        let rpc = h.core.upstream().unwrap();
        rpc.request("thread/goal/set", json!({"threadId":session["upstreamThreadId"],"objective":"Keep goal","status":"paused"})).await.unwrap();
        if title == "GOAL_UNLOADED_RUNNING" {
            // External activity has no local queued/running turn to block it.
            rpc.request("turn/start", json!({"threadId":session["upstreamThreadId"],"input":[{"type":"text","text":"WAIT"}]})).await.unwrap();
        }
        let before = h.core.session_goal(id).await.unwrap();
        let error = h
            .core
            .manage_session(
                "sessions.goal.clear",
                &json!({"sessionId":id,"expectedGoalRevision":before["goalRevision"]}),
            )
            .await
            .unwrap_err();
        assert_eq!(
            error.code,
            if title == "GOAL_ACTIVITY_RACE" {
                "SYNC_CONFLICT"
            } else {
                "CONFLICT"
            },
            "{title}: {error}"
        );
        assert_eq!(
            h.core.session_goal(id).await.unwrap()["goal"],
            before["goal"]
        );
    }
}

#[tokio::test]
async fn goal_clear_checks_revision_preserves_thread_and_deduplicates() {
    let h = Harness::fixture().await;
    let session = h.session("goal-clear").await;
    let id = s(&session, "sessionId");
    let rpc = h.core.upstream().unwrap();
    rpc.request("thread/goal/set",json!({"threadId":session["upstreamThreadId"],"objective":"Keep thread","status":"paused","tokenBudget":5000})).await.unwrap();
    let before = h.core.session_goal(id).await.unwrap();
    let stale = request(
        "sessions.goal.clear",
        json!({"sessionId":id,"expectedGoalRevision":"0".repeat(64)}),
        "clear-stale",
    );
    assert_eq!(
        transport::handle_request(&h.core, &stale, "goal-device").await["type"],
        "error"
    );
    assert_eq!(
        h.core.session_goal(id).await.unwrap()["goal"],
        before["goal"]
    );
    let call = request(
        "sessions.goal.clear",
        json!({"sessionId":id,"expectedGoalRevision":before["goalRevision"]}),
        "clear-once",
    );
    let response = transport::handle_request(&h.core, &call, "goal-device").await;
    assert_eq!(response["type"], "response", "{response}");
    assert_eq!(
        transport::handle_request(&h.core, &call, "goal-device").await,
        response
    );
    let after = h.core.session_goal(id).await.unwrap();
    assert!(after["goal"].is_null());
    assert_eq!(after["upstreamThreadId"], session["upstreamThreadId"]);
    assert!(h.core.store.turns(Some(id)).unwrap().is_empty());
    rpc.request(
        "thread/goal/set",
        json!({"threadId":session["upstreamThreadId"],"objective":"Active","status":"active"}),
    )
    .await
    .unwrap();
    let active = h.core.session_goal(id).await.unwrap();
    let denied = request(
        "sessions.goal.clear",
        json!({"sessionId":id,"expectedGoalRevision":active["goalRevision"]}),
        "clear-active",
    );
    assert_eq!(
        transport::handle_request(&h.core, &denied, "goal-device").await["type"],
        "error"
    );
    assert_eq!(
        h.core.session_goal(id).await.unwrap()["goal"]["objective"],
        "Active"
    );
}

#[tokio::test]
async fn goal_edit_checks_revision_preserves_identity_and_deduplicates() {
    let h = Harness::fixture().await;
    let session = h.session("goal-edit").await;
    let id = s(&session, "sessionId");
    let rpc = h.core.upstream().unwrap();
    rpc.request("thread/goal/set",json!({"threadId":session["upstreamThreadId"],"objective":"Before","status":"paused","tokenBudget":5000})).await.unwrap();
    let before = h.core.session_goal(id).await.unwrap();
    let call = request(
        "sessions.goal.edit",
        json!({"sessionId":id,"objective":"After","tokenBudget":6000,"expectedGoalRevision":before["goalRevision"]}),
        "edit-goal-once",
    );
    let response = transport::handle_request(&h.core, &call, "goal-device").await;
    assert_eq!(response["type"], "response", "{response}");
    assert_eq!(
        transport::handle_request(&h.core, &call, "goal-device").await,
        response
    );
    let changed = h.core.session_goal(id).await.unwrap();
    assert_eq!(changed["goal"]["threadId"], session["upstreamThreadId"]);
    assert_eq!(changed["goal"]["objective"], "After");
    assert_eq!(changed["goal"]["tokenBudget"], 6000);
    assert_eq!(changed["goal"]["status"], "paused");
    assert!(h.core.store.turns(Some(id)).unwrap().is_empty());
    let stale = request(
        "sessions.goal.edit",
        call.payload.clone(),
        "edit-goal-stale",
    );
    assert_eq!(
        transport::handle_request(&h.core, &stale, "goal-device").await["type"],
        "error"
    );
    let keep = request(
        "sessions.goal.edit",
        json!({"sessionId":id,"objective":"Keep budget","expectedGoalRevision":changed["goalRevision"]}),
        "edit-goal-keep",
    );
    let kept = transport::handle_request(&h.core, &keep, "goal-device").await;
    assert_eq!(kept["type"], "response", "{kept}");
    assert_eq!(
        h.core.session_goal(id).await.unwrap()["goal"]["tokenBudget"],
        6000
    );
    rpc.request(
        "thread/goal/set",
        json!({"threadId":session["upstreamThreadId"],"status":"active"}),
    )
    .await
    .unwrap();
    let active = h.core.session_goal(id).await.unwrap();
    let denied = request(
        "sessions.goal.edit",
        json!({"sessionId":id,"objective":"Denied","expectedGoalRevision":active["goalRevision"]}),
        "edit-goal-active",
    );
    assert_eq!(
        transport::handle_request(&h.core, &denied, "goal-device").await["type"],
        "error"
    );
    assert_eq!(
        h.core.session_goal(id).await.unwrap()["goal"]["objective"],
        "Keep budget"
    );
}

#[tokio::test]
async fn goal_view_preserves_native_identity_and_rejects_changed_workspace() {
    let h = Harness::fixture().await;
    let session = h.session("goal-view").await;
    let id = s(&session, "sessionId");
    assert!(h.core.session_goal(id).await.unwrap()["goal"].is_null());
    let rpc = h.core.upstream().unwrap();
    rpc.request("thread/goal/set",json!({"threadId":session["upstreamThreadId"],"objective":"Original objective","status":"paused","tokenBudget":5000})).await.unwrap();
    let view = h.core.session_goal(id).await.unwrap();
    assert_eq!(view["sessionId"], session["sessionId"]);
    assert_eq!(view["goal"]["threadId"], session["upstreamThreadId"]);
    assert_eq!(view["goal"]["objective"], "Original objective");
    assert_eq!(view["goal"]["tokenBudget"], 5000);
    assert!(view.get("cwd").is_none());
    h.core
        .store
        .exec(
            "UPDATE projects SET enabled=0 WHERE projectId=?",
            [s(&session, "projectId")],
        )
        .unwrap();
    assert!(h.core.session_goal(id).await.is_err());
}
#[tokio::test]
async fn token_usage_routes_observations_without_creating_turns() {
    let h = Harness::fixture().await;
    let session = h.session("context-usage").await;
    let rpc = h.core.upstream().unwrap();
    let breakdown = json!({"inputTokens":120,"cachedInputTokens":20,"outputTokens":30,"reasoningOutputTokens":10,"totalTokens":150});
    let notification = json!({"method":"thread/tokenUsage/updated","params":{"threadId":session["upstreamThreadId"],"turnId":"external-usage-turn","tokenUsage":{"last":breakdown,"total":breakdown,"modelContextWindow":1000}}});
    let before = h.core.store.cursor().unwrap();
    let turns = h.core.store.turns(None).unwrap();
    h.core.notification(&rpc, &notification).unwrap();
    assert_eq!(h.core.store.turns(None).unwrap(), turns);
    let events = h.core.store.replay(&before, 100).unwrap();
    assert!(events.to_string().contains("session.tokenUsage"));
    assert!(events.to_string().contains("external-usage-turn"));
    let cursor = h.core.store.cursor().unwrap();
    let mut unknown = notification.clone();
    unknown["params"]["threadId"] = json!("unmapped-thread");
    h.core.notification(&rpc, &unknown).unwrap();
    assert_eq!(h.core.store.cursor().unwrap(), cursor);
    unknown["params"]["tokenUsage"]["last"]["totalTokens"] = json!("invalid");
    assert!(h.core.notification(&rpc, &unknown).is_err());
}
#[tokio::test]
async fn model_defaults_write_checks_version_and_deduplicates() {
    let h = Harness::fixture().await;
    let before = h.core.execution_config(None).await.unwrap();
    assert!(!before.to_string().contains("fixture-user.toml"));
    let call = request(
        "settings.modelDefaults",
        json!({"model":"fixture-model","effort":"high","expectedUserRevision":before["userRevision"]}),
        "model-default-once",
    );
    let response = transport::handle_request(&h.core, &call, "config-device").await;
    assert_eq!(response["type"], "response", "{response}");
    assert_eq!(
        transport::handle_request(&h.core, &call, "config-device").await,
        response
    );
    let changed = h.core.execution_config(None).await.unwrap();
    assert_eq!(changed["values"]["model_reasoning_effort"], "high");
    assert_ne!(changed["userRevision"], before["userRevision"]);
    assert_eq!(
        changed["values"]["default_permissions"],
        before["values"]["default_permissions"]
    );
    let stale = request(
        "settings.modelDefaults",
        call.payload.clone(),
        "model-default-stale",
    );
    let denied = transport::handle_request(&h.core, &stale, "config-device").await;
    assert_eq!(denied["type"], "error", "{denied}");
    let mut invalid = call.payload.clone();
    invalid["model"] = json!("unknown-model");
    invalid["expectedUserRevision"] = changed["userRevision"].clone();
    assert!(h.core.write_model_defaults(&invalid).await.is_err());
    assert_eq!(
        h.core.execution_config(None).await.unwrap()["userRevision"],
        changed["userRevision"]
    );
}
#[tokio::test]
async fn skill_configuration_checks_identity_expected_state_and_deduplicates_write() {
    let h = Harness::fixture().await;
    let session = h.session("skill-settings").await;
    let project = s(&session, "projectId");
    let catalog = h.core.skill_catalog(project).await.unwrap();
    let skill = &catalog["skills"][0];
    assert_eq!(skill["enabled"], true);
    assert!(skill.get("path").is_none());
    let call = request(
        "skills.setEnabled",
        json!({"projectId":project,"skillId":skill["id"],"enabled":false,"expectedEnabled":true}),
        "skill-write-once",
    );
    let response = transport::handle_request(&h.core, &call, "skill-device").await;
    assert_eq!(response["type"], "response", "{response}");
    assert_eq!(response["payload"]["effectiveEnabled"], false);
    assert_eq!(
        transport::handle_request(&h.core, &call, "skill-device").await,
        response
    );
    let changed = h.core.skill_catalog(project).await.unwrap();
    assert_eq!(changed["skills"][0]["enabled"], false);
    assert_eq!(
        changed["skills"][0]["description"],
        "fixture skill; writes 1"
    );
    let stale = request(
        "skills.setEnabled",
        call.payload.clone(),
        "skill-write-stale",
    );
    let denied = transport::handle_request(&h.core, &stale, "skill-device").await;
    assert_eq!(denied["type"], "error", "{denied}");
    let mut invalid = call.payload.clone();
    invalid["skillId"] = json!("0".repeat(64));
    invalid["expectedEnabled"] = json!(false);
    assert!(h.core.set_skill_enabled(&invalid).await.is_err());
    assert_eq!(
        h.core.skill_catalog(project).await.unwrap()["skills"][0]["description"],
        "fixture skill; writes 1"
    );
}
#[tokio::test]
async fn descending_history_preserves_direction_across_pages_and_large_resources() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let h = Harness::fixture().await;
    let session = h.session("ordered-history").await;
    let id = s(&session, "sessionId");
    let latest = h
        .core
        .dispatch(
            &request(
                "sessions.history",
                json!({"sessionId":id,"sortDirection":"desc","limit":1}),
                "latest",
            ),
            "fixture",
        )
        .await
        .unwrap();
    assert_eq!(latest["sortDirection"], "desc");
    assert_eq!(latest["data"][0]["item"]["type"], "agentMessage");
    let older = h
        .core
        .upstream_history_ordered(id, latest["nextCursor"].as_str(), 1, "desc")
        .await
        .unwrap();
    assert_eq!(older["data"][0]["item"]["type"], "userMessage");
    assert!(older["nextCursor"].is_null());
    assert_eq!(
        h.core.upstream_history(id, None, 1).await.unwrap()["data"][0],
        older["data"][0]
    );
    h.core
        .upstream()
        .unwrap()
        .request(
            "thread/name/set",
            json!({"threadId":session["upstreamThreadId"],"name":"HISTORY_LARGE"}),
        )
        .await
        .unwrap();
    let large = h
        .core
        .upstream_history_ordered(id, None, 1, "desc")
        .await
        .unwrap();
    let hash = s(&large["resource"], "sha256");
    assert!(!hash.is_empty());
    assert_eq!(
        h.core
            .upstream_history_content_ordered(id, None, hash, 0, "asc")
            .await
            .unwrap_err()
            .code,
        "CONTENT_CHANGED"
    );
    let mut offset = 0;
    let mut bytes = Vec::new();
    loop {
        let chunk = h
            .core
            .dispatch(
                &request(
                    "sessions.historyContent",
                    json!({"sessionId":id,"sortDirection":"desc","sha256":hash,"offset":offset}),
                    "chunk",
                ),
                "fixture",
            )
            .await
            .unwrap();
        bytes.extend(STANDARD.decode(s(&chunk, "data")).unwrap());
        if let Some(next) = chunk["nextOffset"].as_u64() {
            offset = next as usize;
        } else {
            break;
        }
    }
    let item: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(item["item"]["type"], "agentMessage");
    assert_eq!(item["item"]["text"], "完整历史😀".repeat(90000));
}

#[tokio::test]
async fn upstream_history_is_complete_paged_and_large_content_is_verified() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let h = Harness::fixture().await;
    let session = h.session("history").await;
    let id = s(&session, "sessionId");
    let page = h.core.upstream_history(id, None, 1).await.unwrap();
    assert_eq!(page["data"][0]["item"]["content"][0]["text"], "原始问题");
    assert_eq!(page["nextCursor"], "1");
    assert_eq!(h.core.store.history(id, None, 500).unwrap().len(), 1);
    h.core
        .upstream()
        .unwrap()
        .request(
            "thread/name/set",
            json!({"threadId":session["upstreamThreadId"],"name":"HISTORY_LARGE"}),
        )
        .await
        .unwrap();
    let page = h.core.upstream_history(id, Some("1"), 20).await.unwrap();
    assert!(page["data"].as_array().unwrap().is_empty());
    let resource = &page["resource"];
    assert!(resource["bytes"].as_u64().unwrap() > 1024 * 1024);
    let hash = s(resource, "sha256");
    assert_eq!(
        h.core
            .upstream_history_content(id, Some("1"), &"0".repeat(64), 0)
            .await
            .unwrap_err()
            .code,
        "CONTENT_CHANGED"
    );
    let mut offset = 0;
    let mut bytes = Vec::new();
    loop {
        let chunk = h
            .core
            .upstream_history_content(id, Some("1"), hash, offset)
            .await
            .unwrap();
        let part = STANDARD.decode(s(&chunk, "data")).unwrap();
        assert!(part.len() <= 48 * 1024);
        bytes.extend(part);
        if let Some(next) = chunk["nextOffset"].as_u64() {
            offset = next as usize;
        } else {
            break;
        }
    }
    let entry: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(entry["item"]["text"], "完整历史😀".repeat(90000));
    assert_eq!(
        h.core
            .upstream_history_content(id, Some("1"), hash, bytes.len())
            .await
            .unwrap_err()
            .code,
        "INVALID_REQUEST"
    );
    h.core
        .upstream()
        .unwrap()
        .request(
            "thread/name/set",
            json!({"threadId":session["upstreamThreadId"],"name":"changed"}),
        )
        .await
        .unwrap();
    assert_eq!(
        h.core
            .upstream_history_content(id, Some("1"), hash, 0)
            .await
            .unwrap_err()
            .code,
        "CONTENT_CHANGED"
    );
    paths::remove_local(&h.core.store, s(&session, "projectId")).unwrap();
    assert_eq!(
        h.core
            .upstream_history(id, None, 20)
            .await
            .unwrap_err()
            .code,
        "WORKSPACE_FORBIDDEN"
    );
}
#[tokio::test]
async fn imports_existing_thread_ids_with_archives_provenance_and_atomic_pagination() {
    async fn external(rpc: &Rpc, root: &Path, name: &str) -> String {
        let response = rpc
            .request(
                "thread/start",
                json!({"cwd":root,"sandbox":"read-only","approvalPolicy":"on-request"}),
            )
            .await
            .unwrap();
        let id = s(&response["thread"], "id").to_owned();
        rpc.request("thread/name/set", json!({"threadId":id,"name":name}))
            .await
            .unwrap();
        id
    }
    let h = Harness::fixture().await;
    let (project, root) = h.project("indexed");
    let own = h
        .core
        .create_session(s(&project, "projectId"), "Bridge original")
        .await
        .unwrap();
    let rpc = h.core.upstream().unwrap();
    let child = external(&rpc, &root, "INDEX_CHILD").await;
    let archived = external(&rpc, &root, "Archive original").await;
    rpc.request("thread/archive", json!({"threadId":archived}))
        .await
        .unwrap();
    let active = external(&rpc, &root, "INDEX_ACTIVE").await;
    let outside = h._directory.path().join("not-granted");
    std::fs::create_dir(&outside).unwrap();
    // Explicitly excluded roots stay excluded even though Codex knows them.
    let excluded = paths::add_local(&h.core.store, &outside).unwrap();
    paths::remove_local(&h.core.store, s(&excluded, "projectId")).unwrap();
    external(&rpc, &outside, "INDEX_OUTSIDE").await;
    let refresh = request(
        "sessions.refreshIndex",
        json!({"contractVersion":1}),
        "refresh-index",
    );
    assert_eq!(
        h.core.dispatch(&refresh, "fixture").await.unwrap()["indexed"],
        4
    );
    let sessions = h.core.store.sessions(None).unwrap();
    assert_eq!(sessions.len(), 4);
    let imported = sessions
        .iter()
        .find(|v| v["upstreamThreadId"] == child)
        .unwrap();
    let local_id = s(imported, "sessionId").to_owned();
    assert_eq!(
        imported["upstream"]["parentThreadId"],
        own["upstreamThreadId"]
    );
    assert_eq!(
        imported["upstream"]["forkedFromId"],
        own["upstreamThreadId"]
    );
    assert_eq!(imported["upstream"]["source"], "appServer");
    // A phone can read source history and continue the imported original ID.
    let history = h.core.upstream_history(&local_id, None, 20).await.unwrap();
    assert_eq!(history["data"][0]["item"]["content"][0]["text"], "原始问题");
    let continued = h
        .core
        .start_turn_options(
            &local_id,
            "continue original conversation",
            Some("fixture-model"),
            Some("high"),
        )
        .await
        .unwrap();
    h.wait(s(&continued, "turnId"), "completed").await;
    assert_eq!(
        h.core.store.session(&local_id).unwrap()["upstreamThreadId"],
        child
    );
    assert_eq!(h.core.store.sessions(None).unwrap().len(), 4);
    assert_eq!(
        sessions
            .iter()
            .find(|v| v["upstreamThreadId"] == archived)
            .unwrap()["archived"],
        1
    );
    assert_eq!(
        sessions
            .iter()
            .find(|v| v["upstreamThreadId"] == own["upstreamThreadId"])
            .unwrap()["sessionId"],
        own["sessionId"]
    );
    let active_session = sessions
        .iter()
        .find(|v| v["upstreamThreadId"] == active)
        .unwrap();
    assert_eq!(active_session["status"], "unknown");
    assert_eq!(
        h.core
            .start_turn(s(active_session, "sessionId"), "do not start")
            .await
            .unwrap_err()
            .code,
        "CONFLICT"
    );
    assert_eq!(
        h.core
            .manage_session(
                "sessions.delete",
                &json!({"sessionId":active_session["sessionId"]})
            )
            .await
            .unwrap_err()
            .code,
        "CONFLICT"
    );
    h.core
        .manage_session("sessions.pin", &json!({"sessionId":local_id,"pinned":true}))
        .await
        .unwrap();
    rpc.request(
        "thread/name/set",
        json!({"threadId":child,"name":"Renamed externally"}),
    )
    .await
    .unwrap();
    assert_eq!(h.core.sync_thread_index().await.unwrap(), 4);
    let refreshed = h.core.store.session(&local_id).unwrap();
    assert_eq!(refreshed["upstreamThreadId"], child);
    assert_eq!(refreshed["title"], "Renamed externally");
    assert_eq!(refreshed["pinned"], 1);
    let snapshot = h.core.snapshot().unwrap();
    assert!(snapshot["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .all(|v| v.get("upstreamJson").is_none() && v["upstream"].is_object()));
    // Even a valid first page must not partially publish a broken listing.
    external(&rpc, &root, "INDEX_REPEAT_CURSOR").await;
    let before = h.core.store.cursor().unwrap();
    assert_eq!(
        h.core.sync_thread_index().await.unwrap_err().code,
        "UPSTREAM_PROTOCOL_ERROR"
    );
    assert_eq!(h.core.store.sessions(None).unwrap().len(), 4);
    assert_eq!(h.core.store.cursor().unwrap(), before);
    let reopened = Store::open(&h._directory.path().join("test.db")).unwrap();
    assert_eq!(
        reopened.session(&local_id).unwrap()["upstream"],
        refreshed["upstream"]
    );
}
#[tokio::test]
async fn codex_workspaces_discover_remove_persist_and_explicitly_restore() {
    let h = Harness::fixture().await;
    let root = h._directory.path().join("existing-codex-workspace");
    std::fs::create_dir(&root).unwrap();
    let root = paths::canonical(&root).unwrap();
    let rpc = h.core.upstream().unwrap();
    let native = rpc
        .request(
            "thread/start",
            json!({"cwd":root,"sandbox":"read-only","approvalPolicy":"on-request"}),
        )
        .await
        .unwrap();
    let thread = s(&native["thread"], "id");
    assert!(h.core.store.projects().unwrap().is_empty());
    let sync = request("projects.add", json!({}), "workspace-sync");
    assert_eq!(
        h.core.dispatch(&sync, "fixture").await.unwrap()["status"],
        "synced"
    );
    let projects = h.core.store.projects().unwrap();
    assert_eq!(projects.len(), 1);
    let project = &projects[0];
    assert_eq!(
        paths::root(&h.core.store, s(project, "projectId")).unwrap(),
        root
    );
    assert_eq!(
        h.core.store.sessions(None).unwrap()[0]["upstreamThreadId"],
        thread
    );
    let removal = request(
        "projects.remove",
        json!({"projectId":project["projectId"]}),
        "workspace-remove",
    );
    assert_eq!(
        h.core.dispatch(&removal, "fixture").await.unwrap()["status"],
        "removed"
    );
    h.core.sync_thread_index().await.unwrap();
    assert!(h.core.store.projects().unwrap().is_empty());
    assert!(h.core.store.sessions(None).unwrap().is_empty());
    assert!(root.is_dir());
    rpc.request(
        "thread/read",
        json!({"threadId":thread,"includeTurns":false}),
    )
    .await
    .unwrap();
    let reopened = Store::open(&h._directory.path().join("test.db")).unwrap();
    assert_eq!(
        reopened
            .query(
                "SELECT enabled FROM projects WHERE projectId=?",
                [s(project, "projectId")]
            )
            .unwrap()[0]["enabled"],
        0
    );
    let restored = paths::add_local(&h.core.store, &root).unwrap();
    assert_eq!(restored["projectId"], project["projectId"]);
    h.core.sync_thread_index().await.unwrap();
    assert_eq!(h.core.store.projects().unwrap().len(), 1);
    let session = h.core.store.sessions(None).unwrap()[0].clone();
    let turn = h
        .core
        .start_turn_options(
            s(&session, "sessionId"),
            "hello",
            Some("fixture-model"),
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        h.core.dispatch(&removal, "fixture").await.unwrap_err().code,
        "CONFLICT"
    );
    h.wait(s(&turn, "turnId"), "completed").await;
}
#[tokio::test]
async fn capabilities_reports_live_readiness_without_claiming_desktop_parity() {
    let h = Harness::new();
    let request = protocol::parse(json!({
        "v":1,"type":"request","id":"caps","action":"system.capabilities","payload":{}
    }))
    .unwrap();
    for ready in [false, true] {
        h.core.ready.store(ready, Ordering::SeqCst);
        let value = h.core.dispatch(&request, "fixture").await.unwrap();
        assert_eq!(value["upstreamReady"], ready);
        assert_eq!(value["protocolVersion"], 1);
        assert_eq!(value["capabilitiesVersion"], 1);
        assert_eq!(value["runtime"]["sharedDesktopRuntime"], false);
        assert_eq!(value["features"]["gitWrite"], false);
    }
}
#[tokio::test]
async fn composer_forwards_files_and_resets_plan_and_goal() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let h = Harness::fixture().await;
    let session = h.session("composer").await;
    let id = s(&session, "sessionId");
    let files = json!([{"name":"notes.txt","data":STANDARD.encode(b"notes")},{"name":"photo.png","data":STANDARD.encode(b"\x89PNG\r\n\x1a\nimage")}]);
    for (text, mode, attachments) in [
        ("CHECK_PLAN", "plan", None),
        ("CHECK_COMPOSER_FILES", "default", Some(&files)),
        ("CHECK_COMPOSER_GOAL", "goal", None),
        ("CHECK_COMPOSER_PAUSE", "default", None),
    ] {
        let turn = h
            .core
            .start_turn_composer(id, text, None, None, "workspace", mode, attachments)
            .await
            .unwrap();
        h.wait(s(&turn, "turnId"), "completed").await;
        assert_eq!(h.core.store.session(id).unwrap()["mode"], mode);
    }
    assert_eq!(
        h.core
            .store
            .meta(&format!("goalMode:{id}"))
            .unwrap()
            .as_deref(),
        Some("paused")
    );
    let root = paths::root(&h.core.store, s(&session, "projectId")).unwrap();
    assert!(std::fs::read_dir(root).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".agentdeck-attachments")));
    assert_eq!(
        h.core
            .store
            .query("SELECT * FROM attachment_blobs", [])
            .unwrap()
            .len(),
        2
    );
}
#[tokio::test]
async fn plan_questions_accept_answers_once_and_keep_connection() {
    let h = Harness::fixture().await;
    let session = h.session("questions").await;
    let id = s(&session, "sessionId");
    let turn = h
        .core
        .start_turn_composer(id, "QUESTION", None, None, "workspace", "plan", None)
        .await
        .unwrap();
    h.wait(s(&turn, "turnId"), "waitingApproval").await;
    let approval = h.core.store.approvals(Some(id)).unwrap().remove(0);
    let aid = s(&approval, "approvalId");
    assert!(h
        .core
        .decide_with_answers(id, s(&turn, "turnId"), aid, "approve", Some(&json!({})))
        .is_err());
    h.core
        .decide_with_answers(
            id,
            s(&turn, "turnId"),
            aid,
            "approve",
            Some(&json!({"approach":{"answers":["A"]}})),
        )
        .unwrap();
    h.wait(s(&turn, "turnId"), "completed").await;
    assert!(h
        .core
        .decide_with_answers(
            id,
            s(&turn, "turnId"),
            aid,
            "approve",
            Some(&json!({"approach":{"answers":["A"]}}))
        )
        .is_err());
    assert!(h.core.ready.load(Ordering::SeqCst));
}
#[tokio::test]
async fn upstream_output_burst_preserves_connection() {
    let node = codex::sync_command("where.exe", &["node.exe"], None).unwrap();
    let node = Path::new(node.lines().next().unwrap().trim());
    let script = r#"
        for (let i=0;i<1024;i++) process.stdout.write(JSON.stringify({method:'burst',params:{index:i}})+'\n');
        require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
            const request=JSON.parse(line);
            process.stdout.write(JSON.stringify({id:request.id,result:{ok:true}})+'\n');
        });
    "#;
    let (rpc, mut events) = Rpc::start(node, &["-e".into(), script.into()]).unwrap();
    // Deliberately let the bounded queue fill before consuming command output.
    tokio::time::sleep(Duration::from_millis(300)).await;
    for index in 0..1024 {
        let event = tokio::time::timeout(Duration::from_secs(5), events.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(event["method"], "burst");
        assert_eq!(event["params"]["index"], index);
    }
    assert_eq!(
        rpc.request("config/read", json!({"includeLayers":false}))
            .await
            .unwrap()["ok"],
        true
    );
    rpc.stop();
}
impl Harness {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::open(&directory.path().join("test.db")).unwrap());
        let tls = Certificate::load(directory.path()).unwrap();
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let (tx, mut rx) = tokio::sync::mpsc::channel(32);
        let output = tokio::spawn(async move { while rx.recv().await.is_some() {} });
        let core = Core::new(store, tls, "127.0.0.1".into(), port, tx);
        core.verified.store(true, Ordering::SeqCst);
        Self {
            core,
            _directory: directory,
            _output: output,
            worker: None,
        }
    }
    async fn fixture() -> Self {
        Self::fixture_dropping_terminals(false).await
    }
    async fn fixture_dropping_terminals(drop_terminals: bool) -> Self {
        let mut h = Self::new();
        let node = codex::sync_command("where.exe", &["node.exe"], None)
            .unwrap()
            .lines()
            .next()
            .unwrap()
            .trim()
            .to_owned();
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/appserver.mjs");
        let (rpc, mut events) =
            Rpc::start(Path::new(&node), &[fixture.to_string_lossy().into_owned()]).unwrap();
        *h.core.rpc.write().unwrap() = Some(rpc.clone());
        let core = h.core.clone();
        let worker_rpc = rpc.clone();
        h.worker = Some(tokio::spawn(async move {
            while let Some(v) = events.recv().await {
                if drop_terminals && v["method"] == "turn/completed" {
                    continue;
                }
                if v["method"] == "$lost" {
                    let _ = core.lost();
                    break;
                }
                if v.get("id").is_some() {
                    let _ = core.receive_approval(&worker_rpc, &v);
                } else if let Err(e) = core.notification(&worker_rpc, &v) {
                    panic!("{}", e);
                }
            }
        }));
        codex::initialize(&rpc).await.unwrap();
        h.core.ready.store(true, Ordering::SeqCst);
        h
    }
    fn project(&self, name: &str) -> (Value, PathBuf) {
        let path = self._directory.path().join(name);
        std::fs::create_dir(&path).unwrap();
        let path = paths::canonical(&path).unwrap();
        (paths::add_local(&self.core.store, &path).unwrap(), path)
    }
    async fn session(&self, name: &str) -> Value {
        let (project, _) = self.project(name);
        self.core
            .create_session(s(&project, "projectId"), name)
            .await
            .unwrap()
    }
    async fn wait(&self, turn: &str, status: &str) {
        let end = tokio::time::Instant::now() + Duration::from_secs(5);
        while tokio::time::Instant::now() < end {
            if self.core.store.turn(turn).unwrap()["status"] == status {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!(
            "expected {status}, got {}",
            self.core.store.turn(turn).unwrap()
        );
    }
}
impl Drop for Harness {
    fn drop(&mut self) {
        if let Some(rpc) = self.core.rpc.read().unwrap().as_ref() {
            rpc.stop();
        }
        if let Some(w) = self.worker.take() {
            w.abort();
        }
        self._output.abort();
    }
}
fn request(action: &str, payload: Value, id: &str) -> protocol::Request {
    protocol::parse(json!({"v":1,"type":"request","id":id,"action":action,"payload":payload}))
        .unwrap()
}
#[test]
fn strict_client_protocol() {
    for (action, payload) in [
        (
            "sessions.history",
            json!({"sessionId":"s","sortDirection":"sideways"}),
        ),
        (
            "sessions.historyContent",
            json!({"sessionId":"s","sha256":"a".repeat(64),"offset":0,"sortDirection":false}),
        ),
        (
            "sessions.observe",
            json!({"sessionId":"s","permissionMode":"full"}),
        ),
        (
            "turn.steer",
            json!({"sessionId":"s","expectedTurnId":"","text":"hello"}),
        ),
        (
            "turn.steer",
            json!({"sessionId":"s","expectedTurnId":"t","text":" "}),
        ),
        (
            "turn.steer",
            json!({"sessionId":"s","expectedTurnId":"t","text":"hello","permissionMode":"full"}),
        ),
        ("sessions.history", json!({"sessionId":"s","limit":51})),
        ("sessions.history", json!({"sessionId":"s","cursor":false})),
        (
            "sessions.history",
            json!({"sessionId":"s","cursor":"x".repeat(32769)}),
        ),
        (
            "sessions.historyContent",
            json!({"sessionId":"s","sha256":"G".repeat(64),"offset":0}),
        ),
        (
            "sessions.historyContent",
            json!({"sessionId":"s","sha256":"a".repeat(64),"offset":-1}),
        ),
        (
            "sessions.historyContent",
            json!({"sessionId":"s","sha256":"a".repeat(64),"offset":0,"path":"C:/"}),
        ),
    ] {
        assert!(protocol::parse(
            json!({"v":1,"type":"request","id":"history","action":action,"payload":payload})
        )
        .is_err());
    }
    for v in [
        json!({"v":1,"type":"request","id":"1","action":"shell","payload":{"command":"whoami"}}),
        json!({"v":1,"type":"request","id":"1","action":"projects.add","payload":{"path":"C:/"}}),
        json!({"v":1,"type":"request","id":"1","action":"approvals.decide","payload":{"sessionId":"s","turnId":"t","approvalId":"a","decision":"acceptForSession"}}),
        json!({"v":1,"type":"request","id":"1","action":"turn.start","payload":{"sessionId":"s","text":" "}}),
        json!({"v":1,"type":"request","id":"1","action":"turn.start","payload":{"sessionId":"s","text":"hello","permissionMode":"invented"}}),
        json!({"v":1,"type":"request","id":"1","action":"turn.start","payload":{"sessionId":"s","text":"hello","permissionMode":true}}),
    ] {
        assert!(protocol::parse(v).is_err());
    }
    for mode in ["full", "workspace"] {
        assert_eq!(
            request(
                "turn.start",
                json!({"sessionId":"s","text":"hello","permissionMode":mode}),
                "permission"
            )
            .payload["permissionMode"],
            mode
        );
    }
    assert_eq!(
        request("sessions.detail", json!({"sessionId":"s"}), "1").payload["limit"],
        100
    );
}
#[test]
fn pinned_contract_rejects_guessed_fields() {
    assert!(rpc::validate(
        "v2/TurnCompletedNotification",
        &json!({"threadId":"t","turn":{"id":"u","status":"done"}})
    )
    .is_err());
    assert!(rpc::validate(
        "CommandExecutionRequestApprovalResponse",
        &json!({"decision":"alwaysAllow"})
    )
    .is_err());
    assert!(rpc::schema("ClientRequest").is_some());
}
#[tokio::test]
async fn model_catalog_and_effort_are_validated_and_forwarded() {
    let h = Harness::fixture().await;
    let session = h.session("model-choice").await;
    let id = s(&session, "sessionId");
    assert_eq!(h.core.models().await.unwrap()[0]["model"], "fixture-model");
    assert!(h
        .core
        .start_turn_options(id, "hello", Some("invented"), Some("high"))
        .await
        .is_err());
    assert!(h
        .core
        .start_turn_options(id, "hello", Some("fixture-model"), Some("ultra"))
        .await
        .is_err());
    assert!(h.core.store.turns(Some(id)).unwrap().is_empty());
    let turn = h
        .core
        .start_turn_options(id, "CHECK_MODEL", Some("fixture-model"), Some("high"))
        .await
        .unwrap();
    h.wait(s(&turn, "turnId"), "completed").await;
    assert_eq!(h.core.store.session(id).unwrap()["model"], "fixture-model");
    assert_eq!(
        h.core.store.snapshot(true).unwrap()["sessions"][0]["effort"],
        "high"
    );
}
#[tokio::test]
async fn missing_rollout_never_replaces_the_original_thread() {
    for title in ["MISSING_ROLLOUT", "MISSING_LINEAGE"] {
        let h = Harness::fixture().await;
        let session = h.session(title).await;
        let id = s(&session, "sessionId");
        h.core.loaded.lock().unwrap().clear();
        let error = h.core.start_turn(id, "hello").await.unwrap_err();
        assert_eq!(error.code, "THREAD_NOT_FOUND");
        assert_eq!(
            h.core.store.session(id).unwrap()["upstreamThreadId"],
            session["upstreamThreadId"]
        );
        assert!(h.core.store.turns(Some(id)).unwrap().is_empty());
        assert_eq!(h.core.store.sessions(None).unwrap().len(), 1);
    }
}
#[tokio::test]
async fn fresh_empty_thread_history_waits_for_the_first_rollout_without_hiding_missing_history() {
    let h = Harness::fixture().await;
    let session = h.session("FRESH_EMPTY").await;
    let id = s(&session, "sessionId");
    let page = h
        .core
        .upstream_history_ordered(id, None, 50, "desc")
        .await
        .unwrap();
    assert!(page["data"].as_array().unwrap().is_empty());
    assert!(page["nextCursor"].is_null());
    assert!(h.core.latest_upstream_turn(id).await.unwrap()["turn"].is_null());
    assert_eq!(
        h.core
            .upstream_history_ordered(id, Some("old-page"), 50, "desc")
            .await
            .unwrap_err()
            .code,
        "UPSTREAM_ERROR"
    );
    h.core.loaded.lock().unwrap().clear();
    assert_eq!(
        h.core
            .upstream_history(id, None, 50)
            .await
            .unwrap_err()
            .code,
        "UPSTREAM_ERROR"
    );
    h.core
        .loaded
        .lock()
        .unwrap()
        .insert(s(&session, "upstreamThreadId").into());
    h.core
        .store
        .set_meta(&format!("freshThread:{id}"), "")
        .unwrap();
    assert_eq!(
        h.core
            .upstream_history(id, None, 50)
            .await
            .unwrap_err()
            .code,
        "UPSTREAM_ERROR"
    );
    assert_eq!(
        h.core.latest_upstream_turn(id).await.unwrap_err().code,
        "UPSTREAM_ERROR"
    );
    h.core
        .store
        .set_meta(
            &format!("freshThread:{id}"),
            s(&session, "upstreamThreadId"),
        )
        .unwrap();
    let turn = h.core.start_turn(id, "hello").await.unwrap();
    h.wait(s(&turn, "turnId"), "completed").await;
    assert!(
        !h.core.upstream_history(id, None, 50).await.unwrap()["data"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        h.core
            .store
            .meta(&format!("freshThread:{id}"))
            .unwrap()
            .as_deref(),
        Some("")
    );
    assert_eq!(
        h.core.store.session(id).unwrap()["upstreamThreadId"],
        session["upstreamThreadId"]
    );
}
#[tokio::test]
async fn fresh_empty_history_checks_authoritative_turns_and_workspace() {
    for (title, expected) in [
        ("FRESH_FALSE_EMPTY", "UPSTREAM_ERROR"),
        ("FRESH_WRONG_WORKSPACE", "WORKSPACE_FORBIDDEN"),
    ] {
        let h = Harness::fixture().await;
        let session = h.session(title).await;
        let id = s(&session, "sessionId");
        assert_eq!(
            h.core
                .upstream_history(id, None, 50)
                .await
                .unwrap_err()
                .code,
            expected
        );
        assert_eq!(
            h.core.latest_upstream_turn(id).await.unwrap_err().code,
            expected
        );
    }
}
#[tokio::test]
async fn writer_conflict_preserves_identity_with_and_without_history() {
    let h = Harness::fixture().await;
    let session = h.session("writer conflict").await;
    let id = s(&session, "sessionId");
    h.core
        .manage_session(
            "sessions.rename",
            &json!({"sessionId":id,"title":"WRITER_CONFLICT"}),
        )
        .await
        .unwrap();
    let error = h.core.start_turn(id, "hello").await.unwrap_err();
    assert_eq!(error.code, "THREAD_IN_USE");
    assert_eq!(
        h.core.store.session(id).unwrap()["upstreamThreadId"],
        session["upstreamThreadId"]
    );
    h.core
        .loaded
        .lock()
        .unwrap()
        .insert(s(&session, "upstreamThreadId").into());
    let turn = h.core.start_turn(id, "hello").await.unwrap();
    h.wait(s(&turn, "turnId"), "completed").await;
    h.core.loaded.lock().unwrap().clear();
    let error = h
        .core
        .start_turn_permissions(id, "CHECK_PERMISSION_FULL", None, None, "full")
        .await
        .unwrap_err();
    assert_eq!(error.code, "THREAD_IN_USE");
    assert_eq!(
        h.core.store.session(id).unwrap()["upstreamThreadId"],
        session["upstreamThreadId"]
    );
    assert_eq!(h.core.store.turns(Some(id)).unwrap().len(), 1);
}
#[tokio::test]
async fn permission_modes_switch_without_inheriting_full_access() {
    let h = Harness::fixture().await;
    let session = h.session("permissions").await;
    let id = s(&session, "sessionId");
    for mode in ["full", "workspace", "full"] {
        let text = if mode == "full" {
            "CHECK_PERMISSION_FULL"
        } else {
            "CHECK_PERMISSION_WORKSPACE"
        };
        let turn = h
            .core
            .start_turn_permissions(id, text, None, None, mode)
            .await
            .unwrap();
        h.wait(s(&turn, "turnId"), "completed").await;
        h.core.loaded.lock().unwrap().clear();
    }
    assert!(h.core.store.approvals(None).unwrap().is_empty());
    assert!(h
        .core
        .start_turn_permissions(id, "hello", None, None, "invented")
        .await
        .is_err());
}
#[tokio::test]
async fn session_management_waits_for_upstream_and_survives_reopen() {
    let h = Harness::fixture().await;
    let session = h.session("manage").await;
    let id = s(&session, "sessionId");
    let turn = h.core.start_turn(id, "hello").await.unwrap();
    h.wait(s(&turn, "turnId"), "completed").await;
    h.core
        .manage_session(
            "sessions.rename",
            &json!({"sessionId":id,"title":"REFUSE_DELETE"}),
        )
        .await
        .unwrap();
    assert!(h
        .core
        .manage_session("sessions.delete", &json!({"sessionId":id}))
        .await
        .is_err());
    assert_eq!(h.core.store.session(id).unwrap()["title"], "REFUSE_DELETE");
    h.core
        .manage_session("sessions.archive", &json!({"sessionId":id}))
        .await
        .unwrap();
    assert!(h.core.start_turn(id, "blocked").await.is_err());
    h.core
        .manage_session("sessions.pin", &json!({"sessionId":id,"pinned":true}))
        .await
        .unwrap();
    let reopened = Store::open(&h._directory.path().join("test.db")).unwrap();
    assert_eq!(reopened.session(id).unwrap()["archived"], 1);
    assert_eq!(reopened.session(id).unwrap()["pinned"], 1);
    h.core
        .manage_session("sessions.restore", &json!({"sessionId":id}))
        .await
        .unwrap();
    h.core
        .manage_session(
            "sessions.rename",
            &json!({"sessionId":id,"title":"new name"}),
        )
        .await
        .unwrap();
    h.core
        .manage_session("sessions.delete", &json!({"sessionId":id}))
        .await
        .unwrap();
    assert!(h.core.store.session(id).is_err());
    assert!(h.core.store.turns(Some(id)).unwrap().is_empty());
    assert_eq!(
        h.core.store.replay("0", 100).unwrap_err().code,
        "REPLAY_GAP"
    );
    let floor = h.core.store.meta("retentionFloor").unwrap().unwrap();
    let replay = h.core.store.replay(&floor, 100).unwrap();
    assert_eq!(replay["events"][0]["action"], "session.deleted");
    assert_eq!(
        h.core
            .store
            .one(
                "SELECT COUNT(*) AS n FROM events WHERE sessionId=? AND action!='session.deleted'",
                [id]
            )
            .unwrap()["n"],
        0
    );
}
#[tokio::test]
async fn active_turn_prevents_session_deletion() {
    let h = Harness::fixture().await;
    let session = h.session("active-manage").await;
    let id = s(&session, "sessionId");
    let turn = h.core.start_turn(id, "WAIT").await.unwrap();
    h.wait(s(&turn, "turnId"), "running").await;
    assert!(h
        .core
        .manage_session("sessions.delete", &json!({"sessionId":id}))
        .await
        .is_err());
    assert!(h.core.store.session(id).is_ok());
}
#[tokio::test]
async fn session_mutations_are_idempotent_per_device() {
    let h = Harness::fixture().await;
    let session = h.session("idempotent-management").await;
    let id = s(&session, "sessionId");
    h.core
        .store
        .replace_device("management-device", "fixture", &digest("fixture-token"))
        .unwrap();
    let r = request(
        "sessions.rename",
        json!({"sessionId":id,"title":"once"}),
        "manage-once",
    );
    let first = transport::handle_request(&h.core, &r, "management-device").await;
    assert_eq!(first["type"], "response", "{first}");
    let receipt = request(
        "requests.status",
        json!({"requestId":"manage-once"}),
        "receipt-check",
    );
    let receipt_response = transport::handle_request(&h.core, &receipt, "management-device").await;
    assert_eq!(receipt_response["type"], "response", "{receipt_response}");
    assert_eq!(receipt_response["payload"]["status"], "done");
    assert_eq!(receipt_response["payload"]["response"]["id"], "manage-once");
    let cursor = h.core.store.cursor().unwrap();
    let second = transport::handle_request(&h.core, &r, "management-device").await;
    assert_eq!(first, second);
    assert_eq!(cursor, h.core.store.cursor().unwrap());
    let changed = request(
        "sessions.rename",
        json!({"sessionId":id,"title":"twice"}),
        "manage-once",
    );
    assert_eq!(
        transport::handle_request(&h.core, &changed, "management-device").await["code"],
        "CONFLICT"
    );
    assert_eq!(h.core.store.session(id).unwrap()["title"], "once");
}
#[test]
fn latest_turn_contract_rejects_missing_version_and_scope_overrides() {
    for payload in [
        json!({"sessionId":"s"}),
        json!({"sessionId":"s","contractVersion":2}),
        json!({"sessionId":"s","contractVersion":1,"threadId":"override"}),
        json!({"sessionId":"s","contractVersion":1,"limit":2}),
    ] {
        assert!(protocol::parse(
            json!({"v":1,"type":"request","id":"latest","action":"turn.latest","payload":payload})
        )
        .is_err());
    }
    request(
        "turn.latest",
        json!({"sessionId":"s","contractVersion":1}),
        "valid-latest",
    );
}

#[tokio::test]
async fn lost_terminal_notification_is_reconciled_before_stop_or_continue() {
    for (text, expected) in [
        ("FAIL", "failed"),
        ("done", "completed"),
        ("WAIT", "interrupted"),
    ] {
        let h = Harness::fixture_dropping_terminals(true).await;
        let session = h.session("lost-terminal").await;
        let id = s(&session, "sessionId");
        let turn = h.core.start_turn(id, text).await.unwrap();
        let local = s(&turn, "turnId");
        let native = h.core.store.turn(local).unwrap()["upstreamTurnId"].clone();
        let rpc = h.core.upstream().unwrap();
        if text == "WAIT" {
            rpc.request(
                "turn/interrupt",
                json!({"threadId":session["upstreamThreadId"],"turnId":native}),
            )
            .await
            .unwrap();
        }
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let response = rpc
                    .request(
                        "thread/turns/list",
                        json!({"threadId":session["upstreamThreadId"],"limit":1}),
                    )
                    .await
                    .unwrap();
                if response["data"][0]["status"] == expected {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        h.core
            .store
            .status(id, Some(local), "unknown", None)
            .unwrap();
        let stopped = h.core.interrupt(id, local).await.unwrap();
        assert_eq!(stopped["requested"], false);
        assert_eq!(stopped["status"], expected);
        assert_eq!(h.core.store.turn(local).unwrap()["status"], expected);
        assert_eq!(h.core.store.session(id).unwrap()["status"], expected);
        let cursor = h.core.store.cursor().unwrap();
        assert!(h.core.active_upstream_turn(id).await.unwrap()["upstreamTurnId"].is_null());
        assert_eq!(h.core.store.cursor().unwrap(), cursor);
        // The existing thread can accept the user's next explicit submission.
        h.core
            .start_turn(id, "WAIT next explicit message")
            .await
            .unwrap();
        assert_eq!(h.core.store.turns(Some(id)).unwrap().len(), 2);
    }
}

#[tokio::test]
async fn latest_turn_repairs_imported_status_but_preserves_unbound_unknown_send() {
    let h = Harness::fixture().await;
    let session = h.session("imported-stale").await;
    let id = s(&session, "sessionId");
    h.core.attached_runtime.store(true, Ordering::SeqCst);
    h.core.store.status(id, None, "unknown", None).unwrap();
    h.core.latest_upstream_turn(id).await.unwrap();
    assert_eq!(h.core.store.session(id).unwrap()["status"], "idle");
    let started = h.core.upstream().unwrap().request("turn/start", json!({"threadId":session["upstreamThreadId"],"input":[{"type":"text","text":"WAIT","text_elements":[]}]})).await.unwrap();
    h.core.store.status(id, None, "unknown", None).unwrap();
    h.core.latest_upstream_turn(id).await.unwrap();
    assert_eq!(h.core.store.session(id).unwrap()["status"], "unknown");
    h.core
        .upstream()
        .unwrap()
        .request(
            "turn/interrupt",
            json!({"threadId":session["upstreamThreadId"],"turnId":started["turn"]["id"]}),
        )
        .await
        .unwrap();
    h.core
        .store
        .exec(
            "INSERT INTO turns VALUES(?,?,NULL,'unknown',?,NULL,NULL)",
            rusqlite::params!["unbound-send", id, now()],
        )
        .unwrap();
    h.core.store.status(id, None, "unknown", None).unwrap();
    h.core.latest_upstream_turn(id).await.unwrap();
    assert_eq!(h.core.store.session(id).unwrap()["status"], "unknown");
    assert_eq!(
        h.core
            .start_turn(id, "must not resend")
            .await
            .unwrap_err()
            .code,
        "CONFLICT"
    );
}

#[tokio::test]
async fn latest_turn_reads_empty_running_and_terminal_without_creating_local_turns() {
    let h = Harness::fixture().await;
    let session = h.session("latest-turn").await;
    let id = s(&session, "sessionId");
    let empty = h.core.latest_upstream_turn(id).await.unwrap();
    assert_eq!(empty["contractVersion"], 1);
    assert_eq!(empty["upstreamThreadId"], session["upstreamThreadId"]);
    assert!(empty["turn"].is_null());
    assert!(h.core.store.turns(Some(id)).unwrap().is_empty());
    let turn = h.core.start_turn(id, "WAIT").await.unwrap();
    h.wait(s(&turn, "turnId"), "running").await;
    let r = request(
        "turn.latest",
        json!({"sessionId":id,"contractVersion":1}),
        "latest-read",
    );
    let response = transport::handle_request(&h.core, &r, "latest-device").await;
    assert_eq!(response["type"], "response", "{response}");
    assert_eq!(response["payload"]["turn"]["status"], "inProgress");
    assert_eq!(
        response["payload"]["turn"]["upstreamTurnId"],
        h.core.store.turn(s(&turn, "turnId")).unwrap()["upstreamTurnId"]
    );
    assert_eq!(response["payload"]["turn"].as_object().unwrap().len(), 2);
    assert!(h
        .core
        .store
        .query("SELECT * FROM requests WHERE requestId='latest-read'", [])
        .unwrap()
        .is_empty());
    h.core.interrupt(id, s(&turn, "turnId")).await.unwrap();
    h.wait(s(&turn, "turnId"), "interrupted").await;
    assert_eq!(
        h.core.latest_upstream_turn(id).await.unwrap()["turn"]["status"],
        "interrupted"
    );
    let next = h.core.start_turn(id, "complete newest turn").await.unwrap();
    h.wait(s(&next, "turnId"), "completed").await;
    let latest = h.core.latest_upstream_turn(id).await.unwrap();
    assert_eq!(latest["turn"]["status"], "completed");
    assert_eq!(
        latest["turn"]["upstreamTurnId"],
        h.core.store.turn(s(&next, "turnId")).unwrap()["upstreamTurnId"]
    );
    assert_eq!(h.core.store.turns(Some(id)).unwrap().len(), 2);
    assert!(h.core.active_upstream_turn(id).await.unwrap()["upstreamTurnId"].is_null());
    paths::remove_local(&h.core.store, s(&session, "projectId")).unwrap();
    assert_eq!(
        h.core.latest_upstream_turn(id).await.unwrap_err().code,
        "WORKSPACE_FORBIDDEN"
    );
}

#[tokio::test]
async fn steer_preserves_turn_identity_and_request_replay_never_duplicates_input() {
    let h = Harness::fixture().await;
    let session = h.session("steer").await;
    let id = s(&session, "sessionId");
    let turn = h.core.start_turn(id, "WAIT").await.unwrap();
    h.wait(s(&turn, "turnId"), "running").await;
    let active = h.core.active_upstream_turn(id).await.unwrap();
    let expected = s(&active, "upstreamTurnId");
    assert!(!expected.is_empty());
    assert_eq!(
        h.core
            .steer_turn(id, "stale-turn", "no send", "bad")
            .await
            .unwrap_err()
            .code,
        "TURN_CHANGED"
    );
    assert!(!h.core.busy.lock().unwrap().contains(id));
    h.core
        .store
        .replace_device("steer-device", "fixture", &digest("fixture-token"))
        .unwrap();
    let r = request(
        "turn.steer",
        json!({"sessionId":id,"expectedTurnId":expected,"text":"Additional instruction"}),
        "steer-once",
    );
    let first = transport::handle_request(&h.core, &r, "steer-device").await;
    assert_eq!(first["type"], "response", "{first}");
    let cursor = h.core.store.cursor().unwrap();
    assert_eq!(
        transport::handle_request(&h.core, &r, "steer-device").await,
        first
    );
    assert_eq!(h.core.store.cursor().unwrap(), cursor);
    let events = h.core.store.history(id, None, 100).unwrap();
    assert_eq!(
        events
            .iter()
            .filter(|event| event["action"] == "turn.steered")
            .count(),
        1
    );
    assert_eq!(h.core.store.turns(Some(id)).unwrap().len(), 1);
    let uncertain = request(
        "turn.steer",
        json!({"sessionId":id,"expectedTurnId":expected,"text":"STEER_BAD_ACK"}),
        "steer-unknown",
    );
    assert_eq!(
        transport::handle_request(&h.core, &uncertain, "steer-device").await["code"],
        "OUTCOME_UNKNOWN"
    );
    let cursor = h.core.store.cursor().unwrap();
    assert_eq!(
        transport::handle_request(&h.core, &uncertain, "steer-device").await["code"],
        "OUTCOME_UNKNOWN"
    );
    assert_eq!(h.core.store.cursor().unwrap(), cursor);
    assert_eq!(
        h.core.store.turn(s(&turn, "turnId")).unwrap()["upstreamTurnId"],
        expected
    );
    h.core.interrupt(id, s(&turn, "turnId")).await.unwrap();
    h.wait(s(&turn, "turnId"), "interrupted").await;
    paths::remove_local(&h.core.store, s(&session, "projectId")).unwrap();
    assert_eq!(
        h.core
            .steer_turn(id, expected, "no access", "denied")
            .await
            .unwrap_err()
            .code,
        "WORKSPACE_FORBIDDEN"
    );
}
#[tokio::test]
async fn observation_preserves_identity_and_execution_policy_and_checks_revocation() {
    let h = Harness::fixture().await;
    let session = h.session("OBSERVE_EXACT_ONLY").await;
    let id = s(&session, "sessionId");
    assert_eq!(
        h.core.observe_session(id).await.unwrap_err().code,
        "UNSUPPORTED"
    );
    h.core.attached_runtime.store(true, Ordering::SeqCst);
    h.core.loaded.lock().unwrap().clear();
    let result = h
        .core
        .dispatch(
            &request("sessions.observe", json!({"sessionId":id}), "observe"),
            "fixture",
        )
        .await
        .unwrap();
    assert_eq!(result["upstreamThreadId"], session["upstreamThreadId"]);
    assert_eq!(result["observing"], true);
    assert!(!h
        .core
        .loaded
        .lock()
        .unwrap()
        .contains(s(&session, "upstreamThreadId")));
    assert!(h.core.store.turns(Some(id)).unwrap().is_empty());
    let cursor = h.core.store.cursor().unwrap();
    h.core.observe_session(id).await.unwrap();
    assert_eq!(h.core.store.cursor().unwrap(), cursor);
    let unloaded = h.session("OBSERVE_UNLOADED").await;
    let pending = h
        .core
        .observe_session(s(&unloaded, "sessionId"))
        .await
        .unwrap();
    assert_eq!(pending["observing"], false);
    assert_eq!(pending["state"], "waitingForSource");
    assert!(h
        .core
        .store
        .history(s(&unloaded, "sessionId"), None, 100)
        .unwrap()
        .iter()
        .all(|e| e["action"] != "session.observed"));
    let bad = h.session("OBSERVE_WRONG_ID").await;
    assert_eq!(
        h.core
            .observe_session(s(&bad, "sessionId"))
            .await
            .unwrap_err()
            .code,
        "WORKSPACE_FORBIDDEN"
    );
    paths::remove_local(&h.core.store, s(&session, "projectId")).unwrap();
    assert_eq!(
        h.core.observe_session(id).await.unwrap_err().code,
        "WORKSPACE_FORBIDDEN"
    );
}

#[tokio::test]
async fn external_stop_is_idempotent_pauses_goal_and_waits_for_native_terminal() {
    let h = Harness::fixture().await;
    let session = h.session("external-stop").await;
    let id = s(&session, "sessionId");
    h.core.attached_runtime.store(true, Ordering::SeqCst);
    let rpc = h.core.upstream().unwrap();
    let started=rpc.request("turn/start",json!({"threadId":session["upstreamThreadId"],"input":[{"type":"text","text":"WAIT","text_elements":[]}]})).await.unwrap();
    let native = s(&started["turn"], "id");
    rpc.request("thread/goal/set",json!({"threadId":session["upstreamThreadId"],"objective":"Fixture external goal","status":"active"})).await.unwrap();
    assert_eq!(
        h.core
            .interrupt_active_turn(id, "wrong-target")
            .await
            .unwrap_err()
            .code,
        "TURN_CHANGED"
    );
    h.core
        .store
        .replace_device("stop-device", "fixture", &digest("fixture-token"))
        .unwrap();
    let r = request(
        "turn.interruptActive",
        json!({"sessionId":id,"expectedTurnId":native}),
        "external-stop-once",
    );
    let first = transport::handle_request(&h.core, &r, "stop-device").await;
    assert_eq!(first["type"], "response", "{first}");
    assert_eq!(first["payload"]["requested"], true);
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if h.core
                .store
                .history(id, None, 100)
                .unwrap()
                .iter()
                .any(|e| {
                    e["action"] == "upstream.turn.completed"
                        && e["payload"]["status"] == "interrupted"
                })
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let cursor = h.core.store.cursor().unwrap();
    assert_eq!(
        transport::handle_request(&h.core, &r, "stop-device").await,
        first
    );
    assert_eq!(h.core.store.cursor().unwrap(), cursor);
    assert!(h.core.store.turns(Some(id)).unwrap().is_empty());
    let goal = rpc
        .request(
            "thread/goal/get",
            json!({"threadId":session["upstreamThreadId"]}),
        )
        .await
        .unwrap();
    assert_eq!(goal["goal"]["status"], "paused");
    let turns = rpc
        .request(
            "thread/turns/list",
            json!({"threadId":session["upstreamThreadId"],"limit":1}),
        )
        .await
        .unwrap();
    h.core.notification(&rpc,&json!({"method":"turn/completed","params":{"threadId":session["upstreamThreadId"],"turn":turns["data"][0]}})).unwrap();
    assert_eq!(h.core.store.cursor().unwrap(), cursor);
    assert_eq!(
        h.core
            .interrupt_active_turn(id, native)
            .await
            .unwrap_err()
            .code,
        "TURN_CHANGED"
    );
}
#[tokio::test]
async fn concurrent_external_terminals_are_journaled_once() {
    let h = Harness::fixture().await;
    let session = h.session("terminal-race").await;
    h.core.attached_runtime.store(true, Ordering::SeqCst);
    let rpc = h.core.upstream().unwrap();
    let mut started=rpc.request("turn/start",json!({"threadId":session["upstreamThreadId"],"input":[{"type":"text","text":"WAIT","text_elements":[]}]})).await.unwrap();
    started["turn"]["status"] = json!("interrupted");
    let notification = json!({"method":"turn/completed","params":{"threadId":session["upstreamThreadId"],"turn":started["turn"]}});
    std::thread::scope(|scope| {
        let mut workers = Vec::new();
        for _ in 0..8 {
            let core = &h.core;
            let rpc = &rpc;
            let notification = &notification;
            workers.push(scope.spawn(move || core.notification(rpc, notification)));
        }
        for worker in workers {
            worker.join().unwrap().unwrap();
        }
    });
    assert_eq!(
        h.core
            .store
            .history(s(&session, "sessionId"), None, 100)
            .unwrap()
            .iter()
            .filter(|e| e["action"] == "upstream.turn.completed")
            .count(),
        1
    );
    assert!(h
        .core
        .store
        .turns(Some(s(&session, "sessionId")))
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn framing_partial_utf8_invalid_and_oversize() {
    let line = json!({"id":"one","result":{"text":"测试😀"}}).to_string() + "\n";
    let (mut writer, reader) = tokio::io::duplex(32);
    let bytes = line.into_bytes();
    tokio::spawn(async move {
        use tokio::io::AsyncWriteExt;
        for byte in bytes {
            writer.write_all(&[byte]).await.unwrap();
        }
    });
    let frame = rpc::read_frame(&mut tokio::io::BufReader::new(reader))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(frame["result"]["text"], "测试😀");
    for invalid in [
        &b"not-json\n"[..],
        &b"{\"id\":true,\"result\":{}}\n"[..],
        &b"{\"id\":1,\"result\":{},\"error\":{}}\n"[..],
        &b"{\"id\":1,\"result\":{}}"[..],
    ] {
        assert!(rpc::read_frame(&mut &invalid[..]).await.is_err());
    }
    assert!(rpc::read_frame(&mut &vec![b'x'; 8 * 1024 * 1024 + 1][..])
        .await
        .is_err());
}
#[tokio::test]
async fn fixture_file_and_permission_approval_contracts() {
    let h = Harness::fixture().await;
    let session = h.session("permissions").await;
    for (input, decision) in [
        ("FILE_APPROVAL", "approve"),
        ("PERMISSION_APPROVAL", "reject"),
    ] {
        let turn = h
            .core
            .start_turn(s(&session, "sessionId"), input)
            .await
            .unwrap();
        h.wait(s(&turn, "turnId"), "waitingApproval").await;
        let a = h.core.store.approvals(None).unwrap().remove(0);
        h.core
            .decide(
                s(&session, "sessionId"),
                s(&turn, "turnId"),
                s(&a, "approvalId"),
                decision,
            )
            .unwrap();
        h.wait(
            s(&turn, "turnId"),
            if decision == "approve" {
                "completed"
            } else {
                "interrupted"
            },
        )
        .await;
    }
}

#[tokio::test]
async fn attachment_read_approval_is_explicit_and_cannot_grant_the_library_or_other_sessions() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let h = Harness::fixture().await;
    let foreign = h.session("foreign-attachment").await;
    let other_files =
        json!([{"name":"other.txt","data":STANDARD.encode(b"private other attachment")}]);
    let other_turn = h
        .core
        .start_turn_composer(
            s(&foreign, "sessionId"),
            "upload",
            None,
            None,
            "workspace",
            "default",
            Some(&other_files),
        )
        .await
        .unwrap();
    h.wait(s(&other_turn, "turnId"), "completed").await;
    let session = h.session("attachment-approval").await;
    let id = s(&session, "sessionId");
    let files = json!([{"name":"notes.txt","data":STANDARD.encode(b"attachment text")}]);
    let turn = h
        .core
        .start_turn_composer(
            id,
            "PERMISSION_APPROVAL",
            None,
            None,
            "workspace",
            "default",
            Some(&files),
        )
        .await
        .unwrap();
    h.wait(s(&turn, "turnId"), "waitingApproval").await;
    let approval = h.core.store.approvals(Some(id)).unwrap().remove(0);
    let aid = s(&approval, "approvalId");
    let row = h
        .core
        .store
        .one(
            "SELECT contextJson FROM approvals WHERE approvalId=?",
            [aid],
        )
        .unwrap();
    let context: Value = serde_json::from_str(s(&row, "contextJson")).unwrap();
    let hash = agentdeck_service::digest(b"attachment text");
    let directory = paths::canonical(h._directory.path())
        .unwrap()
        .join("attachments");
    let path = directory.join(&hash);
    let other_path = directory.join(agentdeck_service::digest(b"private other attachment"));
    for (target, access) in [
        (&directory, "read"),
        (&path, "write"),
        (&other_path, "read"),
    ] {
        let mut invalid = context.clone();
        invalid["permissions"]["fileSystem"] = json!({"read":null,"write":null,"entries":[{"path":{"type":"path","path":target},"access":access}]});
        h.core
            .store
            .exec(
                "UPDATE approvals SET contextJson=? WHERE approvalId=?",
                rusqlite::params![invalid.to_string(), aid],
            )
            .unwrap();
        assert_eq!(
            h.core
                .decide(id, s(&turn, "turnId"), aid, "approve")
                .unwrap_err()
                .code,
            "WORKSPACE_FORBIDDEN"
        );
    }
    let mut allowed = context;
    allowed["permissions"]["fileSystem"] = json!({"read":[path],"write":null});
    h.core
        .store
        .exec(
            "UPDATE approvals SET contextJson=? WHERE approvalId=?",
            rusqlite::params![allowed.to_string(), aid],
        )
        .unwrap();
    assert_eq!(
        h.core.store.approvals(Some(id)).unwrap().len(),
        1,
        "denied grants stay pending for a user decision"
    );
    h.core
        .decide(id, s(&turn, "turnId"), aid, "approve")
        .unwrap();
    h.wait(s(&turn, "turnId"), "completed").await;
}
#[tokio::test]
async fn restart_retains_snapshot_and_expire_pending() {
    let h = Harness::fixture().await;
    let session = h.session("restart").await;
    let turn = h
        .core
        .start_turn(s(&session, "sessionId"), "APPROVAL")
        .await
        .unwrap();
    h.wait(s(&turn, "turnId"), "waitingApproval").await;
    let reopened = Store::open(&h._directory.path().join("test.db")).unwrap();
    reopened.recover().unwrap();
    let snapshot = reopened.snapshot(false).unwrap();
    assert_eq!(snapshot["host"]["status"], "disconnected");
    assert_eq!(snapshot["turns"][0]["status"], "unknown");
    assert!(snapshot["approvals"].as_array().unwrap().is_empty());
    assert_eq!(
        snapshot["host"]["hostId"],
        h.core.store.meta("hostId").unwrap().unwrap()
    );
    assert!(!reopened.replay("0", 500).unwrap()["events"]
        .as_array()
        .unwrap()
        .is_empty());
}
#[tokio::test]
async fn dpapi_and_certificate_roundtrip() {
    let h = Harness::new();
    let encrypted = security::dpapi(b"fixture-secret", true).unwrap();
    assert_ne!(encrypted, b"fixture-secret");
    assert_eq!(
        security::dpapi(&encrypted, false).unwrap(),
        b"fixture-secret"
    );
    let cert = Certificate::load(h._directory.path()).unwrap();
    assert_eq!(cert.fingerprint, h.core.tls.fingerprint);
    assert!(cert.supports("127.0.0.1"));
    assert_eq!(cert.restore(Some("203.0.113.12".into())), "127.0.0.1");
}
#[tokio::test]
async fn workspace_sync_preserves_removal_until_explicit_add() {
    let h = Harness::fixture().await;
    // Sync intentionally excludes the OS temp tree.
    let directory = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
    let project = paths::add_local(&h.core.store, directory.path()).unwrap();
    let session = h
        .core
        .create_session(s(&project, "projectId"), "removed-workspace")
        .await
        .unwrap();
    let id = s(&session, "projectId");
    let root = paths::root(&h.core.store, id).unwrap();
    assert_eq!(h.core.sync_workspaces().await.unwrap()["synced"], 1);
    paths::remove_local(&h.core.store, id).unwrap();

    for _ in 0..2 {
        let result = h.core.sync_workspaces().await.unwrap();
        assert_eq!(result["synced"], 0);
        assert_eq!(result["skipped"], 1);
        assert!(h.core.store.projects().unwrap().is_empty());
        assert!(h.core.store.sessions(None).unwrap().is_empty());
    }

    let restored = paths::add_local(&h.core.store, &root).unwrap();
    assert_eq!(restored["projectId"], id);
    assert_eq!(h.core.sync_workspaces().await.unwrap()["synced"], 1);
}

#[tokio::test]
async fn project_identity_and_path_boundary() {
    let h = Harness::new();
    let (p, root) = h.project("project");
    let id = s(&p, "projectId");
    assert!(paths::root(&h.core.store, id).is_ok());
    for p in [
        "../outside",
        "C:/Windows",
        "x:stream",
        "/Windows",
        "\\\\server\\share",
    ] {
        assert!(paths::file(&h.core.store, id, p).is_err(), "{p}");
    }
    let original = h._directory.path().join("old");
    std::fs::rename(&root, &original).unwrap();
    std::fs::create_dir(&root).unwrap();
    assert!(paths::root(&h.core.store, id).is_err());
    paths::add_local(&h.core.store, &root).unwrap();
    assert!(paths::root(&h.core.store, id).is_ok());
}
#[tokio::test]
async fn junction_cannot_escape() {
    let h = Harness::new();
    let (p, root) = h.project("project");
    let outside = h._directory.path().join("outside");
    std::fs::create_dir(&outside).unwrap();
    let link = root.join("escape");
    let status=std::process::Command::new("powershell.exe").args(["-NoProfile","-NonInteractive","-Command","New-Item -ItemType Junction -Path $env:AGENTDECK_TEST_LINK -Target $env:AGENTDECK_TEST_TARGET -ErrorAction Stop | Out-Null"]).env("AGENTDECK_TEST_LINK",&link).env("AGENTDECK_TEST_TARGET",&outside).output().unwrap();
    assert!(
        status.status.success(),
        "{}",
        String::from_utf8_lossy(&status.stderr)
    );
    assert!(paths::file(&h.core.store, s(&p, "projectId"), "escape/secret.txt").is_err());
}
#[tokio::test]
async fn multiple_pairing_invitations_and_devices_remain_independent() {
    let h = Harness::new();
    let first = h
        .core
        .pairing
        .create(&h.core.store, &h.core.endpoint(), &h.core.tls.fingerprint)
        .unwrap();
    let second = h
        .core
        .pairing
        .create_versioned(
            &h.core.store,
            &h.core.endpoint(),
            &h.core.tls.fingerprint,
            2,
        )
        .unwrap();
    assert_eq!(first["v"], 1);
    assert!(first.get("tlsServerName").is_none());
    assert_eq!(second["tlsServerName"], "127.0.0.1");
    let mut replies = Vec::new();
    for qr in [&first, &second] {
        let (reply, _) = h.core.pairing.request(&json!({"token":qr["token"],"displayName":"Independent device","nonce":security::token()})).unwrap();
        replies.push(reply);
    }
    assert_eq!(h.core.pairing.pending_all().len(), 2);
    let mut devices = Vec::new();
    for reply in &replies {
        h.core
            .local_action(
                json!({"action":"pair.confirm","requestId":reply["requestId"],"approve":true}),
            )
            .await
            .unwrap();
        devices.push(
            h.core
                .pairing
                .claim(
                    &h.core.store,
                    &json!({"requestId":reply["requestId"],"claimToken":reply["claimToken"]}),
                )
                .unwrap(),
        );
    }
    assert!(h.core.pairing.pending_all().is_empty());
    for device in &devices {
        assert_eq!(
            pairing::Pairing::authenticate(&h.core.store, s(device, "credential"))
                .unwrap()
                .as_deref(),
            Some(s(device, "deviceId"))
        );
    }
    // Requests and independent authorization must survive a service restart.
    h.core
        .store
        .reserve(
            s(&devices[1], "deviceId"),
            "known-operation",
            "turn.start",
            &json!({"text":"do not repeat"}),
        )
        .unwrap();
    h.core.revoke_device(s(&devices[0], "deviceId")).unwrap();
    assert!(
        pairing::Pairing::authenticate(&h.core.store, s(&devices[0], "credential"))
            .unwrap()
            .is_none()
    );
    let reopened = Store::open(&h._directory.path().join("test.db")).unwrap();
    assert!(
        pairing::Pairing::authenticate(&reopened, s(&devices[1], "credential"))
            .unwrap()
            .is_some()
    );
    assert_eq!(
        reopened
            .reserve(
                s(&devices[1], "deviceId"),
                "known-operation",
                "turn.start",
                &json!({"text":"do not repeat"})
            )
            .unwrap_err()
            .code,
        "OUTCOME_UNKNOWN"
    );
}

#[tokio::test]
async fn pairing_and_revoking_one_device_preserves_other_devices_approval() {
    let h = Harness::fixture().await;
    for id in ["first-device", "second-device"] {
        h.core
            .store
            .add_device(id, id, &digest(security::token()))
            .unwrap();
        h.core.connected.lock().unwrap().insert(id.into(), 1);
    }
    let session = h.session("multiple-approval").await;
    let turn = h
        .core
        .start_turn(s(&session, "sessionId"), "APPROVAL")
        .await
        .unwrap();
    h.wait(s(&turn, "turnId"), "waitingApproval").await;
    let approval = h.core.store.approvals(None).unwrap().remove(0);
    let qr = h
        .core
        .pairing
        .create(&h.core.store, &h.core.endpoint(), &h.core.tls.fingerprint)
        .unwrap();
    let (reply, _) = h
        .core
        .pairing
        .request(
            &json!({"token":qr["token"],"displayName":"Third device","nonce":security::token()}),
        )
        .unwrap();
    h.core
        .local_action(
            json!({"action":"pair.confirm","requestId":reply["requestId"],"approve":true}),
        )
        .await
        .unwrap();
    h.core.revoke_device("first-device").unwrap();
    assert_eq!(
        h.core.store.approvals(None).unwrap()[0]["approvalId"],
        approval["approvalId"]
    );
    h.core
        .decide(
            s(&session, "sessionId"),
            s(&turn, "turnId"),
            s(&approval, "approvalId"),
            "approve",
        )
        .unwrap();
    h.wait(s(&turn, "turnId"), "completed").await;
}

#[tokio::test]
async fn pairing_queue_is_bounded_without_invalidating_previous_invitations() {
    let h = Harness::new();
    let mut invites = Vec::new();
    for _ in 0..16 {
        invites.push(
            h.core
                .pairing
                .create(&h.core.store, &h.core.endpoint(), &h.core.tls.fingerprint)
                .unwrap(),
        );
    }
    assert_eq!(
        h.core
            .pairing
            .create(&h.core.store, &h.core.endpoint(), &h.core.tls.fingerprint)
            .unwrap_err()
            .code,
        "RATE_LIMITED"
    );
    for qr in invites {
        h.core.pairing.request(&json!({"token":qr["token"],"displayName":"Queued device","nonce":security::token()})).unwrap();
    }
    assert_eq!(h.core.pairing.pending_all().len(), 16);
}

#[tokio::test]
async fn pair_requires_human_and_single_claim() {
    let h = Harness::new();
    let qr = h
        .core
        .pairing
        .create(
            &h.core.store,
            "https://127.0.0.1:12345",
            &h.core.tls.fingerprint,
        )
        .unwrap();
    let input =
        json!({"token":qr["token"],"displayName":"Fixture tablet","nonce":security::token()});
    let (reply, _) = h.core.pairing.request(&input).unwrap();
    assert!(h.core.pairing.request(&input).is_err());
    let claim = json!({"requestId":reply["requestId"],"claimToken":reply["claimToken"]});
    assert_eq!(
        h.core.pairing.claim(&h.core.store, &claim).unwrap()["status"],
        "pending"
    );
    h.core
        .pairing
        .confirm(&h.core.store, s(&reply, "requestId"), true)
        .unwrap();
    let claimed = h.core.pairing.claim(&h.core.store, &claim).unwrap();
    assert!(
        pairing::Pairing::authenticate(&h.core.store, s(&claimed, "credential"))
            .unwrap()
            .is_some()
    );
    assert!(h.core.pairing.claim(&h.core.store, &claim).is_err());
    pairing::Pairing::revoke(&h.core.store, s(&claimed, "deviceId")).unwrap();
    assert!(
        pairing::Pairing::authenticate(&h.core.store, s(&claimed, "credential"))
            .unwrap()
            .is_none()
    );
}
#[tokio::test]
async fn rejected_pair_never_issues_credential() {
    let h = Harness::new();
    let qr = h
        .core
        .pairing
        .create(
            &h.core.store,
            "https://127.0.0.1:12345",
            &h.core.tls.fingerprint,
        )
        .unwrap();
    let (reply, _) = h
        .core
        .pairing
        .request(
            &json!({"token":qr["token"],"displayName":"Fixture tablet","nonce":security::token()}),
        )
        .unwrap();
    h.core
        .pairing
        .confirm(&h.core.store, s(&reply, "requestId"), false)
        .unwrap();
    let result = h
        .core
        .pairing
        .claim(
            &h.core.store,
            &json!({"requestId":reply["requestId"],"claimToken":reply["claimToken"]}),
        )
        .unwrap();
    assert_eq!(result["status"], "rejected");
    assert!(result.get("credential").is_none());
}
#[tokio::test]
async fn journal_sequence_gap_redaction_and_idempotency() {
    let h = Harness::new();
    for _ in 0..3 {
        h.core
            .store
            .append(
                "fixture",
                json!({"text":"Bearer fixture-secret","credential":"never-store"}),
                Some("s"),
                None,
            )
            .unwrap();
    }
    let replay = h.core.store.replay("0", 2).unwrap();
    assert!(replay["more"] == true);
    assert_eq!(replay["events"][1]["seq"], 2);
    assert!(!replay.to_string().contains("fixture-secret"));
    h.core.store.set_meta("retentionFloor", "2").unwrap();
    assert!(h.core.store.replay("1", 100).is_err());
    assert!(h.core.store.replay("9999", 100).is_err());
    assert!(h
        .core
        .store
        .reserve("d", "id", "turn.start", &json!({"text":"once"}))
        .unwrap()
        .is_none());
    assert_eq!(
        h.core
            .store
            .reserve("d", "id", "turn.start", &json!({"text":"once"}))
            .unwrap_err()
            .code,
        "OUTCOME_UNKNOWN"
    );
    assert_eq!(
        h.core
            .store
            .reserve("d", "id", "turn.start", &json!({"text":"changed"}))
            .unwrap_err()
            .code,
        "CONFLICT"
    );
}
#[tokio::test]
async fn fixture_two_projects_and_authoritative_completion() {
    let h = Harness::fixture().await;
    let a = h.session("a").await;
    let b = h.session("b").await;
    let ta = h.core.start_turn(s(&a, "sessionId"), "WAIT").await.unwrap();
    let tb = h
        .core
        .start_turn(s(&b, "sessionId"), "FINISH")
        .await
        .unwrap();
    assert!(!tasks::terminal(s(&ta, "status")));
    h.wait(s(&tb, "turnId"), "completed").await;
    assert_eq!(
        h.core.store.turn(s(&ta, "turnId")).unwrap()["status"],
        "running"
    );
    let history = h.core.store.history(s(&a, "sessionId"), None, 100).unwrap();
    assert!(history.iter().all(|v| v["sessionId"] == a["sessionId"]));
    h.core
        .interrupt(s(&a, "sessionId"), s(&ta, "turnId"))
        .await
        .unwrap();
    h.wait(s(&ta, "turnId"), "interrupted").await;
}
#[tokio::test]
async fn fixture_approval_once_and_session_match() {
    let h = Harness::fixture().await;
    let session = h.session("a").await;
    let turn = h
        .core
        .start_turn(s(&session, "sessionId"), "APPROVAL")
        .await
        .unwrap();
    h.wait(s(&turn, "turnId"), "waitingApproval").await;
    let a = h.core.store.approvals(None).unwrap().remove(0);
    assert!(h
        .core
        .decide("wrong", s(&turn, "turnId"), s(&a, "approvalId"), "approve")
        .is_err());
    h.core
        .decide(
            s(&session, "sessionId"),
            s(&turn, "turnId"),
            s(&a, "approvalId"),
            "approve",
        )
        .unwrap();
    assert!(h
        .core
        .decide(
            s(&session, "sessionId"),
            s(&turn, "turnId"),
            s(&a, "approvalId"),
            "approve"
        )
        .is_err());
    h.wait(s(&turn, "turnId"), "completed").await;
}
#[tokio::test]
async fn fixture_denial_expiry_and_disconnect_fail_closed() {
    let h = Harness::fixture().await;
    let session = h.session("a").await;
    let turn = h
        .core
        .start_turn(s(&session, "sessionId"), "APPROVAL")
        .await
        .unwrap();
    h.wait(s(&turn, "turnId"), "waitingApproval").await;
    let a = h.core.store.approvals(None).unwrap().remove(0);
    h.core
        .store
        .exec(
            "UPDATE approvals SET expiresAt=? WHERE approvalId=?",
            ["2000-01-01T00:00:00.000Z", s(&a, "approvalId")],
        )
        .unwrap();
    assert!(h
        .core
        .decide(
            s(&session, "sessionId"),
            s(&turn, "turnId"),
            s(&a, "approvalId"),
            "approve"
        )
        .is_err());
    h.core.expire_due().unwrap();
    h.wait(s(&turn, "turnId"), "interrupted").await;
    let turn = h
        .core
        .start_turn(s(&session, "sessionId"), "APPROVAL")
        .await
        .unwrap();
    h.wait(s(&turn, "turnId"), "waitingApproval").await;
    h.core.invalidate_approvals(true).unwrap();
    h.wait(s(&turn, "turnId"), "interrupted").await;
}
#[tokio::test]
async fn upstream_crash_recovers_unknown() {
    let h = Harness::fixture().await;
    let session = h.session("a").await;
    let turn = h
        .core
        .start_turn(s(&session, "sessionId"), "WAIT")
        .await
        .unwrap();
    h.core.upstream().unwrap().stop();
    h.wait(s(&turn, "turnId"), "unknown").await;
    h.core.store.recover().unwrap();
    assert_eq!(
        h.core.store.turn(s(&turn, "turnId")).unwrap()["status"],
        "unknown"
    );
}
#[tokio::test]
async fn git_real_worktree_untracked_binary_and_truncation() {
    let h = Harness::new();
    let (p, root) = h.project("repo");
    let id = s(&p, "projectId");
    codex::sync_command("git.exe", &["init"], Some(&root)).unwrap();
    std::fs::write(root.join("a.txt"), "hello").unwrap();
    std::fs::write(root.join("binary.bin"), b"x\0y").unwrap();
    std::fs::write(root.join("large.txt"), vec![b'x'; 300 * 1024]).unwrap();
    let status = git::status(&h.core.store, id).await.unwrap();
    assert_eq!(status["files"].as_array().unwrap().len(), 3);
    for name in ["a.txt", "binary.bin", "large.txt"] {
        let entry = status["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["path"] == name)
            .unwrap();
        let diff = git::diff(&h.core.store, id, s(entry, "fileId"))
            .await
            .unwrap();
        assert_eq!(diff["binary"], name == "binary.bin");
        assert_eq!(diff["truncated"], name == "large.txt");
    }
    assert!(git::diff(&h.core.store, id, "arbitrary-path")
        .await
        .is_err());
}
#[tokio::test]
async fn git_status_rename_parser() {
    let values = git::parse(b"R  new name\0old name\0?? other\0");
    assert_eq!(values[0]["oldPath"], "old name");
    assert_eq!(values[0]["path"], "new name");
    assert_eq!(values[1]["untracked"], true);
}
#[tokio::test]
async fn revocation_closes_only_the_revoked_idle_websocket() {
    use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};
    let h = Harness::new();
    h.core.listen("127.0.0.1").await.unwrap();
    let (_, pem) = x509_parser::pem::parse_x509_pem(h.core.tls.cert.as_bytes()).unwrap();
    let mut roots = rustls::RootCertStore::empty();
    roots
        .add(rustls::pki_types::CertificateDer::from(pem.contents))
        .unwrap();
    let config = Arc::new(
        rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth(),
    );
    let mut sockets = Vec::new();
    for id in ["first-device", "second-device"] {
        let credential = security::token();
        h.core
            .store
            .add_device(id, id, &digest(&credential))
            .unwrap();
        let mut request = format!("wss://127.0.0.1:{}/api/v1/ws", h.core.port)
            .into_client_request()
            .unwrap();
        request.headers_mut().insert(
            "Authorization",
            format!("Bearer {credential}").parse().unwrap(),
        );
        let (mut socket, _) = tokio_tungstenite::connect_async_tls_with_config(
            request,
            None,
            false,
            Some(tokio_tungstenite::Connector::Rustls(config.clone())),
        )
        .await
        .unwrap();
        socket.send(Message::Text(json!({"v":1,"type":"request","id":"hello","action":"system.hello","payload":{"client":"multiple-devices-test","version":1}}).to_string().into())).await.unwrap();
        let response = socket.next().await.unwrap().unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(response.to_text().unwrap()).unwrap()["type"],
            "response"
        );
        sockets.push(socket);
    }
    h.core.revoke_device("first-device").unwrap();
    // No extra request/event/heartbeat is required to observe revocation.
    tokio::time::timeout(Duration::from_secs(2), async {
        while let Some(Ok(message)) = sockets[0].next().await {
            if matches!(message, Message::Close(_)) {
                break;
            }
        }
    })
    .await
    .unwrap();
    sockets[1].send(Message::Text(json!({"v":1,"type":"request","id":"still-authorized","action":"snapshot.get","payload":{}}).to_string().into())).await.unwrap();
    let response = tokio::time::timeout(Duration::from_secs(2), sockets[1].next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(response.to_text().unwrap()).unwrap()["id"],
        "still-authorized"
    );
    h.core.shutdown().await;
}

#[tokio::test]
async fn tls_websocket_auth_hello_replay_and_no_origin() {
    let h = Harness::new();
    h.core.listen("127.0.0.1").await.unwrap();
    let url = h.core.endpoint();
    let certificate = reqwest::Certificate::from_pem(h.core.tls.cert.as_bytes()).unwrap();
    let client = reqwest::Client::builder()
        .add_root_certificate(certificate)
        .build()
        .unwrap();
    let response = client
        .post(format!("{url}/api/v1/pair/request"))
        .header("Origin", "https://attacker.invalid")
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 401);
    assert!(
        tokio_tungstenite::connect_async(format!("wss://127.0.0.1:{}/api/v1/ws", h.core.port))
            .await
            .is_err()
    );
    let credential = security::token();
    h.core
        .store
        .replace_device("fixture-device", "Fixture tablet", &digest(&credential))
        .unwrap();
    let (_, pem) = x509_parser::pem::parse_x509_pem(h.core.tls.cert.as_bytes()).unwrap();
    let mut roots = rustls::RootCertStore::empty();
    roots
        .add(rustls::pki_types::CertificateDer::from(pem.contents))
        .unwrap();
    let config = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let mut req = format!("wss://127.0.0.1:{}/api/v1/ws", h.core.port)
        .into_client_request()
        .unwrap();
    req.headers_mut().insert(
        "Authorization",
        format!("Bearer {credential}").parse().unwrap(),
    );
    let (mut ws, _) = tokio_tungstenite::connect_async_tls_with_config(
        req,
        None,
        false,
        Some(tokio_tungstenite::Connector::Rustls(Arc::new(config))),
    )
    .await
    .unwrap();
    ws.send(tokio_tungstenite::tungstenite::Message::Text(
        json!({"v":1,"type":"request","id":"1","action":"snapshot.get","payload":{}})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let v: Value =
        serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
    assert_eq!(v["code"], "VERSION_REQUIRED");
    for (id, action, payload) in [
        ("2", "system.hello", json!({"client":"fixture","version":1})),
        ("3", "snapshot.get", json!({})),
        ("4", "events.replay", json!({"cursor":"0"})),
    ] {
        ws.send(tokio_tungstenite::tungstenite::Message::Text(
            json!({"v":1,"type":"request","id":id,"action":action,"payload":payload})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
        let v: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(v["type"], "response");
        assert_eq!(v["id"], id);
    }
    ws.close(None).await.unwrap();
    h.core.shutdown().await;
}

#[tokio::test]
async fn session_fork_preserves_original_identity_and_deduplicates_request() {
    let h = Harness::fixture().await;
    let source = h.session("fork-source").await;
    let id = s(&source, "sessionId");
    let r = protocol::parse(json!({"v":1,"type":"request","id":"fork-once","action":"sessions.fork","payload":{"sessionId":id}})).unwrap();
    let first = transport::handle_request(&h.core, &r, "fork-device").await;
    let again = transport::handle_request(&h.core, &r, "fork-device").await;
    assert_eq!(first, again);
    assert_eq!(
        h.core.store.session(id).unwrap()["upstreamThreadId"],
        source["upstreamThreadId"]
    );
    let sessions = h.core.store.sessions(None).unwrap();
    assert_eq!(sessions.len(), 2, "{first}");
    let fork = sessions.iter().find(|s| s["sessionId"] != id).unwrap();
    assert_ne!(fork["upstreamThreadId"], source["upstreamThreadId"]);
    assert_eq!(fork["upstream"]["forkedFromId"], source["upstreamThreadId"]);
}

#[tokio::test]
async fn session_fork_rejects_active_source_without_creating_copy() {
    let h = Harness::fixture().await;
    let source = h.session("active-fork").await;
    let id = s(&source, "sessionId");
    let turn = h.core.start_turn(id, "WAIT").await.unwrap();
    h.wait(s(&turn, "turnId"), "running").await;
    assert_eq!(
        h.core
            .manage_session("sessions.fork", &json!({"sessionId":id}))
            .await
            .unwrap_err()
            .code,
        "CONFLICT"
    );
    assert_eq!(h.core.store.sessions(None).unwrap().len(), 1);
}

#[tokio::test]
async fn session_fork_at_turn_uses_authoritative_boundary_and_rejects_unknown() {
    let h = Harness::fixture().await;
    let source = h.session("boundary-fork").await;
    let id = s(&source, "sessionId");
    let first = h.core.start_turn(id, "first").await.unwrap();
    h.wait(s(&first, "turnId"), "completed").await;
    let second = h.core.start_turn(id, "second").await.unwrap();
    h.wait(s(&second, "turnId"), "completed").await;
    let native = h
        .core
        .store
        .one(
            "SELECT upstreamTurnId FROM turns WHERE turnId=?",
            [s(&first, "turnId")],
        )
        .unwrap();
    let boundary = s(&native, "upstreamTurnId");
    assert_eq!(
        h.core
            .manage_session(
                "sessions.fork",
                &json!({"sessionId":id,"lastTurnId":"not-in-source"})
            )
            .await
            .unwrap_err()
            .code,
        "TURN_NOT_FOUND"
    );
    assert_eq!(h.core.store.sessions(None).unwrap().len(), 1);
    let fork = h
        .core
        .manage_session(
            "sessions.fork",
            &json!({"sessionId":id,"lastTurnId":boundary}),
        )
        .await
        .unwrap();
    let latest = h
        .core
        .latest_upstream_turn(s(&fork["session"], "sessionId"))
        .await
        .unwrap();
    assert_eq!(latest["turn"]["upstreamTurnId"], boundary);
    let original = h.core.latest_upstream_turn(id).await.unwrap();
    assert_ne!(original["turn"]["upstreamTurnId"], boundary);
}

#[tokio::test]
async fn session_image_reads_source_identity_and_rejects_changed_or_outside_content() {
    let h = Harness::fixture().await;
    let (project, root) = h.project("image-root");
    let session = h
        .core
        .create_session(s(&project, "projectId"), "HISTORY_IMAGE")
        .await
        .unwrap();
    let id = s(&session, "sessionId");
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    bytes.resize(60000, 0);
    std::fs::write(root.join("image.png"), &bytes).unwrap();
    let first = h
        .core
        .session_image(id, "image-turn", "image-item", 0, 0, None)
        .await
        .unwrap();
    assert_eq!(first["upstreamThreadId"], session["upstreamThreadId"]);
    assert_eq!(first["mime"], "image/png");
    assert_eq!(first["nextOffset"], 48 * 1024);
    let next = h
        .core
        .session_image(
            id,
            "image-turn",
            "image-item",
            0,
            48 * 1024,
            first["sha256"].as_str(),
        )
        .await
        .unwrap();
    assert!(next["nextOffset"].is_null());
    bytes[20] = 1;
    std::fs::write(root.join("image.png"), &bytes).unwrap();
    assert_eq!(
        h.core
            .session_image(
                id,
                "image-turn",
                "image-item",
                0,
                48 * 1024,
                first["sha256"].as_str()
            )
            .await
            .unwrap_err()
            .code,
        "CONTENT_CHANGED"
    );
    assert_eq!(
        h.core
            .session_image(id, "wrong-turn", "image-item", 0, 0, None)
            .await
            .unwrap_err()
            .code,
        "CONTENT_CHANGED"
    );
    std::fs::write(root.parent().unwrap().join("outside.png"), &bytes).unwrap();
    h.core
        .manage_session(
            "sessions.rename",
            &json!({"sessionId":id,"title":"HISTORY_IMAGE_OUTSIDE"}),
        )
        .await
        .unwrap();
    assert_eq!(
        h.core
            .session_image(id, "image-turn", "image-item", 0, 0, None)
            .await
            .unwrap_err()
            .code,
        "WORKSPACE_FORBIDDEN"
    );
}

#[test]
fn session_image_contract_has_no_caller_path_or_hashless_continuation() {
    for payload in [
        json!({"sessionId":"s","turnId":"t","itemId":"i","offset":1}),
        json!({"sessionId":"s","turnId":"t","itemId":"i","offset":0,"path":"C:/secret.png"}),
    ] {
        assert!(protocol::parse(
            json!({"v":1,"type":"request","id":"image","action":"sessions.image","payload":payload})
        )
        .is_err());
    }
}

#[tokio::test]
async fn native_queue_uses_source_state_and_deduplicates_mutations() {
    native_queue_workflow(false).await;
}
#[tokio::test]
async fn native_queue_start_checks_boundary_and_deduplicates_native_turn() {
    native_queue_workflow(true).await;
}
async fn native_queue_workflow(start: bool) {
    use agentdeck_service::rpc::ProtocolVersion;
    use base64::{engine::general_purpose::STANDARD, Engine};
    let h = Harness::new();
    let (project, root) = h.project("queue-root");
    let samples: Value = serde_json::from_str(
        include_str!("fixtures/protocol-samples.json").trim_start_matches('\u{feff}'),
    )
    .unwrap();
    let mut thread = samples["threadStart"]["thread"].clone();
    thread["id"] = json!("native-queue-thread");
    thread["cwd"] = json!(root);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("ws://{}", listener.local_addr().unwrap());
    let started = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let start_count = started.clone();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
        let mut entries: Vec<Value> = Vec::new();
        let mut counter = 0;
        while let Some(Ok(message)) = socket.next().await {
            if !message.is_text() {
                continue;
            }
            let packet: Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
            let p = &packet["params"];
            let result = match s(&packet, "method") {
                "thread/read" => json!({"thread":thread}),
                "thread/queue/list" => json!({"data":entries,"nextCursor":null}),
                "thread/queue/add" => {
                    counter += 1;
                    let entry = json!({"id":format!("q{counter}"),"clientUserMessageId":p["clientUserMessageId"],"input":p["input"]});
                    entries.push(entry.clone());
                    json!({"queuedSubmission":entry})
                }
                "thread/queue/update" => {
                    let entry = entries
                        .iter_mut()
                        .find(|e| e["id"] == p["queuedSubmissionId"])
                        .unwrap();
                    entry["input"] = p["input"].clone();
                    json!({"queuedSubmission":entry})
                }
                "thread/queue/delete" => {
                    let count = entries.len();
                    entries.retain(|e| e["id"] != p["queuedSubmissionId"]);
                    json!({"deleted":entries.len()!=count})
                }
                "thread/queue/reorder" => {
                    entries = p["queuedSubmissionIds"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|id| entries.iter().find(|e| e["id"] == *id).unwrap().clone())
                        .collect();
                    json!({})
                }
                "thread/turns/list" if start => {
                    json!({"data":[],"nextCursor":null,"backwardsCursor":null})
                }
                "thread/goal/get" if start => json!({"goal":null}),
                "config/read" if start => {
                    json!({"config":{"default_permissions":"agentdeck","sandbox_mode":null,"permissions":{"agentdeck":{"extends":":workspace","filesystem":{":root":"deny",":minimal":"read",":tmpdir":"deny",":slash_tmp":"deny"},"network":{"enabled":false}}}},"origins":{},"layers":null})
                }
                "thread/resume" if start => {
                    assert_eq!(p["approvalPolicy"], "on-request");
                    assert_eq!(p["approvalsReviewer"], "user");
                    assert_eq!(p["sandbox"], "workspace-write");
                    assert_eq!(p["config"]["default_permissions"], "agentdeck");
                    let mut resumed = samples["resume"].clone();
                    resumed["cwd"] = json!(root);
                    resumed["thread"] = thread.clone();
                    resumed
                }
                "thread/queue/start" if start => {
                    let entry = entries
                        .iter()
                        .position(|entry| entry["id"] == p["queuedSubmissionId"])
                        .unwrap();
                    entries.remove(entry);
                    start_count.fetch_add(1, Ordering::SeqCst);
                    let mut turn = samples["terminal"]["turn"].clone();
                    turn["id"] = json!("native-queued-turn");
                    turn["status"] = json!("completed");
                    json!({"turn":turn})
                }
                method => panic!("Unexpected execution or configuration method: {method}"),
            };
            socket
                .send(tokio_tungstenite::tungstenite::Message::Text(
                    json!({"id":packet["id"],"result":result})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
        }
    });
    let (rpc, _events) = Rpc::connect_local_websocket_profile(
        &endpoint,
        &"a".repeat(43),
        ProtocolVersion::DesktopBaseline,
    )
    .await
    .unwrap();
    *h.core.rpc.write().unwrap() = Some(rpc.clone());
    h.core.ready.store(true, Ordering::SeqCst);
    h.core
        .store
        .exec(
            "INSERT INTO sessions VALUES(?,?,?,?,?,?,?)",
            rusqlite::params![
                "queue-session",
                s(&project, "projectId"),
                "native-queue-thread",
                "queue",
                "idle",
                now(),
                now()
            ],
        )
        .unwrap();
    let add = request(
        "queue.add",
        json!({"sessionId":"queue-session","text":"one","attachments":[{"name":"queued.png","data":STANDARD.encode(b"\x89PNG\r\n\x1a\nqueued")}]}),
        "queue-once",
    );
    let first = transport::handle_request(&h.core, &add, "queue-device").await;
    assert_eq!(first["type"], "response", "{first}");
    assert_eq!(
        transport::handle_request(&h.core, &add, "queue-device").await,
        first
    );
    h.core
        .native_queue(
            "queue.add",
            &json!({"sessionId":"queue-session","text":"two"}),
            "second",
        )
        .await
        .unwrap();
    h.core
        .native_queue(
            "queue.reorder",
            &json!({"sessionId":"queue-session","submissionIds":["q2","q1"]}),
            "reorder",
        )
        .await
        .unwrap();
    let state = h
        .core
        .native_queue("queue.list", &json!({"sessionId":"queue-session"}), "")
        .await
        .unwrap();
    assert_eq!(state["data"].as_array().unwrap().len(), 2);
    assert_eq!(state["data"][0]["id"], "q2");
    let image = &state["data"][1]["input"][1];
    assert_eq!(image["type"], "localImage");
    assert!(
        std::path::Path::new(s(image, "path")).starts_with(h._directory.path().join("attachments"))
    );
    h.core
        .native_queue(
            "queue.update",
            &json!({"sessionId":"queue-session","submissionId":"q1","text":"changed","expectedInputRevision":state["data"][1]["inputRevision"]}),
            "update",
        )
        .await
        .unwrap();
    h.core
        .native_queue(
            "queue.delete",
            &json!({"sessionId":"queue-session","submissionId":"q2"}),
            "delete",
        )
        .await
        .unwrap();
    let state = h
        .core
        .native_queue("queue.list", &json!({"sessionId":"queue-session"}), "")
        .await
        .unwrap();
    assert_eq!(state["data"][0]["input"][0]["text"], "changed");
    assert!(h
        .core
        .native_queue(
            "queue.reorder",
            &json!({"sessionId":"queue-session","submissionIds":["missing"]}),
            ""
        )
        .await
        .is_err());
    assert!(h.core.store.turns(None).unwrap().is_empty());
    let before = h.core.store.cursor().unwrap();
    h.core
        .notification(
            &rpc,
            &json!({"method":"thread/queue/changed","params":{"threadId":"native-queue-thread"}}),
        )
        .unwrap();
    assert_ne!(before, h.core.store.cursor().unwrap());
    if start {
        let call = request(
            "queue.start",
            json!({"sessionId":"queue-session","submissionId":"q1"}),
            "queue-start-once",
        );
        h.core.verified.store(false, Ordering::SeqCst);
        assert_eq!(
            h.core
                .native_queue("queue.start", &call.payload, "denied")
                .await
                .unwrap_err()
                .code,
            "SANDBOX_UNVERIFIED"
        );
        assert_eq!(started.load(Ordering::SeqCst), 0);
        h.core.verified.store(true, Ordering::SeqCst);
        let response = transport::handle_request(&h.core, &call, "queue-device").await;
        assert_eq!(response["type"], "response", "{response}");
        assert_eq!(
            transport::handle_request(&h.core, &call, "queue-device").await,
            response
        );
        assert_eq!(started.load(Ordering::SeqCst), 1);
        let turns = h.core.store.turns(Some("queue-session")).unwrap();
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0]["upstreamTurnId"], "native-queued-turn");
        assert_eq!(turns[0]["status"], "completed");
    }
    rpc.stop();
    server.abort();
}

#[tokio::test]
async fn session_revert_preserves_identity_invalidates_previews_and_deduplicates() {
    let h = Harness::fixture().await;
    let source = h.session("history-revert").await;
    let id = s(&source, "sessionId");
    let first = h.core.start_turn(id, "first").await.unwrap();
    h.wait(s(&first, "turnId"), "completed").await;
    let first_native = h.core.store.turn(s(&first, "turnId")).unwrap()["upstreamTurnId"].clone();
    let second = h.core.start_turn(id, "second").await.unwrap();
    h.wait(s(&second, "turnId"), "completed").await;
    let latest = h.core.latest_upstream_turn(id).await.unwrap();
    let target = latest["turn"]["upstreamTurnId"].clone();
    let invalid = json!({"sessionId":id,"beforeTurnId":target,"expectedLastTurnId":"stale"});
    assert_eq!(
        h.core
            .manage_session("sessions.revert", &invalid)
            .await
            .unwrap_err()
            .code,
        "SYNC_CONFLICT"
    );
    let r = request(
        "sessions.revert",
        json!({"sessionId":id,"beforeTurnId":target,"expectedLastTurnId":target}),
        "revert-once",
    );
    let result = transport::handle_request(&h.core, &r, "revert-device").await;
    assert_eq!(result["type"], "response", "{result}");
    assert_eq!(
        transport::handle_request(&h.core, &r, "revert-device").await,
        result
    );
    assert_eq!(
        h.core.store.session(id).unwrap()["upstreamThreadId"],
        source["upstreamThreadId"]
    );
    assert_eq!(
        h.core.latest_upstream_turn(id).await.unwrap()["turn"]["upstreamTurnId"],
        first_native
    );
    assert!(h
        .core
        .store
        .query(
            "SELECT * FROM events WHERE sessionId=? AND action='turn.queued'",
            [id]
        )
        .unwrap()
        .is_empty());
    assert!(!h
        .core
        .store
        .query(
            "SELECT * FROM events WHERE sessionId=? AND action='session.historyChanged'",
            [id]
        )
        .unwrap()
        .is_empty());
    assert!(h.core.store.meta("retentionFloor").unwrap().is_some());
}

#[tokio::test]
async fn session_resource_revision_retains_native_image_and_deduplicates_replacement() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let h = Harness::fixture().await;
    let session = h.session("REVISION_RESOURCES").await;
    let id = s(&session, "sessionId");
    let files = json!([{"name":"original.png","data":STANDARD.encode(b"\x89PNG\r\n\x1a\nimage")}]);
    let original = h
        .core
        .start_turn_composer(id, "seed", None, None, "workspace", "default", Some(&files))
        .await
        .unwrap();
    h.wait(s(&original, "turnId"), "completed").await;
    let latest = h.core.latest_upstream_turn(id).await.unwrap();
    let target = s(&latest["turn"], "upstreamTurnId");
    let image = h
        .core
        .session_image(id, target, &format!("user-{target}"), 1, 0, None)
        .await
        .unwrap();
    assert_eq!(
        STANDARD.decode(s(&image, "data")).unwrap(),
        b"\x89PNG\r\n\x1a\nimage"
    );
    h.core.store.retain().unwrap();
    assert_eq!(
        h.core
            .store
            .query("SELECT * FROM attachment_refs WHERE sessionId=?", [id])
            .unwrap()
            .len(),
        1
    );
    let bad = json!({"sessionId":id,"beforeTurnId":target,"expectedLastTurnId":target,"itemId":"missing","text":"replacement"});
    assert_eq!(
        h.core
            .manage_session("sessions.revise", &bad)
            .await
            .unwrap_err()
            .code,
        "CONTENT_CHANGED"
    );
    assert_eq!(
        h.core.latest_upstream_turn(id).await.unwrap()["turn"]["upstreamTurnId"],
        target
    );
    let r = request(
        "sessions.revise",
        json!({"sessionId":id,"beforeTurnId":target,"expectedLastTurnId":target,"itemId":format!("user-{target}"),"text":"CHECK_REVISION_RESOURCES","permissionMode":"workspace","mode":"default"}),
        "resource-revision-once",
    );
    let result = transport::handle_request(&h.core, &r, "revision-device").await;
    assert_eq!(result["type"], "response", "{result}");
    assert_eq!(result["payload"]["retainedImages"], 1, "{result}");
    assert_eq!(
        transport::handle_request(&h.core, &r, "revision-device").await,
        result
    );
    assert_eq!(
        h.core.store.session(id).unwrap()["upstreamThreadId"],
        session["upstreamThreadId"]
    );
    let turn = h.core.latest_upstream_turn(id).await.unwrap();
    assert_ne!(turn["turn"]["upstreamTurnId"], target);
}

#[tokio::test]
async fn account_status_projects_metadata_without_credentials_or_mutation_journal() {
    let h = Harness::fixture().await;
    let r = request("account.status", json!({}), "read-account-once");
    let result = transport::handle_request(&h.core, &r, "account-device").await;
    assert_eq!(result["type"], "response", "{result}");
    assert_eq!(result["payload"]["account"]["type"], "apiKey");
    assert_eq!(result["payload"]["usage"]["ordinaryUsageAllowed"], false);
    assert_eq!(
        result["payload"]["usage"]["buckets"][0]["primary"]["usedPercent"],
        37
    );
    assert!(!result.to_string().contains("fixture-secret"));
    assert!(h
        .core
        .store
        .query(
            "SELECT * FROM requests WHERE deviceId=?",
            ["account-device"]
        )
        .unwrap()
        .is_empty());
}
