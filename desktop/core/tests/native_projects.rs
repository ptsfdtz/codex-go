use agentdeck_service::rpc::{ProtocolVersion, Rpc};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message;

fn project(id: &str) -> Value {
    json!({"id":id,"name":"原生项目","roots":[{"path":"C:/isolated"}],"metadata":{"source":"synthetic"},"position":0,"createdAt":1,"updatedAt":2,"recencyAt":null})
}

async fn page(
    response: Value,
    cursor: Option<&str>,
    limit: usize,
) -> agentdeck_service::Result<Value> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("ws://{}", listener.local_addr().unwrap());
    let expected_cursor = cursor.map(str::to_owned);
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
        let packet: Value =
            serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(packet["method"], "project/list");
        assert_eq!(
            packet["params"],
            json!({"cursor":expected_cursor,"limit":limit})
        );
        socket
            .send(Message::Text(
                json!({"id":packet["id"],"result":response})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        while let Some(Ok(message)) = socket.next().await {
            if message.is_close() {
                break;
            }
        }
    });
    let (rpc, _events) = Rpc::connect_local_websocket_profile(
        &endpoint,
        &"a".repeat(43),
        ProtocolVersion::DesktopBaseline,
    )
    .await
    .unwrap();
    let result = rpc.project_page(cursor, limit).await;
    rpc.stop();
    server.await.unwrap();
    result
}

#[tokio::test]
async fn native_project_pages_preserve_authoritative_identity_and_content() {
    let response = json!({"data":[project("a"),project("b")],"nextCursor":"second-page"});
    assert_eq!(page(response.clone(), None, 2).await.unwrap(), response);
    let last = json!({"data":[project("c")],"nextCursor":null});
    assert_eq!(
        page(last.clone(), Some("second-page"), 2).await.unwrap(),
        last
    );
    assert_eq!(
        page(json!({"data":[]}), None, 1).await.unwrap(),
        json!({"data":[]})
    );
}

#[tokio::test]
async fn native_project_pages_reject_invalid_or_incomplete_source_results() {
    let mut invalid_metadata = project("a");
    invalid_metadata["metadata"]["source"] = json!(42);
    let mut missing_roots = project("a");
    missing_roots.as_object_mut().unwrap().remove("roots");
    for response in [
        json!({"data":[invalid_metadata]}),
        json!({"data":[missing_roots]}),
        json!({"data":[project("a"),project("a")]}),
        json!({"data":[project("a"),project("b"),project("c")]}),
        json!({"data":[project("")]}),
        json!({"data":[],"nextCursor":"same-page"}),
        json!({"data":[],"nextCursor":""}),
        json!({"data":[],"nextCursor":"x".repeat(4097)}),
    ] {
        assert_eq!(
            page(response, Some("same-page"), 2).await.unwrap_err().code,
            "UPSTREAM_PROTOCOL_ERROR"
        );
    }
    let mut large = project("large");
    large["name"] = json!("x".repeat(384 * 1024));
    assert_eq!(
        page(json!({"data":[large]}), None, 1)
            .await
            .unwrap_err()
            .code,
        "UPSTREAM_CONTENT_TOO_LARGE"
    );
}

#[tokio::test]
async fn native_project_parameters_and_version_fail_before_transmission() {
    for version in [ProtocolVersion::Managed, ProtocolVersion::DesktopBaseline] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("ws://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            while let Some(Ok(message)) = socket.next().await {
                assert!(!message.is_text(), "rejected request was transmitted");
                if message.is_close() {
                    break;
                }
            }
        });
        let (rpc, _events) =
            Rpc::connect_local_websocket_profile(&endpoint, &"a".repeat(43), version)
                .await
                .unwrap();
        if version == ProtocolVersion::Managed {
            assert_eq!(
                rpc.project_page(None, 1).await.unwrap_err().code,
                "UPSTREAM_VERSION_UNSUPPORTED"
            );
            assert!(rpc.request("project/list", json!({})).await.is_err());
        } else {
            for limit in [0, 101] {
                assert_eq!(
                    rpc.project_page(None, limit).await.unwrap_err().code,
                    "INVALID_REQUEST"
                );
            }
            for cursor in [String::new(), "x".repeat(4097)] {
                assert_eq!(
                    rpc.project_page(Some(&cursor), 1).await.unwrap_err().code,
                    "INVALID_REQUEST"
                );
            }
            assert!(rpc
                .request("project/list", json!({"limit":-1}))
                .await
                .is_err());
        }
        assert!(rpc
            .request(
                "project/create",
                json!({"idempotencyKey":"probe","name":"probe","roots":[]})
            )
            .await
            .is_err());
        rpc.stop();
        server.await.unwrap();
    }
}
