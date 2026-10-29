//! Private, authenticated loopback control for the headless host. Never routed
//! through the LAN listener or cloud relay; only fixed local actions are accepted.
use crate::{ensure, protocol, s, security, service::Core, Error, Result};
use axum::{
    extract::{DefaultBodyLimit, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use subtle::ConstantTimeEq;

pub const ENDPOINT_FILE: &str = "management.json";
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Endpoint {
    pub address: std::net::SocketAddrV4,
    pub token: String,
}
struct Control {
    core: Arc<Core>,
    endpoint: Endpoint,
    mutation: tokio::sync::Mutex<()>,
}
pub struct Management {
    path: PathBuf,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Management {
    fn drop(&mut self) {
        self.task.abort();
        let _ = std::fs::remove_file(&self.path);
    }
}
impl Management {
    pub async fn start(core: Arc<Core>, directory: &Path) -> Result<Self> {
        security::restrict_directory(directory)?;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let std::net::SocketAddr::V4(address) = listener.local_addr()? else {
            unreachable!()
        };
        let endpoint = Endpoint {
            address,
            token: security::token(),
        };
        let path = directory.join(ENDPOINT_FILE);
        // The caller holds the state-directory lock. Atomic replacement also
        // prevents a partially written endpoint during concurrent CLI startup.
        let mut temporary = tempfile::NamedTempFile::new_in(directory)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            temporary
                .as_file()
                .set_permissions(std::fs::Permissions::from_mode(0o600))?;
        }
        temporary.write_all(
            &serde_json::to_vec(&endpoint)
                .map_err(|_| Error::new("IO_ERROR", "Cannot encode control endpoint"))?,
        )?;
        // A crashed daemon may leave an old endpoint file. The state lock is
        // acquired before this function, so replacing it cannot race a live
        // owner.
        let _ = std::fs::remove_file(&path);
        temporary
            .persist(&path)
            .map_err(|_| Error::new("IO_ERROR", "Cannot save control endpoint"))?;
        let state = Arc::new(Control {
            core,
            endpoint,
            mutation: tokio::sync::Mutex::new(()),
        });
        let app = Router::new()
            .route("/control", post(control))
            .layer(DefaultBodyLimit::max(65536))
            .layer(middleware::from_fn_with_state(state.clone(), authorize))
            .with_state(state);
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Ok(Self { path, task })
    }
}
async fn authorize(State(state): State<Arc<Control>>, request: Request, next: Next) -> Response {
    let headers = request.headers();
    let expected = format!("Bearer {}", state.endpoint.token);
    let token = headers
        .get("authorization")
        .map(|v| v.as_bytes())
        .unwrap_or_default();
    if headers.contains_key("origin")
        || headers.get_all("authorization").iter().count() != 1
        || headers.get_all("host").iter().count() != 1
        || request.uri().query().is_some()
        || headers.get("host").and_then(|v| v.to_str().ok())
            != Some(state.endpoint.address.to_string().as_str())
        || !bool::from(token.ct_eq(expected.as_bytes()))
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    next.run(request).await
}
async fn control(State(state): State<Arc<Control>>, Json(request): Json<Value>) -> Response {
    let result = tokio::time::timeout(Duration::from_secs(90), async {
        let _guard = state.mutation.lock().await;
        match s(&request, "action") {
            "update.prepare" => {
                protocol::fields(&request, &["action", "jobId"], &[])?;
                let _barrier = state.core.update_gate.write().await;
                let job = crate::host::update_job::status()?;
                ensure(
                    job["job"]["id"] == request["jobId"] && job["job"]["phase"] == "waitingIdle",
                    "UPDATE_CHANGED",
                    "Update request changed",
                )?;
                if state.core.ready.load(std::sync::atomic::Ordering::SeqCst) {
                    tokio::time::timeout(Duration::from_secs(15), state.core.sync_thread_index())
                        .await
                        .map_err(|_| {
                            Error::new(
                                "UPDATE_NOT_IDLE",
                                "Cannot verify native task state yet; restart remains queued",
                            )
                        })??;
                }
                crate::host::update_job::ensure_idle(
                    &state.core.store,
                    !state.core.busy.lock().unwrap().is_empty(),
                )?;
                state
                    .core
                    .update_draining
                    .store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(json!({"prepared":true}))
            }
            "update.release" => {
                protocol::fields(&request, &["action", "jobId"], &[])?;
                let job = crate::host::update_job::status()?;
                ensure(
                    job["job"]["id"] == request["jobId"]
                        && ["failed", "installed", "complete"]
                            .iter()
                            .any(|phase| job["job"]["phase"] == *phase),
                    "UPDATE_CHANGED",
                    "Update is still switching or its identity changed",
                )?;
                state
                    .core
                    .update_draining
                    .store(false, std::sync::atomic::Ordering::SeqCst);
                Ok(json!({"released":true}))
            }
            "state" => {
                protocol::fields(&request, &["action"], &[])?;
                state.core.state()
            }
            "pair.invite" => {
                protocol::fields(&request, &["action", "address", "version"], &[])?;
                protocol::text(&request, "address", 1, 160)?;
                let version = request["version"]
                    .as_u64()
                    .filter(|v| (1..=3).contains(v))
                    .ok_or_else(|| Error::new("INVALID_REQUEST", "Invalid pairing version"))?;
                state
                    .core
                    .create_invitation(s(&request, "address"), version as u8)
                    .await
            }
            "pair.approve" => {
                protocol::fields(&request, &["action", "requestId", "code"], &[])?;
                protocol::text(&request, "requestId", 1, 160)?;
                let code = s(&request, "code");
                ensure(
                    code.len() == 6 && code.bytes().all(|b| b.is_ascii_digit()),
                    "INVALID_REQUEST",
                    "Six-digit code required",
                )?;
                state.core.pairing.confirm_with_code(
                    &state.core.store,
                    s(&request, "requestId"),
                    code,
                )?;
                state.core.publish();
                Ok(json!({"success":true}))
            }
            // Approval must use the code-checking action above. Desktop IPC is
            // kept compatible, but this endpoint cannot bypass that check.
            "pair.confirm" if request["approve"] != false => Err(Error::new(
                "INVALID_REQUEST",
                "Use pair.approve with the six-digit code",
            )),
            "pair.create" | "pair.createStable" | "pair.createRemote" => {
                Err(Error::new("INVALID_REQUEST", "Use pair.invite"))
            }
            _ => {
                state.core.local_action(request).await?;
                Ok(json!({"success":true}))
            }
        }
    })
    .await;
    match result {
        Ok(Ok(value)) => Json(json!({"ok":true,"result":value})).into_response(),
        Ok(Err(error)) => (StatusCode::BAD_REQUEST, Json(error.packet(None))).into_response(),
        Err(_) => (StatusCode::GATEWAY_TIMEOUT, Json(json!({"code":"UNKNOWN_OUTCOME","message":"Operation timed out; inspect state before retrying"}))).into_response(),
    }
}

/// CLI requests always read the endpoint written by the owning daemon. Never
/// follow redirects, use proxy environment variables, or accept remote addresses.
pub async fn call(
    directory: &Path,
    request: Value,
) -> std::result::Result<Value, Box<dyn std::error::Error>> {
    let bytes = std::fs::read(directory.join(ENDPOINT_FILE))?;
    if bytes.len() > 4096 {
        return Err("Invalid management endpoint".into());
    }
    let endpoint: Endpoint = serde_json::from_slice(&bytes)?;
    if *endpoint.address.ip() != std::net::Ipv4Addr::LOCALHOST
        || !security::valid_token(&endpoint.token)
    {
        return Err("Invalid management endpoint".into());
    }
    let response = reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(95)).build()?
        .post(format!("http://{}/control", endpoint.address)).bearer_auth(endpoint.token)
        .json(&request).send().await
        .map_err(|_| "Cannot reach the host; start agentdeck serve. If an operation was sent, inspect status before retrying.")?;
    let status = response.status();
    let value: Value = response.json().await?;
    if !status.is_success() || value["ok"] != true {
        return Err(format!("{}: {}", s(&value, "code"), s(&value, "message")).into());
    }
    Ok(value["result"].clone())
}
