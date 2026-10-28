mod crypto;
use crate::{api::browser_auth, Error, Result, State};
use axum::{
    extract::{Path, State as AppState},
    http::{header, HeaderMap, StatusCode},
    routing::{get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

// AgentChat is local-first. The cloud only stores encrypted API keys.
pub struct Chat {
    keys: Option<crypto::Keys>,
}
impl Chat {
    pub fn environment() -> Result<Self> {
        Ok(Self {
            keys: crypto::Keys::environment()?,
        })
    }
    fn keys(&self) -> Result<&crypto::Keys> {
        self.keys.as_ref().ok_or_else(|| {
            Error::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "CHAT_NOT_CONFIGURED",
                "AgentChat 尚未启用，请配置服务端加密密钥",
            )
        })
    }
}
pub fn router() -> Router<Arc<State>> {
    Router::new()
        .route("/api/v1/chat/keys", get(status))
        .route("/api/v1/chat/keys/{id}", put(save).delete(remove))
        .route("/api/v1/chat/keys/{id}/reveal", post(reveal))
}
fn validate_id(id: &str) -> Result<()> {
    Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| Error::invalid())
}
async fn status(AppState(state): AppState<Arc<State>>, headers: HeaderMap) -> Result<Json<Value>> {
    browser_auth(&state, &headers, false, true).await?;
    Ok(Json(json!({"enabled":state.chat.keys.is_some()})))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KeyInput {
    api_key: String,
}
async fn save(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<KeyInput>,
) -> Result<Json<Value>> {
    let auth = browser_auth(&state, &headers, true, true).await?;
    validate_id(&id)?;
    if input.api_key.trim().is_empty()
        || input.api_key.len() > 4096
        || input.api_key.chars().any(char::is_control)
    {
        return Err(Error::invalid());
    }
    if !state
        .limits
        .take(format!("chat.keys:{}", auth.account_id), 20.0, 0.2, 1.0)
    {
        return Err(Error::limit());
    }
    let encrypted = state
        .chat
        .keys()?
        .encrypt(&format!("{}:{id}", auth.account_id), &input.api_key)?;
    let mut db = state.store.pool.get().await?;
    let tx = db.transaction().await?;
    tx.query_one(
        "SELECT id FROM accounts WHERE id=$1 FOR UPDATE",
        &[&auth.account_id],
    )
    .await?;
    let count: i64 = tx
        .query_one(
            "SELECT count(*) FROM chat_keys WHERE account_id=$1 AND id<>$2",
            &[&auth.account_id, &id],
        )
        .await?
        .get(0);
    if count >= 64 {
        return Err(Error::limit());
    }
    let changed=tx.execute("INSERT INTO chat_keys(id,account_id,api_key) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET api_key=$3 WHERE chat_keys.account_id=$2",&[&id,&auth.account_id,&encrypted]).await?;
    if changed == 0 {
        return Err(Error::forbidden());
    }
    tx.commit().await?;
    Ok(Json(json!({"saved":true})))
}
async fn reveal(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<(HeaderMap, Json<Value>)> {
    let auth = browser_auth(&state, &headers, true, true).await?;
    validate_id(&id)?;
    if !state
        .limits
        .take(format!("chat.reveal:{}", auth.account_id), 60.0, 1.0, 1.0)
    {
        return Err(Error::limit());
    }
    let row = state
        .store
        .pool
        .get()
        .await?
        .query_opt(
            "SELECT api_key FROM chat_keys WHERE id=$1 AND account_id=$2",
            &[&id, &auth.account_id],
        )
        .await?
        .ok_or_else(Error::forbidden)?;
    let key = state.chat.keys()?.decrypt(
        &format!("{}:{id}", auth.account_id),
        &row.get::<_, String>(0),
    )?;
    let mut response = HeaderMap::new();
    response.insert(header::CACHE_CONTROL, "no-store, private".parse().unwrap());
    response.insert(header::PRAGMA, "no-cache".parse().unwrap());
    Ok((response, Json(json!({"apiKey":key}))))
}
async fn remove(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    let auth = browser_auth(&state, &headers, true, true).await?;
    validate_id(&id)?;
    state
        .store
        .pool
        .get()
        .await?
        .execute(
            "DELETE FROM chat_keys WHERE id=$1 AND account_id=$2",
            &[&id, &auth.account_id],
        )
        .await?;
    Ok(Json(json!({"deleted":true})))
}
#[cfg(test)]
mod tests;
