//! Local transport fixtures, not original desktop acceptance.
use agentdeck_service::{desktop_adapter::DesktopAdapter, runtime::RuntimeTarget};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{SinkExt, StreamExt};
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio_tungstenite::{
    accept_hdr_async, connect_async,
    tungstenite::{
        client::IntoClientRequest,
        http::{HeaderValue, StatusCode},
        Message,
    },
};

#[tokio::test]
#[ignore = "explicit Node ws module; transport fixture only, not original desktop UI"]
async fn desktop_style_node_constructor_sends_url_basic_auth() {
    use tokio::io::AsyncWriteExt;
    let module =
        std::env::var_os("AGENTDECK_DESKTOP_WS_MODULE").expect("set absolute Node ws module path");
    let (_dir, target, _, task) = fixture().await;
    let adapter = DesktopAdapter::listen(target, 0, _dir.path().join("adapter-token"))
        .await
        .unwrap();
    let mut child = tokio::process::Command::new("node")
        .arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/desktop_ws_client.cjs"
        ))
        .env("AGENTDECK_DESKTOP_WS_MODULE", module)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let input = serde_json::json!({"endpoint":format!("ws://127.0.0.1:{}/",adapter.port),"token":"d".repeat(43)});
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.to_string().as_bytes())
        .await
        .unwrap();
    let output = tokio::time::timeout(Duration::from_secs(25), child.wait_with_output())
        .await
        .unwrap()
        .unwrap();
    assert!(
        output.status.success(),
        "desktop-style WS constructor failed"
    );
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&output.stdout).unwrap(),
        serde_json::json!({"passed":true})
    );
    task.abort();
}

// The tungstenite callback fixes the error response type.
#[allow(clippy::result_large_err)]
async fn fixture() -> (
    tempfile::TempDir,
    RuntimeTarget,
    Arc<AtomicUsize>,
    tokio::task::JoinHandle<()>,
) {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("token");
    std::fs::write(&file, "a".repeat(43)).unwrap();
    std::fs::write(dir.path().join("adapter-token"), "d".repeat(43)).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let count = Arc::new(AtomicUsize::new(0));
    let accepted = count.clone();
    let source_token = file.clone();
    let target = RuntimeTarget::from_options(
        Some(format!("ws://{}", listener.local_addr().unwrap()).into()),
        Some(file.into_os_string()),
    )
    .unwrap();
    let task = tokio::spawn(async move {
        while let Ok((socket, _)) = listener.accept().await {
            accepted.fetch_add(1, Ordering::SeqCst);
            let source_token = source_token.clone();
            tokio::spawn(async move {
                let Ok(mut ws) = accept_hdr_async(
                    socket,
                    |request: &tokio_tungstenite::tungstenite::handshake::server::Request,
                     response| {
                        assert_eq!(
                            request.headers()["authorization"],
                            format!("Bearer {}", std::fs::read_to_string(source_token).unwrap())
                        );
                        Ok(response)
                    },
                )
                .await
                else {
                    return;
                };
                ws.send(Message::Text("{\"method\":\"approval\",\"id\":7}".into()))
                    .await
                    .unwrap();
                while let Some(Ok(message)) = ws.next().await {
                    if message.is_text() && ws.send(message).await.is_err() {
                        break;
                    }
                }
            });
        }
    });
    (dir, target, count, task)
}

fn request(port: u16, token: &str) -> tokio_tungstenite::tungstenite::http::Request<()> {
    let mut request = format!("ws://127.0.0.1:{port}/")
        .into_client_request()
        .unwrap();
    request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!(
            "Basic {}",
            STANDARD.encode(format!("agentdeck:{token}"))
        ))
        .unwrap(),
    );
    request
}

#[tokio::test]
async fn rejects_untrusted_handshakes_without_contacting_native() {
    let (_dir, target, count, task) = fixture().await;
    assert!(
        DesktopAdapter::listen(RuntimeTarget::Managed, 0, _dir.path().join("adapter-token"))
            .await
            .is_err()
    );
    let adapter = DesktopAdapter::listen(target, 0, _dir.path().join("adapter-token"))
        .await
        .unwrap();
    for case in 0..8 {
        let mut req = request(adapter.port, &"d".repeat(43));
        match case {
            0 => {
                req.headers_mut().remove("authorization");
            }
            1 => {
                req.headers_mut()
                    .insert("authorization", HeaderValue::from_static("Basic invalid"));
            }
            2 => {
                req.headers_mut()
                    .insert("origin", HeaderValue::from_static("http://localhost"));
            }
            3 => {
                req.headers_mut()
                    .insert("host", HeaderValue::from_static("localhost"));
            }
            4 => {
                *req.uri_mut() = format!("ws://127.0.0.1:{}/?token=unused", adapter.port)
                    .parse()
                    .unwrap();
            }
            5 => {
                req.headers_mut().insert(
                    "sec-websocket-protocol",
                    HeaderValue::from_static("unexpected"),
                );
            }
            6 => {
                req.headers_mut()
                    .append("authorization", HeaderValue::from_static("Basic duplicate"));
            }
            _ => {
                req = request(adapter.port, &"a".repeat(43));
            }
        }
        let Err(tokio_tungstenite::tungstenite::Error::Http(response)) = connect_async(req).await
        else {
            panic!("invalid handshake accepted")
        };
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    assert_eq!(count.load(Ordering::SeqCst), 0);
    task.abort();
}

#[tokio::test]
async fn independent_credentials_are_required_at_start_and_each_handshake() {
    let (dir, target, count, task) = fixture().await;
    assert!(DesktopAdapter::from_options(&target, None, None)
        .await
        .unwrap()
        .is_none());
    assert!(
        DesktopAdapter::from_options(&target, Some("0".into()), None)
            .await
            .is_err()
    );
    assert!(DesktopAdapter::from_options(
        &target,
        None,
        Some(dir.path().join("adapter-token").into_os_string())
    )
    .await
    .is_err());
    assert!(DesktopAdapter::listen(target.clone(), 0, "relative".into())
        .await
        .is_err());
    assert!(
        DesktopAdapter::listen(target.clone(), 0, dir.path().join("token"))
            .await
            .is_err()
    );
    let adapter = DesktopAdapter::listen(target, 0, dir.path().join("adapter-token"))
        .await
        .unwrap();
    // A later native rotation must never silently make the ingress credential
    // usable directly against native, or let new adapter connections through.
    std::fs::write(dir.path().join("token"), "d".repeat(43)).unwrap();
    assert!(connect_async(request(adapter.port, &"d".repeat(43)))
        .await
        .is_err());
    assert_eq!(count.load(Ordering::SeqCst), 0);
    task.abort();
}

#[tokio::test]
async fn relays_original_frames_rotates_credentials_and_shutdown_closes_only_adapter() {
    let (_dir, target, count, task) = fixture().await;
    let adapter = DesktopAdapter::listen(target, 0, _dir.path().join("adapter-token"))
        .await
        .unwrap();
    let (mut desktop, _) = connect_async(request(adapter.port, &"d".repeat(43)))
        .await
        .unwrap();
    assert_eq!(
        desktop.next().await.unwrap().unwrap().into_text().unwrap(),
        "{\"method\":\"approval\",\"id\":7}"
    );
    let original = "{\"id\":7,\"result\":{\"decision\":\"accept\"},\"text\":\"中文 😀\"}";
    desktop.send(Message::Text(original.into())).await.unwrap();
    assert_eq!(
        desktop.next().await.unwrap().unwrap().into_text().unwrap(),
        original
    );
    desktop
        .send(Message::Ping(vec![1, 2, 3].into()))
        .await
        .unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(2), desktop.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
        Message::Pong(vec![1, 2, 3].into())
    );
    std::fs::write(_dir.path().join("adapter-token"), "b".repeat(43)).unwrap();
    assert!(connect_async(request(adapter.port, &"d".repeat(43)))
        .await
        .is_err());
    assert_eq!(count.load(Ordering::SeqCst), 1);
    let (mut second, _) = connect_async(request(adapter.port, &"b".repeat(43)))
        .await
        .unwrap();
    second.next().await.unwrap().unwrap();
    drop(desktop);
    second
        .send(Message::Text("still alive".into()))
        .await
        .unwrap();
    assert_eq!(
        second.next().await.unwrap().unwrap().into_text().unwrap(),
        "still alive"
    );
    drop(adapter);
    let closed = tokio::time::timeout(Duration::from_secs(2), second.next())
        .await
        .unwrap();
    assert!(!matches!(closed, Some(Ok(Message::Text(_)))));
    assert!(!task.is_finished());
    task.abort();
}

#[tokio::test]
async fn unavailable_native_returns_generic_error() {
    let (_dir, mut target, _, task) = fixture().await;
    task.abort();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    if let RuntimeTarget::Attached { endpoint, .. } = &mut target {
        *endpoint = format!("ws://{}", listener.local_addr().unwrap());
    }
    drop(listener);
    let adapter = DesktopAdapter::listen(target, 0, _dir.path().join("adapter-token"))
        .await
        .unwrap();
    let Err(tokio_tungstenite::tungstenite::Error::Http(response)) =
        connect_async(request(adapter.port, &"d".repeat(43))).await
    else {
        panic!("unavailable native accepted")
    };
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    assert!(response.body().as_ref().is_none_or(|body| body.is_empty()));
}
