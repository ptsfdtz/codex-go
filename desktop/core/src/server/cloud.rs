//! Account control plane and fixed-destination, end-to-end TLS relay acceptor.
//! Cloud credentials never enter desktop state, events, or Codex requests.
use crate::{ensure, pairing::RemoteIdentity, security, service::Core, Error, Result};
use agentdeck_connection_protocol::{ControlMessage, MAX_RELAY_FRAME, VERSION};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex, RwLock},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::watch,
    task::{JoinHandle, JoinSet},
};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};

const SAVED_KEY: &str = "cloudSessionProtectedV1";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Tokens {
    access_token: String,
    refresh_token: String,
    access_expires_in: u64,
    account_id: String,
    username: String,
    cloud_device_id: String,
    must_change_password: bool,
}
#[derive(Clone, Serialize, Deserialize)]
struct Saved {
    origin: String,
    installation: String,
    expires_at: i64,
    tokens: Tokens,
}
#[derive(Default, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub origin: String,
    pub username: String,
    pub account_id: String,
    pub signed_in: bool,
    pub online: bool,
    pub must_change_password: bool,
    pub error: Option<String>,
}
pub struct Cloud {
    access_cache:
        tokio::sync::Mutex<std::collections::HashMap<String, (RemoteIdentity, std::time::Instant)>>,
    #[cfg(test)]
    connector: Option<Arc<rustls::ClientConfig>>,
    client: reqwest::Client,
    saved: tokio::sync::Mutex<Option<Saved>>,
    status: RwLock<Status>,
    changed: watch::Sender<u64>,
    task: Mutex<Option<JoinHandle<()>>>,
}
impl Default for Cloud {
    fn default() -> Self {
        Self {
            access_cache: Default::default(),
            #[cfg(test)]
            connector: None,
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(25))
                .build()
                .expect("Valid HTTP client configuration"),
            saved: tokio::sync::Mutex::new(None),
            status: RwLock::new(Status::default()),
            changed: watch::channel(0).0,
            task: Mutex::new(None),
        }
    }
}
impl Cloud {
    async fn websocket(
        &self,
        request: tokio_tungstenite::tungstenite::http::Request<()>,
        limit: usize,
    ) -> std::result::Result<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        tokio_tungstenite::tungstenite::Error,
    > {
        #[cfg(test)]
        let connector = self
            .connector
            .clone()
            .map(tokio_tungstenite::Connector::Rustls);
        #[cfg(not(test))]
        let connector = None;
        let config = tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default()
            .max_message_size(Some(limit))
            .max_frame_size(Some(limit));
        tokio_tungstenite::connect_async_tls_with_config(request, Some(config), false, connector)
            .await
            .map(|(socket, _)| socket)
    }
    pub fn status(&self) -> Status {
        self.status.read().unwrap().clone()
    }
    fn notify(&self) {
        self.changed
            .send_modify(|generation| *generation = generation.wrapping_add(1));
    }
    pub fn stop(&self) {
        if let Some(task) = self.task.lock().unwrap().take() {
            task.abort();
        }
    }
    pub fn pairing_account(&self) -> Result<(String, String)> {
        let state = self.status();
        ensure(
            state.signed_in && !state.must_change_password,
            "CLOUD_LOGIN_REQUIRED",
            "请先登录并修改初始密码",
        )?;
        Ok((state.origin, state.account_id))
    }
    fn write(&self, core: &Core, saved: Option<&Saved>) -> Result<()> {
        let value = match saved {
            Some(saved) => STANDARD.encode(security::dpapi(
                &serde_json::to_vec(saved)
                    .map_err(|_| Error::new("SECRET_STORE_ERROR", "无法保存云端登录信息"))?,
                true,
            )?),
            None => String::new(),
        };
        core.store.set_meta(SAVED_KEY, &value)
    }
    fn identity(&self, saved: &Saved) {
        *self.status.write().unwrap() = Status {
            origin: saved.origin.clone(),
            username: saved.tokens.username.clone(),
            account_id: saved.tokens.account_id.clone(),
            signed_in: true,
            must_change_password: saved.tokens.must_change_password,
            ..Status::default()
        };
    }
    fn failure(&self, error: &Error) {
        let mut status = self.status.write().unwrap();
        status.online = false;
        status.error = Some(error.message.clone());
    }
    async fn forget(&self, core: &Core, message: Option<String>) -> Result<Option<Saved>> {
        self.access_cache.lock().await.clear();
        let mut saved = self.saved.lock().await;
        self.write(core, None)?;
        let previous = saved.take();
        let mut status = self.status.write().unwrap();
        status.signed_in = false;
        status.online = false;
        status.must_change_password = false;
        status.error = message;
        drop(status);
        self.notify();
        core.authorization_changed.notify_waiters();
        Ok(previous)
    }
    pub async fn start(core: &Arc<Core>) -> Result<()> {
        let loaded = (|| -> Result<Option<Saved>> {
            let Some(protected) = core.store.meta(SAVED_KEY)?.filter(|v| !v.is_empty()) else {
                return Ok(None);
            };
            let bytes = STANDARD
                .decode(protected)
                .map_err(|_| Error::new("SECRET_STORE_ERROR", "无法读取云端登录信息"))?;
            let saved: Saved =
                serde_json::from_slice(&security::dpapi(&bytes, false)?).map_err(|_| {
                    Error::new("SECRET_STORE_ERROR", "云端登录信息格式无效，请重新登录")
                })?;
            validate_origin(&saved.origin)?;
            Ok(Some(saved))
        })();
        match loaded {
            Ok(Some(saved)) => {
                core.cloud.identity(&saved);
                *core.cloud.saved.lock().await = Some(saved);
            }
            Ok(None) => {}
            Err(error) => core.cloud.failure(&error),
        }
        let owner = core.clone();
        let task = tokio::spawn(async move { run(owner).await });
        *core.cloud.task.lock().unwrap() = Some(task);
        Ok(())
    }
    async fn access(&self, core: &Core) -> Result<Saved> {
        let mut slot = self.saved.lock().await;
        let saved = slot
            .as_mut()
            .ok_or_else(|| Error::new("CLOUD_LOGIN_REQUIRED", "请登录云端服务"))?;
        if saved.expires_at <= chrono::Utc::now().timestamp() + 60 {
            let response = self
                .client
                .post(format!("{}/api/v1/auth/refresh", saved.origin))
                .json(&json!({"refreshToken":saved.tokens.refresh_token}))
                .send()
                .await
                .map_err(network_error)?;
            let renewed: Tokens = reply(response).await?;
            ensure(
                renewed.account_id == saved.tokens.account_id
                    && renewed.cloud_device_id == saved.tokens.cloud_device_id,
                "CLOUD_IDENTITY_MISMATCH",
                "云端账户或设备身份发生变化，请重新登录",
            )?;
            saved.expires_at =
                chrono::Utc::now().timestamp() + renewed.access_expires_in.min(600) as i64;
            saved.tokens = renewed;
            // Persist before another refresh can use the new secret. A failed write
            // stops remote use rather than risking reuse after a process restart.
            if self.write(core, Some(saved)).is_err() {
                *slot = None;
                return Err(Error::new(
                    "SECRET_STORE_ERROR",
                    "无法安全保存登录信息，请重新登录",
                ));
            }
            let saved = slot.as_ref().unwrap();
            self.status.write().unwrap().must_change_password = saved.tokens.must_change_password;
        }
        Ok(slot.as_ref().unwrap().clone())
    }
}
pub fn validate_origin(value: &str) -> Result<String> {
    let url = reqwest::Url::parse(value)
        .map_err(|_| Error::new("CONFIG_ERROR", "请输入完整的 HTTPS 服务地址"))?;
    ensure(
        url.scheme() == "https"
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.path() == "/"
            && url.query().is_none()
            && url.fragment().is_none(),
        "CONFIG_ERROR",
        "云端地址必须是 HTTPS 域名地址，不能包含路径或凭据",
    )?;
    Ok(url.origin().ascii_serialization())
}
fn network_error(_: reqwest::Error) -> Error {
    Error::new("CLOUD_UNAVAILABLE", "无法连接云端服务，请检查网络")
}
async fn reply<T: serde::de::DeserializeOwned>(response: reqwest::Response) -> Result<T> {
    let status = response.status();
    if status.is_success() {
        return response
            .json()
            .await
            .map_err(|_| Error::new("CLOUD_PROTOCOL_ERROR", "云端响应格式不兼容"));
    }
    let value: Value = response.json().await.unwrap_or(Value::Null);
    let (code, message) = match value["code"].as_str() {
        Some("PASSWORD_CHANGE_REQUIRED") => ("PASSWORD_CHANGE_REQUIRED", "请先修改初始密码"),
        Some("HOST_BOUND") => ("HOST_BOUND", "电脑已绑定其他账户，请先在原账户中解绑"),
        _ if status == reqwest::StatusCode::UNAUTHORIZED => (
            "CLOUD_LOGIN_REQUIRED",
            "登录已失效或账号密码无效，请重新登录",
        ),
        _ if status == reqwest::StatusCode::FORBIDDEN => {
            ("CLOUD_FORBIDDEN", "云端拒绝访问，请检查账户或设备授权")
        }
        _ if status == reqwest::StatusCode::TOO_MANY_REQUESTS => {
            ("RATE_LIMITED", "已达到云端请求或设备配额，请稍后重试")
        }
        _ => ("CLOUD_UNAVAILABLE", "云端服务暂时不可用"),
    };
    Err(Error::new(code, message))
}
impl Core {
    /// Account authorization is checked for both LAN and relayed sockets. A
    /// short cache bounds revocation latency without an HTTP call per delta.
    pub(crate) async fn account_device(
        &self,
        credential: &str,
        remote: Option<&RemoteIdentity>,
    ) -> Result<String> {
        ensure(
            security::valid_token(credential),
            "UNAUTHORIZED",
            "Invalid device credential",
        )?;
        let status = self.cloud.status();
        ensure(
            status.signed_in && !status.must_change_password,
            "UNAUTHORIZED",
            "Account signed out",
        )?;
        let hash = crate::digest(credential);
        let mut cache = self.cloud.access_cache.lock().await;
        if let Some((identity, until)) = cache.get(&hash) {
            if *until > std::time::Instant::now()
                && identity.issuer == status.origin
                && identity.account_id == status.account_id
                && remote.is_none_or(|r| r == identity)
            {
                let existing = self.store.query(
                    "SELECT revokedAt FROM devices WHERE deviceId=?",
                    [&identity.device_id],
                )?;
                ensure(
                    existing
                        .first()
                        .is_some_and(|row| row["revokedAt"].is_null()),
                    "UNAUTHORIZED",
                    "Device revoked",
                )?;
                return Ok(identity.device_id.clone());
            }
        }
        let saved = self.cloud.access(self).await?;
        let value: Value = reply(
            self.cloud
                .client
                .post(format!("{}/api/v1/hosts/access/validate", saved.origin))
                .bearer_auth(&saved.tokens.access_token)
                .json(&json!({"credential":credential}))
                .send()
                .await
                .map_err(network_error)?,
        )
        .await?;
        let identity = RemoteIdentity {
            issuer: saved.origin,
            account_id: saved.tokens.account_id,
            device_id: crate::s(&value, "deviceId").into(),
        };
        ensure(
            value["hostId"] == self.store.meta("hostId")?.unwrap_or_default()
                && value["accountId"] == identity.account_id
                && uuid::Uuid::parse_str(&identity.device_id).is_ok()
                && uuid::Uuid::parse_str(crate::s(&value, "sessionId")).is_ok()
                && remote.is_none_or(|r| r == &identity),
            "UNAUTHORIZED",
            "Account device identity mismatch",
        )?;
        let current = self.cloud.status();
        ensure(
            current.signed_in
                && current.origin == identity.issuer
                && current.account_id == identity.account_id,
            "UNAUTHORIZED",
            "Account changed",
        )?;
        let existing = self.store.query(
            "SELECT deviceId,revokedAt,credentialHash FROM devices WHERE deviceId=?",
            [&identity.device_id],
        )?;
        let marker = format!("account:{}", crate::s(&value, "sessionId"));
        if existing.is_empty() {
            self.store.add_device(
                &identity.device_id,
                crate::s(&value, "displayName"),
                &marker,
            )?;
        } else {
            let row = &existing[0];
            // Only an explicitly new cloud login may restore a locally revoked
            // account device. Refreshing or issuing another grant cannot do so.
            ensure(
                crate::s(row, "credentialHash").starts_with("account:")
                    && (row["revokedAt"].is_null() || row["credentialHash"] != marker),
                "UNAUTHORIZED",
                "Device revoked; sign in again",
            )?;
            let changed=self.store.exec("UPDATE devices SET credentialHash=?,displayName=?,revokedAt=NULL WHERE deviceId=? AND (revokedAt IS NULL OR (revokedAt=? AND credentialHash<>?))",rusqlite::params![marker,crate::s(&value,"displayName"),identity.device_id,row["revokedAt"].as_str(),marker])?;
            ensure(changed == 1, "UNAUTHORIZED", "Device revoked")?;
        }
        cache.retain(|_, (_, until)| *until > std::time::Instant::now());
        cache.insert(
            hash,
            (
                identity.clone(),
                std::time::Instant::now() + Duration::from_secs(10),
            ),
        );
        Ok(identity.device_id)
    }
    pub async fn cloud_login(
        self: &Arc<Self>,
        origin: &str,
        username: &str,
        password: &str,
    ) -> Result<()> {
        let origin = validate_origin(origin)?;
        ensure(
            !username.trim().is_empty() && username.len() <= 80 && password.len() <= 1024,
            "INVALID_REQUEST",
            "账户或密码格式无效",
        )?;
        let mut slot = self.cloud.saved.lock().await;
        ensure(slot.is_none(), "CONFLICT", "请先退出当前云端账户")?;
        let installation = self
            .store
            .meta("cloudInstallationId")?
            .unwrap_or_else(security::token);
        self.store.set_meta("cloudInstallationId", &installation)?;
        let tokens:Tokens=reply(self.cloud.client.post(format!("{origin}/api/v1/auth/login")).json(&json!({"username":username,"password":password,"installationId":installation,"deviceName":std::env::var("COMPUTERNAME").unwrap_or_else(|_|"AgentDeck computer".into()),"kind":"desktop"})).send().await.map_err(network_error)?).await?;
        let saved = Saved {
            origin,
            installation,
            expires_at: chrono::Utc::now().timestamp() + tokens.access_expires_in.min(600) as i64,
            tokens,
        };
        self.cloud.write(self, Some(&saved))?;
        self.cloud.identity(&saved);
        *slot = Some(saved);
        drop(slot);
        self.cloud.notify();
        Ok(())
    }
    pub async fn cloud_logout(&self, unbind: bool) -> Result<()> {
        // Local disconnection happens even if the cloud cannot be reached.
        let saved = self.cloud.forget(self, None).await?;
        if let Some(saved) = saved {
            let response = if unbind {
                self.cloud
                    .client
                    .delete(format!(
                        "{}/api/v1/hosts/{}",
                        saved.origin,
                        self.store.meta("hostId")?.unwrap_or_default()
                    ))
                    .bearer_auth(&saved.tokens.access_token)
                    .send()
                    .await
            } else {
                self.cloud
                    .client
                    .post(format!("{}/api/v1/auth/logout", saved.origin))
                    .bearer_auth(&saved.tokens.access_token)
                    .send()
                    .await
            };
            let response = response.map_err(network_error)?;
            let _: Value = reply(response).await?;
        }
        Ok(())
    }
    pub async fn cloud_password(&self, old: &str, new: &str) -> Result<()> {
        ensure(
            (12..=1024).contains(&new.len()) && old.len() <= 1024,
            "INVALID_REQUEST",
            "新密码需为 12 至 1024 字节",
        )?;
        let saved = self.cloud.access(self).await?;
        let _: Value = reply(
            self.cloud
                .client
                .post(format!("{}/api/v1/auth/password", saved.origin))
                .bearer_auth(&saved.tokens.access_token)
                .json(&json!({"oldPassword":old,"newPassword":new}))
                .send()
                .await
                .map_err(network_error)?,
        )
        .await?;
        self.cloud
            .forget(self, Some("密码已修改，请重新登录".into()))
            .await?;
        Ok(())
    }
}
async fn run(core: Arc<Core>) {
    let mut changed = core.cloud.changed.subscribe();
    let mut failures = 0u32;
    loop {
        let _ = *changed.borrow_and_update();
        if core.stopping.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        if !core.cloud.status().signed_in || core.cloud.status().must_change_password {
            if changed.changed().await.is_err() {
                return;
            }
            continue;
        }
        let result = control(&core, &mut changed).await;
        if let Err(error) = result {
            core.cloud.failure(&error);
            if matches!(
                error.code.as_str(),
                "CLOUD_LOGIN_REQUIRED"
                    | "CLOUD_FORBIDDEN"
                    | "CLOUD_IDENTITY_MISMATCH"
                    | "SECRET_STORE_ERROR"
            ) {
                let _ = core.cloud.forget(&core, Some(error.message)).await;
            }
        }
        {
            core.cloud.status.write().unwrap().online = false;
        }
        core.publish();
        failures = (failures + 1).min(5);
        tokio::select! {_=changed.changed()=>{failures=0},_=tokio::time::sleep(Duration::from_secs(1<<failures))=>{}}
    }
}
async fn control(core: &Arc<Core>, changed: &mut watch::Receiver<u64>) -> Result<()> {
    let saved = core.cloud.access(core).await?;
    let host = core.store.meta("hostId")?.unwrap_or_default();
    let addresses = security::addresses();
    if let Some(address) = addresses.iter().find(|a| a.as_str() != "127.0.0.1") {
        core.store.set_meta("lanEnabled", "true")?;
        core.listen(address).await?;
    }
    register(core, &saved, &host).await?;
    let mut request = format!(
        "{}/api/v1/relay/control",
        saved.origin.replacen("https:", "wss:", 1)
    )
    .into_client_request()
    .map_err(|_| Error::new("CONFIG_ERROR", "云端连接地址无效"))?;
    request.headers_mut().insert(
        "Authorization",
        format!("Bearer {}", saved.tokens.access_token)
            .parse()
            .map_err(|_| Error::new("CLOUD_PROTOCOL_ERROR", "云端凭据无效"))?,
    );
    let mut socket =
        tokio::time::timeout(Duration::from_secs(15), core.cloud.websocket(request, 4096))
            .await
            .map_err(|_| Error::new("CLOUD_UNAVAILABLE", "云端连接超时"))?
            .map_err(|error| match error {
                tokio_tungstenite::tungstenite::Error::Http(response)
                    if matches!(response.status().as_u16(), 401 | 403) =>
                {
                    Error::new("CLOUD_LOGIN_REQUIRED", "云端登录已失效，请重新登录")
                }
                _ => Error::new("CLOUD_UNAVAILABLE", "云端连接中断，正在重连"),
            })?;
    let mut tunnels = JoinSet::new();
    let mut tick = tokio::time::interval(Duration::from_secs(30));
    tick.tick().await;
    let mut received = std::time::Instant::now();
    let mut ready = false;
    loop {
        tokio::select! {
            biased;
            _=changed.changed()=>break,
            incoming=socket.next()=>{
                received=std::time::Instant::now();
                match incoming {
                    Some(Ok(Message::Text(value)))=>match serde_json::from_str::<ControlMessage>(&value).map_err(|_|Error::new("CLOUD_PROTOCOL_ERROR","云端连接协议不兼容"))? {
                        ControlMessage::Ready{version,host_id}=>{
                            ensure(!ready&&version==VERSION&&host_id==host,"CLOUD_IDENTITY_MISMATCH","云端电脑身份不匹配")?;
                            ready=true;{let mut status=core.cloud.status.write().unwrap();status.online=true;status.error=None;}core.publish();
                        },
                        ControlMessage::OpenTunnel{tunnel_id,host_ticket,expires_at,client_device_id}=>{
                            ensure(ready&&security::valid_token(&host_ticket)&&uuid::Uuid::parse_str(&tunnel_id).is_ok()&&uuid::Uuid::parse_str(&client_device_id).is_ok(),"CLOUD_PROTOCOL_ERROR","云端转发请求无效")?;
                            ensure(chrono::DateTime::parse_from_rfc3339(&expires_at).is_ok_and(|value|value.timestamp()>chrono::Utc::now().timestamp()),"CLOUD_PROTOCOL_ERROR","云端转发请求已过期")?;
                            ensure(tunnels.len()<64,"RATE_LIMITED","电脑远程连接数已达上限")?;
                            let owner=core.clone();let session=core.cloud.access(core).await?;
                            tunnels.spawn(async move{let _=serve_tunnel(owner,session,tunnel_id,host_ticket,client_device_id).await;});
                        },
                    },
                    Some(Ok(Message::Ping(value)))=>{socket.send(Message::Pong(value)).await.map_err(|_|Error::new("CLOUD_UNAVAILABLE","云端连接中断"))?;},
                    Some(Ok(Message::Pong(_)))=>{},
                    _=>return Err(Error::new("CLOUD_UNAVAILABLE","云端连接中断，正在重连")),
                }
            },
            _=tunnels.join_next(),if !tunnels.is_empty()=>{},
            _=tick.tick()=>{
                ensure(received.elapsed()<Duration::from_secs(75),"CLOUD_UNAVAILABLE","云端心跳超时，正在重连")?;
                let current=core.cloud.access(core).await?;
                core.refresh_network().await?;
                register(core,&current,&host).await?;
                socket.send(Message::Ping(Vec::new().into())).await.map_err(|_|Error::new("CLOUD_UNAVAILABLE","云端连接中断"))?;
            }
        }
    }
    Ok(())
}
async fn register(core: &Core, saved: &Saved, host: &str) -> Result<()> {
    let endpoint = format!("https://{}:{}", core.address.read().unwrap(), core.port);
    let _:Value=reply(core.cloud.client.put(format!("{}/api/v1/hosts/self",saved.origin)).bearer_auth(&saved.tokens.access_token).json(&json!({"hostId":host,"displayName":std::env::var("COMPUTERNAME").unwrap_or_else(|_|"AgentDeck computer".into()),"fingerprint":core.tls.fingerprint,"endpoints":[endpoint]})).send().await.map_err(network_error)?).await?;
    Ok(())
}
struct AbortTask(JoinHandle<()>);
impl Drop for AbortTask {
    fn drop(&mut self) {
        self.0.abort();
    }
}
async fn serve_tunnel(
    core: Arc<Core>,
    saved: Saved,
    id: String,
    ticket: String,
    client_device: String,
) -> Result<()> {
    let mut request = format!(
        "{}/api/v1/relay/tunnels/{id}/host",
        saved.origin.replacen("https:", "wss:", 1)
    )
    .into_client_request()
    .map_err(|_| Error::new("CONFIG_ERROR", "云端转发地址无效"))?;
    request.headers_mut().insert(
        "Authorization",
        format!("Bearer {}", saved.tokens.access_token)
            .parse()
            .unwrap(),
    );
    request
        .headers_mut()
        .insert("X-Tunnel-Ticket", ticket.parse().unwrap());
    let mut socket = tokio::time::timeout(
        Duration::from_secs(10),
        core.cloud.websocket(request, MAX_RELAY_FRAME),
    )
    .await
    .map_err(|_| Error::new("CLOUD_UNAVAILABLE", "云端转发超时"))?
    .map_err(|_| Error::new("CLOUD_UNAVAILABLE", "云端转发连接失败"))?;
    let (stream, bridge) = tokio::io::duplex(128 * 1024);
    let _pump = AbortTask(tokio::spawn(async move {
        let (mut read, mut write) = tokio::io::split(bridge);
        let mut bytes = vec![0; 32 * 1024];
        loop {
            tokio::select! {
                result=read.read(&mut bytes)=>match result {Ok(0)|Err(_)=>break,Ok(count)=>if !matches!(tokio::time::timeout(Duration::from_secs(10),socket.send(Message::Binary(bytes[..count].to_vec().into()))).await,Ok(Ok(()))){break}},
                message=socket.next()=>match message {
                    Some(Ok(Message::Binary(value))) if value.len()<=MAX_RELAY_FRAME=>if !matches!(tokio::time::timeout(Duration::from_secs(10),write.write_all(&value)).await,Ok(Ok(()))){break},
                    Some(Ok(Message::Ping(value)))=>if socket.send(Message::Pong(value)).await.is_err(){break},
                    Some(Ok(Message::Pong(_)))=>{},_=>break,
                }
            }
        }
        let _ = tokio::time::timeout(Duration::from_secs(1), socket.close(None)).await;
    }));
    let certificates = rustls_pemfile::certs(&mut core.tls.cert.as_bytes())
        .collect::<std::io::Result<Vec<_>>>()?;
    let key = rustls_pemfile::private_key(&mut core.tls.key.as_bytes())?
        .ok_or_else(|| Error::new("TLS_ERROR", "无法加载电脑证书"))?;
    let tls = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certificates, key)
        .map_err(|_| Error::new("TLS_ERROR", "无法配置电脑证书"))?;
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(tls));
    let stream = tokio::time::timeout(Duration::from_secs(10), acceptor.accept(stream))
        .await
        .map_err(|_| Error::new("TLS_ERROR", "远程 TLS 握手超时"))??;
    let remote = RemoteIdentity {
        issuer: saved.origin,
        account_id: saved.tokens.account_id,
        device_id: client_device,
    };
    let finished = Arc::new(tokio::sync::Notify::new());
    let upgraded = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let router = crate::transport::remote_router(core, remote, finished.clone(), upgraded.clone());
    let service = hyper_util::service::TowerToHyperService::new(router);
    let _ = hyper::server::conn::http1::Builder::new()
        .timer(hyper_util::rt::TokioTimer::new())
        .header_read_timeout(Duration::from_secs(10))
        .serve_connection(hyper_util::rt::TokioIo::new(stream), service)
        .with_upgrades()
        .await;
    if upgraded.load(std::sync::atomic::Ordering::SeqCst) {
        finished.notified().await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cloud_origin_requires_https_without_path_or_embedded_credentials() {
        assert_eq!(
            validate_origin("https://connect.example.com/").unwrap(),
            "https://connect.example.com"
        );
        for origin in [
            "http://connect.example.com",
            "https://user:secret@connect.example.com",
            "https://connect.example.com/admin",
            "https://connect.example.com?token=secret",
            "https://connect.example.com#fragment",
        ] {
            assert!(validate_origin(origin).is_err());
        }
    }
}

#[cfg(test)]
#[path = "cloud_test.rs"]
mod integration_tests;
