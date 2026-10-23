use crate::{ensure, now, pairing::Pairing, protocol, service::Core, Error, Result};
use axum::{
    body::{to_bytes, Body},
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, State, WebSocketUpgrade,
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::Arc,
    time::{Duration, Instant},
};
#[derive(Clone)]
struct LimitedAcceptor(Arc<tokio::sync::Semaphore>);
struct LimitedStream {
    inner: tokio::net::TcpStream,
    _slot: tokio::sync::OwnedSemaphorePermit,
}
impl tokio::io::AsyncRead for LimitedStream {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}
impl tokio::io::AsyncWrite for LimitedStream {
    fn poll_write(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        std::pin::Pin::new(&mut self.inner).poll_write(cx, buf)
    }
    fn poll_flush(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.inner).poll_flush(cx)
    }
    fn poll_shutdown(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}
impl<S> axum_server::accept::Accept<tokio::net::TcpStream, S> for LimitedAcceptor {
    type Stream = LimitedStream;
    type Service = S;
    type Future = std::future::Ready<std::io::Result<(LimitedStream, S)>>;
    fn accept(&self, stream: tokio::net::TcpStream, service: S) -> Self::Future {
        std::future::ready(
            self.0
                .clone()
                .try_acquire_owned()
                .map(|slot| {
                    (
                        LimitedStream {
                            inner: stream,
                            _slot: slot,
                        },
                        service,
                    )
                })
                .map_err(|_| std::io::Error::other("Connection limit")),
        )
    }
}
#[derive(Default)]
pub struct Buckets {
    values: HashMap<String, (f64, Instant)>,
}
impl Buckets {
    pub fn take(&mut self, key: String, capacity: f64, refill: f64) -> bool {
        let at = Instant::now();
        let entry = self.values.entry(key.clone()).or_insert((capacity, at));
        entry.0 = (entry.0 + at.duration_since(entry.1).as_secs_f64() * refill).min(capacity);
        entry.1 = at;
        let allowed = entry.0 >= 1.;
        if allowed {
            entry.0 -= 1.;
        }
        if self.values.len() > 1000 {
            if let Some(old) = self
                .values
                .iter()
                .filter(|(k, _)| **k != key)
                .min_by_key(|(_, v)| v.1)
                .map(|(k, _)| k.clone())
            {
                self.values.remove(&old);
            }
        }
        allowed
    }
}
fn denied() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        [
            ("Cache-Control", "no-store"),
            ("X-Content-Type-Options", "nosniff"),
        ],
        axum::Json(json!({"code":"UNAUTHORIZED","message":"Endpoint unavailable"})),
    )
        .into_response()
}
async fn pair_request(
    State(core): State<Arc<Core>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    pair(core, peer, headers, body, false).await
}
async fn pair_claim(
    State(core): State<Arc<Core>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    pair(core, peer, headers, body, true).await
}
async fn pair(
    core: Arc<Core>,
    peer: SocketAddr,
    headers: HeaderMap,
    body: Body,
    claim: bool,
) -> Response {
    if headers.contains_key("origin") {
        return denied();
    }
    let result: Result<Value> = async {
        ensure(
            core.rates.lock().unwrap().take(
                format!("pair:{}:{claim}", peer.ip()),
                if claim { 30. } else { 10. },
                if claim { 2. } else { 0.1 },
            ),
            "RATE_LIMITED",
            "Pairing limit reached",
        )?;
        let bytes = tokio::time::timeout(Duration::from_secs(10), to_bytes(body, 4096))
            .await
            .map_err(|_| Error::new("INVALID_REQUEST", "Pairing timed out"))?
            .map_err(|_| Error::new("INVALID_REQUEST", "Pairing body too large"))?;
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|_| Error::new("INVALID_REQUEST", "Invalid pairing JSON"))?;
        if claim {
            core.pairing.claim(&core.store, &value)
        } else {
            let (response, confirmation) = core.pairing.request(&value)?;
            core.emit("pair.confirm", confirmation);
            Ok(response)
        }
    }
    .await;
    let (status, value) = match result {
        Ok(v) => (StatusCode::OK, v),
        Err(e) => (
            if e.code == "RATE_LIMITED" {
                StatusCode::TOO_MANY_REQUESTS
            } else {
                StatusCode::BAD_REQUEST
            },
            json!({"code":e.code,"message":e.message}),
        ),
    };
    (
        status,
        [
            ("Cache-Control", "no-store"),
            ("X-Content-Type-Options", "nosniff"),
        ],
        axum::Json(value),
    )
        .into_response()
}
async fn upgrade(
    State(core): State<Arc<Core>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if headers.contains_key("origin") {
        return denied();
    }
    let credential = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .unwrap_or("")
        .to_owned();
    let device = Pairing::authenticate(&core.store, &credential)
        .ok()
        .flatten();
    let Some(device) = device else {
        return denied();
    };
    let Ok(slot) = core.ws_slots.clone().try_acquire_owned() else {
        return denied();
    };
    if !core
        .rates
        .lock()
        .unwrap()
        .take(format!("rpc:{device}"), 60., 20.)
    {
        return denied();
    }
    ws.max_message_size(1024 * 1024)
        .max_frame_size(1024 * 1024)
        .write_buffer_size(0)
        .max_write_buffer_size(2 * 1024 * 1024)
        .on_upgrade(move |socket| async move {
            let _slot = slot;
            connection(core, socket, device, credential).await
        })
        .into_response()
}
impl Core {
    pub async fn listen(self: &Arc<Self>, address: &str) -> Result<()> {
        let mut network = self.network.lock().await;
        if network.is_some() && *self.address.read().unwrap() == address {
            return Ok(());
        }
        let ip: IpAddr = address
            .parse()
            .map_err(|_| Error::new("CONFIG_ERROR", "Invalid listen address"))?;
        let socket = std::net::TcpListener::bind(SocketAddr::new(ip, self.port))
            .map_err(|_| Error::new("PORT_UNAVAILABLE", "Bridge 端口已被使用，请先退出旧版本"))?;
        socket.set_nonblocking(true)?;
        let config = axum_server::tls_rustls::RustlsConfig::from_pem(
            self.tls.cert.clone().into_bytes(),
            self.tls.key.clone().into_bytes(),
        )
        .await
        .map_err(|_| Error::new("TLS_ERROR", "Cannot load TLS certificate"))?;
        let router = Router::new()
            .route("/api/v1/pair/request", post(pair_request))
            .route("/api/v1/pair/claim", post(pair_claim))
            .route("/api/v1/ws", get(upgrade))
            .fallback(|| async { denied() })
            .with_state(self.clone());
        let handle = axum_server::Handle::new();
        let acceptor = axum_server::tls_rustls::RustlsAcceptor::new(config)
            .handshake_timeout(Duration::from_secs(10))
            .acceptor(LimitedAcceptor(Arc::new(tokio::sync::Semaphore::new(64))));
        let mut server = axum_server::from_tcp(socket)
            .map_err(|_| Error::new("TLS_ERROR", "Cannot configure TLS listener"))?
            .acceptor(acceptor)
            .handle(handle.clone());
        server
            .http_builder()
            .http1()
            .timer(hyper_util::rt::TokioTimer::new())
            .header_read_timeout(Duration::from_secs(10));
        let owner = self.clone();
        let task = tokio::spawn(async move {
            if server
                .serve(router.into_make_service_with_connect_info::<SocketAddr>())
                .await
                .is_err()
            {
                owner.emit(
                    "error",
                    json!({"message":"TLS listener stopped unexpectedly"}),
                );
                owner.request_stop();
            }
        });
        if let Some((old, task)) = network.take() {
            old.shutdown();
            let _ = tokio::time::timeout(Duration::from_secs(2), task).await;
        }
        *self.address.write().unwrap() = address.into();
        *network = Some((handle, task));
        Ok(())
    }
}
async fn send(socket: &mut futures_util::stream::SplitSink<WebSocket, Message>, v: Value) -> bool {
    let text = v.to_string();
    if text.len() > 1024 * 1024 {
        if let Some(id) = v["id"].as_str() {
            let error = Error::new(
                "PAYLOAD_TOO_LARGE",
                "Result too large; reduce history or inspect locally",
            )
            .packet(Some(id));
            return tokio::time::timeout(
                Duration::from_secs(5),
                socket.send(Message::Text(error.to_string().into())),
            )
            .await
            .is_ok_and(|r| r.is_ok());
        }
        return false;
    }
    tokio::time::timeout(
        Duration::from_secs(5),
        socket.send(Message::Text(text.into())),
    )
    .await
    .is_ok_and(|r| r.is_ok())
}
async fn connection(core: Arc<Core>, socket: WebSocket, device: String, credential: String) {
    *core
        .connected
        .lock()
        .unwrap()
        .entry(device.clone())
        .or_default() += 1;
    core.publish();
    let (mut writer, mut reader) = socket.split();
    let mut events = core.store.events.subscribe();
    let (responses, mut result_rx) = tokio::sync::mpsc::channel::<Value>(8);
    let local_slots = {
        let mut slots = core.device_slots.lock().unwrap();
        if slots.len() >= 1000 && !slots.contains_key(&device) {
            return;
        }
        slots
            .entry(device.clone())
            .or_insert_with(|| Arc::new(tokio::sync::Semaphore::new(8)))
            .clone()
    };
    let mut hello = false;
    let mut heartbeat = tokio::time::interval(Duration::from_secs(15));
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    heartbeat.tick().await;
    let mut last_received = Instant::now();
    loop {
        tokio::select! {
            incoming=reader.next()=>{match incoming{Some(Ok(Message::Text(text)))=>{
                if Pairing::authenticate(&core.store,&credential).ok().flatten().as_ref()!=Some(&device){break;}
                last_received = Instant::now();
                let request=serde_json::from_str::<Value>(&text).map_err(|_|Error::new("INVALID_REQUEST","Invalid JSON")).and_then(protocol::parse);let request=match request{Ok(v)=>v,Err(e)=>{if !send(&mut writer,e.packet(None)).await{break;}continue;}};
            if !hello&&request.action!="system.hello"{if !send(&mut writer,Error::new("VERSION_REQUIRED","Send system.hello first").packet(Some(&request.id))).await{break;}continue;}
            if request.action=="system.hello"{hello=true;}
                if !core.rates.lock().unwrap().take(format!("rpc:{device}"),60.,20.){if !send(&mut writer,Error::new("RATE_LIMITED","Request rate limit").packet(Some(&request.id))).await{break;}continue;}
                let permit=local_slots.clone().try_acquire_owned();let global=core.rpc_slots.clone().try_acquire_owned();if permit.is_err()||global.is_err(){if !send(&mut writer,Error::new("RATE_LIMITED","Too many concurrent requests").packet(Some(&request.id))).await{break;}continue;}
                let owner=core.clone();let tx=responses.clone();let device=device.clone();tokio::spawn(async move{let _permit=permit;let _global=global;let packet=handle_request(&owner,&request,&device).await;let _=tx.try_send(packet);});
            },Some(Ok(Message::Pong(_)))=>last_received=Instant::now(),Some(Ok(Message::Ping(bytes)))=>{last_received=Instant::now();if !matches!(tokio::time::timeout(Duration::from_secs(5),writer.send(Message::Pong(bytes))).await,Ok(Ok(()))){break;}},Some(Ok(Message::Binary(_)))|Some(Ok(Message::Close(_)))|Some(Err(_))|None=>break}},
            result=result_rx.recv()=>{if let Some(v)=result{if !send(&mut writer,v).await{break;}}},
            event=events.recv()=>{match event{Ok(v) if hello=>{if Pairing::authenticate(&core.store,&credential).ok().flatten().as_ref()!=Some(&device)||!send(&mut writer,v).await{break;}},Ok(_)=>{},Err(_)=>break}},
            _=heartbeat.tick()=>{if peer_timed_out(last_received, Instant::now())||core.stopping.load(std::sync::atomic::Ordering::SeqCst)||Pairing::authenticate(&core.store,&credential).ok().flatten().as_ref()!=Some(&device){break;}
                if !matches!(tokio::time::timeout(Duration::from_secs(5),writer.send(Message::Ping(vec![].into()))).await,Ok(Ok(()))){break;}}
        }
    }
    let _ = tokio::time::timeout(Duration::from_secs(1), writer.close()).await;
    let last = {
        let mut connected = core.connected.lock().unwrap();
        if let Some(n) = connected.get_mut(&device) {
            *n = n.saturating_sub(1);
            if *n == 0 {
                connected.remove(&device);
            }
        }
        connected.is_empty()
    };
    if last {
        let _ = core.invalidate_approvals(true);
    }
    core.publish();
}
fn peer_timed_out(last_received: Instant, now: Instant) -> bool {
    now.saturating_duration_since(last_received) >= Duration::from_secs(60)
}

pub async fn handle_request(core: &Core, r: &protocol::Request, device: &str) -> Value {
    let mutate = matches!(
        r.action.as_str(),
        "sessions.create"
            | "skills.setEnabled"
            | "settings.outputDefaults"
            | "settings.modelDefaults"
            | "queue.add"
            | "queue.update"
            | "queue.delete"
            | "queue.reorder"
            | "queue.start"
            | "sessions.goal.resume"
            | "sessions.goal.clear"
            | "sessions.goal.edit"
            | "sessions.revise"
            | "sessions.compact"
            | "sessions.revert"
            | "sessions.fork"
            | "sessions.rename"
            | "sessions.archive"
            | "sessions.restore"
            | "sessions.delete"
            | "sessions.pin"
            | "turn.start"
            | "turn.steer"
            | "turn.interruptActive"
            | "turn.interrupt"
            | "approvals.decide"
            | "projects.add"
            | "projects.remove"
            | "devices.revokeSelf"
            | "settings.update"
    );
    if mutate {
        match core.store.reserve(device, &r.id, &r.action, &r.payload) {
            Ok(Some(v)) => return v,
            Ok(None) => {}
            Err(e) => return e.packet(Some(&r.id)),
        }
    }
    let result = core.dispatch(r, device).await;
    match result {
        Ok(payload) => {
            let response = json!({"v":1,"type":"response","id":r.id,"action":r.action,"payload":payload,"ts":now()});
            if mutate&&core.store.exec("UPDATE requests SET status='done',responseJson=? WHERE deviceId=? AND requestId=?",[response.to_string(),device.into(),r.id.clone()]).is_err(){return Error::new("OUTCOME_UNKNOWN","Could not save outcome; reconcile snapshot").packet(Some(&r.id));}
            response
        }
        Err(e) => {
            let _ = core.store.append("request.failed", json!({"action":r.action,"requestId":r.id,"code":e.code,"message":crate::redact(&e.message)}), r.payload["sessionId"].as_str(), None);
            if mutate {
                let _ = core.store.exec(
                    "UPDATE requests SET status='unknown' WHERE deviceId=? AND requestId=?",
                    [device, &r.id],
                );
            }
            e.packet(Some(&r.id))
        }
    }
}

#[cfg(test)]
mod heartbeat_tests {
    use super::*;
    #[test]
    fn late_heartbeat_is_tolerated_but_silent_peer_expires() {
        let start = Instant::now();
        assert!(!peer_timed_out(start, start + Duration::from_secs(30)));
        assert!(!peer_timed_out(start, start + Duration::from_secs(59)));
        assert!(peer_timed_out(start, start + Duration::from_secs(60)));
        let resumed = start + Duration::from_secs(45);
        assert!(!peer_timed_out(resumed, start + Duration::from_secs(75)));
    }
}
