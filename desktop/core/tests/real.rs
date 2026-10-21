//! Opt-in local checks. Never part of unattended CI and never a tablet acceptance substitute.
use agentdeck_service::{security::Certificate, service::Core, store::Store, *};
use serde_json::json;
use std::{
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
#[tokio::test]
#[ignore = "requires installed Codex and Windows MXC; creates an ephemeral thread without model requests"]
async fn real_codex_thread_start() {
    let exe = codex::find().unwrap();
    assert_eq!(exe, paths::canonical(&exe).unwrap());
    codex::verify(&exe).unwrap();
    let root = tempfile::tempdir().unwrap();
    let store = Arc::new(Store::open(&root.path().join("test.db")).unwrap());
    let tls = Certificate::load(root.path()).unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::channel(32);
    let output = tokio::spawn(async move { while rx.recv().await.is_some() {} });
    let core = Core::new(store, tls, "127.0.0.1".into(), 49329, tx);
    let owner = core.clone();
    let supervisor = tokio::spawn(async move {
        owner.supervise(exe).await;
    });
    let until = tokio::time::Instant::now() + Duration::from_secs(60);
    while !core.ready.load(Ordering::SeqCst) && tokio::time::Instant::now() < until {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let rpc = core.upstream().unwrap();
    codex::settings(&rpc, root.path()).await.unwrap();
    let response = rpc
        .request(
            "thread/start",
            json!({
                "cwd": root.path(), "approvalPolicy": "on-request",
                "approvalsReviewer": "user", "ephemeral": true,
                "config": {"default_permissions": "agentdeck"}
            }),
        )
        .await
        .unwrap();
    rpc::validate("v2/ThreadStartResponse", &response).unwrap();
    codex::checked_thread(&response, &paths::canonical(root.path()).unwrap(), true).unwrap();
    core.shutdown().await;
    supervisor.abort();
    output.abort();
}
#[test]
#[ignore = "requires an explicit isolated backup of the current Windows data"]
fn migrated_data_identity() {
    let directory = PathBuf::from(
        std::env::var_os("AGENTDECK_TEST_DATA_DIR").expect("isolated data backup required"),
    );
    let store = Store::open(&directory.join("agentdeck.db")).unwrap();
    let cert = Certificate::load(&directory).unwrap();
    let projects = store.projects().unwrap();
    assert!(!projects.is_empty());
    for project in &projects {
        paths::root(&store, s(project, "projectId"))
            .unwrap_or_else(|e| panic!("{}: {e}", s(project, "name")));
    }
    let report = json!({"result":"PASS","backend":"Rust","projectsVerified":projects.len(),"devices":store.query("SELECT deviceId FROM devices WHERE revokedAt IS NULL",[]).unwrap().len(),"hostId":store.meta("hostId").unwrap(),"certificateFingerprint":cert.fingerprint,"port":store.meta("listenPort").unwrap()});
    std::fs::write(directory.join("native-data-check.json"), report.to_string()).unwrap();
}
#[tokio::test]
#[ignore = "uses the real model to commit only a temporary test repository in full-access mode"]
async fn real_full_access_git_commit() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("repo");
    std::fs::create_dir(&root).unwrap();
    codex::sync_command("git.exe", &["init", "--quiet"], Some(&root)).unwrap();
    std::fs::write(root.join("sentinel.txt"), "full-access-test\n").unwrap();
    let store = Arc::new(Store::open(&directory.path().join("test.db")).unwrap());
    let project = paths::add_local(&store, &root).unwrap();
    let tls = Certificate::load(directory.path()).unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::channel(32);
    let output = tokio::spawn(async move { while rx.recv().await.is_some() {} });
    let core = Core::new(store, tls, "127.0.0.1".into(), 49329, tx);
    core.verified.store(true, Ordering::SeqCst);
    let owner = core.clone();
    let supervisor = tokio::spawn(async move {
        owner.supervise(codex::find().unwrap()).await;
    });
    let until = tokio::time::Instant::now() + Duration::from_secs(60);
    while !core.ready.load(Ordering::SeqCst) && tokio::time::Instant::now() < until {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let session = core
        .create_session(s(&project, "projectId"), "Isolated full-access git test")
        .await
        .unwrap();
    let prompt = "This is an isolated temporary test repository. Only in the current working directory, run git add sentinel.txt, then git -c user.name=AgentDeckTest -c user.email=agentdeck-test@example.invalid -c core.hooksPath=NUL commit -m full-access-test. Do not push, inspect other projects, or change any other files. Report the result.";
    for (index, mode) in ["full", "workspace", "full"].into_iter().enumerate() {
        if index == 2 {
            let previous = core.upstream().unwrap();
            previous.stop();
            let until = tokio::time::Instant::now() + Duration::from_secs(60);
            loop {
                if core
                    .upstream()
                    .is_ok_and(|rpc| rpc.generation != previous.generation)
                {
                    break;
                }
                assert!(tokio::time::Instant::now() < until, "Codex did not restart");
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
        core.loaded.lock().unwrap().clear();
        let text = if mode == "full"
            && codex::sync_command("git.exe", &["rev-parse", "--verify", "HEAD"], Some(&root))
                .is_err()
        {
            prompt
        } else {
            "Reply exactly MODE_OK without calling tools or changing files."
        };
        let turn = core
            .start_turn_permissions(s(&session, "sessionId"), text, None, None, mode)
            .await
            .unwrap();
        let until = tokio::time::Instant::now() + Duration::from_secs(180);
        loop {
            let current = core.store.turn(s(&turn, "turnId")).unwrap();
            if tasks::terminal(s(&current, "status")) {
                assert_eq!(current["status"], "completed", "{current}");
                break;
            }
            assert!(tokio::time::Instant::now() < until, "Timed out: {current}");
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
    assert!(core.store.approvals(None).unwrap().is_empty());
    let hash =
        codex::sync_command("git.exe", &["rev-parse", "--verify", "HEAD"], Some(&root)).unwrap();
    assert!(!hash.trim().is_empty());
    assert!(
        codex::sync_command("git.exe", &["status", "--porcelain"], Some(&root))
            .unwrap()
            .trim()
            .is_empty()
    );
    std::fs::create_dir_all(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../artifacts")).unwrap();
    std::fs::write(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/full-access-git-test.json"), json!({"passed":true,"commit":hash.trim(),"approvals":0,"modes":["full","workspace","full"],"scope":"temporary repository only"}).to_string()).unwrap();
    core.shutdown().await;
    supervisor.abort();
    output.abort();
}
#[tokio::test]
#[ignore = "uses the real logged-in Codex environment and actual model requests"]
async fn real_codex_completion_and_resume() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("authorized");
    std::fs::create_dir(&root).unwrap();
    let store = Arc::new(Store::open(&directory.path().join("test.db")).unwrap());
    let project = paths::add_local(&store, &root).unwrap();
    let tls = Certificate::load(directory.path()).unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::channel::<serde_json::Value>(32);
    let output = tokio::spawn(async move {
        while let Some(v) = rx.recv().await {
            if v["type"] == "error" {
                eprintln!("{}", v["payload"]);
            }
        }
    });
    let core = Core::new(store, tls, "127.0.0.1".into(), 49329, tx);
    let exe = codex::find().unwrap();
    codex::verify(&exe).unwrap();
    let boundary =
        service::boundary_runtime(&exe, Path::new(env!("CARGO_BIN_EXE_agentdeck-service")))
            .await
            .unwrap();
    assert_eq!(boundary["passed"], true);
    core.verified.store(true, Ordering::SeqCst);
    let owner = core.clone();
    let supervisor = tokio::spawn(async move {
        owner.supervise(exe).await;
    });
    let until = tokio::time::Instant::now() + Duration::from_secs(60);
    while !core.ready.load(Ordering::SeqCst) && tokio::time::Instant::now() < until {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(core.ready.load(Ordering::SeqCst));
    let models = core.models().await.unwrap();
    let selected = models
        .iter()
        .find(|m| m["isDefault"] == true)
        .or(models.first())
        .expect("No available Codex model");
    let model = s(selected, "model");
    let effort = s(selected, "defaultReasoningEffort");
    let session = core
        .create_session(s(&project, "projectId"), "Native Rust real smoke")
        .await
        .unwrap();
    let mut statuses = vec![];
    for index in 0..2 {
        if index == 1 {
            core.loaded.lock().unwrap().clear();
        }
        let turn=core.start_turn_options(s(&session,"sessionId"),"Reply exactly AGENTDECK_RUST_OK. Do not call any tools, execute commands, or change any files.",Some(model),Some(effort)).await.unwrap();
        let until = tokio::time::Instant::now() + Duration::from_secs(120);
        let final_turn = loop {
            let t = core.store.turn(s(&turn, "turnId")).unwrap();
            if tasks::terminal(s(&t, "status")) {
                break t;
            }
            assert!(
                tokio::time::Instant::now() < until,
                "No authoritative completion: {t}"
            );
            tokio::time::sleep(Duration::from_millis(100)).await;
        };
        assert_eq!(final_turn["status"], "completed", "{final_turn}");
        statuses.push(final_turn["status"].clone());
    }
    let history = core
        .store
        .history(s(&session, "sessionId"), None, 500)
        .unwrap();
    assert!(history
        .iter()
        .any(|e| e["payload"].to_string().contains("AGENTDECK_RUST_OK")));
    assert!(core.store.approvals(None).unwrap().is_empty());
    let id = s(&session, "sessionId");
    for (action, payload) in [
        (
            "sessions.rename",
            json!({"sessionId":id,"title":"AgentDeck isolated management smoke"}),
        ),
        ("sessions.archive", json!({"sessionId":id})),
        ("sessions.restore", json!({"sessionId":id})),
        ("sessions.delete", json!({"sessionId":id})),
    ] {
        core.manage_session(action, &payload).await.unwrap();
    }
    assert!(core.store.session(id).is_err());
    let report = json!({"at":now(),"result":"PASS","backend":"Rust","boundary":boundary,"actualCodexVersion":codex::VERSION,"terminalStatuses":statuses,"streamingEvents":history.iter().filter(|v|v["action"]=="turn.progress").count(),"resume":true,"model":model,"effort":effort,"modelCatalog":models.len(),"sessionManagement":["rename","archive","restore","delete"],"scope":"Only the isolated thread created by this test","humanApproval":"NOT REQUESTED: text-only task","physicalTablet":"NOT TESTED"});
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../artifacts");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("native-real-codex.json"), report.to_string()).unwrap();
    core.shutdown().await;
    supervisor.abort();
    output.abort();
}
