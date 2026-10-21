//! Shared-runtime transport checks: never start a model or alter user state.
use agentdeck_service::rpc::Rpc;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{sync::atomic::Ordering, time::Duration};
use tokio_tungstenite::{
    accept_hdr_async,
    tungstenite::{
        handshake::server::{Request, Response},
        Message,
    },
};

fn credential() -> String {
    "a".repeat(43)
}

#[tokio::test]
#[ignore = "explicit desktop baseline binary; isolated HOME, no model or user history"]
async fn real_desktop_baseline_uses_versioned_rust_contracts() {
    use agentdeck_service::{codex, rpc::ProtocolVersion};
    let executable =
        std::env::var_os("AGENTDECK_DESKTOP_PROBE_EXE").expect("set desktop baseline executable");
    let version = codex::sync_command(&executable.to_string_lossy(), &["--version"], None).unwrap();
    assert_eq!(
        version.trim(),
        format!("codex-cli {}", ProtocolVersion::DesktopBaseline.version())
    );
    let boundary = agentdeck_service::service::boundary_runtime(
        std::path::Path::new(&executable),
        std::path::Path::new(env!("CARGO_BIN_EXE_agentdeck-service")),
    )
    .await
    .unwrap();
    assert_eq!(
        boundary["passed"], true,
        "desktop baseline native boundary failed"
    );
    let directory = tempfile::tempdir().unwrap();
    let home = directory.path().join("home");
    let project = directory.path().join("project");
    std::fs::create_dir(&home).unwrap();
    std::fs::create_dir(&project).unwrap();
    let token = agentdeck_service::security::token();
    let token_file = directory.path().join("capability-token");
    std::fs::write(&token_file, &token).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("ws://{}", listener.local_addr().unwrap());
    drop(listener);
    let mut args = codex::args();
    let listen = args.iter().position(|value| value == "stdio://").unwrap();
    args[listen] = endpoint.clone();
    args.extend([
        "--ws-auth".into(),
        "capability-token".into(),
        "--ws-token-file".into(),
    ]);
    let mut child = tokio::process::Command::new(&executable)
        .args(args)
        .arg(&token_file)
        .env("CODEX_HOME", &home)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut attached = None;
    for _ in 0..60 {
        assert!(
            child.try_wait().unwrap().is_none(),
            "isolated desktop baseline server exited"
        );
        if let Ok(client) = Rpc::connect_local_websocket_profile(
            &endpoint,
            &token,
            ProtocolVersion::DesktopBaseline,
        )
        .await
        {
            attached = Some(client);
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let (a, mut first_events) = attached.expect("desktop baseline server startup timed out");
    let (b, mut second_events) =
        Rpc::connect_local_websocket_profile(&endpoint, &token, ProtocolVersion::DesktopBaseline)
            .await
            .unwrap();
    let drain_a = tokio::spawn(async move { while first_events.recv().await.is_some() {} });
    let drain_b = tokio::spawn(async move { while second_events.recv().await.is_some() {} });
    codex::initialize_attached(&a).await.unwrap();
    codex::initialize_attached(&b).await.unwrap();
    let created = a
        .request(
            "thread/start",
            json!({"cwd":project,"sandbox":"read-only","approvalPolicy":"on-request"}),
        )
        .await
        .unwrap();
    a.validate("v2/ThreadStartResponse", &created).unwrap();
    let id = created["thread"]["id"].clone();
    let named = a
        .request(
            "thread/name/set",
            json!({"threadId":id,"name":"Versioned desktop baseline"}),
        )
        .await
        .unwrap();
    a.validate("v2/ThreadSetNameResponse", &named).unwrap();
    let resumed = b.request("thread/resume", json!({"threadId":id,"cwd":project,"sandbox":"read-only","approvalPolicy":"on-request"})).await.unwrap();
    b.validate("v2/ThreadResumeResponse", &resumed).unwrap();
    assert_eq!(resumed["thread"]["id"], id);
    assert_eq!(resumed["thread"]["name"], "Versioned desktop baseline");
    // A genuinely new baseline method must pass that profile's outgoing schema.
    let owners = b
        .request(
            "thread/attachmentOwner/list",
            json!({"attachmentType":"probe","identityKey":"isolated-missing-attachment"}),
        )
        .await
        .unwrap();
    b.validate("v2/ThreadAttachmentOwnerListResponse", &owners)
        .unwrap();
    a.stop();
    tokio::time::timeout(Duration::from_secs(5), async {
        while a.alive.load(Ordering::SeqCst) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let read = b
        .request("thread/read", json!({"threadId":id,"includeTurns":false}))
        .await
        .unwrap();
    b.validate("v2/ThreadReadResponse", &read).unwrap();
    assert_eq!(read["thread"]["id"], id);
    assert!(child.try_wait().unwrap().is_none());
    // Verify the real binary entrypoint, not only the Rust library supervisor.
    let startup_directory = directory.path().join("startup");
    let free_port = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let startup_port = free_port.local_addr().unwrap().port().to_string();
    drop(free_port);
    let mut startup = tokio::process::Command::new(env!("CARGO_BIN_EXE_agentdeck-service"))
        .env("CODEX_HOME", &home)
        .env("AGENTDECK_CODEX_EXE", &executable)
        .env("AGENTDECK_DATA_DIR", &startup_directory)
        .env("AGENTDECK_PORT", startup_port)
        .env("AGENTDECK_STARTUP_CHECK", "1")
        .env("AGENTDECK_RUNTIME_WS_URL", &endpoint)
        .env("AGENTDECK_RUNTIME_TOKEN_FILE", &token_file)
        .env(
            "AGENTDECK_RUNTIME_PROTOCOL_VERSION",
            ProtocolVersion::DesktopBaseline.version(),
        )
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    // Child::wait closes a stdin still owned by Child. Keep the parent channel
    // open so the service does not correctly interpret EOF as host shutdown.
    let _startup_stdin = startup.stdin.take().unwrap();
    let startup_stdout = startup.stdout.take().unwrap();
    let startup_errors = tokio::spawn(async move {
        use tokio::io::AsyncBufReadExt;
        let mut lines = tokio::io::BufReader::new(startup_stdout).lines();
        let mut errors = Vec::new();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Ok(packet) = serde_json::from_str::<Value>(&line) {
                if packet["type"] == "error" && errors.len() < 16 {
                    errors.push(packet["payload"]["message"].clone());
                }
            }
        }
        errors
    });
    let status = tokio::time::timeout(Duration::from_secs(110), startup.wait())
        .await
        .unwrap()
        .unwrap();
    let errors = startup_errors.await.unwrap();
    assert!(
        status.success(),
        "desktop baseline service entrypoint failed: {errors:?}"
    );
    let report: Value = serde_json::from_slice(
        &std::fs::read(startup_directory.join("startup-check.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(report["result"], "PASS");
    assert_eq!(report["runtimeMode"], "attached-local-ws");
    assert_eq!(
        report["codexVersion"],
        ProtocolVersion::DesktopBaseline.version()
    );
    let startup_store =
        agentdeck_service::store::Store::open(&startup_directory.join("agentdeck.db")).unwrap();
    assert_eq!(
        startup_store
            .meta("sandboxVerifiedVersion")
            .unwrap()
            .as_deref(),
        Some(ProtocolVersion::DesktopBaseline.version())
    );
    let store = std::sync::Arc::new(
        agentdeck_service::store::Store::open(&directory.path().join("bridge.db")).unwrap(),
    );
    let granted = agentdeck_service::paths::add_local(&store, &project).unwrap();
    let tls = agentdeck_service::security::Certificate::load(directory.path()).unwrap();
    let (tx, mut output) = tokio::sync::mpsc::channel(32);
    let output_task = tokio::spawn(async move { while output.recv().await.is_some() {} });
    let core = agentdeck_service::service::Core::new(store, tls, "127.0.0.1".into(), 49321, tx);
    // Only the real successful boundary above authorizes the isolated Core.
    core.verified.store(true, Ordering::SeqCst);
    let target = agentdeck_service::runtime::RuntimeTarget::Attached {
        endpoint: endpoint.clone(),
        token_file,
        protocol: ProtocolVersion::DesktopBaseline,
    };
    let owner = core.clone();
    let supervisor = tokio::spawn(async move {
        owner.supervise_runtime(executable.into(), target).await;
    });
    tokio::time::timeout(Duration::from_secs(20), async {
        while !core.ready.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("desktop baseline Core did not become ready");
    assert_eq!(
        core.upstream().unwrap().protocol(),
        ProtocolVersion::DesktopBaseline
    );
    assert_eq!(
        core.snapshot().unwrap()["host"]["codexVersion"],
        ProtocolVersion::DesktopBaseline.version()
    );
    let session = core
        .create_session(
            granted["projectId"].as_str().unwrap(),
            "Supervised desktop baseline",
        )
        .await
        .unwrap();
    let read = b
        .request(
            "thread/read",
            json!({"threadId":session["upstreamThreadId"],"includeTurns":false}),
        )
        .await
        .unwrap();
    b.validate("v2/ThreadReadResponse", &read).unwrap();
    assert_eq!(read["thread"]["name"], "Supervised desktop baseline");
    let indexed = core.sync_thread_index().await.unwrap();
    if indexed != 2 {
        for params in [
            json!({"limit":100,"modelProviders":[]}),
            json!({"limit":100,"modelProviders":[],"useStateDbOnly":true}),
            json!({"limit":100,"modelProviders":[],"cwd":project}),
        ] {
            let listed = b.request("thread/list", params.clone()).await.unwrap();
            eprintln!(
                "isolated listing diagnostic: stateDbOnly={}, cwdFilter={}, rows={}",
                params["useStateDbOnly"],
                params.get("cwd").is_some(),
                listed["data"].as_array().unwrap().len()
            );
        }
    }
    assert_eq!(indexed, 2);
    let sessions = core.store.sessions(None).unwrap();
    let imported = sessions
        .iter()
        .find(|v| v["upstreamThreadId"] == id)
        .unwrap();
    let imported_id = imported["sessionId"].as_str().unwrap().to_owned();
    let history = core.upstream_history(&imported_id, None, 20).await.unwrap();
    assert!(history["data"].as_array().unwrap().is_empty());
    assert!(history["nextCursor"].is_null());
    assert_eq!(imported["title"], "Versioned desktop baseline");
    assert_eq!(imported["upstream"]["source"], created["thread"]["source"]);
    b.request(
        "thread/name/set",
        json!({"threadId":id,"name":"External title after import"}),
    )
    .await
    .unwrap();
    b.request("thread/archive", json!({"threadId":id}))
        .await
        .unwrap();
    assert_eq!(core.sync_thread_index().await.unwrap(), 2);
    let imported = core.store.session(&imported_id).unwrap();
    assert_eq!(imported["upstreamThreadId"], id);
    assert_eq!(imported["title"], "External title after import");
    assert_eq!(imported["archived"], 1);
    assert_eq!(
        core.store
            .session(session["sessionId"].as_str().unwrap())
            .unwrap()["upstreamThreadId"],
        session["upstreamThreadId"]
    );
    let generation = core.upstream().unwrap().generation.clone();
    core.upstream().unwrap().stop();
    tokio::time::timeout(Duration::from_secs(10), async {
        while !core
            .upstream()
            .is_ok_and(|rpc| rpc.generation != generation)
        {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("desktop baseline Core did not reconnect");
    assert_eq!(
        core.upstream().unwrap().protocol(),
        ProtocolVersion::DesktopBaseline
    );
    assert_eq!(
        core.store
            .session(session["sessionId"].as_str().unwrap())
            .unwrap()["upstreamThreadId"],
        session["upstreamThreadId"]
    );
    core.shutdown().await;
    tokio::time::timeout(Duration::from_secs(5), supervisor)
        .await
        .unwrap()
        .unwrap();
    assert!(child.try_wait().unwrap().is_none());
    let read = b
        .request(
            "thread/read",
            json!({"threadId":session["upstreamThreadId"],"includeTurns":false}),
        )
        .await
        .unwrap();
    b.validate("v2/ThreadReadResponse", &read).unwrap();
    assert_eq!(read["thread"]["id"], session["upstreamThreadId"]);
    output_task.abort();
    b.stop();
    child.kill().await.unwrap();
    child.wait().await.unwrap();
    drain_a.abort();
    drain_b.abort();
}

#[tokio::test]
async fn attached_initialize_rejects_other_versions_before_ready_notification() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("ws://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
        let request: Value =
            serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(request["method"], "initialize");
        socket.send(Message::Text(json!({"id":request["id"],"result":{"userAgent":"Codex Desktop/0.163.0-alpha.10.2 (Windows)","codexHome":"C:/isolated","platformFamily":"windows","platformOs":"windows"}}).to_string().into())).await.unwrap();
        while let Some(Ok(message)) = socket.next().await {
            if message.is_close() {
                break;
            }
            if let Message::Text(text) = message {
                let value: Value = serde_json::from_str(&text).unwrap();
                assert_ne!(value["method"], "initialized");
            }
        }
    });
    let (rpc, _events) = Rpc::connect_local_websocket(&endpoint, &credential())
        .await
        .unwrap();
    assert_eq!(
        agentdeck_service::codex::initialize_attached(&rpc)
            .await
            .unwrap_err()
            .code,
        "UPSTREAM_VERSION_UNSUPPORTED"
    );
    rpc.stop();
    server.await.unwrap();
}

#[tokio::test]
async fn dropping_event_consumer_disconnects_unused_client() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("ws://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
        while let Some(Ok(message)) = socket.next().await {
            if message.is_close() {
                return;
            }
        }
    });
    let (rpc, events) = Rpc::connect_local_websocket(&endpoint, &credential())
        .await
        .unwrap();
    drop(events);
    tokio::time::timeout(Duration::from_secs(2), server)
        .await
        .unwrap()
        .unwrap();
    assert!(!rpc.alive.load(Ordering::SeqCst));
}

#[tokio::test]
async fn stop_remains_responsive_when_notification_queue_is_full() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("ws://{}", listener.local_addr().unwrap());
    let (sent_tx, sent_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
        for seq in 0..140 {
            socket
                .send(Message::Text(
                    json!({"method":"probe/progress","params":{"seq":seq}})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
        }
        let _ = sent_tx.send(());
        while let Some(Ok(message)) = socket.next().await {
            if message.is_close() {
                break;
            }
        }
    });
    let (rpc, mut events) = Rpc::connect_local_websocket(&endpoint, &credential())
        .await
        .unwrap();
    sent_rx.await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    rpc.stop();
    tokio::time::timeout(Duration::from_secs(2), async {
        while rpc.alive.load(Ordering::SeqCst) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if events.recv().await.unwrap()["method"] == "$lost" {
                break;
            }
        }
    })
    .await
    .unwrap();
    server.await.unwrap();
}

#[tokio::test]
#[allow(clippy::result_large_err)] // tungstenite's handshake callback fixes its error type.
async fn authenticated_messages_and_client_stop_leave_listener_running() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("ws://{}", listener.local_addr().unwrap());
    let (closed_tx, closed_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = accept_hdr_async(stream, |request: &Request, response: Response| {
            assert_eq!(
                request.headers()["authorization"],
                format!("Bearer {}", credential())
            );
            Ok(response)
        })
        .await
        .unwrap();
        let request: Value =
            serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(request["method"], "thread/loaded/list");
        socket.send(Message::Ping(vec![1, 2].into())).await.unwrap();
        socket
            .send(Message::Text(
                json!({"id":request["id"],"result":{"data":["same-thread"]}})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        socket.send(Message::Text(json!({"method":"thread/name/updated","params":{"threadId":"same-thread","threadName":"updated"}}).to_string().into())).await.unwrap();
        while let Some(Ok(message)) = socket.next().await {
            if message.is_close() {
                break;
            }
        }
        let _ = closed_tx.send(());
        // A new connection is still accepted after the previous RPC client stops.
        let (_next, _) = listener.accept().await.unwrap();
    });
    let (rpc, mut events) = Rpc::connect_local_websocket(&endpoint, &credential())
        .await
        .unwrap();
    let response = rpc.request("thread/loaded/list", json!({})).await.unwrap();
    assert_eq!(response["data"][0], "same-thread");
    assert_eq!(
        events.recv().await.unwrap()["method"],
        "thread/name/updated"
    );
    rpc.stop();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(2), events.recv())
            .await
            .unwrap()
            .unwrap()["method"],
        "$lost"
    );
    assert!(!rpc.alive.load(Ordering::SeqCst));
    tokio::time::timeout(Duration::from_secs(2), closed_rx)
        .await
        .unwrap()
        .unwrap();
    let _connection = tokio::net::TcpStream::connect(endpoint.strip_prefix("ws://").unwrap())
        .await
        .unwrap();
    server.await.unwrap();
}

#[tokio::test]
#[ignore = "explicit local pinned Codex binary; isolated HOME, no model turn or user history"]
async fn real_pinned_runtime_accepts_two_rust_clients() {
    use agentdeck_service::{codex, rpc::validate};
    let executable =
        std::env::var_os("AGENTDECK_SHARED_PROBE_EXE").expect("set isolated probe executable");
    codex::verify(std::path::Path::new(&executable)).unwrap();
    let directory = tempfile::tempdir().unwrap();
    let home = directory.path().join("home");
    let project = directory.path().join("project");
    std::fs::create_dir(&home).unwrap();
    std::fs::create_dir(&project).unwrap();
    let token = agentdeck_service::security::token();
    let token_file = directory.path().join("capability-token");
    std::fs::write(&token_file, &token).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("ws://{}", listener.local_addr().unwrap());
    drop(listener);
    let mut args = codex::args();
    let listen = args.iter().position(|value| value == "stdio://").unwrap();
    args[listen] = endpoint.clone();
    args.extend([
        "--ws-auth".into(),
        "capability-token".into(),
        "--ws-token-file".into(),
    ]);
    let mut child = tokio::process::Command::new(&executable)
        .args(args)
        .arg(&token_file)
        .env("CODEX_HOME", &home)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut attached = None;
    for _ in 0..60 {
        assert!(
            child.try_wait().unwrap().is_none(),
            "isolated server exited"
        );
        if let Ok(client) = Rpc::connect_local_websocket(&endpoint, &token).await {
            attached = Some(client);
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let (a, mut first_events) = attached.expect("server startup timed out");
    let (b, mut second_events) = Rpc::connect_local_websocket(&endpoint, &token)
        .await
        .unwrap();
    let drain_a = tokio::spawn(async move { while first_events.recv().await.is_some() {} });
    let drain_b = tokio::spawn(async move { while second_events.recv().await.is_some() {} });
    codex::initialize(&a).await.unwrap();
    codex::initialize(&b).await.unwrap();
    let created = a
        .request(
            "thread/start",
            json!({"cwd":project,"sandbox":"read-only","approvalPolicy":"on-request"}),
        )
        .await
        .unwrap();
    validate("v2/ThreadStartResponse", &created).unwrap();
    let id = created["thread"]["id"].clone();
    let result = a
        .request(
            "thread/name/set",
            json!({"threadId":id,"name":"Isolated Rust shared runtime"}),
        )
        .await
        .unwrap();
    validate("v2/ThreadSetNameResponse", &result).unwrap();
    let read = b
        .request("thread/read", json!({"threadId":id,"includeTurns":false}))
        .await
        .unwrap();
    validate("v2/ThreadReadResponse", &read).unwrap();
    assert_eq!(read["thread"]["id"], id);
    assert_eq!(read["thread"]["name"], "Isolated Rust shared runtime");
    a.stop();
    tokio::time::timeout(Duration::from_secs(2), async {
        while a.alive.load(Ordering::SeqCst) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let read = b
        .request("thread/read", json!({"threadId":id,"includeTurns":false}))
        .await
        .unwrap();
    assert_eq!(read["thread"]["id"], id);
    assert!(child.try_wait().unwrap().is_none());
    // Exercise the production MXC boundary gate before creating a supervised
    // session. A connected socket by itself is not authorization to run tasks.
    let boundary = agentdeck_service::service::boundary_runtime(
        std::path::Path::new(&executable),
        std::path::Path::new(env!("CARGO_BIN_EXE_agentdeck-service")),
    )
    .await
    .unwrap();
    assert_eq!(boundary["passed"], true, "native boundary probe failed");
    let store = std::sync::Arc::new(
        agentdeck_service::store::Store::open(&directory.path().join("bridge.db")).unwrap(),
    );
    let granted = agentdeck_service::paths::add_local(&store, &project).unwrap();
    let tls = agentdeck_service::security::Certificate::load(directory.path()).unwrap();
    let (tx, mut output) = tokio::sync::mpsc::channel(32);
    let output_task = tokio::spawn(async move { while output.recv().await.is_some() {} });
    let core = agentdeck_service::service::Core::new(store, tls, "127.0.0.1".into(), 49321, tx);
    core.verified.store(true, Ordering::SeqCst);
    let owner = core.clone();
    let target = agentdeck_service::runtime::RuntimeTarget::Attached {
        endpoint: endpoint.clone(),
        token_file,
        protocol: agentdeck_service::rpc::ProtocolVersion::Managed,
    };
    let supervisor = tokio::spawn(async move {
        owner.supervise_runtime(executable.into(), target).await;
    });
    tokio::time::timeout(Duration::from_secs(20), async {
        while !core.ready.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("attached supervisor did not become ready");
    let session = core
        .create_session(
            granted["projectId"].as_str().unwrap(),
            "Shared supervised title",
        )
        .await
        .unwrap();
    let read = b
        .request(
            "thread/read",
            json!({"threadId":session["upstreamThreadId"],"includeTurns":false}),
        )
        .await
        .unwrap();
    assert_eq!(read["thread"]["name"], "Shared supervised title");
    assert!(core.attached_runtime.load(Ordering::SeqCst));
    let previous_generation = core.upstream().unwrap().generation.clone();
    core.upstream().unwrap().stop();
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if core
                .upstream()
                .is_ok_and(|rpc| rpc.generation != previous_generation)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("attached supervisor did not reconnect");
    assert_eq!(
        core.store
            .session(session["sessionId"].as_str().unwrap())
            .unwrap()["upstreamThreadId"],
        session["upstreamThreadId"]
    );
    core.shutdown().await;
    tokio::time::timeout(Duration::from_secs(5), supervisor)
        .await
        .unwrap()
        .unwrap();
    let read = b
        .request(
            "thread/read",
            json!({"threadId":session["upstreamThreadId"],"includeTurns":false}),
        )
        .await
        .unwrap();
    assert_eq!(read["thread"]["id"], session["upstreamThreadId"]);
    assert!(child.try_wait().unwrap().is_none());
    output_task.abort();
    b.stop();
    child.kill().await.unwrap();
    child.wait().await.unwrap();
    drain_a.abort();
    drain_b.abort();
}

#[tokio::test]
async fn malformed_response_fails_pending_request_and_signals_loss() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("ws://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
        let _ = socket.next().await;
        socket.send(Message::Text("[]".into())).await.unwrap();
        while let Some(Ok(message)) = socket.next().await {
            if message.is_close() {
                break;
            }
        }
    });
    let (rpc, mut events) = Rpc::connect_local_websocket(&endpoint, &credential())
        .await
        .unwrap();
    let error = rpc
        .request("thread/loaded/list", json!({}))
        .await
        .unwrap_err();
    assert_eq!(error.code, "UPSTREAM_UNAVAILABLE");
    assert_eq!(events.recv().await.unwrap()["method"], "$lost");
    server.await.unwrap();
}

#[tokio::test]
async fn authentication_failure_does_not_echo_endpoint_or_credential() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("ws://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut buffer = [0u8; 4096];
        let _ = stream.read(&mut buffer).await;
        stream
            .write_all(
                b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            )
            .await
            .unwrap();
    });
    let error = match Rpc::connect_local_websocket(&endpoint, &credential()).await {
        Ok(_) => panic!("unauthorized connection accepted"),
        Err(error) => error,
    };
    assert_eq!(error.code, "UPSTREAM_UNAVAILABLE");
    assert!(!error.message.contains(&credential()));
    assert!(!error.message.contains(&endpoint));
    server.await.unwrap();
}
