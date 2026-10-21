//! Authenticated local attachment. Closing this client never terminates the server.
use super::*;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::{
    client::IntoClientRequest,
    http::{header::AUTHORIZATION, HeaderValue},
    protocol::{Message, WebSocketConfig},
};

pub(crate) fn local_request(
    endpoint: &str,
    credential: &str,
) -> Result<tokio_tungstenite::tungstenite::http::Request<()>> {
    // IntoClientRequest normalizes URL userinfo, so reject it before conversion.
    ensure(
        !endpoint.contains('@'),
        "CONFIG_ERROR",
        "Runtime endpoint must not contain credentials",
    )?;
    let mut request = endpoint
        .into_client_request()
        .map_err(|_| Error::new("CONFIG_ERROR", "Invalid local runtime endpoint"))?;
    let uri = request.uri();
    ensure(
        uri.scheme_str() == Some("ws")
            && uri
                .authority()
                .is_some_and(|authority| !authority.as_str().contains('@'))
            && matches!(uri.host(), Some("127.0.0.1" | "[::1]"))
            && uri.port_u16().is_some_and(|port| port != 0)
            && matches!(uri.path_and_query().map(|v| v.as_str()), Some("/")),
        "CONFIG_ERROR",
        "Runtime attachment requires an exact loopback WebSocket endpoint",
    )?;
    validate_local_credential(credential)?;
    let mut authorization = HeaderValue::from_str(&format!("Bearer {credential}"))
        .map_err(|_| Error::new("CONFIG_ERROR", "Invalid local runtime credential"))?;
    authorization.set_sensitive(true);
    request.headers_mut().insert(AUTHORIZATION, authorization);
    Ok(request)
}
pub fn validate_local_endpoint(endpoint: &str) -> Result<()> {
    local_request(endpoint, &"x".repeat(43)).map(|_| ())
}
pub fn validate_local_credential(credential: &str) -> Result<()> {
    ensure(
        (32..=4096).contains(&credential.len())
            && credential
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte)),
        "CONFIG_ERROR",
        "Invalid local runtime credential",
    )
}

impl Rpc {
    /// Transport-only attachment. Callers must validate the server version/schema
    /// and runtime policy before publishing readiness or invoking task operations.
    pub async fn connect_local_websocket(
        endpoint: &str,
        credential: &str,
    ) -> Result<(Arc<Self>, mpsc::Receiver<Value>)> {
        Self::connect_local_websocket_profile(endpoint, credential, ProtocolVersion::Managed).await
    }
    /// Explicit schema selection for isolated baseline validation. Selecting a
    /// schema does not authorize publishing a ready production runtime.
    pub async fn connect_local_websocket_profile(
        endpoint: &str,
        credential: &str,
        protocol: ProtocolVersion,
    ) -> Result<(Arc<Self>, mpsc::Receiver<Value>)> {
        let request = local_request(endpoint, credential)?;
        let config = WebSocketConfig::default()
            .max_message_size(Some(LIMIT))
            .max_frame_size(Some(LIMIT));
        let (socket, _) = tokio::time::timeout(
            Duration::from_secs(10),
            tokio_tungstenite::connect_async_with_config(request, Some(config), true),
        )
        .await
        .map_err(|_| Error::new("UPSTREAM_TIMEOUT", "Local runtime connection timed out"))?
        .map_err(|_| {
            Error::new(
                "UPSTREAM_UNAVAILABLE",
                "Local runtime connection or authentication failed",
            )
        })?;
        let (output, mut writes) = mpsc::channel::<Value>(2);
        let (events, event_rx) = mpsc::channel(128);
        let rpc = Arc::new(Self {
            protocol,
            output,
            pending: Mutex::new(HashMap::new()),
            next: AtomicU64::new(1),
            alive: AtomicBool::new(true),
            stop: tokio::sync::Notify::new(),
            generation: crate::uid("generation"),
            project_revision: AtomicU64::new(0),
        });
        let owner = rpc.clone();
        tokio::spawn(async move {
            let (mut writer, mut reader) = socket.split();
            loop {
                tokio::select! {
                    _ = owner.stop.notified() => break,
                    _ = events.closed() => break,
                    write = writes.recv() => {
                        let Some(value) = write else { break; };
                        if !matches!(tokio::time::timeout(Duration::from_secs(10), writer.send(Message::Text(value.to_string().into()))).await, Ok(Ok(()))) { break; }
                    },
                    frame = reader.next() => {
                        let value = match frame {
                            Some(Ok(Message::Text(text))) => match serde_json::from_str::<Value>(&text) {
                                Ok(value) if checked_packet(&value).is_ok() => value,
                                _ => break,
                            },
                            Some(Ok(Message::Ping(_))) => {
                                if !matches!(tokio::time::timeout(Duration::from_secs(10), writer.flush()).await, Ok(Ok(()))) { break; }
                                continue;
                            },
                            Some(Ok(Message::Pong(_))) => continue,
                            _ => break,
                        };
                        if value.get("method").is_some() {
                            owner.observe_project_notification(&value);
                            tokio::select! {
                                _ = owner.stop.notified() => break,
                                result = events.send(value) => if result.is_err() { break; },
                            }
                        } else if let Some(id) = value.get("id") {
                            if let Some(sender) = owner.pending.lock().unwrap().remove(&id.to_string()) {
                                let result = if let Some(error) = value.get("error") {
                                    Err(Error::new("UPSTREAM_ERROR", crate::s(error, "message")))
                                } else { Ok(value["result"].clone()) };
                                let _ = sender.send(result);
                            }
                        }
                    },
                }
            }
            owner.alive.store(false, Ordering::SeqCst);
            for (_, sender) in owner.pending.lock().unwrap().drain() {
                let _ = sender.send(Err(Error::new(
                    "UPSTREAM_UNAVAILABLE",
                    "Runtime disconnected; outcome may be unknown",
                )));
            }
            // Disconnect this socket only; the shared runtime belongs to all clients.
            let _ = tokio::time::timeout(Duration::from_secs(1), writer.close()).await;
            let _ = events.send(json!({"method":"$lost"})).await;
        });
        Ok((rpc, event_rx))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_nonlocal_endpoints_and_credentials_without_echoing_secrets() {
        let credential = "x".repeat(43);
        for endpoint in [
            "ws://localhost:1234",
            "ws://192.168.1.1:1234",
            "wss://127.0.0.1:1234",
            "ws://127.0.0.1:0",
            "ws://127.0.0.1:1234/path",
            "ws://127.0.0.1:1234/?token=secret",
            "ws://user:secret@127.0.0.1:1234",
        ] {
            assert!(local_request(endpoint, &credential).is_err(), "{endpoint}");
        }
        for credential in ["", "short", "secret\r\nAuthorization: value"] {
            let error = local_request("ws://127.0.0.1:1234", credential).unwrap_err();
            assert_eq!(error.code, "CONFIG_ERROR");
        }
        for endpoint in ["ws://127.0.0.1:1234", "ws://[::1]:1234/"] {
            let request = local_request(endpoint, &credential).unwrap();
            assert!(request.headers()[AUTHORIZATION].is_sensitive());
        }
    }
}
