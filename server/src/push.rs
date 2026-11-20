//! Optional Web Push transport. Notification contents and routing hints never
//! enter the cloud database, audit log, or provider URLs.
use crate::{
    api::{browser_auth, native_auth},
    security, Error, Result, State,
};
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use axum::{
    extract::State as AppState,
    http::{HeaderMap, StatusCode, Uri},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use futures_util::{stream, StreamExt};
use jwt_compact::{alg::Es256, AlgorithmExt, Claims, Header};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use web_push_native::{
    p256::{ecdsa::SigningKey, elliptic_curve::sec1::ToEncodedPoint, PublicKey, SecretKey},
    WebPushBuilder,
};

const TTL: Duration = Duration::from_secs(300);
const MAX_SUBSCRIPTIONS: i64 = 32;

#[cfg(test)]
mod tests;

pub struct Push {
    signer: SigningKey,
    vault: Aes256Gcm,
    public: String,
    contact: String,
    client: reqwest::Client,
    delivered: Mutex<HashMap<String, Instant>>,
    retries: Arc<tokio::sync::Semaphore>,
    slots: tokio::sync::Semaphore,
}

impl Push {
    pub fn environment() -> Result<Option<Self>> {
        let Ok(encoded) = std::env::var("AGENTDECK_PUSH_VAPID_PRIVATE") else {
            return Ok(None);
        };
        if encoded.is_empty() {
            return Ok(None);
        }
        let contact = std::env::var("AGENTDECK_PUSH_CONTACT").map_err(|_| Error::invalid())?;
        Self::new(&encoded, contact).map(Some)
    }
    fn new(encoded: &str, contact: String) -> Result<Self> {
        let key = B64.decode(encoded).map_err(|_| Error::invalid())?;
        let secret = SecretKey::from_slice(&key).map_err(|_| Error::invalid())?;
        if key.len() != 32
            || contact.len() > 512
            || contact.chars().any(char::is_whitespace)
            || !reqwest::Url::parse(&contact)
                .is_ok_and(|u| matches!(u.scheme(), "mailto" | "https"))
        {
            return Err(Error::invalid());
        }
        let public = B64.encode(secret.public_key().to_encoded_point(false).as_bytes());
        let vault_key = Sha256::new()
            .chain_update(b"AgentDeck push subscription storage v1\0")
            .chain_update(&key)
            .finalize();
        Ok(Self {
            signer: SigningKey::from(secret),
            vault: Aes256Gcm::new(&vault_key),
            public,
            contact,
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(4))
                .build()
                .map_err(|_| Error::unavailable())?,
            delivered: Mutex::new(HashMap::new()),
            retries: Arc::new(tokio::sync::Semaphore::new(64)),
            slots: tokio::sync::Semaphore::new(8),
        })
    }
    fn authorization(&self, uri: &Uri) -> Result<String> {
        let audience = format!("https://{}", uri.authority().ok_or_else(Error::invalid)?);
        let mut claims = Claims::new(json!({"aud":audience,"sub":self.contact}));
        claims.expiration = Some(chrono::Utc::now() + chrono::Duration::minutes(10));
        let jwt = Es256
            .token(&Header::empty(), &claims, &self.signer)
            .map_err(|_| Error::unavailable())?;
        Ok(format!("vapid t={jwt}, k={}", self.public))
    }
    fn seal(&self, binding: &str, subscription: &Subscription) -> Result<Vec<u8>> {
        let mut nonce = [0u8; 12];
        rand::rng().fill_bytes(&mut nonce);
        let plain = serde_json::to_vec(subscription).map_err(|_| Error::invalid())?;
        let sealed = self
            .vault
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &plain,
                    aad: binding.as_bytes(),
                },
            )
            .map_err(|_| Error::unavailable())?;
        let mut out = nonce.to_vec();
        out.extend(sealed);
        Ok(out)
    }
    fn open(&self, binding: &str, sealed: &[u8]) -> Result<Subscription> {
        let (nonce, ciphertext) = sealed.split_at_checked(12).ok_or_else(Error::invalid)?;
        let plain = self
            .vault
            .decrypt(
                Nonce::from_slice(nonce),
                Payload {
                    msg: ciphertext,
                    aad: binding.as_bytes(),
                },
            )
            .map_err(|_| Error::invalid())?;
        serde_json::from_slice(&plain).map_err(|_| Error::invalid())
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Subscription {
    endpoint: String,
    p256dh: String,
    auth: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Registration {
    account_id: String,
    device_id: String,
    include_completion: bool,
    subscription: Subscription,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Owner {
    account_id: String,
    device_id: String,
}

impl Subscription {
    fn builder(&self) -> Result<WebPushBuilder> {
        let uri: Uri = self.endpoint.parse().map_err(|_| Error::invalid())?;
        let host = uri.host().unwrap_or("");
        let provider = matches!(
            host,
            "fcm.googleapis.com" | "updates.push.services.mozilla.com" | "web.push.apple.com"
        ) || host.ends_with(".push.apple.com")
            || host.ends_with(".notify.windows.com");
        if !provider
            || self.endpoint.len() > 2048
            || uri.scheme_str() != Some("https")
            || uri.authority().is_none_or(|a| a.as_str() != host)
            || uri.path().len() < 2
            || self.endpoint.contains(['#', '\\'])
        {
            return Err(Error::invalid());
        }
        let bytes = B64.decode(&self.p256dh).map_err(|_| Error::invalid())?;
        let public = PublicKey::from_sec1_bytes(&bytes).map_err(|_| Error::invalid())?;
        let auth: [u8; 16] = B64
            .decode(&self.auth)
            .ok()
            .and_then(|a| a.try_into().ok())
            .ok_or_else(Error::invalid)?;
        if bytes.len() != 65 {
            return Err(Error::invalid());
        }
        Ok(WebPushBuilder::new(uri, public, auth.into()).with_valid_duration(TTL))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Wake {
    session_id: String,
    event_key: String,
    kind: Kind,
    approval_id: Option<String>,
    occurred_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Kind {
    Approval,
    Question,
    Completed,
    Failed,
    Interrupted,
}
impl Kind {
    fn completion(&self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Interrupted)
    }
}

pub fn router() -> Router<Arc<State>> {
    Router::new()
        .route(
            "/api/v1/web/push",
            get(status).put(subscribe).delete(unsubscribe),
        )
        .route("/api/v1/hosts/self/push", post(wake))
}

pub(crate) async fn window(state: &State, account: &str) -> Result<Value> {
    let Some(push) = &state.push else {
        return Ok(Value::Null);
    };
    let row=state.store.pool.get().await?.query_one(
        "SELECT floor(extract(epoch FROM min(p.subscribed_at))*1000)::bigint,
                floor(extract(epoch FROM min(p.subscribed_at) FILTER (WHERE p.include_completion))*1000)::bigint
         FROM web_push_subscriptions p JOIN devices d ON d.id=p.device_id JOIN sessions s ON s.id=p.session_id
         WHERE d.account_id=$1 AND p.vapid_key=$2 AND d.revoked_at IS NULL
           AND s.revoked_at IS NULL AND s.refresh_expires_at>now()", &[&account,&push.public]).await?;
    let start: Option<i64> = row.get(0);
    Ok(start.map_or(
        Value::Null,
        |since| json!({"since":since,"completionSince":row.get::<_,Option<i64>>(1)}),
    ))
}

async fn status(AppState(state): AppState<Arc<State>>, headers: HeaderMap) -> Result<Json<Value>> {
    let auth = browser_auth(&state, &headers, false, true).await?;
    let Some(push) = &state.push else {
        return Ok(Json(json!({"available":false})));
    };
    let row = state
        .store
        .pool
        .get()
        .await?
        .query_opt(
            "SELECT endpoint_hash,include_completion FROM web_push_subscriptions
         WHERE session_id=$1 AND vapid_key=$2",
            &[&auth.session_id, &push.public],
        )
        .await?;
    Ok(Json(
        json!({"available":true,"publicKey":push.public,"endpointHash":row.as_ref().map(|r|r.get::<_,String>(0)),"includeCompletion":row.is_some_and(|r|r.get::<_,bool>(1))}),
    ))
}

async fn subscribe(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Json(input): Json<Registration>,
) -> Result<Json<Value>> {
    let auth = browser_auth(&state, &headers, true, true).await?;
    if auth.account_id != input.account_id || auth.device_id != input.device_id {
        return Err(Error::forbidden());
    }
    let sub = input.subscription;
    let push = state.push.as_ref().ok_or_else(Error::unavailable)?;
    sub.builder()?;
    let hash = security::digest(&sub.endpoint);
    let sealed = push.seal(&auth.session_id, &sub)?;
    let mut conn = state.store.pool.get().await?;
    let tx = conn.transaction().await?;
    tx.query_one(
        "SELECT id FROM accounts WHERE id=$1 FOR UPDATE",
        &[&auth.account_id],
    )
    .await?;
    tx.query_opt(
        "SELECT id FROM sessions WHERE id=$1 AND revoked_at IS NULL
                  AND refresh_expires_at>now() FOR UPDATE",
        &[&auth.session_id],
    )
    .await?
    .ok_or_else(Error::unauthorized)?;
    tx.execute(
        "DELETE FROM web_push_subscriptions p USING sessions s, devices d
                WHERE s.id=p.session_id AND d.id=s.device_id AND d.account_id=$1
                  AND (s.refresh_expires_at<=now() OR p.vapid_key<>$2)",
        &[&auth.account_id, &push.public],
    )
    .await?;
    let count: i64 = tx
        .query_one(
            "SELECT count(*) FROM web_push_subscriptions p JOIN devices d ON d.id=p.device_id
                                WHERE d.account_id=$1 AND d.id<>$2",
            &[&auth.account_id, &auth.device_id],
        )
        .await?
        .get(0);
    if count >= MAX_SUBSCRIPTIONS {
        return Err(Error::limit());
    }
    let save=tx.execute("INSERT INTO web_push_subscriptions(device_id,session_id,endpoint_hash,vapid_key,sealed,include_completion)
            VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(device_id) DO UPDATE
            SET session_id=excluded.session_id,endpoint_hash=excluded.endpoint_hash,vapid_key=excluded.vapid_key,
                sealed=excluded.sealed,include_completion=excluded.include_completion",
            &[&auth.device_id,&auth.session_id,&hash,&push.public,&sealed,&input.include_completion]).await;
    if save.as_ref().err().and_then(|e| e.code())
        == Some(&tokio_postgres::error::SqlState::UNIQUE_VIOLATION)
    {
        return Err(Error::new(
            StatusCode::CONFLICT,
            "PUSH_SUBSCRIPTION_CONFLICT",
            "请重新启用后台提醒",
        ));
    }
    save?;
    tx.commit().await?;
    Ok(Json(json!({"ok":true})))
}

async fn unsubscribe(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Json(owner): Json<Owner>,
) -> Result<Json<Value>> {
    let auth = browser_auth(&state, &headers, true, true).await?;
    if auth.account_id != owner.account_id || auth.device_id != owner.device_id {
        return Err(Error::forbidden());
    }
    state
        .store
        .pool
        .get()
        .await?
        .execute(
            "DELETE FROM web_push_subscriptions WHERE session_id=$1",
            &[&auth.session_id],
        )
        .await?;
    Ok(Json(json!({"ok":true})))
}

async fn wake(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Json(wake): Json<Wake>,
) -> Result<Json<Value>> {
    let auth = native_auth(&state, &headers).await?;
    auth.ready()?;
    if auth.kind != "desktop" {
        return Err(Error::forbidden());
    }
    if !routable_id(&wake.session_id, "session_")
        || wake
            .occurred_at
            .abs_diff(chrono::Utc::now().timestamp_millis())
            > 300_000
        || wake
            .approval_id
            .as_deref()
            .is_some_and(|id| !routable_id(id, "approval_") || wake.kind.completion())
        || wake.event_key.len() != 64
        || !wake.event_key.bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err(Error::invalid());
    }
    let host = state
        .store
        .host_for_device(&auth.device_id)
        .await?
        .ok_or_else(Error::forbidden)?;
    let push = state.push.as_ref().ok_or_else(Error::unavailable)?;
    if !state
        .limits
        .take(format!("push:{}", auth.device_id), 30., 1., 1.)
    {
        return Err(Error::limit());
    }
    let _slot = push.slots.try_acquire().map_err(|_| Error::limit())?;
    let completion = wake.kind.completion();
    let targets=state.store.pool.get().await?.query("SELECT p.session_id FROM web_push_subscriptions p JOIN devices d ON d.id=p.device_id WHERE d.account_id=$1 AND p.vapid_key=$2 AND (NOT $3 OR p.include_completion)", &[&auth.account_id,&push.public,&completion]).await?;
    let mut packet = json!({"accountId":auth.account_id,"hostId":host,"sessionId":wake.session_id,"eventKey":wake.event_key});
    if let Some(id) = wake.approval_id {
        packet["approvalId"] = json!(id);
    }
    let delivery = Arc::new(Delivery {
        auth,
        host,
        event: wake.event_key,
        packet: packet.to_string(),
        completion,
        occurred_at: wake.occurred_at,
    });
    stream::iter(targets)
        .for_each_concurrent(8, |row| {
            let delivery = delivery.clone();
            let state = state.clone();
            async move {
                let session: String = row.get(0);
                if deliver(&state, &delivery, &session).await.is_err() {
                    // Retry only this recipient. A broken device must not delay later
                    // approvals on the same Host or repeat successful deliveries.
                    if let Ok(slot) = push.retries.clone().try_acquire_owned() {
                        tokio::spawn(async move {
                            let _slot = slot;
                            for delay in [2, 8, 30] {
                                tokio::time::sleep(Duration::from_secs(delay)).await;
                                if deliver(&state, &delivery, &session).await.is_ok() {
                                    break;
                                }
                            }
                        });
                    }
                }
            }
        })
        .await;
    Ok(Json(json!({"ok":true})))
}

struct Delivery {
    auth: crate::accounts::Auth,
    host: String,
    event: String,
    packet: String,
    completion: bool,
    occurred_at: i64,
}
fn routable_id(value: &str, prefix: &str) -> bool {
    value
        .strip_prefix(prefix)
        .is_some_and(|s| uuid::Uuid::parse_str(s).is_ok_and(|id| id.to_string() == s))
}
struct Claim<'a> {
    push: &'a Push,
    marker: String,
    success: bool,
}
impl Drop for Claim<'_> {
    fn drop(&mut self) {
        if !self.success {
            self.push.delivered.lock().unwrap().remove(&self.marker);
        }
    }
}
async fn deliver(state: &State, delivery: &Delivery, session: &str) -> Result<()> {
    let push = state.push.as_ref().ok_or_else(Error::unavailable)?;
    let Delivery {
        auth,
        host,
        event,
        packet,
        completion,
        occurred_at,
    } = delivery;
    // Recheck both recipient and sender before each bounded outbound operation,
    // including queued fan-out after a logout, revocation, or unbind.
    let row=state.store.pool.get().await?.query_opt(
        "SELECT p.endpoint_hash,p.sealed FROM web_push_subscriptions p
         JOIN sessions s ON s.id=p.session_id JOIN devices d ON d.id=s.device_id
         JOIN accounts a ON a.id=d.account_id
         WHERE p.session_id=$1 AND p.vapid_key=$2 AND a.id=$3 AND NOT a.disabled AND NOT a.must_change_password
           AND s.revoked_at IS NULL AND s.refresh_expires_at>now() AND d.revoked_at IS NULL
           AND (NOT $6 OR p.include_completion) AND floor(extract(epoch FROM p.subscribed_at)*1000)::bigint<=$7
           AND EXISTS (SELECT 1 FROM hosts h JOIN devices hd ON h.device_id=hd.id
               JOIN sessions hs ON hs.device_id=hd.id WHERE h.host_id=$4 AND hd.account_id=a.id
               AND hd.revoked_at IS NULL AND hs.id=$5 AND hs.revoked_at IS NULL AND hs.access_expires_at>now())",
        &[&session,&push.public,&auth.account_id,&host,&auth.session_id,&completion,&occurred_at]).await?;
    let Some(row) = row else { return Ok(()) };
    let hash: String = row.get(0);
    let marker = security::digest(format!("{host}/{event}/{session}/{hash}"));
    let mut claim = {
        let mut seen = push.delivered.lock().unwrap();
        if seen
            .get(&marker)
            .is_some_and(|seen_at| seen_at.elapsed() < TTL)
        {
            return Ok(());
        }
        if seen.len() >= 16384 {
            seen.retain(|_, seen_at| seen_at.elapsed() < TTL);
        }
        if seen.len() >= 16384 {
            return Err(Error::limit());
        }
        seen.insert(marker.clone(), Instant::now());
        Claim {
            push,
            marker,
            success: false,
        }
    };
    let sub = push.open(session, row.get(1))?;
    let request = sub
        .builder()?
        .build(packet.as_bytes())
        .map_err(|_| Error::unavailable())?;
    let authorization = push.authorization(request.uri())?;
    let (parts, body) = request.into_parts();
    let result = push
        .client
        .post(sub.endpoint)
        .headers(parts.headers)
        .header("Authorization", authorization)
        .body(body)
        .send()
        .await
        .map_err(|_| Error::unavailable())?;
    if matches!(result.status(), StatusCode::NOT_FOUND | StatusCode::GONE) {
        state
            .store
            .pool
            .get()
            .await?
            .execute(
                "DELETE FROM web_push_subscriptions WHERE session_id=$1 AND endpoint_hash=$2",
                &[&session, &hash],
            )
            .await?;
    } else if result.status().is_server_error()
        || matches!(
            result.status(),
            StatusCode::REQUEST_TIMEOUT | StatusCode::TOO_MANY_REQUESTS
        )
    {
        return Err(Error::unavailable());
    }
    claim.success = true;
    Ok(())
}
