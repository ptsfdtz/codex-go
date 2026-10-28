mod crypto;
mod network;
mod stream;
use crate::{accounts::Auth, api::browser_auth, Error, Result, State};
use axum::{
    extract::{Path, State as AppState},
    http::{HeaderMap, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{convert::Infallible, sync::Arc, time::Duration};
use uuid::Uuid;

pub struct Chat {
    keys: Option<crypto::Keys>,
    streams: Arc<tokio::sync::Semaphore>,
    jobs: Arc<tokio::sync::Semaphore>,
    #[cfg(test)]
    test_endpoint: Option<reqwest::Url>,
}
impl Chat {
    pub fn environment() -> Result<Self> {
        Ok(Self {
            keys: crypto::Keys::environment()?,
            streams: Arc::new(tokio::sync::Semaphore::new(128)),
            jobs: Arc::new(tokio::sync::Semaphore::new(32)),
            #[cfg(test)]
            test_endpoint: None,
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
        .route("/api/v1/chat/providers", get(providers))
        .route(
            "/api/v1/chat/providers/{id}",
            put(save_provider).delete(delete_provider),
        )
        .route(
            "/api/v1/chat/conversations",
            get(conversations).post(create_conversation),
        )
        .route(
            "/api/v1/chat/conversations/{id}",
            get(conversation).delete(delete_conversation),
        )
        .route("/api/v1/chat/conversations/{id}/messages", post(send))
        .route("/api/v1/chat/conversations/{id}/stop", post(stop))
        .route("/api/v1/chat/conversations/{id}/events", get(events))
}
fn conflict(message: &'static str) -> Error {
    Error::new(StatusCode::CONFLICT, "CHAT_CONFLICT", message)
}
fn validate_id(id: &str) -> Result<()> {
    Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| Error::invalid())
}
fn label(value: &str, max: usize) -> Result<()> {
    if value.trim().is_empty() || value.chars().count() > max || value.chars().any(char::is_control)
    {
        Err(Error::invalid())
    } else {
        Ok(())
    }
}
async fn providers(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    let auth = browser_auth(&state, &headers, false, true).await?;
    let rows=state.store.pool.get().await?.query("SELECT id,name,base_url,models,model_efforts FROM chat_providers WHERE account_id=$1 ORDER BY name,id",&[&auth.account_id]).await?;
    Ok(Json(
        json!({"enabled":state.chat.keys.is_some(),"data":rows.iter().map(|r|json!({"id":r.get::<_,String>("id"),"name":r.get::<_,String>("name"),"baseUrl":r.get::<_,String>("base_url"),"models":r.get::<_,Value>("models"),"hasKey":true,"modelEfforts":r.get::<_,Value>("model_efforts")})).collect::<Vec<_>>()}),
    ))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProviderInput {
    name: String,
    base_url: String,
    api_key: Option<String>,
    models: Vec<String>,
    model_efforts: Option<std::collections::HashMap<String, Vec<String>>>,
}
async fn save_provider(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<ProviderInput>,
) -> Result<Json<Value>> {
    let auth = browser_auth(&state, &headers, true, true).await?;
    validate_id(&id)?;
    label(&input.name, 80)?;
    let base = network::base_url(&input.base_url)?
        .to_string()
        .trim_end_matches('/')
        .to_owned();
    if input.models.is_empty() || input.models.len() > 32 {
        return Err(Error::invalid());
    }
    for model in &input.models {
        label(model, 160)?;
    }
    if let Some(efforts) = &input.model_efforts {
        if efforts.len() > input.models.len()
            || efforts.iter().any(|(model, values)| {
                !input.models.contains(model)
                    || values.len() > 8
                    || values.iter().any(|v| {
                        ![
                            "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
                        ]
                        .contains(&v.as_str())
                    })
            })
        {
            return Err(Error::invalid());
        }
    }
    let keys = state.chat.keys()?;
    let mut db = state.store.pool.get().await?;
    let tx = db.transaction().await?;
    tx.query_one(
        "SELECT id FROM accounts WHERE id=$1 FOR UPDATE",
        &[&auth.account_id],
    )
    .await?;
    let old = tx
        .query_opt(
            "SELECT base_url,api_key,model_efforts FROM chat_providers WHERE id=$1 AND account_id=$2 FOR UPDATE",
            &[&id, &auth.account_id],
        )
        .await?;
    let key = if let Some(key) = input.api_key.filter(|key| !key.is_empty()) {
        if key.len() > 4096 || key.chars().any(char::is_control) {
            return Err(Error::invalid());
        }
        keys.encrypt(&format!("{}:{id}", auth.account_id), &key)?
    } else {
        let old = old.as_ref().ok_or_else(Error::invalid)?;
        if old.get::<_, String>("base_url") != base {
            return Err(conflict("更换接口地址时请重新填写 API Key"));
        }
        old.get("api_key")
    };
    if old.is_none()
        && tx
            .query_one(
                "SELECT count(*) FROM chat_providers WHERE account_id=$1",
                &[&auth.account_id],
            )
            .await?
            .get::<_, i64>(0)
            >= 16
    {
        return Err(Error::limit());
    }
    let model_efforts = input
        .model_efforts
        .as_ref()
        .map(|values| json!(values))
        .unwrap_or_else(|| {
            old.as_ref()
                .map(|row| row.get::<_, Value>("model_efforts"))
                .unwrap_or(json!({}))
        });
    let changed = tx.execute("INSERT INTO chat_providers(id,account_id,name,base_url,api_key,models,model_efforts) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=$3,base_url=$4,api_key=$5,models=$6,model_efforts=$7,updated_at=now() WHERE chat_providers.account_id=$2",&[&id,&auth.account_id,&input.name.trim(),&base,&key,&json!(input.models),&model_efforts]).await?;
    if changed == 0 {
        return Err(Error::forbidden());
    }
    tx.commit().await?;
    Ok(Json(json!({"saved":true})))
}
async fn delete_provider(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    let auth = browser_auth(&state, &headers, true, true).await?;
    state
        .store
        .pool
        .get()
        .await?
        .execute(
            "DELETE FROM chat_providers WHERE account_id=$1 AND id=$2",
            &[&auth.account_id, &id],
        )
        .await?;
    Ok(Json(json!({"deleted":true})))
}
async fn conversations(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    let auth = browser_auth(&state, &headers, false, true).await?;
    let rows=state.store.pool.get().await?.query("SELECT id,title,provider_id,model,effort,updated_at::text FROM chat_conversations WHERE account_id=$1 ORDER BY updated_at DESC LIMIT 500",&[&auth.account_id]).await?;
    Ok(Json(
        json!({"data":rows.iter().map(|r|json!({"id":r.get::<_,String>("id"),"title":r.get::<_,String>("title"),"providerId":r.get::<_,String>("provider_id"),"model":r.get::<_,String>("model"),"effort":r.get::<_,String>("effort"),"updatedAt":r.get::<_,String>("updated_at")})).collect::<Vec<_>>()}),
    ))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateInput {
    id: String,
    provider_id: String,
    model: String,
}
async fn create_conversation(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Json(input): Json<CreateInput>,
) -> Result<Json<Value>> {
    let auth = browser_auth(&state, &headers, true, true).await?;
    validate_id(&input.id)?;
    label(&input.model, 160)?;
    state.chat.keys()?;
    let mut db = state.store.pool.get().await?;
    let tx = db.transaction().await?;
    tx.query_one(
        "SELECT id FROM accounts WHERE id=$1 FOR UPDATE",
        &[&auth.account_id],
    )
    .await?;
    if tx
        .query_one(
            "SELECT count(*) FROM chat_conversations WHERE account_id=$1",
            &[&auth.account_id],
        )
        .await?
        .get::<_, i64>(0)
        >= 500
    {
        return Err(Error::limit());
    }
    let provider = tx
        .query_opt(
            "SELECT models FROM chat_providers WHERE account_id=$1 AND id=$2",
            &[&auth.account_id, &input.provider_id],
        )
        .await?
        .ok_or_else(Error::forbidden)?;
    if !provider
        .get::<_, Value>(0)
        .as_array()
        .is_some_and(|models| models.contains(&json!(input.model)))
    {
        return Err(Error::invalid());
    }
    tx.execute("INSERT INTO chat_conversations(id,account_id,title,provider_id,model) VALUES($1,$2,'新对话',$3,$4) ON CONFLICT(id) DO NOTHING",&[&input.id,&auth.account_id,&input.provider_id,&input.model]).await?;
    if tx
        .query_opt(
            "SELECT id FROM chat_conversations WHERE id=$1 AND account_id=$2",
            &[&input.id, &auth.account_id],
        )
        .await?
        .is_none()
    {
        return Err(Error::forbidden());
    }
    tx.commit().await?;
    Ok(Json(json!({"id":input.id})))
}
async fn view(state: &State, account: &str, id: &str) -> Result<Value> {
    let db = state.store.pool.get().await?;
    let row=db.query_opt("SELECT id,title,provider_id,model,effort FROM chat_conversations WHERE account_id=$1 AND id=$2",&[&account,&id]).await?.ok_or_else(Error::forbidden)?;
    // A generation that stopped heartbeating must never be automatically replayed.
    db.execute("UPDATE chat_messages SET status='interrupted',error='生成连接已中断，已有内容已保留',updated_at=now() WHERE conversation_id=$1 AND status='running' AND updated_at<now()-interval '45 seconds'",&[&id]).await?;
    let messages=db.query("SELECT id,request_id,role,content,status,error,provider_id,model,effort FROM chat_messages WHERE conversation_id=$1 ORDER BY created_at,id",&[&id]).await?;
    Ok(
        json!({"id":row.get::<_,String>("id"),"title":row.get::<_,String>("title"),"providerId":row.get::<_,String>("provider_id"),"model":row.get::<_,String>("model"),"effort":row.get::<_,String>("effort"),"messages":messages.iter().map(|r|json!({"id":r.get::<_,String>("id"),"requestId":r.get::<_,String>("request_id"),"role":r.get::<_,String>("role"),"content":r.get::<_,String>("content"),"status":r.get::<_,String>("status"),"error":r.get::<_,Option<String>>("error"),"providerId":r.get::<_,String>("provider_id"),"model":r.get::<_,String>("model"),"effort":r.get::<_,String>("effort")})).collect::<Vec<_>>()}),
    )
}
async fn conversation(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    let auth = browser_auth(&state, &headers, false, true).await?;
    Ok(Json(view(&state, &auth.account_id, &id).await?))
}
async fn delete_conversation(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    let auth = browser_auth(&state, &headers, true, true).await?;
    let mut db = state.store.pool.get().await?;
    let tx = db.transaction().await?;
    tx.query_opt(
        "SELECT id FROM chat_conversations WHERE account_id=$1 AND id=$2 FOR UPDATE",
        &[&auth.account_id, &id],
    )
    .await?
    .ok_or_else(Error::forbidden)?;
    let n=tx.execute("DELETE FROM chat_conversations c WHERE account_id=$1 AND id=$2 AND NOT EXISTS(SELECT 1 FROM chat_messages WHERE conversation_id=c.id AND status='running')",&[&auth.account_id,&id]).await?;
    if n == 0 {
        return Err(conflict("请先停止生成，再删除对话"));
    }
    tx.commit().await?;
    Ok(Json(json!({"deleted":true})))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SendInput {
    #[serde(default)]
    effort: String,
    request_id: String,
    text: String,
    provider_id: String,
    model: String,
    expected_last_message_id: Option<String>,
}
async fn send(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<SendInput>,
) -> Result<Json<Value>> {
    let auth = browser_auth(&state, &headers, true, true).await?;
    validate_id(&input.request_id)?;
    if input.text.trim().is_empty() || input.text.len() > 12000 {
        return Err(Error::invalid());
    }
    label(&input.model, 160)?;
    state.chat.keys()?;
    if !state
        .limits
        .take(format!("chat.send:{}", auth.account_id), 20.0, 0.2, 1.0)
    {
        return Err(Error::limit());
    }
    let mut db = state.store.pool.get().await?;
    let tx = db.transaction().await?;
    tx.query_opt(
        "SELECT id FROM chat_conversations WHERE id=$1 AND account_id=$2 FOR UPDATE",
        &[&id, &auth.account_id],
    )
    .await?
    .ok_or_else(Error::forbidden)?;
    if let Some(row)=tx.query_opt("SELECT content,provider_id,model,effort FROM chat_messages WHERE conversation_id=$1 AND request_id=$2 AND role='user'",&[&id,&input.request_id]).await? {
        if row.get::<_,String>(0)!=input.text || row.get::<_,String>(1)!=input.provider_id || row.get::<_,String>(2)!=input.model || row.get::<_,String>(3)!=input.effort {return Err(conflict("请求内容已变化，请核对会话"));}
        return Ok(Json(json!({"accepted":true,"requestId":input.request_id})));
    }
    if tx
        .query_opt(
            "SELECT id FROM chat_messages WHERE conversation_id=$1 AND status='running'",
            &[&id],
        )
        .await?
        .is_some()
    {
        return Err(conflict("此对话正在生成回复"));
    }
    let last=tx.query_opt("SELECT id FROM chat_messages WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",&[&id]).await?.map(|r|r.get::<_,String>(0));
    if last != input.expected_last_message_id {
        return Err(conflict("对话已在其他页面更新，请刷新后发送"));
    }
    let provider = tx
        .query_opt(
            "SELECT base_url,api_key,models,model_efforts FROM chat_providers WHERE account_id=$1 AND id=$2",
            &[&auth.account_id, &input.provider_id],
        )
        .await?
        .ok_or_else(Error::forbidden)?;
    if !provider
        .get::<_, Value>("models")
        .as_array()
        .is_some_and(|models| models.contains(&json!(input.model)))
    {
        return Err(Error::invalid());
    }
    if !input.effort.is_empty()
        && !provider.get::<_, Value>("model_efforts")[&input.model]
            .as_array()
            .is_some_and(|values| values.contains(&json!(input.effort)))
    {
        return Err(Error::new(
            StatusCode::BAD_REQUEST,
            "UNSUPPORTED_EFFORT",
            "此模型未配置该思考强度，请在设置中核对接口支持范围",
        ));
    }
    let size = tx.query_one("SELECT count(*),coalesce(sum(octet_length(content)),0)::bigint FROM chat_messages WHERE conversation_id=$1", &[&id]).await?;
    if size.get::<_, i64>(0) >= 200 || size.get::<_, i64>(1) > 1024 * 1024 {
        return Err(conflict("此对话过长，请新建对话后继续"));
    }
    let history=tx.query("SELECT role,content FROM chat_messages WHERE conversation_id=$1 AND content<>'' AND status IN ('complete','stopped') ORDER BY created_at,id",&[&id]).await?;
    let mut messages = history
        .iter()
        .map(|r| json!({"role":r.get::<_,String>(0),"content":r.get::<_,String>(1)}))
        .collect::<Vec<_>>();
    messages.push(json!({"role":"user","content":input.text}));
    if messages.len() > 200 || json!(messages).to_string().len() > 256 * 1024 {
        return Err(conflict("此对话过长，请新建对话后继续"));
    }
    // Serialize account sends across server instances to bound model billing/concurrency.
    tx.query_one(
        "SELECT id FROM accounts WHERE id=$1 FOR UPDATE",
        &[&auth.account_id],
    )
    .await?;
    if tx.query_one("SELECT count(*) FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id WHERE c.account_id=$1 AND m.status='running'",&[&auth.account_id]).await?.get::<_,i64>(0)>=2 {return Err(Error::limit());}
    let permit = state
        .chat
        .jobs
        .clone()
        .try_acquire_owned()
        .map_err(|_| Error::limit())?;
    let message = Uuid::new_v4().to_string();
    tx.execute("INSERT INTO chat_messages(id,conversation_id,request_id,role,content,status,provider_id,model,effort) VALUES($1,$2,$3,'user',$4,'complete',$5,$6,$7)",&[&Uuid::new_v4().to_string(),&id,&input.request_id,&input.text,&input.provider_id,&input.model,&input.effort]).await?;
    // Distinct timestamps guarantee user-before-assistant ordering inside one transaction.
    tx.execute("INSERT INTO chat_messages(id,conversation_id,request_id,role,status,provider_id,model,effort,created_at) VALUES($1,$2,$3,'assistant','running',$4,$5,$6,now()+interval '1 microsecond')",&[&message,&id,&input.request_id,&input.provider_id,&input.model,&input.effort]).await?;
    tx.execute("UPDATE chat_conversations SET title=CASE WHEN title='新对话' THEN $3 ELSE title END,provider_id=$4,model=$5,effort=$6,updated_at=now() WHERE id=$1 AND account_id=$2",&[&id,&auth.account_id,&input.text.chars().take(40).collect::<String>(),&input.provider_id,&input.model,&input.effort]).await?;
    let base: String = provider.get("base_url");
    let encrypted: String = provider.get("api_key");
    tx.commit().await?;
    let request_id = input.request_id.clone();
    tokio::spawn(stream::generate(stream::Generation {
        state,
        auth,
        message,
        provider: input.provider_id,
        model: input.model,
        effort: input.effort,
        base,
        encrypted,
        messages,
        _permit: permit,
    }));
    Ok(Json(json!({"accepted":true,"requestId":request_id})))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StopInput {
    message_id: String,
}
async fn stop(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<StopInput>,
) -> Result<Json<Value>> {
    let auth = browser_auth(&state, &headers, true, true).await?;
    state.store.pool.get().await?.execute("UPDATE chat_messages m SET status='stopped',updated_at=now() FROM chat_conversations c WHERE m.conversation_id=c.id AND c.account_id=$1 AND c.id=$2 AND m.id=$3 AND m.status='running'",&[&auth.account_id,&id,&input.message_id]).await?;
    Ok(Json(json!({"stopped":true})))
}
async fn events(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response> {
    let auth = browser_auth(&state, &headers, false, true).await?;
    if !state
        .limits
        .take(format!("chat.events:{}", auth.account_id), 12.0, 0.1, 1.0)
    {
        return Err(Error::limit());
    }
    view(&state, &auth.account_id, &id).await?;
    let permit = state
        .chat
        .streams
        .clone()
        .try_acquire_owned()
        .map_err(|_| Error::limit())?;
    let stream = futures_util::stream::unfold(
        (
            state,
            auth,
            id,
            String::new(),
            tokio::time::Instant::now(),
            permit,
        ),
        |(state, auth, id, mut prior, start, permit)| async move {
            loop {
                if start.elapsed() > Duration::from_secs(310) {
                    return None;
                }
                let db = state.store.pool.get().await.ok()?;
                let valid=db.query_opt("SELECT s.id FROM sessions s JOIN devices d ON d.id=s.device_id JOIN accounts a ON a.id=d.account_id WHERE s.id=$1 AND s.revoked_at IS NULL AND s.access_expires_at>now() AND d.revoked_at IS NULL AND NOT a.disabled",&[&auth.session_id]).await.ok()?.is_some();
                drop(db);
                if !valid {
                    return None;
                }
                let value = match view(&state, &auth.account_id, &id).await {
                    Ok(v) => v,
                    Err(_) => return None,
                };
                let text = value.to_string();
                if text != prior {
                    prior = text.clone();
                    let event = Event::default().event("snapshot").data(text);
                    return Some((
                        Ok::<_, Infallible>(event),
                        (state, auth, id, prior, start, permit),
                    ));
                }
                tokio::time::sleep(Duration::from_millis(650)).await;
            }
        },
    );
    Ok((
        [("X-Accel-Buffering", "no")],
        Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(10))),
    )
        .into_response())
}

#[cfg(test)]
mod tests;
