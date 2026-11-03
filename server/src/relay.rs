use crate::{
    accounts::Auth,
    api::{browser_auth, native_auth},
    security, Error, Result, State,
};
use agentdeck_connection_protocol::{
    ControlMessage, TunnelOffer, TunnelRequest, MAX_RELAY_FRAME, TICKET_LIFETIME_SECONDS, VERSION,
};
use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, State as AppState, WebSocketUpgrade,
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, oneshot, watch};
use uuid::Uuid;

#[derive(Clone)]
struct Control {
    generation: String,
    account: String,
    device: String,
    session: String,
    outgoing: mpsc::Sender<ControlMessage>,
    cancel: watch::Sender<bool>,
}
struct Ticket {
    hash: String,
    sender: Option<oneshot::Sender<WebSocket>>,
}
struct Tunnel {
    account: String,
    host: String,
    generation: String,
    client_device: String,
    host_device: String,
    client_session: String,
    host_session: String,
    expires: Instant,
    client: Ticket,
    server: Ticket,
    cancel: watch::Sender<bool>,
}
#[derive(Default)]
struct Connections {
    controls: HashMap<String, Control>,
    tunnels: HashMap<String, Tunnel>,
}
pub struct Hub {
    inner: Mutex<Connections>,
    max_tunnels: usize,
    bytes: AtomicU64,
}
impl Hub {
    pub fn new(max_tunnels: usize) -> Self {
        Self {
            inner: Mutex::new(Connections::default()),
            max_tunnels,
            bytes: AtomicU64::new(0),
        }
    }
    pub fn online(&self, host: &str) -> bool {
        self.inner
            .lock()
            .unwrap()
            .controls
            .get(host)
            .is_some_and(|c| !*c.cancel.borrow())
    }
    pub fn stats(&self) -> Value {
        let inner = self.inner.lock().unwrap();
        json!({"onlineHosts":inner.controls.len(),"tunnels":inner.tunnels.len(),"relayedBytes":self.bytes.load(Ordering::Relaxed),"maxTunnels":self.max_tunnels})
    }
    pub fn disconnect_session(&self, session: &str) {
        self.cancel(
            |c| c.session == session,
            |t| t.client_session == session || t.host_session == session,
        )
    }
    pub fn disconnect_device(&self, device: &str) {
        self.cancel(
            |c| c.device == device,
            |t| t.client_device == device || t.host_device == device,
        )
    }
    pub fn disconnect_account(&self, account: &str) {
        self.cancel(|c| c.account == account, |t| t.account == account)
    }
    pub fn shutdown(&self) {
        self.cancel(|_| true, |_| true)
    }
    fn cancel(&self, control: impl Fn(&Control) -> bool, tunnel: impl Fn(&Tunnel) -> bool) {
        let inner = self.inner.lock().unwrap();
        for entry in inner.controls.values().filter(|c| control(c)) {
            entry.cancel.send_replace(true);
        }
        for entry in inner.tunnels.values().filter(|t| tunnel(t)) {
            entry.cancel.send_replace(true);
        }
    }
    fn register(
        &self,
        host: &str,
        auth: &Auth,
        outgoing: mpsc::Sender<ControlMessage>,
        cancel: watch::Sender<bool>,
    ) -> String {
        let generation = Uuid::new_v4().to_string();
        let mut inner = self.inner.lock().unwrap();
        if let Some(old) = inner.controls.insert(
            host.into(),
            Control {
                generation: generation.clone(),
                account: auth.account_id.clone(),
                device: auth.device_id.clone(),
                session: auth.session_id.clone(),
                outgoing,
                cancel,
            },
        ) {
            old.cancel.send_replace(true);
            for tunnel in inner
                .tunnels
                .values()
                .filter(|t| t.host == host && t.generation == old.generation)
            {
                tunnel.cancel.send_replace(true);
            }
        }
        generation
    }
    fn remove_control(&self, host: &str, generation: &str) {
        let mut inner = self.inner.lock().unwrap();
        if inner
            .controls
            .get(host)
            .is_some_and(|c| c.generation == generation)
        {
            inner.controls.remove(host);
        }
        for tunnel in inner
            .tunnels
            .values()
            .filter(|t| t.host == host && t.generation == generation)
        {
            tunnel.cancel.send_replace(true);
        }
    }
}

pub async fn control(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Result<Response> {
    let auth = native_auth(&state, &headers).await?;
    auth.ready()?;
    if auth.kind != "desktop" {
        return Err(Error::forbidden());
    }
    if !state
        .limits
        .take(format!("control:{}", auth.device_id), 10., 1., 1.)
    {
        return Err(Error::limit());
    }
    let host = state
        .store
        .host_for_device(&auth.device_id)
        .await?
        .ok_or_else(Error::forbidden)?;
    Ok(upgrade
        .max_message_size(4096)
        .max_frame_size(4096)
        .on_upgrade(move |socket| control_connection(state, socket, auth, host)))
}
async fn send(socket: &mut WebSocket, message: Message) -> bool {
    matches!(
        tokio::time::timeout(Duration::from_secs(5), socket.send(message)).await,
        Ok(Ok(()))
    )
}
async fn control_connection(state: Arc<State>, mut socket: WebSocket, auth: Auth, host: String) {
    if !state
        .store
        .session_active(&auth.session_id)
        .await
        .unwrap_or(false)
    {
        return;
    }
    let (tx, mut rx) = mpsc::channel(16);
    let (cancel, mut stop) = watch::channel(false);
    let generation = state.hub.register(&host, &auth, tx, cancel);
    // Registration must precede the final database check: a concurrent revoke
    // either finds this control in the hub or is observed here.
    if !state
        .store
        .session_active(&auth.session_id)
        .await
        .unwrap_or(false)
        || state
            .store
            .host_for_device(&auth.device_id)
            .await
            .ok()
            .flatten()
            .as_deref()
            != Some(&host)
    {
        state.hub.remove_control(&host, &generation);
        return;
    }
    let ready = ControlMessage::Ready {
        version: VERSION,
        host_id: host.clone(),
    };
    if !send(
        &mut socket,
        Message::Text(serde_json::to_string(&ready).unwrap().into()),
    )
    .await
    {
        state.hub.remove_control(&host, &generation);
        return;
    }
    let mut tick = tokio::time::interval(Duration::from_secs(15));
    tick.tick().await;
    let mut received = Instant::now();
    loop {
        tokio::select! {
            _=stop.changed()=>break,
            incoming=socket.next()=>match incoming {
                Some(Ok(Message::Ping(value)))=>{received=Instant::now();if !send(&mut socket,Message::Pong(value)).await{break}},
                Some(Ok(Message::Pong(_)))=>received=Instant::now(),
                _=>break,
            },
            outgoing=rx.recv()=>match outgoing {
                Some(message)=>if !send(&mut socket,Message::Text(serde_json::to_string(&message).unwrap().into())).await{break},
                None=>break,
            },
            _=tick.tick()=>{
                if received.elapsed()>=Duration::from_secs(60)||!state.store.session_active(&auth.session_id).await.unwrap_or(false){break}
                if !send(&mut socket,Message::Ping(Vec::new().into())).await{break}
            }
        }
    }
    state.hub.remove_control(&host, &generation);
    let _ = send(&mut socket, Message::Close(None)).await;
}

pub async fn offer(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Json(request): Json<TunnelRequest>,
) -> Result<Json<TunnelOffer>> {
    let auth = if headers.contains_key("origin") {
        browser_auth(&state, &headers, true, true).await?
    } else {
        native_auth(&state, &headers).await?
    };
    auth.ready()?;
    if auth.kind != "mobile" && auth.kind != "web" {
        return Err(Error::forbidden());
    }
    if !state
        .limits
        .take(format!("offer:{}", auth.device_id), 10., 2., 1.)
    {
        return Err(Error::limit());
    }
    let host_device = state
        .store
        .host_owner(&request.host_id, &auth.account_id)
        .await?;
    let id = Uuid::new_v4().to_string();
    let host_ticket = security::token();
    let client_ticket = security::token();
    let (host_tx, host_rx) = oneshot::channel();
    let (client_tx, client_rx) = oneshot::channel();
    let (cancel, stop) = watch::channel(false);
    let expires_at = (chrono::Utc::now()
        + chrono::Duration::seconds(TICKET_LIFETIME_SECONDS as i64))
    .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let control = {
        let mut inner = state.hub.inner.lock().unwrap();
        if inner.tunnels.len() >= state.hub.max_tunnels
            || inner
                .tunnels
                .values()
                .filter(|t| t.account == auth.account_id)
                .count()
                >= auth.max_tunnels as usize
        {
            return Err(Error::limit());
        }
        let control = inner
            .controls
            .get(&request.host_id)
            .filter(|c| {
                c.account == auth.account_id && c.device == host_device && !*c.cancel.borrow()
            })
            .cloned()
            .ok_or_else(|| Error::new(StatusCode::CONFLICT, "HOST_OFFLINE", "电脑当前不在线"))?;
        inner.tunnels.insert(
            id.clone(),
            Tunnel {
                account: auth.account_id.clone(),
                host: request.host_id.clone(),
                generation: control.generation.clone(),
                client_device: auth.device_id.clone(),
                host_device,
                client_session: auth.session_id.clone(),
                host_session: control.session.clone(),
                expires: Instant::now() + Duration::from_secs(TICKET_LIFETIME_SECONDS),
                client: Ticket {
                    hash: security::digest(&client_ticket),
                    sender: Some(client_tx),
                },
                server: Ticket {
                    hash: security::digest(&host_ticket),
                    sender: Some(host_tx),
                },
                cancel,
            },
        );
        control
    };
    let notification = ControlMessage::OpenTunnel {
        tunnel_id: id.clone(),
        host_ticket,
        expires_at: expires_at.clone(),
        client_device_id: auth.device_id.clone(),
    };
    if !state
        .store
        .session_active(&auth.session_id)
        .await
        .unwrap_or(false)
        || !state
            .store
            .session_active(&control.session)
            .await
            .unwrap_or(false)
    {
        state.hub.inner.lock().unwrap().tunnels.remove(&id);
        return Err(Error::unauthorized());
    }
    if control.outgoing.try_send(notification).is_err() {
        state.hub.inner.lock().unwrap().tunnels.remove(&id);
        return Err(Error::limit());
    }
    let owner = state.clone();
    let tunnel_id = id.clone();
    tokio::spawn(async move {
        tunnel_connection(
            owner.clone(),
            host_rx,
            client_rx,
            stop,
            auth,
            control.session,
        )
        .await;
        owner.hub.inner.lock().unwrap().tunnels.remove(&tunnel_id);
    });
    Ok(Json(TunnelOffer {
        version: VERSION,
        tunnel_id: id,
        client_ticket,
        expires_at,
    }))
}

pub async fn attach(
    AppState(state): AppState<Arc<State>>,
    Path((id, side)): Path<(String, String)>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Result<Response> {
    let auth = if headers.contains_key("origin") {
        browser_auth(&state, &headers, false, true).await?
    } else {
        native_auth(&state, &headers).await?
    };
    auth.ready()?;
    let ticket = headers
        .get("x-tunnel-ticket")
        .and_then(|v| v.to_str().ok())
        .filter(|v| security::valid_token(v))
        .or_else(|| {
            headers
                .get("sec-websocket-protocol")
                .and_then(|v| v.to_str().ok())
                .and_then(|value| {
                    value
                        .split(',')
                        .map(str::trim)
                        .find(|part| security::valid_token(part))
                })
        })
        .ok_or_else(Error::forbidden)?;
    let sender = {
        let mut inner = state.hub.inner.lock().unwrap();
        let tunnel = inner
            .tunnels
            .get_mut(&id)
            .filter(|t| {
                t.account == auth.account_id && !*t.cancel.borrow() && t.expires > Instant::now()
            })
            .ok_or_else(Error::forbidden)?;
        let ticket_slot = match side.as_str() {
            "host"
                if auth.kind == "desktop"
                    && auth.device_id == tunnel.host_device
                    && auth.session_id == tunnel.host_session =>
            {
                &mut tunnel.server
            }
            "client"
                if (auth.kind == "mobile" || auth.kind == "web")
                    && auth.device_id == tunnel.client_device
                    && auth.session_id == tunnel.client_session =>
            {
                &mut tunnel.client
            }
            _ => return Err(Error::forbidden()),
        };
        if !security::equal(&ticket_slot.hash, &security::digest(ticket)) {
            return Err(Error::forbidden());
        }
        ticket_slot.sender.take().ok_or_else(Error::forbidden)?
    };
    Ok(upgrade
        .protocols(["agentdeck-relay-v1"])
        .max_message_size(MAX_RELAY_FRAME)
        .max_frame_size(MAX_RELAY_FRAME)
        .write_buffer_size(0)
        .max_write_buffer_size(MAX_RELAY_FRAME * 2)
        .on_upgrade(move |socket| async move {
            let _ = sender.send(socket);
        })
        .into_response())
}

async fn tunnel_connection(
    state: Arc<State>,
    host: oneshot::Receiver<WebSocket>,
    client: oneshot::Receiver<WebSocket>,
    mut stop: watch::Receiver<bool>,
    auth: Auth,
    host_session: String,
) {
    let peers = tokio::select! {
        _=stop.changed()=>return,
        peers=tokio::time::timeout(Duration::from_secs(TICKET_LIFETIME_SECONDS),async{tokio::try_join!(host,client)})=>match peers{Ok(Ok(peers))=>peers,_=>return},
    };
    let (mut host, mut client) = peers;
    if *stop.borrow()
        || !state
            .store
            .session_active(&auth.session_id)
            .await
            .unwrap_or(false)
        || !state
            .store
            .session_active(&host_session)
            .await
            .unwrap_or(false)
    {
        return;
    }
    let mut tick = tokio::time::interval(Duration::from_secs(15));
    tick.tick().await;
    let mut host_seen = Instant::now();
    let mut client_seen = Instant::now();
    loop {
        tokio::select! {
            _=stop.changed()=>break,
            message=client.next()=>{
                client_seen=Instant::now();
                if !forward(&state,&auth,message,&mut client,&mut host).await{break}
            },
            message=host.next()=>{
                host_seen=Instant::now();
                if !forward(&state,&auth,message,&mut host,&mut client).await{break}
            },
            _=tick.tick()=>{
                if host_seen.elapsed()>=Duration::from_secs(60)||client_seen.elapsed()>=Duration::from_secs(60)||!state.store.session_active(&auth.session_id).await.unwrap_or(false)||!state.store.session_active(&host_session).await.unwrap_or(false){break}
                if !send(&mut host,Message::Ping(Vec::new().into())).await||!send(&mut client,Message::Ping(Vec::new().into())).await{break}
            }
        }
    }
    let _ = tokio::join!(
        send(&mut host, Message::Close(None)),
        send(&mut client, Message::Close(None))
    );
}
async fn forward(
    state: &State,
    auth: &Auth,
    message: Option<std::result::Result<Message, axum::Error>>,
    source: &mut WebSocket,
    target: &mut WebSocket,
) -> bool {
    match message {
        Some(Ok(Message::Binary(bytes))) => {
            let rate = auth.bandwidth_bytes_per_second as f64;
            if bytes.len() > MAX_RELAY_FRAME
                || !state.limits.take(
                    format!("bandwidth:{}", auth.account_id),
                    rate * 2.,
                    rate,
                    bytes.len() as f64,
                )
            {
                return false;
            }
            state
                .hub
                .bytes
                .fetch_add(bytes.len() as u64, Ordering::Relaxed);
            send(target, Message::Binary(bytes)).await
        }
        Some(Ok(Message::Ping(bytes))) => send(source, Message::Pong(bytes)).await,
        Some(Ok(Message::Pong(_))) => true,
        _ => false,
    }
}
