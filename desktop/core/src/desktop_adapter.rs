//! Opt-in authenticated loopback transport for the desktop's local WS route.
//! Never logs headers, URLs containing credentials, or JSON-RPC content.
use crate::{ensure, runtime::RuntimeTarget, security, Error, Result};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::{HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{SinkExt, StreamExt};
use std::{
    net::{Ipv4Addr, SocketAddr},
    sync::Arc,
    time::Duration,
};
use tokio::sync::Semaphore;
use tokio_tungstenite::tungstenite::{
    client::IntoClientRequest, http::HeaderValue, protocol::WebSocketConfig,
    Message as NativeMessage,
};
use tokio_util::sync::CancellationToken;

const LIMIT: usize = 8 * 1024 * 1024;

#[derive(Clone)]
struct AdapterState {
    target: RuntimeTarget,
    host: String,
    slots: Arc<Semaphore>,
    shutdown: CancellationToken,
}

pub struct DesktopAdapter {
    pub port: u16,
    task: tokio::task::JoinHandle<()>,
    shutdown: CancellationToken,
}
impl Drop for DesktopAdapter {
    fn drop(&mut self) {
        self.shutdown.cancel();
        self.task.abort();
    }
}
impl DesktopAdapter {
    pub async fn from_environment(target: &RuntimeTarget) -> Result<Option<Self>> {
        let Some(port) = std::env::var_os("AGENTDECK_DESKTOP_ADAPTER_PORT") else {
            return Ok(None);
        };
        let port = port
            .to_str()
            .and_then(|p| p.parse::<u16>().ok())
            .ok_or_else(|| Error::new("CONFIG_ERROR", "Invalid desktop adapter port"))?;
        Ok(Some(Self::listen(target.clone(), port).await?))
    }
    pub async fn listen(target: RuntimeTarget, port: u16) -> Result<Self> {
        ensure(
            port == 0 || port > 1024,
            "CONFIG_ERROR",
            "Invalid desktop adapter port",
        )?;
        let RuntimeTarget::Attached { endpoint, .. } = &target else {
            return Err(Error::new(
                "CONFIG_ERROR",
                "Desktop adapter requires an explicitly attached runtime",
            ));
        };
        crate::rpc::validate_local_endpoint(endpoint)?;
        target.credential()?;
        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, port))
            .await
            .map_err(|_| Error::new("PORT_UNAVAILABLE", "Desktop adapter listener unavailable"))?;
        let port = listener.local_addr()?.port();
        let shutdown = CancellationToken::new();
        let state = AdapterState {
            target,
            host: format!("127.0.0.1:{port}"),
            slots: Arc::new(Semaphore::new(16)),
            shutdown: shutdown.clone(),
        };
        let router = Router::new()
            .route("/", get(upgrade))
            .fallback(|| async { StatusCode::UNAUTHORIZED })
            .with_state(state);
        let task = tokio::spawn(async move {
            let _ = axum::serve(
                listener,
                router.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await;
        });
        Ok(Self {
            port,
            task,
            shutdown,
        })
    }
}

async fn upgrade(
    State(state): State<AdapterState>,
    uri: Uri,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    // Origin-bearing browsers, DNS-rebound hosts and query credentials are not
    // desktop local transports. No unauthenticated forwarding path exists.
    if uri.path_and_query().map(|p| p.as_str()) != Some("/")
        || headers.contains_key("origin")
        || headers.contains_key("sec-websocket-protocol")
        || headers.get("host").and_then(|h| h.to_str().ok()) != Some(&state.host)
        || headers.get_all("authorization").iter().count() != 1
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(token) = state.target.credential() else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let expected = format!("Basic {}", STANDARD.encode(format!("agentdeck:{token}")));
    let supplied = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    if !security::equal(supplied, &expected) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(slot) = state.slots.try_acquire_owned() else {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    };
    let RuntimeTarget::Attached { endpoint, .. } = state.target else {
        unreachable!()
    };
    let Ok(mut request) = endpoint.into_client_request() else {
        return StatusCode::BAD_GATEWAY.into_response();
    };
    let Ok(mut authorization) = HeaderValue::from_str(&format!("Bearer {token}")) else {
        return StatusCode::BAD_GATEWAY.into_response();
    };
    authorization.set_sensitive(true);
    request.headers_mut().insert("authorization", authorization);
    let config = WebSocketConfig::default()
        .max_message_size(Some(LIMIT))
        .max_frame_size(Some(LIMIT));
    let connection = tokio::select! {
        _=state.shutdown.cancelled()=>return StatusCode::SERVICE_UNAVAILABLE.into_response(),
        connection=tokio::time::timeout(Duration::from_secs(10),tokio_tungstenite::connect_async_with_config(request,Some(config),true))=>connection,
    };
    let Ok(Ok((native, _))) = connection else {
        return StatusCode::BAD_GATEWAY.into_response();
    };
    ws.max_message_size(LIMIT)
        .max_frame_size(LIMIT)
        .on_upgrade(move |desktop| async move {
            let _slot = slot;
            forward(desktop, native, state.shutdown).await;
        })
        .into_response()
}

async fn forward(
    mut desktop: WebSocket,
    mut native: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    shutdown: CancellationToken,
) {
    loop {
        tokio::select! {
            _=shutdown.cancelled()=>break,
            incoming=desktop.recv()=>{
                let Some(Ok(message))=incoming else {break};
                let message=match message {
                    Message::Text(text)=>NativeMessage::Text(text.to_string().into()),
                    Message::Ping(_)=>{if !matches!(tokio::time::timeout(Duration::from_secs(10),desktop.flush()).await,Ok(Ok(()))){break;} continue;},
                    Message::Pong(_)=>continue,
                    _=>break,
                };
                if !matches!(tokio::time::timeout(Duration::from_secs(10),native.send(message)).await,Ok(Ok(()))){break;}
            }
            incoming=native.next()=>{
                let Some(Ok(message))=incoming else {break};
                let message=match message {
                    NativeMessage::Text(text)=>Message::Text(text.to_string().into()),
                    NativeMessage::Ping(_)=>{if !matches!(tokio::time::timeout(Duration::from_secs(10),native.flush()).await,Ok(Ok(()))){break;} continue;},
                    NativeMessage::Pong(_)=>continue,
                    _=>break,
                };
                if !matches!(tokio::time::timeout(Duration::from_secs(10),desktop.send(message)).await,Ok(Ok(()))){break;}
            }
        }
    }
    // Closing the desktop connection drops only this upstream socket, never the
    // shared process, another client, or a task. No pending frame is replayed.
}
