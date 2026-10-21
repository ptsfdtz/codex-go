//! Shared-runtime checks use isolated homes; model probes use loopback synthetic providers.
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
    desktop_baseline_contracts(false, false).await;
}

#[tokio::test]
#[ignore = "explicit desktop baseline binary; isolated HOME and synthetic loopback model"]
async fn real_desktop_baseline_persisted_history_through_core() {
    desktop_baseline_contracts(true, false).await;
}

#[tokio::test]
#[ignore = "explicit desktop baseline binary; isolated HOME and held synthetic model"]
async fn real_desktop_baseline_steers_original_turn_through_core() {
    desktop_baseline_contracts(false, true).await;
}

async fn native_request(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    id: &str,
    method: &str,
    params: Value,
) -> Value {
    socket
        .send(Message::Text(
            json!({"id":id,"method":method,"params":params})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let message = socket.next().await.unwrap().unwrap();
            if !message.is_text() {
                continue;
            }
            let packet: Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
            if packet["id"] == id {
                assert!(
                    packet.get("error").is_none(),
                    "isolated native project seed failed"
                );
                return packet["result"].clone();
            }
        }
    })
    .await
    .unwrap()
}

async fn desktop_baseline_contracts(with_history: bool, with_steering: bool) {
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
    let answer = "Persisted synthetic answer: 中文 😀\n```text\noriginal content\n```";
    let response_gate = std::sync::Arc::new(tokio::sync::Notify::new());
    let provider_gate = response_gate.clone();
    let hold_response = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(with_steering));
    let provider_hold = hold_response.clone();
    let provider_requests = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let provider_count = provider_requests.clone();
    let instruction_consumed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let provider_consumed = instruction_consumed.clone();
    let provider = if with_history || with_steering {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        std::fs::write(home.join("config.toml"), format!(
            "model = \"agentdeck-history-probe\"\nmodel_provider = \"history_probe\"\n[model_providers.history_probe]\nname = \"isolated synthetic history\"\nbase_url = \"http://{}/v1\"\nwire_api = \"responses\"\nrequires_openai_auth = false\nsupports_websockets = false\n",
            listener.local_addr().unwrap())).unwrap();
        Some(tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let response_gate = provider_gate.clone();
                let request_count = provider_count.clone();
                let consumed = provider_consumed.clone();
                let hold = provider_hold.clone();
                tokio::spawn(async move {
                    let mut request = Vec::new();
                    let mut buffer = [0u8; 8192];
                    loop {
                        let n = stream.read(&mut buffer).await.unwrap();
                        if n == 0 {
                            return;
                        }
                        request.extend_from_slice(&buffer[..n]);
                        assert!(request.len() < 1024 * 1024);
                        if let Some(end) = request.windows(4).position(|v| v == b"\r\n\r\n") {
                            let headers =
                                String::from_utf8_lossy(&request[..end]).to_ascii_lowercase();
                            let length = headers
                                .lines()
                                .find_map(|line| line.strip_prefix("content-length:"))
                                .unwrap()
                                .trim()
                                .parse::<usize>()
                                .unwrap();
                            if request.len() >= end + 4 + length {
                                break;
                            }
                        }
                    }
                    assert!(request.starts_with(b"POST /v1/responses "));
                    request_count.fetch_add(1, Ordering::SeqCst);
                    if String::from_utf8_lossy(&request)
                        .contains("Continue the exact original task.")
                    {
                        consumed.store(true, Ordering::SeqCst);
                    }
                    let item = json!({"id":"history-answer","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":answer,"annotations":[]}]});
                    let mut body = String::new();
                    for event in [
                        json!({"type":"response.created","response":{"id":"history-response","status":"in_progress","output":[]}}),
                        json!({"type":"response.output_item.added","output_index":0,"item":{"id":"history-answer","type":"message","role":"assistant","status":"in_progress","content":[]}}),
                        json!({"type":"response.output_text.delta","item_id":"history-answer","output_index":0,"content_index":0,"delta":answer}),
                        json!({"type":"response.output_item.done","output_index":0,"item":item}),
                        json!({"type":"response.completed","response":{"id":"history-response","status":"completed","output":[item],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}),
                    ] {
                        body.push_str(&format!(
                            "event: {}\ndata: {event}\n\n",
                            event["type"].as_str().unwrap()
                        ));
                    }
                    let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
                    if hold.swap(false, Ordering::SeqCst) {
                        let split =
                            response.find("\r\n\r\n").unwrap() + 4 + body.find("\n\n").unwrap() + 2;
                        if stream
                            .write_all(&response.as_bytes()[..split])
                            .await
                            .is_err()
                        {
                            return;
                        }
                        response_gate.notified().await;
                        let _ = stream.write_all(&response.as_bytes()[split..]).await;
                    } else {
                        let _ = stream.write_all(response.as_bytes()).await;
                    }
                    let _ = stream.shutdown().await;
                });
            }
        }))
    } else {
        None
    };
    let token = agentdeck_service::security::token();
    let token_file = directory.path().join("capability-token");
    std::fs::write(&token_file, &token).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("ws://{}", listener.local_addr().unwrap());
    drop(listener);
    let mut args = codex::args();
    args.extend([
        "-c".into(),
        "features.code_mode_host=true".into(),
        "-c".into(),
        "analytics.enabled=false".into(),
    ]);
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
        .env_remove("OPENAI_API_KEY")
        .env_remove("CODEX_API_KEY")
        .env_remove("HTTP_PROXY")
        .env_remove("HTTPS_PROXY")
        .env_remove("ALL_PROXY")
        .env("NO_PROXY", "127.0.0.1,localhost")
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
    if !with_history && !with_steering {
        // Seed through an independent native protocol client. Production Rust
        // exposes only the pinned project/list contract, never these writes.
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let mut request = endpoint.as_str().into_client_request().unwrap();
        request
            .headers_mut()
            .insert("Authorization", format!("Bearer {token}").parse().unwrap());
        let (mut source, _) = tokio_tungstenite::connect_async(request).await.unwrap();
        native_request(&mut source, "project-init", "initialize", json!({"clientInfo":{"name":"rust_project_seed","version":"0.3.0"},"capabilities":{"experimentalApi":true}})).await;
        source
            .send(Message::Text(
                json!({"method":"initialized","params":{}})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        let mut expected = std::collections::HashSet::new();
        for key in ["one", "two"] {
            let created = native_request(&mut source, key, "project/create", json!({"idempotencyKey":key,"name":format!("Isolated {key}"),"roots":[{"path":project}],"metadata":{"fixture":"rust"}})).await;
            expected.insert(created["project"]["id"].as_str().unwrap().to_owned());
        }
        let mut cursor: Option<String> = None;
        let mut seen = std::collections::HashSet::new();
        for _ in 0..3 {
            let page = a.project_page(cursor.as_deref(), 1).await.unwrap();
            assert_eq!(page["data"].as_array().unwrap().len(), 1);
            let entry = &page["data"][0];
            assert_eq!(entry["metadata"]["fixture"], "rust");
            assert_eq!(
                entry["roots"][0]["path"],
                project.to_string_lossy().as_ref()
            );
            assert!(seen.insert(entry["id"].as_str().unwrap().to_owned()));
            cursor = page["nextCursor"].as_str().map(str::to_owned);
            if cursor.is_none() {
                break;
            }
        }
        assert!(cursor.is_none());
        assert_eq!(seen, expected);
        let id = expected.iter().next().unwrap();
        native_request(
            &mut source,
            "rename-project",
            "project/update",
            json!({"projectId":id,"name":"Externally renamed"}),
        )
        .await;
        let reread = b.project_page(None, 100).await.unwrap();
        assert!(reread["data"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["id"] == *id && p["name"] == "Externally renamed"));
        let outside = tempfile::tempdir().unwrap();
        let outside_root = agentdeck_service::paths::canonical(outside.path()).unwrap();
        let mixed = native_request(&mut source, "mixed", "project/create", json!({"idempotencyKey":"mixed","name":"Unauthorized mixed roots","roots":[{"path":project},{"path":outside_root}]})).await;
        let bridge = tempfile::tempdir().unwrap();
        let store = std::sync::Arc::new(
            agentdeck_service::store::Store::open(&bridge.path().join("bridge.db")).unwrap(),
        );
        let grant = agentdeck_service::paths::add_local(&store, &project).unwrap();
        let tls = agentdeck_service::security::Certificate::load(bridge.path()).unwrap();
        let (tx, _rx) = tokio::sync::mpsc::channel(8);
        let core = agentdeck_service::service::Core::new(store, tls, "127.0.0.1".into(), 0, tx);
        *core.rpc.write().unwrap() = Some(a.clone());
        core.ready.store(true, Ordering::SeqCst);
        let projected = core.native_project_page(None, 100).await.unwrap();
        let entries = projected["data"].as_array().unwrap();
        assert_eq!(entries.len(), 2);
        let ids: std::collections::HashSet<_> = entries
            .iter()
            .map(|entry| {
                assert_eq!(
                    entry["rootGrants"],
                    json!([{"rootIndex":0,"projectId":grant["projectId"]}])
                );
                assert_ne!(entry["project"]["id"], mixed["project"]["id"]);
                entry["project"]["id"].as_str().unwrap().to_owned()
            })
            .collect();
        assert_eq!(ids, expected);
        core.store
            .replace_device("project-reader", "isolated test", "synthetic-hash")
            .unwrap();
        let first = core
            .native_project_device_page("project-reader", None, 1)
            .await
            .unwrap();
        let cursor = first["nextCursor"].as_str().unwrap();
        assert!(agentdeck_service::security::valid_token(cursor));
        let second = core
            .native_project_device_page("project-reader", Some(cursor), 1)
            .await
            .unwrap();
        assert_eq!(first["viewId"], second["viewId"]);
        let device_ids: std::collections::HashSet<_> = [&first, &second]
            .iter()
            .map(|page| {
                page["data"][0]["project"]["id"]
                    .as_str()
                    .unwrap()
                    .to_owned()
            })
            .collect();
        assert_eq!(device_ids, expected);
        assert!(second["nextCursor"].is_null());
        assert_eq!(
            second,
            core.native_project_device_page("project-reader", Some(cursor), 1)
                .await
                .unwrap()
        );
        let revision = a.project_revision();
        native_request(
            &mut source,
            "invalidate-view",
            "project/update",
            json!({"projectId":id,"name":"After device view"}),
        )
        .await;
        tokio::time::timeout(Duration::from_secs(5), async {
            while a.project_revision() == revision {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            core.native_project_device_page("project-reader", Some(cursor), 1)
                .await
                .unwrap_err()
                .code,
            "SYNC_CONFLICT"
        );
        let refreshed = core
            .native_project_device_page("project-reader", None, 100)
            .await
            .unwrap();
        assert_ne!(refreshed["viewId"], first["viewId"]);
        assert!(refreshed["data"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["project"]["id"] == *id
                && entry["project"]["name"] == "After device view"));
        assert_eq!(core.store.projects().unwrap().len(), 1);
        assert!(core.store.sessions(None).unwrap().is_empty());
        let external = native_request(&mut source,"external-thread","thread/start",json!({"cwd":project,"projectId":id,"sandbox":"read-only","approvalPolicy":"on-request"})).await;
        let refresh = agentdeck_service::protocol::parse(json!({"v":1,"type":"request","id":"refresh-native-index","action":"sessions.refreshIndex","payload":{"contractVersion":1}})).unwrap();
        let refreshed_index = core.dispatch(&refresh, "project-reader").await.unwrap();
        assert_eq!(refreshed_index["contractVersion"], 1);
        assert!(refreshed_index["indexed"].as_u64().unwrap() >= 1);
        let sessions = core.store.sessions(None).unwrap();
        let imported = sessions
            .iter()
            .find(|session| session["upstreamThreadId"] == external["thread"]["id"])
            .unwrap();
        let authoritative = native_request(
            &mut source,
            "read-unpersisted",
            "thread/read",
            json!({"threadId":external["thread"]["id"],"includeTurns":false}),
        )
        .await;
        assert_eq!(
            imported["upstream"]["projectId"],
            authoritative["thread"]["projectId"]
        );
        // No history/model turn was created: preserve unknown association rather
        // than inferring it from the requested project or matching cwd.
        assert!(authoritative["thread"]["projectId"].is_null());
        assert_eq!(imported["projectId"], grant["projectId"]);
        source.close(None).await.unwrap();
    }
    let (created, history_project_id) = if with_history {
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let mut request = endpoint.as_str().into_client_request().unwrap();
        request
            .headers_mut()
            .insert("Authorization", format!("Bearer {token}").parse().unwrap());
        let (mut source, _) = tokio_tungstenite::connect_async(request).await.unwrap();
        native_request(&mut source,"history-project-init","initialize",json!({"clientInfo":{"name":"history_project_seed","version":"0.3.0"},"capabilities":{"experimentalApi":true}})).await;
        source
            .send(Message::Text(
                json!({"method":"initialized","params":{}})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        let project_seed=native_request(&mut source,"history-project","project/create",json!({"idempotencyKey":"history-project","name":"Persisted project","roots":[{"path":project}]})).await;
        let native_id = project_seed["project"]["id"].as_str().unwrap().to_owned();
        let thread=native_request(&mut source,"history-thread","thread/start",json!({"cwd":project,"projectId":native_id,"sandbox":"read-only","approvalPolicy":"on-request"})).await;
        source.close(None).await.unwrap();
        (thread, Some(native_id))
    } else {
        let created = a
            .request(
                "thread/start",
                json!({"cwd":project,"sandbox":"read-only","approvalPolicy":"on-request"}),
            )
            .await
            .unwrap();
        (created, None)
    };
    a.validate("v2/ThreadStartResponse", &created).unwrap();
    let id = created["thread"]["id"].clone();
    {
        // Run the actual stdio executable with no credential in argv/environment.
        use tokio::io::AsyncWriteExt;
        let proxy_path = directory.path().join("agentdeck-codex-proxy.exe");
        std::fs::copy(env!("CARGO_BIN_EXE_agentdeck-codex-proxy"), &proxy_path).unwrap();
        std::fs::write(proxy_path.with_extension("json"),json!({"formatVersion":1,"nativeExecutable":std::path::PathBuf::from(&executable),"endpoint":endpoint,"tokenFile":token_file,"protocolVersion":ProtocolVersion::DesktopBaseline.version()}).to_string()).unwrap();
        let version = tokio::process::Command::new(&proxy_path)
            .arg("--version")
            .env("CODEX_HOME", &home)
            .output()
            .await
            .unwrap();
        assert!(
            version.status.success(),
            "proxy version failed: {}",
            String::from_utf8_lossy(&version.stderr)
        );
        assert_eq!(
            String::from_utf8(version.stdout).unwrap().trim(),
            "codex-cli 0.163.0-alpha.10.2"
        );
        let loaded_before =
            a.request("thread/loaded/list", json!({})).await.unwrap()["data"].clone();
        let mut mismatch = tokio::process::Command::new(&proxy_path)
            .args(["app-server", "-c", "features.code_mode_host=false"])
            .env("CODEX_HOME", &home)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        mismatch.stdin.take().unwrap().write_all(format!("{}\n{}\n",json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"mismatch_probe","version":"0.1"}}}),json!({"id":2,"method":"thread/start","params":{"cwd":project}})).as_bytes()).await.unwrap();
        let rejected = tokio::time::timeout(Duration::from_secs(20), mismatch.wait_with_output())
            .await
            .unwrap()
            .unwrap();
        assert!(!rejected.status.success());
        assert!(rejected.stdout.is_empty());
        assert_eq!(
            String::from_utf8(rejected.stderr).unwrap().trim(),
            "AgentDeck desktop proxy: PROXY_CONFIG_MISMATCH\nAgentDeck desktop startup: PROXY_STARTUP_FEATURES_VALUE"
        );
        assert_eq!(
            a.request("thread/loaded/list", json!({})).await.unwrap()["data"],
            loaded_before
        );
        let mut proxy = tokio::process::Command::new(&proxy_path)
            .args([
                "-c",
                "features.code_mode_host=true",
                "app-server",
                "--analytics-default-enabled",
            ])
            .env_remove("CODEX_APP_SERVER_WS_URL")
            .env("CODEX_HOME", &home)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let mut input = proxy.stdin.take().unwrap();
        let mut output = tokio::io::BufReader::new(proxy.stdout.take().unwrap());
        input.write_all(format!("{}\n",json!({"id":"desktop-init","method":"initialize","params":{"clientInfo":{"name":"codex_desktop","version":"0.3.0"},"capabilities":{"experimentalApi":true}}})).as_bytes()).await.unwrap();
        let initialized = tokio::time::timeout(Duration::from_secs(20), async {
            loop {
                let value = agentdeck_service::rpc::read_frame(&mut output)
                    .await
                    .unwrap()
                    .expect("stdio proxy ended before initialize");
                if value["id"] == "desktop-init" {
                    break value;
                }
                assert_ne!(value["method"], "config/read");
            }
        })
        .await
        .unwrap();
        assert!(initialized.get("result").is_some());
        input.write_all(format!("{}\n{}\n",json!({"method":"initialized"}),json!({"id":"desktop-read","method":"thread/read","params":{"threadId":id,"includeTurns":false}})).as_bytes()).await.unwrap();
        let read = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let value = agentdeck_service::rpc::read_frame(&mut output)
                    .await
                    .unwrap()
                    .unwrap();
                if value["id"] == "desktop-read" {
                    break value;
                }
            }
        })
        .await
        .unwrap();
        assert_eq!(read["result"]["thread"]["id"], id);
        drop(input);
        let closed = tokio::time::timeout(Duration::from_secs(10), proxy.wait_with_output())
            .await
            .unwrap()
            .unwrap();
        assert!(
            closed.status.success(),
            "proxy failed with code-only stderr: {}",
            String::from_utf8_lossy(&closed.stderr)
        );
        assert_eq!(
            a.request("thread/read", json!({"threadId":id,"includeTurns":false}))
                .await
                .unwrap()["thread"]["id"],
            id
        );
    }
    // A desktop-compatible Basic handshake reaches this same real native server.
    // This is transport acceptance, not evidence that the original GUI is attached.
    {
        use base64::{engine::general_purpose::STANDARD, Engine};
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let target = agentdeck_service::runtime::RuntimeTarget::Attached {
            endpoint: endpoint.clone(),
            token_file: token_file.clone(),
            protocol: ProtocolVersion::DesktopBaseline,
        };
        let adapter_file = directory.path().join("desktop-adapter-token");
        let adapter_token = "d".repeat(43);
        std::fs::write(&adapter_file, &adapter_token).unwrap();
        let adapter =
            agentdeck_service::desktop_adapter::DesktopAdapter::listen(target, 0, adapter_file)
                .await
                .unwrap();
        let mut request = format!("ws://127.0.0.1:{}/", adapter.port)
            .into_client_request()
            .unwrap();
        request.headers_mut().insert(
            "authorization",
            format!(
                "Basic {}",
                STANDARD.encode(format!("agentdeck:{adapter_token}"))
            )
            .parse()
            .unwrap(),
        );
        let (mut client, _) = tokio_tungstenite::connect_async(request).await.unwrap();
        client.send(Message::Text(json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"adapter_probe","version":"0.1"},"capabilities":{"experimentalApi":true}}}).to_string().into())).await.unwrap();
        let initialized = tokio::time::timeout(Duration::from_secs(10), client.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let initialized: Value = serde_json::from_str(initialized.to_text().unwrap()).unwrap();
        assert_eq!(initialized["id"], 1);
        assert!(initialized.get("result").is_some());
        client
            .send(Message::Text(
                json!({"method":"initialized"}).to_string().into(),
            ))
            .await
            .unwrap();
        client.send(Message::Text(json!({"id":2,"method":"thread/read","params":{"threadId":id,"includeTurns":false}}).to_string().into())).await.unwrap();
        let read = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let message = client.next().await.unwrap().unwrap();
                let value: Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
                if value["id"] == 2 {
                    break value;
                }
            }
        })
        .await
        .unwrap();
        assert_eq!(read["result"]["thread"]["id"], id);
    }
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
    let history_turn = if with_history {
        let started = b.request("turn/start", json!({"threadId":id,"input":[{"type":"text","text":"Complete the persisted history probe.","text_elements":[]}]})).await.unwrap();
        let turn_id = started["turn"]["id"].clone();
        tokio::time::timeout(Duration::from_secs(20), async {
            loop {
                let read = b
                    .request("thread/read", json!({"threadId":id,"includeTurns":true}))
                    .await
                    .unwrap();
                b.validate("v2/ThreadReadResponse", &read).unwrap();
                if read["thread"]["turns"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|turn| turn["id"] == turn_id && turn["status"] == "completed")
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .expect("synthetic history turn did not complete");
        Some(turn_id)
    } else {
        None
    };
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
    if let Some(native_id) = &history_project_id {
        assert_eq!(read["thread"]["projectId"], *native_id);
    }
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
    let (tx, mut output) = tokio::sync::mpsc::channel::<Value>(32);
    let output_task = tokio::spawn(async move {
        while let Some(value) = output.recv().await {
            if value["type"] == "error" {
                eprintln!("isolated Core error: {}", value["payload"]);
            }
        }
    });
    let reserved = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let bridge_port = reserved.local_addr().unwrap().port();
    drop(reserved);
    let core =
        agentdeck_service::service::Core::new(store, tls, "127.0.0.1".into(), bridge_port, tx);
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
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if core
                .store
                .sessions(None)
                .unwrap()
                .iter()
                .any(|v| v["upstreamThreadId"] == id && v["title"] == "Versioned desktop baseline")
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("attached runtime did not automatically import existing thread");
    let sessions = core.store.sessions(None).unwrap();
    let imported = sessions
        .iter()
        .find(|v| v["upstreamThreadId"] == id)
        .unwrap();
    let imported_id = imported["sessionId"].as_str().unwrap().to_owned();
    if let Some(native_id) = &history_project_id {
        assert_eq!(imported["upstream"]["projectId"], *native_id);
    }
    if let Some(native_id) = &history_project_id {
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let credential = agentdeck_service::security::token();
        core.store
            .replace_device(
                "persisted-project-reader",
                "isolated WSS test",
                &agentdeck_service::digest(&credential),
            )
            .unwrap();
        core.listen("127.0.0.1").await.unwrap();
        let (_, pem) = x509_parser::pem::parse_x509_pem(core.tls.cert.as_bytes()).unwrap();
        let mut roots = rustls::RootCertStore::empty();
        roots
            .add(rustls::pki_types::CertificateDer::from(pem.contents))
            .unwrap();
        let config = rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        let mut request = format!("wss://127.0.0.1:{}/api/v1/ws", core.port)
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
            Some(tokio_tungstenite::Connector::Rustls(std::sync::Arc::new(
                config,
            ))),
        )
        .await
        .unwrap();
        async fn bridge_call(
            socket: &mut tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
            request_id: &str,
            action: &str,
            payload: Value,
        ) -> Value {
            socket.send(Message::Text(json!({"v":1,"type":"request","id":request_id,"action":action,"payload":payload}).to_string().into())).await.unwrap();
            tokio::time::timeout(Duration::from_secs(35), async {
                loop {
                    let message = socket.next().await.unwrap().unwrap();
                    if let Message::Text(text) = message {
                        let packet: Value = serde_json::from_str(&text).unwrap();
                        if packet["id"] == request_id {
                            return packet;
                        }
                    }
                }
            })
            .await
            .unwrap()
        }
        assert_eq!(
            bridge_call(
                &mut socket,
                "hello-project-reader",
                "system.hello",
                json!({"client":"isolated-project-reader","version":1})
            )
            .await["type"],
            "response"
        );
        let capabilities = bridge_call(
            &mut socket,
            "project-capabilities",
            "system.capabilities",
            json!({}),
        )
        .await;
        assert_eq!(
            capabilities["payload"]["features"]["nativeProjectReadViews"],
            true
        );
        assert_eq!(
            capabilities["payload"]["features"]["threadIndexRefresh"],
            true
        );
        assert_eq!(
            capabilities["payload"]["runtime"]["sharedDesktopRuntime"],
            false
        );
        let projects = bridge_call(
            &mut socket,
            "original-native-project",
            "projects.nativePage",
            json!({"contractVersion":1}),
        )
        .await;
        let entries = projects["payload"]["data"].as_array().unwrap();
        let native_project = entries
            .iter()
            .find(|entry| entry["project"]["id"] == *native_id)
            .unwrap();
        assert_eq!(
            native_project["rootGrants"][0]["projectId"],
            granted["projectId"]
        );
        tokio::time::timeout(Duration::from_secs(15), async {
            for attempt in 0..30 {
                let result = bridge_call(
                    &mut socket,
                    &format!("refresh-persisted-{attempt}"),
                    "sessions.refreshIndex",
                    json!({"contractVersion":1}),
                )
                .await;
                if result["type"] == "response" {
                    assert_eq!(result["payload"]["contractVersion"], 1);
                    return;
                }
                assert_eq!(result["code"], "CONFLICT");
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            panic!("project refresh remained busy");
        })
        .await
        .unwrap();
        let snapshot = bridge_call(
            &mut socket,
            "project-session-snapshot",
            "snapshot.get",
            json!({}),
        )
        .await;
        let remote = snapshot["payload"]["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|session| session["sessionId"] == imported_id)
            .unwrap();
        assert_eq!(remote["upstreamThreadId"], id);
        assert_eq!(remote["upstream"]["projectId"], *native_id);
        assert_eq!(remote["projectId"], granted["projectId"]);
        let remote_history = bridge_call(
            &mut socket,
            "project-session-history",
            "sessions.history",
            json!({"sessionId":imported_id,"limit":20}),
        )
        .await;
        let content = remote_history["payload"]["data"].as_array().unwrap();
        assert_eq!(content.len(), 2);
        assert!(content.iter().any(|entry| entry["item"]["text"] == answer
            && entry["turnId"] == *history_turn.as_ref().unwrap()));
        assert!(content
            .iter()
            .any(|entry| entry["item"]["content"][0]["text"]
                == "Complete the persisted history probe."));
        socket.close(None).await.unwrap();
    }

    let mut history = core.upstream_history(&imported_id, None, 20).await.unwrap();
    if let Some(turn_id) = &history_turn {
        assert_eq!(history["data"].as_array().unwrap().len(), 2);
        let first = core.upstream_history(&imported_id, None, 1).await.unwrap();
        let next = first["nextCursor"]
            .as_str()
            .expect("real history must paginate");
        let second = core
            .upstream_history(&imported_id, Some(next), 1)
            .await
            .unwrap();
        assert_eq!(first["data"][0], history["data"][0]);
        assert_eq!(second["data"][0], history["data"][1]);
        assert!(second["nextCursor"].is_null());
        assert_eq!(second["data"][0]["turnId"], *turn_id);
        assert_eq!(second["data"][0]["item"]["type"], "agentMessage");
        assert_eq!(second["data"][0]["item"]["text"], answer);
        let latest = core
            .upstream_history_ordered(&imported_id, None, 1, "desc")
            .await
            .unwrap();
        assert_eq!(latest["data"][0], second["data"][0]);
        let older = core
            .upstream_history_ordered(&imported_id, latest["nextCursor"].as_str(), 1, "desc")
            .await
            .unwrap();
        assert_eq!(older["data"][0], first["data"][0]);
        assert!(older["nextCursor"].is_null());
    } else {
        assert!(history["data"].as_array().unwrap().is_empty());
    }
    assert!(history["nextCursor"].is_null());
    assert_eq!(imported["title"], "Versioned desktop baseline");
    assert_eq!(imported["upstream"]["source"], created["thread"]["source"]);
    if with_steering {
        let observing = core.observe_session(&imported_id).await.unwrap();
        assert_eq!(observing["upstreamThreadId"], id);
        assert_eq!(observing["observing"], true);
        let observed_event = core
            .store
            .history(&imported_id, None, 100)
            .unwrap()
            .into_iter()
            .find(|e| e["action"] == "session.observed")
            .unwrap();
        assert_eq!(observed_event["payload"]["sandbox"], resumed["sandbox"]);
        assert_eq!(
            observed_event["payload"]["approvalPolicy"],
            resumed["approvalPolicy"]
        );
        let cursor = core.store.cursor().unwrap();
        core.observe_session(&imported_id).await.unwrap();
        assert_eq!(core.store.cursor().unwrap(), cursor);
        let started = b.request("turn/start",json!({"threadId":id,"input":[{"type":"text","text":"Hold for additional instruction.","text_elements":[]}]})).await.unwrap();
        let turn_id = started["turn"]["id"].as_str().unwrap();
        let active = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if let Ok(active) = core.active_upstream_turn(&imported_id).await {
                    if active["upstreamTurnId"] == turn_id {
                        break active;
                    }
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("active original turn identity did not become visible");
        assert_eq!(active["upstreamTurnId"], turn_id);
        assert_eq!(
            core.steer_turn(
                &imported_id,
                "wrong-turn",
                "must not send",
                "negative-probe"
            )
            .await
            .unwrap_err()
            .code,
            "TURN_CHANGED"
        );
        let accepted = core
            .steer_turn(
                &imported_id,
                turn_id,
                "Continue the exact original task.",
                "positive-probe",
            )
            .await
            .unwrap();
        assert_eq!(accepted["accepted"], true);
        assert_eq!(accepted["upstreamTurnId"], turn_id);
        assert!(core.store.turns(Some(&imported_id)).unwrap().is_empty());
        let events = core.store.history(&imported_id, None, 100).unwrap();
        assert_eq!(
            events
                .iter()
                .filter(|event| event["action"] == "turn.steered")
                .count(),
            1
        );
        response_gate.notify_one();
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                match core.active_upstream_turn(&imported_id).await {
                    Ok(active) if active["upstreamTurnId"].is_null() => break,
                    Ok(_) => {}
                    Err(error) if error.code == "TURN_STATE_UNAVAILABLE" => {}
                    Err(error) => panic!("active turn reconciliation failed: {error:?}"),
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("steered original turn did not finish");
        assert!(provider_requests.load(Ordering::SeqCst) >= 2);
        assert!(instruction_consumed.load(Ordering::SeqCst));
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let events = core.store.history(&imported_id, None, 100).unwrap();
                if events.iter().any(|e| {
                    e["action"] == "upstream.progress"
                        && e["payload"]["upstreamTurnId"] == turn_id
                        && e["payload"]["method"] == "item/completed"
                        && e["payload"]["item"]["text"] == answer
                }) && events.iter().any(|e| {
                    e["action"] == "upstream.turn.completed"
                        && e["payload"]["upstreamTurnId"] == turn_id
                        && e["payload"]["status"] == "completed"
                }) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("native observation did not deliver original output and completion");
        let saved_items = core
            .upstream_history_ordered(&imported_id, None, 20, "desc")
            .await
            .unwrap();
        let completed_item = core
            .store
            .history(&imported_id, None, 100)
            .unwrap()
            .into_iter()
            .find(|e| {
                e["action"] == "upstream.progress"
                    && e["payload"]["upstreamTurnId"] == turn_id
                    && e["payload"]["method"] == "item/completed"
                    && e["payload"]["item"]["type"] == "agentMessage"
            })
            .unwrap();
        assert!(
            saved_items["data"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| entry["turnId"] == turn_id
                    && entry["item"]["id"] == completed_item["payload"]["item"]["id"]
                    && entry["item"]["text"] == answer),
            "persisted and streamed original items must have the same native identity"
        );

        let finished = b
            .request(
                "thread/turns/list",
                json!({"threadId":id,"limit":1,"sortDirection":"desc","itemsView":"notLoaded"}),
            )
            .await
            .unwrap();
        assert_eq!(finished["data"][0]["id"], turn_id);
        assert_eq!(finished["data"][0]["status"], "completed");
        hold_response.store(true, Ordering::SeqCst);
        let stopping=b.request("turn/start",json!({"threadId":id,"input":[{"type":"text","text":"Hold for external stop.","text_elements":[]}]})).await.unwrap();
        let stop_id = stopping["turn"]["id"].as_str().unwrap();
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if core
                    .active_upstream_turn(&imported_id)
                    .await
                    .is_ok_and(|active| active["upstreamTurnId"] == stop_id)
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("external stop target did not become visible");
        assert_eq!(
            core.interrupt_active_turn(&imported_id, "wrong-stop-target")
                .await
                .unwrap_err()
                .code,
            "TURN_CHANGED"
        );
        let requested = core
            .interrupt_active_turn(&imported_id, stop_id)
            .await
            .unwrap();
        assert_eq!(requested["requested"], true);
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let events = core.store.history(&imported_id, None, 100).unwrap();
                if events.iter().any(|event| {
                    event["action"] == "upstream.turn.completed"
                        && event["payload"]["upstreamTurnId"] == stop_id
                        && event["payload"]["status"] == "interrupted"
                }) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("stop acknowledgement was not followed by authoritative interruption");
        assert!(core.store.turns(Some(&imported_id)).unwrap().is_empty());
        response_gate.notify_one();
        history = core.upstream_history(&imported_id, None, 20).await.unwrap();
    }
    if with_history {
        let generation = core.upstream().unwrap().generation.clone();
        let started = b.request("turn/start", json!({"threadId":id,"input":[{"type":"text","text":"External turn after index import.","text_elements":[]}]})).await.unwrap();
        let turn_id = started["turn"]["id"].clone();
        tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                let read = b
                    .request("thread/read", json!({"threadId":id,"includeTurns":true}))
                    .await
                    .unwrap();
                if read["thread"]["turns"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|turn| turn["id"] == turn_id && turn["status"] == "completed")
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("external synthetic turn did not complete");
        history = core.upstream_history(&imported_id, None, 20).await.unwrap();
        assert_eq!(history["data"].as_array().unwrap().len(), 4);
        assert_eq!(core.upstream().unwrap().generation, generation);
        assert!(core.store.turns(Some(&imported_id)).unwrap().is_empty());
    }
    core.busy.lock().unwrap().insert(imported_id.clone());
    b.request(
        "thread/name/set",
        json!({"threadId":id,"name":"External title after import"}),
    )
    .await
    .unwrap();
    b.request("thread/archive", json!({"threadId":id}))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(
        core.store.session(&imported_id).unwrap()["title"],
        "Versioned desktop baseline"
    );
    core.busy.lock().unwrap().remove(&imported_id);
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let current = core.store.session(&imported_id).unwrap();
            if current["title"] == "External title after import" && current["archived"] == 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("external metadata notifications did not refresh original thread");
    let imported = core.store.session(&imported_id).unwrap();
    assert_eq!(imported["upstreamThreadId"], id);
    assert_eq!(imported["title"], "External title after import");
    assert_eq!(imported["archived"], 1);
    if let Some(native_id) = &history_project_id {
        assert_eq!(imported["upstream"]["projectId"], *native_id);
    }
    b.request("thread/unarchive", json!({"threadId":id}))
        .await
        .unwrap();
    let restored = tokio::time::timeout(Duration::from_secs(10), async {
        while core.store.session(&imported_id).unwrap()["archived"] != 0 {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await;
    restored.expect("external unarchive did not refresh original session");
    let external = b
        .request(
            "thread/start",
            json!({"cwd":project,"sandbox":"read-only","approvalPolicy":"on-request"}),
        )
        .await
        .unwrap();
    let external_id = external["thread"]["id"].clone();
    tokio::time::timeout(Duration::from_secs(10), async {
        while !core
            .store
            .sessions(None)
            .unwrap()
            .iter()
            .any(|v| v["upstreamThreadId"] == external_id)
        {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("externally created original thread was not imported by notification");
    let external_session = core
        .store
        .sessions(None)
        .unwrap()
        .into_iter()
        .find(|v| v["upstreamThreadId"] == external_id)
        .unwrap();
    let external_session_id = external_session["sessionId"].as_str().unwrap();
    core.busy
        .lock()
        .unwrap()
        .insert(external_session_id.to_owned());
    b.request("thread/delete", json!({"threadId":external_id}))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(core.store.session(external_session_id).is_ok());
    core.busy.lock().unwrap().remove(external_session_id);
    tokio::time::timeout(Duration::from_secs(10), async {
        while core.store.session(external_session_id).is_ok() {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("authoritative external deletion did not remove cached session");
    assert_eq!(
        core.store
            .query(
                "SELECT * FROM events WHERE sessionId=? AND action='session.deleted'",
                [external_session_id]
            )
            .unwrap()
            .len(),
        1
    );
    b.request(
        "thread/name/set",
        json!({"threadId":id,"name":"Survivor after deletion"}),
    )
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        while core.store.session(&imported_id).unwrap()["title"] != "Survivor after deletion" {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("a deleted source thread blocked subsequent index updates");
    assert_eq!(
        core.store
            .session(session["sessionId"].as_str().unwrap())
            .unwrap()["upstreamThreadId"],
        session["upstreamThreadId"]
    );
    let observations_before_reconnect = core
        .store
        .history(&imported_id, None, 100)
        .unwrap()
        .iter()
        .filter(|e| e["action"] == "session.observed")
        .count();
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
        core.upstream_history(&imported_id, None, 20).await.unwrap(),
        history
    );
    assert_eq!(
        core.store
            .session(session["sessionId"].as_str().unwrap())
            .unwrap()["upstreamThreadId"],
        session["upstreamThreadId"]
    );
    if with_steering {
        // Archive unloaded the source. Its owner explicitly reloads its own
        // execution environment; observation must not do so on the owner's behalf.
        b.request("thread/resume",json!({"threadId":id,"cwd":project,"sandbox":"read-only","approvalPolicy":"on-request","excludeTurns":true})).await.unwrap();
        tokio::time::timeout(Duration::from_secs(10), async {
            while core
                .store
                .history(&imported_id, None, 100)
                .unwrap()
                .iter()
                .filter(|e| e["action"] == "session.observed")
                .count()
                <= observations_before_reconnect
            {
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("native observation was not restored after source reload and reconnect");
        let restored_event = core
            .store
            .history(&imported_id, None, 100)
            .unwrap()
            .into_iter()
            .rev()
            .find(|e| e["action"] == "session.observed")
            .unwrap();
        assert_eq!(
            restored_event["payload"]["sandbox"], resumed["sandbox"],
            "observation must not change the source sandbox"
        );
        assert_eq!(
            restored_event["payload"]["approvalPolicy"],
            resumed["approvalPolicy"]
        );
        let started=b.request("turn/start",json!({"threadId":id,"input":[{"type":"text","text":"After observer reconnect.","text_elements":[]}]})).await.unwrap();
        let turn_id = &started["turn"]["id"];
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if core
                    .store
                    .history(&imported_id, None, 100)
                    .unwrap()
                    .iter()
                    .any(|e| {
                        e["action"] == "upstream.turn.completed"
                            && e["payload"]["upstreamTurnId"] == *turn_id
                            && e["payload"]["status"] == "completed"
                    })
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("restored native observation missed the next original turn");
        let recovered = core
            .upstream_history_ordered(&imported_id, None, 1, "desc")
            .await
            .unwrap();
        assert_eq!(recovered["data"][0]["turnId"], *turn_id);
        assert_eq!(recovered["data"][0]["item"]["text"], answer);

        assert!(core.store.turns(Some(&imported_id)).unwrap().is_empty());
    }
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
    if let Some(provider) = provider {
        provider.abort();
    }
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
    let (tx, mut output) = tokio::sync::mpsc::channel::<Value>(32);
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
