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
fn strict_android_protocol() {
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
async fn idle_writer_conflict_continues_history_without_stealing_lock() {
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
    let turn = h
        .core
        .start_turn_permissions(id, "CHECK_PERMISSION_FULL", None, None, "full")
        .await
        .unwrap();
    h.wait(s(&turn, "turnId"), "completed").await;
    assert_ne!(
        h.core.store.session(id).unwrap()["upstreamThreadId"],
        session["upstreamThreadId"]
    );
    assert_eq!(h.core.store.turns(Some(id)).unwrap().len(), 2);
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
