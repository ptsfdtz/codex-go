use crate::{
    accounts::{AccountCreate, AccountUpdate, Auth, Login, PasswordChange, Refresh, SessionTokens},
    security,
    storage::{public_account, Refreshed},
    Error, Result, State,
};
use agentdeck_connection_protocol::DeviceKind;
use axum::{
    extract::{ConnectInfo, DefaultBodyLimit, Path, Request, State as AppState},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
};

pub fn router(state: Arc<State>) -> Router {
    Router::new()
        .route("/health/live", get(|| async { Json(json!({"ok":true})) }))
        .route("/health/ready", get(health))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/refresh", post(refresh))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/auth/password", post(password))
        .route("/api/v1/account", get(account))
        .route("/api/v1/devices", get(devices))
        .route("/api/v1/devices/{id}", delete(revoke_device))
        .route("/api/v1/hosts", get(hosts))
        .route("/api/v1/hosts/self", put(register_host))
        .route("/api/v1/hosts/{id}", delete(unbind_host))
        .route("/api/v1/relay/control", get(crate::relay::control))
        .route("/api/v1/relay/tunnels", post(crate::relay::offer))
        .route(
            "/api/v1/relay/tunnels/{id}/{side}",
            get(crate::relay::attach),
        )
        .route(
            "/api/v1/admin/session",
            post(admin_login).get(admin_session).delete(admin_logout),
        )
        .route("/api/v1/admin/refresh", post(admin_refresh))
        .route("/api/v1/admin/password", post(admin_password))
        .route(
            "/api/v1/admin/accounts",
            get(admin_accounts).post(admin_create),
        )
        .route("/api/v1/admin/accounts/{id}", put(admin_update))
        .route(
            "/api/v1/admin/accounts/{id}/reset-password",
            post(admin_reset),
        )
        .route("/api/v1/admin/devices", get(admin_devices))
        .route("/api/v1/admin/devices/{id}", delete(admin_revoke))
        .route("/api/v1/admin/status", get(admin_status))
        .route("/api/v1/admin/audit", get(admin_audit))
        .route(
            "/admin",
            get(|| async { Html(include_str!("../admin/index.html")) }),
        )
        .route(
            "/admin/",
            get(|| async { Html(include_str!("../admin/index.html")) }),
        )
        .route(
            "/admin/app.js",
            get(|| async {
                (
                    [(
                        header::CONTENT_TYPE,
                        "application/javascript; charset=utf-8",
                    )],
                    include_str!("../admin/app.js"),
                )
            }),
        )
        .route(
            "/admin/style.css",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
                    include_str!("../admin/style.css"),
                )
            }),
        )
        .fallback(|| async { Error::new(StatusCode::NOT_FOUND, "NOT_FOUND", "地址不存在") })
        .layer(DefaultBodyLimit::max(16 * 1024))
        .layer(middleware::from_fn(response_headers))
        .with_state(state)
}
async fn response_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        "X-Content-Type-Options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("Referrer-Policy", HeaderValue::from_static("no-referrer"));
    headers.insert("Content-Security-Policy",HeaderValue::from_static("default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"));
    response
}
fn no_origin(headers: &HeaderMap) -> Result<()> {
    if headers.contains_key(header::ORIGIN) {
        return Err(Error::forbidden());
    }
    Ok(())
}
fn origin(state: &State, headers: &HeaderMap) -> Result<()> {
    if headers.get(header::ORIGIN).and_then(|v| v.to_str().ok())
        != Some(state.config.public_origin.as_str())
    {
        return Err(Error::forbidden());
    }
    Ok(())
}
pub async fn native_auth(state: &State, headers: &HeaderMap) -> Result<Auth> {
    no_origin(headers)?;
    let access = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(Error::unauthorized)?;
    let auth = state.store.authenticate(access).await?;
    if auth.kind == "adminWeb" {
        return Err(Error::forbidden());
    }
    Ok(auth)
}
fn cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|value| value.trim().split_once('='))
        .find_map(|(key, value)| (key == name).then_some(value))
}
fn csrf_header(headers: &HeaderMap) -> Result<&str> {
    headers
        .get("x-csrf-token")
        .and_then(|v| v.to_str().ok())
        .filter(|v| security::valid_token(v))
        .ok_or_else(Error::forbidden)
}
async fn web_auth(state: &State, headers: &HeaderMap, write: bool, ready: bool) -> Result<Auth> {
    if write {
        origin(state, headers)?;
    }
    let auth = state
        .store
        .authenticate(cookie(headers, "__Host-agentdeck_access").ok_or_else(Error::unauthorized)?)
        .await?;
    auth.administrator()?;
    if auth.kind != "adminWeb" {
        return Err(Error::forbidden());
    }
    if write
        && !auth.csrf_hash.as_ref().is_some_and(|hash| {
            csrf_header(headers).is_ok_and(|token| security::equal(hash, &security::digest(token)))
        })
    {
        return Err(Error::forbidden());
    }
    if ready {
        auth.ready()?
    }
    Ok(auth)
}
fn login_limit(state: &State, headers: &HeaderMap, peer: SocketAddr, username: &str) -> Result<()> {
    let source = if state.config.proxy_token.as_ref().is_some_and(|expected| {
        headers
            .get("x-agentdeck-proxy-token")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|value| security::equal(expected, value))
    }) {
        headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<IpAddr>().ok())
            .unwrap_or(peer.ip())
    } else {
        peer.ip()
    };
    if !state
        .limits
        .take(format!("login-ip:{source}"), 30., 0.5, 1.)
        || !state
            .limits
            .take(format!("login-name:{username}"), 8., 0.1, 1.)
    {
        return Err(Error::limit());
    }
    Ok(())
}
async fn perform_login(
    state: &State,
    headers: &HeaderMap,
    peer: SocketAddr,
    input: Login,
    admin: bool,
) -> Result<SessionTokens> {
    let username = security::username(&input.username)?;
    security::label(&input.device_name)?;
    if !security::valid_token(&input.installation_id) {
        return Err(Error::invalid());
    }
    login_limit(state, headers, peer, &username)?;
    let account = state.store.find_login(&username).await?;
    let valid = state
        .passwords
        .verify(
            &input.password,
            account.as_ref().map(|a| a.password_hash.as_str()),
        )
        .await?;
    let account = account
        .filter(|a| valid && !a.disabled)
        .ok_or_else(Error::unauthorized)?;
    let kind = match input.kind {
        DeviceKind::Desktop => "desktop",
        DeviceKind::Mobile => "mobile",
        DeviceKind::AdminWeb => "adminWeb",
    };
    if admin && (account.role != "admin" || kind != "adminWeb") || !admin && kind == "adminWeb" {
        return Err(Error::forbidden());
    }
    let (tokens, old) = state
        .store
        .login(
            &account,
            &input.installation_id,
            kind,
            input.device_name.trim(),
        )
        .await?;
    for session in old {
        state.hub.disconnect_session(&session)
    }
    Ok(tokens)
}
async fn health(AppState(state): AppState<Arc<State>>) -> Result<Json<Value>> {
    state.store.healthy().await?;
    Ok(Json(json!({"ok":true})))
}
async fn login(
    AppState(state): AppState<Arc<State>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(input): Json<Login>,
) -> Result<Json<SessionTokens>> {
    no_origin(&headers)?;
    Ok(Json(
        perform_login(&state, &headers, peer, input, false).await?,
    ))
}
async fn refresh(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Json(input): Json<Refresh>,
) -> Result<Json<SessionTokens>> {
    no_origin(&headers)?;
    match state
        .store
        .refresh(&input.refresh_token, None, false)
        .await?
    {
        Refreshed::Issued(tokens) => Ok(Json(tokens)),
        Refreshed::Reused(session) => {
            state.hub.disconnect_session(&session);
            Err(Error::unauthorized())
        }
    }
}
async fn logout(AppState(state): AppState<Arc<State>>, headers: HeaderMap) -> Result<Json<Value>> {
    let auth = native_auth(&state, &headers).await?;
    state.store.logout(&auth).await?;
    state.hub.disconnect_session(&auth.session_id);
    Ok(Json(json!({"ok":true})))
}
async fn change_password(state: &State, auth: &Auth, input: PasswordChange) -> Result<Json<Value>> {
    if !state
        .limits
        .take(format!("password:{}", auth.account_id), 5., 0.1, 1.)
    {
        return Err(Error::limit());
    }
    let old = state.store.password_hash(&auth.account_id).await?;
    if !state
        .passwords
        .verify(&input.old_password, Some(&old))
        .await?
    {
        return Err(Error::unauthorized());
    }
    let hash = state.passwords.hash(&input.new_password).await?;
    state
        .store
        .change_password(&auth.account_id, &auth.account_id, Some(&old), &hash, false)
        .await?;
    state.hub.disconnect_account(&auth.account_id);
    Ok(Json(json!({"ok":true,"loginRequired":true})))
}
async fn password(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Json(input): Json<PasswordChange>,
) -> Result<Json<Value>> {
    let auth = native_auth(&state, &headers).await?;
    change_password(&state, &auth, input).await
}
async fn account(AppState(state): AppState<Arc<State>>, headers: HeaderMap) -> Result<Json<Value>> {
    Ok(Json(public_account(&native_auth(&state, &headers).await?)))
}
async fn devices(AppState(state): AppState<Arc<State>>, headers: HeaderMap) -> Result<Json<Value>> {
    let auth = native_auth(&state, &headers).await?;
    auth.ready()?;
    Ok(Json(
        json!({"devices":state.store.devices(Some(&auth.account_id)).await?}),
    ))
}
async fn revoke_device(
    AppState(state): AppState<Arc<State>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    let auth = native_auth(&state, &headers).await?;
    auth.ready()?;
    state
        .store
        .revoke_device(&auth.account_id, Some(&auth.account_id), &id)
        .await?;
    state.hub.disconnect_device(&id);
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HostRegistration {
    host_id: String,
    display_name: String,
}
async fn register_host(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Json(input): Json<HostRegistration>,
) -> Result<Json<Value>> {
    let auth = native_auth(&state, &headers).await?;
    auth.ready()?;
    security::label(&input.display_name)?;
    if input.host_id.is_empty()
        || input.host_id.len() > 160
        || !input
            .host_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err(Error::invalid());
    }
    state
        .store
        .register_host(&auth, &input.host_id, input.display_name.trim())
        .await?;
    Ok(Json(json!({"hostId":input.host_id})))
}
async fn hosts(AppState(state): AppState<Arc<State>>, headers: HeaderMap) -> Result<Json<Value>> {
    let auth = native_auth(&state, &headers).await?;
    auth.ready()?;
    let mut hosts = state.store.hosts(&auth.account_id).await?;
    for host in &mut hosts {
        host["online"] = json!(state
            .hub
            .online(host["hostId"].as_str().unwrap_or_default()));
    }
    Ok(Json(json!({"hosts":hosts})))
}
async fn unbind_host(
    AppState(state): AppState<Arc<State>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    let auth = native_auth(&state, &headers).await?;
    auth.ready()?;
    let device = state.store.unbind_host(&auth, &id).await?;
    state.hub.disconnect_device(&device);
    Ok(Json(json!({"ok":true})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WebLogin {
    username: String,
    password: String,
}
fn token_cookies(tokens: &SessionTokens) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    for (name, value, age, http_only) in [
        (
            "__Host-agentdeck_access",
            tokens.access_token.as_str(),
            600,
            true,
        ),
        (
            "__Host-agentdeck_refresh",
            tokens.refresh_token.as_str(),
            2592000,
            true,
        ),
        (
            "__Host-agentdeck_csrf",
            tokens
                .csrf_token
                .as_deref()
                .ok_or_else(Error::unavailable)?,
            2592000,
            false,
        ),
    ] {
        headers.append(
            header::SET_COOKIE,
            HeaderValue::from_str(&format!(
                "{name}={value}; Path=/; Secure; SameSite=Strict; Max-Age={age}{}",
                if http_only { "; HttpOnly" } else { "" }
            ))
            .map_err(|_| Error::unavailable())?,
        );
    }
    Ok(headers)
}
fn clear_cookies() -> HeaderMap {
    let mut headers = HeaderMap::new();
    for name in [
        "__Host-agentdeck_access",
        "__Host-agentdeck_refresh",
        "__Host-agentdeck_csrf",
    ] {
        headers.append(
            header::SET_COOKIE,
            HeaderValue::from_str(&format!(
                "{name}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0"
            ))
            .unwrap(),
        );
    }
    headers
}
async fn admin_login(
    AppState(state): AppState<Arc<State>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(input): Json<WebLogin>,
) -> Result<Response> {
    origin(&state, &headers)?;
    let installation = cookie(&headers, "__Host-agentdeck_installation")
        .filter(|v| security::valid_token(v))
        .map(str::to_owned)
        .unwrap_or_else(security::token);
    let tokens = perform_login(
        &state,
        &headers,
        peer,
        Login {
            username: input.username,
            password: input.password,
            installation_id: installation.clone(),
            device_name: "管理浏览器".into(),
            kind: DeviceKind::AdminWeb,
        },
        true,
    )
    .await?;
    let mut cookies = token_cookies(&tokens)?;
    cookies.append(header::SET_COOKIE,HeaderValue::from_str(&format!("__Host-agentdeck_installation={installation}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=31536000")).unwrap());
    Ok((
        cookies,
        Json(json!({"mustChangePassword":tokens.must_change_password})),
    )
        .into_response())
}
async fn admin_refresh(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
) -> Result<Response> {
    origin(&state, &headers)?;
    let csrf = csrf_header(&headers)?;
    let raw = cookie(&headers, "__Host-agentdeck_refresh").ok_or_else(Error::unauthorized)?;
    match state.store.refresh(raw, Some(csrf), true).await? {
        Refreshed::Issued(tokens) => {
            Ok((token_cookies(&tokens)?, Json(json!({"ok":true}))).into_response())
        }
        Refreshed::Reused(session) => {
            state.hub.disconnect_session(&session);
            Err(Error::unauthorized())
        }
    }
}
async fn admin_session(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    let auth = web_auth(&state, &headers, false, false).await?;
    Ok(Json(public_account(&auth)))
}
async fn admin_logout(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
) -> Result<Response> {
    let auth = web_auth(&state, &headers, true, false).await?;
    state.store.logout(&auth).await?;
    state.hub.disconnect_session(&auth.session_id);
    Ok((clear_cookies(), Json(json!({"ok":true}))).into_response())
}
async fn admin_password(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Json(input): Json<PasswordChange>,
) -> Result<Response> {
    let auth = web_auth(&state, &headers, true, false).await?;
    let result = change_password(&state, &auth, input).await?;
    Ok((clear_cookies(), result).into_response())
}
async fn admin_accounts(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    web_auth(&state, &headers, false, true).await?;
    Ok(Json(json!({"accounts":state.store.accounts().await?})))
}
async fn admin_create(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
    Json(input): Json<AccountCreate>,
) -> Result<Json<Value>> {
    let auth = web_auth(&state, &headers, true, true).await?;
    let username = security::username(&input.username)?;
    let temporary = security::token();
    let hash = state.passwords.hash(&temporary).await?;
    let id = state
        .store
        .create_account(Some(&auth.account_id), &username, &hash, "user")
        .await?;
    Ok(Json(
        json!({"accountId":id,"username":username,"temporaryPassword":temporary}),
    ))
}
async fn admin_update(
    AppState(state): AppState<Arc<State>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<AccountUpdate>,
) -> Result<Json<Value>> {
    let auth = web_auth(&state, &headers, true, true).await?;
    input.validate()?;
    state
        .store
        .update_account(&auth.account_id, &id, &input)
        .await?;
    state.hub.disconnect_account(&id);
    Ok(Json(json!({"ok":true})))
}
async fn admin_reset(
    AppState(state): AppState<Arc<State>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    let auth = web_auth(&state, &headers, true, true).await?;
    let temporary = security::token();
    let hash = state.passwords.hash(&temporary).await?;
    state
        .store
        .change_password(&auth.account_id, &id, None, &hash, true)
        .await?;
    state.hub.disconnect_account(&id);
    Ok(Json(json!({"temporaryPassword":temporary})))
}
async fn admin_devices(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    web_auth(&state, &headers, false, true).await?;
    Ok(Json(json!({"devices":state.store.devices(None).await?})))
}
async fn admin_revoke(
    AppState(state): AppState<Arc<State>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    let auth = web_auth(&state, &headers, true, true).await?;
    state
        .store
        .revoke_device(&auth.account_id, None, &id)
        .await?;
    state.hub.disconnect_device(&id);
    Ok(Json(json!({"ok":true})))
}
async fn admin_status(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    web_auth(&state, &headers, false, true).await?;
    state.store.healthy().await?;
    Ok(Json(
        json!({"database":"ok","connections":state.hub.stats()}),
    ))
}
async fn admin_audit(
    AppState(state): AppState<Arc<State>>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    web_auth(&state, &headers, false, true).await?;
    Ok(Json(json!({"entries":state.store.audit().await?})))
}
