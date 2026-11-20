use agentdeck_service::{
    composer::MAX_ATTACHMENT_BYTES, digest, security, service::Core, store::Store,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Arc},
};
use tokio_tungstenite::tungstenite::Message;

// Only the official queue RPCs are served. Refuse the policy read needed
// for turn/start so the acceptance test cannot launch an execution.
async fn queue_peer(
    root: PathBuf,
) -> (
    Arc<agentdeck_service::rpc::Rpc>,
    tokio::sync::mpsc::Receiver<Value>,
) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("ws://{}/", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let (connection, _) = listener.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_async(connection).await.unwrap();
        while let Some(Ok(Message::Text(frame))) = socket.next().await {
            let request: Value = serde_json::from_str(&frame).unwrap();
            let params = &request["params"];
            let id = &request["id"];
            let response = match request["method"].as_str().unwrap() {
                "config/read" => {
                    json!({"id":id,"error":{"code":-32000,"message":"No execution runtime in this fixture"}})
                }
                "thread/read" => json!({"id":id,"result":{"thread":{
                    "cliVersion":"test","createdAt":0,"cwd":root,"ephemeral":false,"id":"transport-test",
                    "modelProvider":"test","preview":"","projectId":null,"sessionId":"transport-test",
                    "source":"cli","status":{"type":"idle"},"turns":[],"updatedAt":0
                }}}),
                "thread/queue/list" => json!({"id":id,"result":{"data":[],"nextCursor":null}}),
                "thread/queue/add" => {
                    assert_eq!(params["threadId"], "transport-test");
                    let reference = params["input"][1]["text"].as_str().unwrap();
                    assert!(reference.contains("bound.bin"));
                    assert!(reference.contains("attachment_"));
                    json!({"id":id,"result":{"queuedSubmission":{"id":"queued-bound","clientUserMessageId":params["clientUserMessageId"],"input":params["input"]}}})
                }
                other => panic!("Unexpected model-free test RPC {other}"),
            };
            socket
                .send(Message::Text(response.to_string().into()))
                .await
                .unwrap();
        }
    });
    agentdeck_service::rpc::Rpc::connect_local_websocket_profile(
        &endpoint,
        &security::token(),
        agentdeck_service::rpc::ProtocolVersion::DesktopBaseline,
    )
    .await
    .unwrap()
}

/// Browser transport acceptance is opt-in. Start local Vite and supply Playwright
/// as for the other browser tests. An optional disposable loopback Cloud config
/// exercises the actual ticketed relay. The upstream queue is isolated.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires local Vite and Playwright"]
async fn encrypted_browser_attachment_requests_reach_host_intact() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let directory = tempfile::tempdir().unwrap();
    let store = Arc::new(Store::open(&directory.path().join("test.db")).unwrap());
    let root = directory.path().join("project");
    std::fs::create_dir(&root).unwrap();
    let project = agentdeck_service::paths::add_local(&store, &root).unwrap();
    store.exec("INSERT INTO sessions VALUES('transport-test',?,'transport-test','Boundary','idle','now','now')",
        [project["projectId"].as_str().unwrap()]).unwrap();
    let certificate = security::Certificate::load(directory.path()).unwrap();
    let fingerprint = certificate.fingerprint.clone();
    let credential = security::token();
    store
        .add_device("device", "Browser", &digest(&credential))
        .unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let (local, _events) = tokio::sync::mpsc::channel(8);
    let core = Core::new(store.clone(), certificate, "127.0.0.1".into(), port, local);
    let (rpc, _upstream_events) = queue_peer(root).await;
    *core.rpc.write().unwrap() = Some(rpc);
    core.ready.store(true, Ordering::SeqCst);
    core.listen("127.0.0.1").await.unwrap();
    let script = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../scripts/web/test-attachment-relay-browser.mjs");
    let status = tokio::process::Command::new("node")
        .arg(script)
        .env("ATTACHMENT_TEST_HOST_PORT", port.to_string())
        .env("ATTACHMENT_TEST_PIN", fingerprint)
        .env("ATTACHMENT_TEST_GRANT", credential)
        .kill_on_drop(true)
        .status()
        .await
        .unwrap();
    assert!(status.success());
    let bytes: Vec<u8> = (0..MAX_ATTACHMENT_BYTES).map(|i| (i % 251) as u8).collect();
    let blobs = store.query("SELECT b.sha256,b.bytes,r.name FROM attachment_blobs b JOIN attachment_refs r USING(sha256) WHERE r.sessionId='transport-test'", []).unwrap();
    assert_eq!(
        blobs,
        vec![json!({"sha256":digest(&bytes),"bytes":MAX_ATTACHMENT_BYTES,"name":"bound.bin"})]
    );
    assert_eq!(
        std::fs::read(directory.path().join("attachments").join(digest(&bytes))).unwrap(),
        bytes
    );
    for action in ["turn.start", "queue.add"] {
        let payload = json!({"attachments":[{"name":"bound.bin","data":STANDARD.encode(&bytes)}],"sessionId":"transport-test","text":"boundary"});
        let expected = digest(json!({"action":action,"payload":payload}).to_string());
        let receipts = store.query("SELECT requestId,requestHash FROM requests WHERE deviceId='device' AND requestId=?", [action]).unwrap();
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0]["requestHash"], expected);
        assert!(store
            .query(
                "SELECT requestId FROM requests WHERE requestId=?",
                [format!("{action}-over")]
            )
            .unwrap()
            .is_empty());
    }
    core.shutdown().await;
}
