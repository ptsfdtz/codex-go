use agentdeck_service::{
    paths,
    rpc::{ProtocolVersion, Rpc},
    security::Certificate,
    service::Core,
    store::Store,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;

struct Harness {
    directory: tempfile::TempDir,
    core: Arc<Core>,
}
struct Source {
    rpc: Arc<Rpc>,
    _events: mpsc::Receiver<Value>,
    requested: Option<oneshot::Receiver<Value>>,
    release: Option<oneshot::Sender<()>>,
    worker: tokio::task::JoinHandle<()>,
    notifications: mpsc::Sender<Value>,
}
impl Harness {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::open(&directory.path().join("bridge.sqlite")).unwrap());
        let tls = Certificate {
            cert: String::new(),
            key: String::new(),
            fingerprint: "fixture".into(),
            ips: vec![],
        };
        let (tx, _rx) = mpsc::channel(1);
        let core = Core::new(store, tls, "127.0.0.1".into(), 0, tx);
        Self { directory, core }
    }
    fn folder(&self, name: &str) -> PathBuf {
        let path = self.directory.path().join(name);
        std::fs::create_dir_all(&path).unwrap();
        paths::canonical(&path).unwrap()
    }
    async fn source(&self, response: Value) -> Source {
        self.source_pages(vec![response]).await
    }
    async fn source_pages(&self, responses: Vec<Value>) -> Source {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("ws://{}", listener.local_addr().unwrap());
        let (requested_tx, requested) = oneshot::channel();
        let (release, released) = oneshot::channel();
        let (notifications, mut notification_rx) = mpsc::channel::<Value>(8);
        let worker = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            let Some(Ok(Message::Text(text))) = socket.next().await else {
                return;
            };
            let packet: Value = serde_json::from_str(&text).unwrap();
            assert_eq!(packet["method"], "project/list");
            requested_tx.send(packet.clone()).unwrap();
            released.await.unwrap();
            while let Ok(notification) = notification_rx.try_recv() {
                socket
                    .send(Message::Text(notification.to_string().into()))
                    .await
                    .unwrap();
            }
            let mut packet = packet;
            for (index, response) in responses.iter().enumerate() {
                if index > 0 {
                    let message = socket.next().await.unwrap().unwrap();
                    packet = serde_json::from_str(message.to_text().unwrap()).unwrap();
                    assert_eq!(packet["method"], "project/list");
                    assert_eq!(
                        packet["params"]["cursor"],
                        responses[index - 1]["nextCursor"]
                    );
                }
                socket
                    .send(Message::Text(
                        json!({"id":packet["id"],"result":response})
                            .to_string()
                            .into(),
                    ))
                    .await
                    .unwrap();
            }
            loop {
                tokio::select! {
                    message = socket.next() => {
                        if !matches!(message, Some(Ok(message)) if !message.is_close()) { break; }
                    },
                    Some(notification) = notification_rx.recv() => {
                        socket.send(Message::Text(notification.to_string().into())).await.unwrap();
                    }
                }
            }
        });
        let (rpc, events) = Rpc::connect_local_websocket_profile(
            &endpoint,
            &"a".repeat(43),
            ProtocolVersion::DesktopBaseline,
        )
        .await
        .unwrap();
        *self.core.rpc.write().unwrap() = Some(rpc.clone());
        self.core.ready.store(true, Ordering::SeqCst);
        Source {
            rpc,
            _events: events,
            requested: Some(requested),
            release: Some(release),
            worker,
            notifications,
        }
    }
    fn read(&self) -> tokio::task::JoinHandle<agentdeck_service::Result<Value>> {
        let core = self.core.clone();
        tokio::spawn(async move { core.native_project_page(None, 10).await })
    }
}
impl Source {
    async fn wait(&mut self) {
        tokio::time::timeout(Duration::from_secs(5), self.requested.take().unwrap())
            .await
            .unwrap()
            .unwrap();
    }
    fn release(&mut self) {
        self.release.take().unwrap().send(()).unwrap();
    }
    async fn stop(self) {
        self.rpc.stop();
        self.worker.await.unwrap();
    }
}
fn project(id: &str, roots: &[PathBuf]) -> Value {
    json!({"id":id,"name":format!("project-{id}"),"roots":roots.iter().map(|p|json!({"path":p})).collect::<Vec<_>>(),"metadata":{"original":"preserved"},"position":2,"createdAt":1,"updatedAt":3})
}

#[tokio::test]
async fn remote_project_contract_validates_version_cursor_and_dispatches_device_scope() {
    use agentdeck_service::protocol;
    let request = |payload: Value| json!({"v":1,"type":"request","id":"native-project-test","action":"projects.nativePage","payload":payload});
    for payload in [
        json!({}),
        json!({"contractVersion":2}),
        json!({"contractVersion":1,"limit":101}),
        json!({"contractVersion":1,"cursor":"source-cursor"}),
        json!({"contractVersion":1,"deviceId":"other"}),
    ] {
        assert!(protocol::parse(request(payload)).is_err());
    }
    let parsed = protocol::parse(request(json!({"contractVersion":1}))).unwrap();
    assert_eq!(parsed.payload["limit"], 50);
    let h = Harness::new();
    h.core
        .store
        .replace_device("device", "test", "synthetic-hash")
        .unwrap();
    let source = h.source(json!({"data":[]})).await;
    let page = h.core.dispatch(&parsed, "device").await.unwrap();
    assert_eq!(page["contractVersion"], 1);
    assert_eq!(page["consistency"], "bounded-read-view");
    assert!(page["data"].as_array().unwrap().is_empty());
    assert_eq!(
        h.core.dispatch(&parsed, "other").await.unwrap_err().code,
        "UNAUTHORIZED"
    );
    source.stop().await;
}

#[tokio::test]
async fn full_view_cache_rejects_before_source_read_and_revocation_reclaims_capacity() {
    let h = Harness::new();
    // Multiple devices are a server-side fixture, not a claim about pairing UI.
    for index in 0..9 {
        h.core
            .store
            .query(
                "INSERT INTO devices VALUES(?,? ,?,'fixture',NULL)",
                [
                    format!("device-{index}"),
                    format!("test-{index}"),
                    format!("synthetic-{index}"),
                ],
            )
            .unwrap();
    }
    let mut source = h.source(json!({"data":[]})).await;
    for index in 0..8 {
        assert!(h
            .core
            .native_project_device_page(&format!("device-{index}"), None, 1)
            .await
            .unwrap()["data"]
            .as_array()
            .unwrap()
            .is_empty());
    }
    assert_eq!(
        h.core
            .native_project_device_page("device-8", None, 1)
            .await
            .unwrap_err()
            .code,
        "BUSY"
    );
    // Replacing this device's view does not consume a ninth slot.
    h.core
        .native_project_device_page("device-0", None, 1)
        .await
        .unwrap();
    h.core
        .store
        .query(
            "UPDATE devices SET revokedAt='fixture' WHERE deviceId='device-0'",
            [],
        )
        .unwrap();
    h.core
        .native_project_device_page("device-8", None, 1)
        .await
        .unwrap();
    assert_eq!(
        h.core
            .native_project_device_page("device-0", None, 1)
            .await
            .unwrap_err()
            .code,
        "UNAUTHORIZED"
    );
    source.rpc.stop();
    assert!(source.requested.take().unwrap().await.is_err());
    source.stop().await;
}

#[tokio::test]
async fn reconnect_rejects_old_cursor_and_refreshes_same_identity_from_new_source() {
    let h = Harness::new();
    let a = h.folder("a");
    paths::add_local(&h.core.store, &a).unwrap();
    h.core
        .store
        .replace_device("device", "test", "synthetic-hash")
        .unwrap();
    let old = project("same-native", std::slice::from_ref(&a));
    let mut first_source = h
        .source(json!({"data":[old,project("two",std::slice::from_ref(&a))]}))
        .await;
    first_source.release();
    let first = h
        .core
        .native_project_device_page("device", None, 1)
        .await
        .unwrap();
    let cursor = first["nextCursor"].as_str().unwrap();
    first_source.stop().await;
    let mut changed = old.clone();
    changed["name"] = json!("Changed while disconnected");
    let mut second_source = h.source(json!({"data":[changed]})).await;
    assert_eq!(
        h.core
            .native_project_device_page("device", Some(cursor), 1)
            .await
            .unwrap_err()
            .code,
        "UPSTREAM_UNAVAILABLE"
    );
    second_source.release();
    let refreshed = h
        .core
        .native_project_device_page("device", None, 1)
        .await
        .unwrap();
    assert_ne!(refreshed["viewId"], first["viewId"]);
    assert_eq!(refreshed["data"][0]["project"], changed);
    assert!(refreshed["nextCursor"].is_null());
    assert_eq!(
        h.core
            .native_project_device_page("device", Some(cursor), 1)
            .await
            .unwrap_err()
            .code,
        "INVALID_CURSOR"
    );
    assert_eq!(h.core.store.projects().unwrap().len(), 1);
    assert!(h.core.store.sessions(None).unwrap().is_empty());
    second_source.stop().await;
}

#[tokio::test]
async fn project_notifications_invalidate_both_cached_and_inflight_views() {
    for during_build in [false, true] {
        let h = Harness::new();
        let a = h.folder("a");
        paths::add_local(&h.core.store, &a).unwrap();
        h.core
            .store
            .replace_device("device", "test", "synthetic-hash")
            .unwrap();
        let mut source = h
            .source(json!({"data":[project("one",std::slice::from_ref(&a)),project("two",&[a])]}))
            .await;
        let core = h.core.clone();
        let read =
            tokio::spawn(async move { core.native_project_device_page("device", None, 1).await });
        source.wait().await;
        if during_build {
            // Even an untrusted payload must invalidate, never mutate projects.
            source
                .notifications
                .send(json!({"method":"project/changed","params":{"unknown":"not applied"}}))
                .await
                .unwrap();
        }
        source.release();
        if during_build {
            assert_eq!(read.await.unwrap().unwrap_err().code, "SYNC_CONFLICT");
        } else {
            let page = read.await.unwrap().unwrap();
            let cursor = page["nextCursor"].as_str().unwrap();
            source
                .notifications
                .send(json!({"method":"unrelated/notification","params":{}}))
                .await
                .unwrap();
            source._events.recv().await.unwrap();
            assert!(h
                .core
                .native_project_device_page("device", Some(cursor), 1)
                .await
                .is_ok());
            source.notifications.send(json!({"method":"project/changed","params":{"kind":"deleted","projectId":"one"}})).await.unwrap();
            source._events.recv().await.unwrap();
            assert_eq!(
                h.core
                    .native_project_device_page("device", Some(cursor), 1)
                    .await
                    .unwrap_err()
                    .code,
                "SYNC_CONFLICT"
            );
        }
        assert_eq!(h.core.store.projects().unwrap().len(), 1);
        source.stop().await;
    }
}

#[tokio::test]
async fn dead_rpc_cannot_serve_a_cached_project_page_even_before_core_lost_handler() {
    let h = Harness::new();
    let a = h.folder("a");
    paths::add_local(&h.core.store, &a).unwrap();
    h.core
        .store
        .replace_device("device", "test", "synthetic-hash")
        .unwrap();
    let mut source = h
        .source(json!({"data":[project("one",std::slice::from_ref(&a)),project("two",&[a])]}))
        .await;
    source.release();
    let page = h
        .core
        .native_project_device_page("device", None, 1)
        .await
        .unwrap();
    let cursor = page["nextCursor"].as_str().unwrap();
    source.rpc.stop();
    tokio::time::timeout(Duration::from_secs(5), async {
        while source.rpc.alive.load(Ordering::SeqCst) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        h.core
            .native_project_device_page("device", Some(cursor), 1)
            .await
            .unwrap_err()
            .code,
        "UPSTREAM_UNAVAILABLE"
    );
    source.stop().await;
}

#[tokio::test]
async fn device_view_hides_source_cursors_replays_and_rejects_other_devices_or_limits() {
    let h = Harness::new();
    let a = h.folder("a");
    paths::add_local(&h.core.store, &a).unwrap();
    h.core
        .store
        .replace_device("device-a", "test", "not-a-real-credential")
        .unwrap();
    let mut source = h.source_pages(vec![
        json!({"data":[project("one",std::slice::from_ref(&a))],"nextCursor":"private-source-cursor"}),
        json!({"data":[project("two",std::slice::from_ref(&a))]})
    ]).await;
    source.release();
    let first = h
        .core
        .native_project_device_page("device-a", None, 1)
        .await
        .unwrap();
    assert_eq!(first["data"][0]["project"]["id"], "one");
    assert!(!first.to_string().contains("private-source-cursor"));
    let cursor = first["nextCursor"].as_str().unwrap();
    assert!(agentdeck_service::security::valid_token(cursor));
    let second = h
        .core
        .native_project_device_page("device-a", Some(cursor), 1)
        .await
        .unwrap();
    assert_eq!(second["data"][0]["project"]["id"], "two");
    assert!(second["nextCursor"].is_null());
    assert_eq!(
        second,
        h.core
            .native_project_device_page("device-a", Some(cursor), 1)
            .await
            .unwrap()
    );
    assert_eq!(
        h.core
            .native_project_device_page("device-a", Some(cursor), 2)
            .await
            .unwrap_err()
            .code,
        "INVALID_CURSOR"
    );
    h.core
        .store
        .query(
            "INSERT INTO devices VALUES('device-b','test','fake-hash','fixture',NULL)",
            [],
        )
        .unwrap();
    assert_eq!(
        h.core
            .native_project_device_page("device-b", Some(cursor), 1)
            .await
            .unwrap_err()
            .code,
        "INVALID_CURSOR"
    );
    h.core
        .store
        .query("UPDATE projects SET enabled=0", [])
        .unwrap();
    assert_eq!(
        h.core
            .native_project_device_page("device-a", Some(cursor), 1)
            .await
            .unwrap_err()
            .code,
        "SYNC_CONFLICT"
    );
    h.core
        .store
        .replace_device("device-c", "test", "new-fake-hash")
        .unwrap();
    assert_eq!(
        h.core
            .native_project_device_page("device-a", Some(cursor), 1)
            .await
            .unwrap_err()
            .code,
        "UNAUTHORIZED"
    );
    source.stop().await;
}

#[tokio::test]
async fn device_view_rejects_cross_page_identity_duplicates_and_cursor_cycles() {
    for cycle in [false, true] {
        let h = Harness::new();
        let a = h.folder("a");
        paths::add_local(&h.core.store, &a).unwrap();
        h.core
            .store
            .replace_device("device", "test", "fake-hash")
            .unwrap();
        let pages = if cycle {
            vec![
                json!({"data":[],"nextCursor":"a"}),
                json!({"data":[],"nextCursor":"b"}),
                json!({"data":[],"nextCursor":"a"}),
            ]
        } else {
            vec![
                json!({"data":[project("same",std::slice::from_ref(&a))],"nextCursor":"a"}),
                json!({"data":[project("same",std::slice::from_ref(&a))]}),
            ]
        };
        let mut source = h.source_pages(pages).await;
        source.release();
        assert_eq!(
            h.core
                .native_project_device_page("device", None, 1)
                .await
                .unwrap_err()
                .code,
            if cycle {
                "UPSTREAM_PROTOCOL_ERROR"
            } else {
                "SYNC_CONFLICT"
            }
        );
        source.stop().await;
    }
}

#[tokio::test]
async fn device_revoked_while_building_view_gets_no_page() {
    let h = Harness::new();
    let a = h.folder("a");
    paths::add_local(&h.core.store, &a).unwrap();
    h.core
        .store
        .replace_device("device", "test", "fake-hash")
        .unwrap();
    let mut source = h.source(json!({"data":[project("one",&[a])]})).await;
    let core = h.core.clone();
    let reading =
        tokio::spawn(async move { core.native_project_device_page("device", None, 1).await });
    source.wait().await;
    assert_eq!(
        h.core
            .native_project_device_page("device", None, 1)
            .await
            .unwrap_err()
            .code,
        "BUSY"
    );
    h.core
        .store
        .replace_device("replacement", "test", "other-fake-hash")
        .unwrap();
    source.release();
    assert_eq!(reading.await.unwrap().unwrap_err().code, "UNAUTHORIZED");
    source.stop().await;
}

#[tokio::test]
async fn core_catalog_requires_all_exact_roots_and_never_creates_local_grants() {
    let h = Harness::new();
    let a = h.folder("a");
    let b = h.folder("b");
    let outside = h.folder("outside");
    let child = h.folder("a/child");
    let grant_a = paths::add_local(&h.core.store, &a).unwrap();
    let grant_b = paths::add_local(&h.core.store, &b).unwrap();
    let original = project("native-original", &[a.clone(), b.clone()]);
    let mut hidden = project("hidden-marker", &[a.clone(), outside]);
    hidden["metadata"] = json!({"secret":"hidden-marker"});
    let response = json!({"data":[original,hidden,project("descendant",&[child]),project("rootless",&[]),project("relative",&[PathBuf::from("relative")])],"nextCursor":"continue"});
    let mut source = h.source(response).await;
    source.release();
    let result = h.core.native_project_page(None, 10).await.unwrap();
    assert_eq!(result["data"].as_array().unwrap().len(), 1);
    assert_eq!(result["data"][0]["project"], original);
    assert_eq!(
        result["data"][0]["rootGrants"],
        json!([{"rootIndex":0,"projectId":grant_a["projectId"]},{"rootIndex":1,"projectId":grant_b["projectId"]}])
    );
    assert_eq!(result["nextCursor"], "continue");
    assert!(!result.to_string().contains("hidden-marker"));
    assert_eq!(h.core.store.projects().unwrap().len(), 2);
    assert!(h.core.store.sessions(None).unwrap().is_empty());
    source.stop().await;
}

#[tokio::test]
async fn empty_filtered_pages_keep_cursor_but_grantless_catalog_does_not_query_source() {
    let h = Harness::new();
    let a = h.folder("a");
    let outside = h.folder("outside");
    let mut source = h.source(json!({"data":[]})).await;
    assert_eq!(
        h.core.native_project_page(None, 10).await.unwrap()["nextCursor"],
        Value::Null
    );
    assert_eq!(
        h.core.native_project_page(None, 0).await.unwrap_err().code,
        "INVALID_REQUEST"
    );
    source.rpc.stop();
    assert!(source.requested.take().unwrap().await.is_err());
    source.stop().await;
    paths::add_local(&h.core.store, &a).unwrap();
    let mut source = h
        .source(json!({"data":[project("hidden",&[outside])],"nextCursor":"later"}))
        .await;
    source.release();
    let result = h.core.native_project_page(None, 10).await.unwrap();
    assert!(result["data"].as_array().unwrap().is_empty());
    assert_eq!(result["nextCursor"], "later");
    source.stop().await;
}

#[tokio::test]
async fn grant_revocation_during_read_aborts_the_whole_page_and_reauthorization_recovers() {
    let h = Harness::new();
    let a = h.folder("a");
    let grant = paths::add_local(&h.core.store, &a).unwrap();
    let response = json!({"data":[project("same-native",std::slice::from_ref(&a))]});
    let mut source = h.source(response.clone()).await;
    let reading = h.read();
    source.wait().await;
    h.core
        .store
        .exec(
            "UPDATE projects SET enabled=0 WHERE projectId=?",
            [grant["projectId"].as_str().unwrap()],
        )
        .unwrap();
    source.release();
    assert_eq!(reading.await.unwrap().unwrap_err().code, "SYNC_CONFLICT");
    source.stop().await;
    assert_eq!(
        paths::add_local(&h.core.store, &a).unwrap()["projectId"],
        grant["projectId"]
    );
    let mut source = h.source(response).await;
    source.release();
    assert_eq!(
        h.core.native_project_page(None, 10).await.unwrap()["data"][0]["project"]["id"],
        "same-native"
    );
    source.stop().await;
}

#[tokio::test]
async fn runtime_replacement_during_read_does_not_return_a_stale_page() {
    let h = Harness::new();
    let a = h.folder("a");
    paths::add_local(&h.core.store, &a).unwrap();
    let mut first = h
        .source(json!({"data":[project("old-runtime",&[a])]}))
        .await;
    let reading = h.read();
    first.wait().await;
    let second = h.source(json!({"data":[]})).await;
    assert_ne!(first.rpc.generation, second.rpc.generation);
    first.release();
    assert_eq!(
        reading.await.unwrap().unwrap_err().code,
        "UPSTREAM_UNAVAILABLE"
    );
    first.stop().await;
    second.stop().await;
}

#[tokio::test]
async fn replaced_directory_identity_invalidates_the_projection() {
    let h = Harness::new();
    let a = h.folder("a");
    paths::add_local(&h.core.store, &a).unwrap();
    let mut source = h
        .source(json!({"data":[project("original",std::slice::from_ref(&a))]}))
        .await;
    let reading = h.read();
    source.wait().await;
    std::fs::rename(&a, h.directory.path().join("old-a")).unwrap();
    std::fs::create_dir(&a).unwrap();
    source.release();
    assert_eq!(
        reading.await.unwrap().unwrap_err().code,
        "WORKSPACE_FORBIDDEN"
    );
    source.stop().await;
}
