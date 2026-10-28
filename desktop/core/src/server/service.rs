use crate::{
    codex, ensure, now,
    pairing::Pairing,
    paths, protocol,
    rpc::Rpc,
    s,
    security::{self, Certificate},
    store::Store,
    Error, Result,
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, RwLock,
    },
    time::Duration,
};
use tokio::sync::{mpsc, Notify, Semaphore};
pub struct Core {
    pub(crate) lan_gateway: Mutex<Option<(std::net::SocketAddr, tokio::task::JoinHandle<()>)>>,
    pub cloud: crate::cloud::Cloud,
    pub(crate) discovery: Mutex<Option<crate::server::discovery::Advertisement>>,
    pub store: Arc<Store>,
    pub pairing: Pairing,
    pub tls: Certificate,
    pub rpc: RwLock<Option<Arc<Rpc>>>,
    pub ready: AtomicBool,
    pub runtime_error: RwLock<Option<Value>>,
    pub attached_runtime: AtomicBool,
    runtime_protocol: RwLock<crate::rpc::ProtocolVersion>,
    runtime_version: RwLock<Option<String>>,
    pub verified: AtomicBool,
    pub loaded: Mutex<HashSet<String>>,
    pub(crate) observed: Mutex<HashMap<String, String>>,
    pub(crate) observation_lock: tokio::sync::Mutex<()>,
    pub busy: Mutex<HashSet<String>>,
    pub(crate) thread_sync: tokio::sync::Mutex<()>,
    pub(crate) thread_index_changed: Notify,
    pub(crate) thread_index_pending: Mutex<HashMap<String, String>>,
    pub task_limit: Semaphore,
    pub connected: Mutex<HashMap<String, usize>>,
    pub authorization_changed: Notify,
    pub address: RwLock<String>,
    pub port: u16,
    pub stop: Notify,
    pub stopping: AtomicBool,
    pub(crate) update_gate: tokio::sync::RwLock<()>,
    pub(crate) update_draining: AtomicBool,
    pub local: mpsc::Sender<Value>,
    pub network: tokio::sync::Mutex<
        Option<(
            axum_server::Handle<std::net::SocketAddr>,
            tokio::task::JoinHandle<()>,
        )>,
    >,
    pub rpc_slots: Arc<Semaphore>,
    pub ws_slots: Arc<Semaphore>,
    pub device_slots: Mutex<HashMap<String, Arc<Semaphore>>>,
    pub rates: Mutex<crate::transport::Buckets>,
    pub(crate) project_views: Mutex<Vec<crate::native_project_views::ProjectView>>,
    pub(crate) project_view_build: tokio::sync::Mutex<()>,
    pub git_hashes: tokio::sync::Mutex<HashMap<String, String>>,
}
impl Core {
    pub fn new(
        store: Arc<Store>,
        tls: Certificate,
        address: String,
        port: u16,
        local: mpsc::Sender<Value>,
    ) -> Arc<Self> {
        Arc::new(Self {
            lan_gateway: Mutex::new(None),
            cloud: crate::cloud::Cloud::default(),
            discovery: Mutex::new(None),
            store,
            pairing: Pairing::default(),
            tls,
            rpc: RwLock::new(None),
            ready: AtomicBool::new(false),
            runtime_error: RwLock::new(None),
            attached_runtime: AtomicBool::new(false),
            runtime_protocol: RwLock::new(crate::rpc::ProtocolVersion::Managed),
            runtime_version: RwLock::new(None),
            verified: AtomicBool::new(false),
            loaded: Mutex::new(HashSet::new()),
            observed: Mutex::new(HashMap::new()),
            observation_lock: tokio::sync::Mutex::new(()),
            busy: Mutex::new(HashSet::new()),
            thread_sync: tokio::sync::Mutex::new(()),
            thread_index_changed: Notify::new(),
            thread_index_pending: Mutex::new(HashMap::new()),
            task_limit: Semaphore::new(2),
            connected: Mutex::new(HashMap::new()),
            authorization_changed: Notify::new(),
            address: RwLock::new(address),
            port,
            stop: Notify::new(),
            stopping: AtomicBool::new(false),
            update_gate: tokio::sync::RwLock::new(()),
            update_draining: AtomicBool::new(false),
            local,
            network: tokio::sync::Mutex::new(None),
            rpc_slots: Arc::new(Semaphore::new(32)),
            ws_slots: Arc::new(Semaphore::new(64)),
            device_slots: Mutex::new(HashMap::new()),
            rates: Mutex::new(crate::transport::Buckets::default()),
            project_views: Mutex::new(Vec::new()),
            project_view_build: tokio::sync::Mutex::new(()),
            git_hashes: tokio::sync::Mutex::new(HashMap::new()),
        })
    }
    pub fn emit(&self, kind: &str, payload: Value) {
        if self
            .local
            .try_send(json!({"type":kind,"payload":payload}))
            .is_err()
        {
            self.request_stop();
        }
    }
    pub fn request_stop(&self) {
        if let Some((_, task)) = self.lan_gateway.lock().unwrap().take() {
            task.abort();
        }
        self.stopping.store(true, Ordering::SeqCst);
        self.stop.notify_one();
    }
    pub fn endpoint(&self) -> String {
        format!("https://{}:{}", self.address.read().unwrap(), self.port)
    }
    pub fn snapshot(&self) -> Result<Value> {
        let mut snapshot = self.store.snapshot(self.ready.load(Ordering::SeqCst))?;
        snapshot["host"]["codexVersion"] = json!(self
            .runtime_version
            .read()
            .unwrap()
            .as_deref()
            .unwrap_or(""));
        Ok(snapshot)
    }
    pub fn state(&self) -> Result<Value> {
        let mut devices = self.store.query(
            "SELECT deviceId,displayName,createdAt FROM devices WHERE revokedAt IS NULL",
            [],
        )?;
        let connected = self.connected.lock().unwrap();
        for d in &mut devices {
            d["connected"] = json!(connected.contains_key(s(d, "deviceId")));
        }
        drop(connected);
        let sessions = self.store.sessions(None)?;
        let mut approvals = self.store.approvals(None)?;
        for a in &mut approvals {
            a["sessionTitle"] = sessions
                .iter()
                .find(|v| v["sessionId"] == a["sessionId"])
                .map(|v| v["title"].clone())
                .unwrap_or(Value::Null);
        }
        let mut state = json!({"codexReady":self.ready.load(Ordering::SeqCst),"sandboxVerified":self.verified.load(Ordering::SeqCst),"endpoint":self.endpoint(),"listenAddress":*self.address.read().unwrap(),"lastWorkspaceSync":self.store.meta("lastWorkspaceSync")?.unwrap_or_default(),"projects":self.store.visible_projects()?,"devices":devices,"approvals":approvals,"pairings":self.pairing.pending_all(),"addresses":std::iter::once("127.0.0.1".to_string()).chain(security::addresses()).collect::<Vec<_>>() });
        state["cloud"] = json!(self.cloud.status());
        state["runtimeError"] = json!(*self.runtime_error.read().unwrap());
        state["hostId"] = json!(self.store.meta("hostId")?);
        state["activeTurns"] = json!(self.store.turns(None)?.len());
        state["servicePid"] = json!(std::process::id());
        state["runningVersion"] = json!(std::env::current_exe()
            .ok()
            .and_then(|p| std::fs::read_to_string(p.parent()?.join("release.txt")).ok())
            .map(|v| v.trim().to_owned()));
        state["codexVersion"] = json!(self
            .runtime_version
            .read()
            .unwrap()
            .as_deref()
            .unwrap_or(""));
        Ok(state)
    }
    pub fn publish(&self) {
        match self.state() {
            Ok(v) => self.emit("state", v),
            Err(e) => self.emit("error", json!({"message":e.to_string()})),
        }
    }
    pub async fn create_pair(self: &Arc<Self>, address: &str) -> Result<()> {
        self.create_pair_versioned(address, 1).await
    }
    pub async fn create_pair_versioned(self: &Arc<Self>, address: &str, version: u8) -> Result<()> {
        let mut qr = self.create_invitation(address, version).await?;
        let code = qrcode::QrCode::new(qr.to_string().as_bytes())
            .map_err(|_| Error::new("PAIRING_ERROR", "Cannot render QR"))?;
        let image = code
            .render::<image::Luma<u8>>()
            .min_dimensions(512, 512)
            .build();
        let mut png = std::io::Cursor::new(vec![]);
        image::DynamicImage::ImageLuma8(image)
            .write_to(&mut png, image::ImageFormat::Png)
            .map_err(|_| Error::new("PAIRING_ERROR", "Cannot encode QR"))?;
        use base64::Engine;
        qr["image"] = json!(base64::engine::general_purpose::STANDARD.encode(png.into_inner()));
        self.emit("pair.qr", qr);
        Ok(())
    }
    /// Return the same invitation as the desktop QR without logging its secret.
    pub async fn create_invitation(self: &Arc<Self>, address: &str, version: u8) -> Result<Value> {
        ensure(
            matches!(version, 1..=3),
            "INVALID_REQUEST",
            "Unsupported pairing version",
        )?;
        ensure(
            address == "127.0.0.1" || security::addresses().contains(&address.to_owned()),
            "CONFIG_ERROR",
            "Choose a private address assigned to this PC",
        )?;
        ensure(
            self.tls
                .supports(if version >= 2 { "127.0.0.1" } else { address }),
            "CERTIFICATE_ADDRESS_MISMATCH",
            "Address changed; renew certificate locally and pair again",
        )?;
        self.listen(address).await?;
        if address != "127.0.0.1" {
            self.store.set_meta("lanEnabled", "true")?;
        }
        self.store.set_meta("listenAddress", address)?;
        let qr = if version == 3 {
            let (issuer, account) = self.cloud.pairing_account()?;
            self.pairing.create_remote(
                &self.store,
                &self.endpoint(),
                &self.tls.fingerprint,
                &issuer,
                &account,
            )?
        } else {
            self.pairing.create_versioned(
                &self.store,
                &self.endpoint(),
                &self.tls.fingerprint,
                version,
            )?
        };
        Ok(qr)
    }
    pub async fn local_action(self: &Arc<Self>, v: Value) -> Result<bool> {
        let _update_guard = self.update_gate.read().await;
        let action = s(&v, "action");
        ensure(
            action == "stop" || !self.update_draining.load(Ordering::SeqCst),
            "UPDATE_RESTARTING",
            "Host is switching versions; reconnect before changing state",
        )?;
        let allowed: &[&str] = match action {
            "workspaces.sync" | "stop" => &[],
            "project.add" => &["path"],
            "project.remove" => &["projectId"],
            "pair.create" | "pair.createStable" | "pair.createRemote" => &["address"],
            "cloud.login" => &["origin", "username", "password"],
            "cloud.password" => &["oldPassword", "newPassword"],
            "cloud.logout" => &["unbind"],
            "pair.confirm" => &["requestId", "approve"],
            "device.revoke" => &["deviceId"],
            "approval.decide" => &["sessionId", "turnId", "approvalId", "decision"],
            _ => return Err(Error::new("INVALID_REQUEST", "Unsupported local action")),
        };
        let mut required = vec!["action"];
        required.extend_from_slice(allowed);
        protocol::fields(&v, &required, &["localRequestId"])?;
        if v.get("localRequestId").is_some() {
            protocol::text(&v, "localRequestId", 1, 100)?;
        }
        for k in allowed {
            if !matches!(*k, "approve" | "unbind") {
                protocol::text(
                    &v,
                    k,
                    1,
                    match *k {
                        "path" => 32768,
                        "password" | "oldPassword" | "newPassword" => 1024,
                        "origin" => 2048,
                        _ => 160,
                    },
                )?;
            }
        }
        match action {
            "cloud.login" => {
                self.cloud_login(s(&v, "origin"), s(&v, "username"), s(&v, "password"))
                    .await?
            }
            "cloud.password" => {
                self.cloud_password(s(&v, "oldPassword"), s(&v, "newPassword"))
                    .await?
            }
            "cloud.logout" => {
                ensure(
                    v["unbind"].is_boolean(),
                    "INVALID_REQUEST",
                    "Boolean unbind required",
                )?;
                self.cloud_logout(v["unbind"] == true).await?;
            }
            "workspaces.sync" => {
                let result = self.sync_workspaces().await?;
                self.emit("workspaces.synced", result);
            }
            "project.add" => {
                paths::add_local(&self.store, Path::new(s(&v, "path")))?;
                self.thread_index_changed.notify_one();
            }
            "project.remove" => paths::remove_local(&self.store, s(&v, "projectId"))?,
            "pair.create" => self.create_pair(s(&v, "address")).await?,
            "pair.createStable" => self.create_pair_versioned(s(&v, "address"), 2).await?,
            "pair.createRemote" => self.create_pair_versioned(s(&v, "address"), 3).await?,
            "pair.confirm" => {
                ensure(
                    v["approve"].is_boolean(),
                    "INVALID_REQUEST",
                    "Boolean confirmation required",
                )?;
                self.pairing
                    .confirm(&self.store, s(&v, "requestId"), v["approve"] == true)?;
            }
            "device.revoke" => {
                self.revoke_device(s(&v, "deviceId"))?;
            }
            "approval.decide" => {
                self.decide(
                    s(&v, "sessionId"),
                    s(&v, "turnId"),
                    s(&v, "approvalId"),
                    s(&v, "decision"),
                )?;
            }
            "stop" => {
                self.request_stop();
                return Ok(false);
            }
            _ => unreachable!(),
        }
        self.publish();
        self.emit(
            "action.result",
            json!({"localRequestId":v["localRequestId"],"action":action,"success":true}),
        );
        Ok(true)
    }
    pub async fn supervise(self: &Arc<Self>, exe: PathBuf) {
        self.supervise_runtime(exe, crate::runtime::RuntimeTarget::Managed)
            .await;
    }
    pub async fn supervise_runtime(
        self: &Arc<Self>,
        exe: PathBuf,
        target: crate::runtime::RuntimeTarget,
    ) {
        self.attached_runtime
            .store(target.attached(), Ordering::SeqCst);
        *self.runtime_protocol.write().unwrap() = target.protocol();
        let mut failures = 0u32;
        let mut args = codex::args();
        let mut discovered = false;
        while !self.stopping.load(Ordering::SeqCst) {
            let result: Result<()> = async {
                *self.runtime_version.write().unwrap() = None;
                let (rpc, mut events) = match &target {
                    crate::runtime::RuntimeTarget::Managed => Rpc::start(&exe, &args)?,
                    crate::runtime::RuntimeTarget::Attached { endpoint, .. } => {
                        let credential = target.credential()?;
                        Rpc::connect_local_websocket_profile(endpoint, &credential, target.protocol()).await?
                    },
                };
                *self.rpc.write().unwrap() = Some(rpc.clone());
                let owner = self.clone();
                let event_rpc = rpc.clone();
                let event_task = tokio::spawn(async move {
                    while let Some(v) = events.recv().await {
                        if v["method"] == "$lost" {
                            break;
                        }
                        let result = if v.get("id").is_some() {
                            owner.receive_approval(&event_rpc, &v)
                        } else {
                            owner.notification(&event_rpc, &v)
                        };
                        if let Err(e) = result {
                            owner.emit(
                                "error",
                                json!({"code":"UPSTREAM_PROTOCOL_ERROR","message":format!("Codex 协议检查失败：{}",e.code)}),
                            );
                            if v.get("id").is_none() {
                                event_rpc.stop();
                            }
                        }
                    }
                    let _ = owner.lost();
                });
                let initialized: Result<()> = async {
                    if target.attached() { codex::initialize_attached(&rpc).await?; }
                    else { codex::initialize(&rpc).await?; }
                    *self.runtime_protocol.write().unwrap() = rpc.protocol();
                    *self.runtime_version.write().unwrap() = rpc.runtime_version();
                    // Preserve the actual native boundary proof across every
                    // reconnect. Never relabel a probe of one installed binary
                    // as verification of a different attached server version.
                    #[cfg(any(windows, target_os = "macos"))]
                    if self.verified.load(Ordering::SeqCst) {
                        if let Some(probed) = self.store.meta("sandboxProbeVersion")? {
                            ensure(
                                !probed.is_empty() && rpc.runtime_version().as_deref() == Some(probed.as_str()),
                                "UPSTREAM_VERSION_MISMATCH",
                                "共享运行时版本与已通过沙箱验证的本机 Codex 不同；请为 Host 选择同一份原生程序。",
                            )?;
                        }
                    }
                    let verified_version = if self.verified.load(Ordering::SeqCst) {
                        rpc.runtime_version().unwrap_or_default()
                    } else {
                        String::new()
                    };
                    self.store.set_meta("sandboxVerifiedVersion", &verified_version)?;
                    if !discovered && !target.attached() {
                        let config = rpc
                            .request("config/read", json!({"includeLayers":false}))
                            .await?;
                        rpc.validate("v2/ConfigReadResponse", &config)?;
                        let names: Vec<_> = config["config"]["mcp_servers"]
                            .as_object()
                            .map(|o| {
                                o.iter()
                                    .filter(|(_, v)| v["enabled"] != false)
                                    .map(|(k, _)| k.clone())
                                    .collect()
                            })
                            .unwrap_or_default();
                        ensure(
                            names.len() <= 100,
                            "UNSAFE_UPSTREAM_CONFIG",
                            "Too many configured MCP servers",
                        )?;
                        discovered = true;
                        if !names.is_empty() {
                            let table = format!(
                                "{{{}}}",
                                names
                                    .iter()
                                    .map(|n| format!("{}={{enabled=false}}", json!(n)))
                                    .collect::<Vec<_>>()
                                    .join(",")
                            );
                            args.extend(["-c".into(), format!("mcp_servers={table}")]);
                            return Err(Error::new(
                                "CONFIG_RESTART",
                                "Restarting with external MCP disabled",
                            ));
                        }
                    }
                    #[cfg(windows)]
                    {
                        let readiness = rpc.request("windowsSandbox/readiness", Value::Null).await?;
                        rpc.validate("v2/WindowsSandboxReadinessResponse", &readiness)?;
                        ensure(
                            readiness["status"] == "ready",
                            "SANDBOX_UNAVAILABLE",
                            "Windows sandbox is not ready",
                        )?;
                    }
                    let config = rpc
                        .request("config/read", json!({"includeLayers":false}))
                        .await?;
                    rpc.validate("v2/ConfigReadResponse", &config)?;
                    codex::check_policy(&config)?;
                    self.ready.store(true, Ordering::SeqCst);
                    *self.runtime_error.write().unwrap() = None;
                    self.reconcile(&rpc).await?;
                    self.store
                        .append("host.status", json!({"status":"connected"}), None, None)?;
                    self.publish();
                    Ok(())
                }
                .await;
                if let Err(e) = initialized {
                    rpc.stop();
                    let _ = event_task.await;
                    return Err(e);
                }
                failures = 0;
                let source_task = {
                    let owner = self.clone();
                    let source_rpc = rpc.clone();
                    tokio::spawn(async move { owner.watch_source_changes(source_rpc).await })
                };
                let index_task = {
                    let owner = self.clone();
                    let index_rpc = rpc.clone();
                    tokio::spawn(async move { owner.watch_thread_index(index_rpc).await })
                };
                let _ = event_task.await;
                source_task.abort(); let _ = source_task.await;
                index_task.abort(); let _ = index_task.await;
                Ok(())
            }
            .await;
            if self.stopping.load(Ordering::SeqCst) {
                break;
            }
            if let Err(e) = result {
                if e.code != "CONFIG_RESTART" {
                    *self.runtime_error.write().unwrap() =
                        Some(json!({"code":e.code,"message":e.message}));
                    self.emit(
                        "error",
                        json!({"message":format!("Codex 尚未就绪（{}），正在重试",e.code)}),
                    );
                }
            }
            self.publish();
            let delay =
                Duration::from_millis((500u64.saturating_mul(1u64 << failures.min(6))).min(30000));
            failures = failures.saturating_add(1);
            tokio::time::sleep(delay).await;
        }
    }
    pub async fn dispatch(&self, r: &protocol::Request, device: &str) -> Result<Value> {
        let p = &r.payload;
        match r.action.as_str() {
            "requests.status" => self.store.request_status(device, s(p, "requestId")),
            "system.hello" => Ok(
                json!({"v":1,"hostId":self.store.meta("hostId")?,"serverVersion":"0.3.0","heartbeatSeconds":15}),
            ),
            "system.capabilities" => {
                let mut value = crate::capabilities::describe_profile(
                    self.ready.load(Ordering::SeqCst),
                    self.verified.load(Ordering::SeqCst),
                    self.attached_runtime.load(Ordering::SeqCst),
                    *self.runtime_protocol.read().unwrap(),
                );
                value["codexVersion"] = json!(self
                    .runtime_version
                    .read()
                    .unwrap()
                    .as_deref()
                    .unwrap_or(""));
                value["minimumCodexVersion"] = json!(codex::MIN_SUPPORTED_VERSION);
                value["runtime"]["schemaBaseline"] =
                    json!(self.runtime_protocol.read().unwrap().version());
                Ok(value)
            }
            "system.updateCheck" => {
                let status = crate::host::updates::status().await.map_err(|_| {
                    Error::new(
                        "UPDATE_CHECK_FAILED",
                        "Cannot check the official Host release; retry later",
                    )
                })?;
                Ok(status)
            }
            "system.updateStatus" => {
                let running = self.state()?["runningVersion"].clone();
                crate::host::update_job::observe_ready(
                    running.as_str().unwrap_or(""),
                    self.ready.load(Ordering::SeqCst)
                        && self.cloud.status().online
                        && self.runtime_error.read().unwrap().is_none(),
                )?;
                let mut value = crate::host::update_job::status()?;
                value["host"] = json!({"version":running,
                    "cloudOnline":self.cloud.status().online,
                    "codexReady":self.ready.load(Ordering::SeqCst),
                    "runtimeError":*self.runtime_error.read().unwrap()});
                Ok(value)
            }
            "system.updateInstall" => crate::host::update_job::install(s(p, "version")).await,
            "system.updateApply" => crate::host::update_job::apply(s(p, "jobId")),
            "system.updateCancel" => crate::host::update_job::cancel(s(p, "jobId")),
            "system.diagnostics" => {
                let mut counts = json!({});
                for table in ["projects", "sessions", "turns", "events", "devices"] {
                    counts[table] = self
                        .store
                        .one(&format!("SELECT COUNT(*) AS n FROM {table}"), [])?["n"]
                        .clone();
                }
                counts["pendingApprovals"] = json!(self.store.approval_rows(None)?.len());
                counts["journalBytes"] = self.store.one(
                    "SELECT COALESCE(SUM(length(CAST(payloadJson AS BLOB))),0) AS n FROM events",
                    [],
                )?["n"]
                    .clone();
                Ok(
                    json!({"at":now(),"bridgeVersion":"0.3.0","protocolVersion":1,"codexVersion":self.runtime_version.read().unwrap().as_deref().unwrap_or(""),"minimumCodexVersion":codex::MIN_SUPPORTED_VERSION,"nodeVersion":"Rust native (no Node runtime)","platform":std::env::consts::OS,"upstreamReady":self.ready.load(Ordering::SeqCst),"sandboxVerified":self.verified.load(Ordering::SeqCst),"cursor":self.store.cursor()?,"retention":self.store.retention(),"counts":counts}),
                )
            }
            "settings.execution" => self.execution_config(p["projectId"].as_str()).await,
            "settings.outputDefaults" => self.write_output_defaults(p).await,
            "settings.modelDefaults" => self.write_model_defaults(p).await,
            "skills.catalog" => self.skill_catalog(s(p, "projectId")).await,
            "skills.setEnabled" => self.set_skill_enabled(p).await,
            "files.list" => self.project_files(s(p, "projectId"), s(p, "directory")),
            "files.readImage" => self.project_file_image(
                s(p, "projectId"),
                s(p, "path"),
                p["offset"].as_u64().unwrap() as usize,
                p["sha256"].as_str(),
            ),
            "files.readText" => self.project_file_text(s(p, "projectId"), s(p, "path")),
            "files.reference" => self.project_file_reference(s(p, "projectId"), s(p, "path")),
            "account.status" => self.account_status().await,
            "models.list" => Ok(json!({"models":self.models().await?})),
            "sessions.goal.resume" => self.resume_session_goal(p).await,
            "sessions.goal" => self.session_goal(s(p, "sessionId")).await,
            "sessions.rename"
            | "sessions.archive"
            | "sessions.restore"
            | "sessions.delete"
            | "sessions.goal.clear"
            | "sessions.goal.edit"
            | "sessions.pin"
            | "sessions.revise"
            | "sessions.compact"
            | "sessions.revert"
            | "sessions.fork" => self.manage_session(&r.action, p).await,
            "settings.get" => Ok(json!({"retention":self.store.retention()})),
            "settings.update" => {
                self.store.set_meta("retention", &p.to_string())?;
                self.store
                    .append("settings.updated", json!({"retention":p}), None, None)?;
                Ok(json!({"retention":p}))
            }
            "snapshot.get" => self.snapshot(),
            "sessions.refreshIndex" => {
                let indexed =
                    tokio::time::timeout(Duration::from_secs(30), self.sync_thread_index())
                        .await
                        .map_err(|_| {
                            Error::new(
                                "UPSTREAM_TIMEOUT",
                                "Thread index refresh timed out; retry refresh",
                            )
                        })??;
                Ok(json!({"contractVersion":1,"indexed":indexed}))
            }
            "projects.nativePage" => {
                self.native_project_device_page(
                    device,
                    p["cursor"].as_str(),
                    p["limit"].as_u64().unwrap_or(50) as usize,
                )
                .await
            }
            "projects.list" => Ok(json!({"projects":self.store.visible_projects()?})),
            "projects.add" => {
                let indexed = self.sync_thread_index().await?;
                self.publish();
                Ok(
                    json!({"status":"synced","indexed":indexed,"projects":self.store.visible_projects()?}),
                )
            }
            "projects.remove" => {
                let _sync = self.thread_sync.try_lock().map_err(|_| {
                    Error::new("CONFLICT", "Workspace sync in progress; retry removal")
                })?;
                {
                    let busy = self.busy.lock().unwrap();
                    ensure(
                        busy.is_empty(),
                        "CONFLICT",
                        "Conversation operation in progress; retry removal",
                    )?;
                    paths::remove_local(&self.store, s(p, "projectId"))?;
                }
                self.publish();
                Ok(json!({"status":"removed"}))
            }
            "queue.list" | "queue.add" | "queue.update" | "queue.delete" | "queue.reorder"
            | "queue.start" => {
                self.native_queue(&r.action, p, &crate::digest(format!("{device}:{}", r.id)))
                    .await
            }
            "sessions.list" => {
                Ok(json!({"sessions":self.store.visible_sessions(p["projectId"].as_str())?}))
            }
            "sessions.observe" => self.observe_session(s(p, "sessionId")).await,
            "sessions.history" => {
                self.upstream_history_ordered(
                    s(p, "sessionId"),
                    p["cursor"].as_str(),
                    p["limit"].as_u64().unwrap_or(20) as usize,
                    p["sortDirection"].as_str().unwrap_or("asc"),
                )
                .await
            }
            "sessions.image" => tokio::time::timeout(
                Duration::from_secs(30),
                self.session_image(
                    s(p, "sessionId"),
                    s(p, "turnId"),
                    s(p, "itemId"),
                    p["contentIndex"].as_u64().unwrap_or(0) as usize,
                    p["offset"].as_u64().unwrap() as usize,
                    p["sha256"].as_str(),
                ),
            )
            .await
            .map_err(|_| Error::new("UPSTREAM_TIMEOUT", "Image read timed out"))?,
            "sessions.historyContent" => {
                self.upstream_history_content_ordered(
                    s(p, "sessionId"),
                    p["cursor"].as_str(),
                    s(p, "sha256"),
                    p["offset"].as_u64().unwrap() as usize,
                    p["sortDirection"].as_str().unwrap_or("asc"),
                )
                .await
            }
            "sessions.create" => {
                let project = s(p, "projectId");
                if project == paths::CHAT_PROJECT {
                    paths::chat_workspace(&self.store)?;
                }
                Ok(json!({"session":self.create_session(project,s(p,"title")).await?}))
            }
            "sessions.detail" => Ok(
                json!({"session":self.store.session(s(p,"sessionId"))?,"turns":self.store.turns(Some(s(p,"sessionId")))?,"events":self.store.history(s(p,"sessionId"),p["before"].as_str(),p["limit"].as_u64().unwrap_or(100) as usize)?}),
            ),
            "turn.start" => Ok(
                json!({"turn":self.start_turn_with_skills(s(p,"sessionId"),s(p,"text"),p["model"].as_str(),p["effort"].as_str(),p["permissionMode"].as_str().unwrap_or("workspace"),p["mode"].as_str().unwrap_or("default"),p.get("attachments"),p.get("skills")).await?}),
            ),
            "turn.interrupt" => self.interrupt(s(p, "sessionId"), s(p, "turnId")).await,
            "turn.active" => self.active_upstream_turn(s(p, "sessionId")).await,
            "turn.latest" => tokio::time::timeout(
                Duration::from_secs(30),
                self.latest_upstream_turn(s(p, "sessionId")),
            )
            .await
            .map_err(|_| Error::new("UPSTREAM_TIMEOUT", "Latest turn read timed out"))?,
            "turn.interruptActive" => {
                self.interrupt_active_turn(s(p, "sessionId"), s(p, "expectedTurnId"))
                    .await
            }
            "turn.steer" => {
                self.steer_turn(
                    s(p, "sessionId"),
                    s(p, "expectedTurnId"),
                    s(p, "text"),
                    &crate::digest(format!("{device}:{}", r.id)),
                )
                .await
            }
            "approvals.list" => {
                if let Some(id) = p["sessionId"].as_str() {
                    self.store.session(id)?;
                }
                Ok(json!({"approvals":self.store.approvals(p["sessionId"].as_str())?}))
            }
            "approvals.decide" => self.decide_with_answers(
                s(p, "sessionId"),
                s(p, "turnId"),
                s(p, "approvalId"),
                s(p, "decision"),
                p.get("answers"),
            ),
            "git.branches" => {
                crate::git::comparison::branches(&self.store, s(p, "projectId")).await
            }
            "git.compare" => {
                crate::git::comparison::compare(
                    &self.store,
                    s(p, "projectId"),
                    s(p, "base"),
                    s(p, "head"),
                    s(p, "mode"),
                )
                .await
            }
            "git.compareDiff" => {
                crate::git::comparison::diff(
                    &self.store,
                    s(p, "projectId"),
                    s(p, "base"),
                    s(p, "head"),
                    s(p, "fileId"),
                )
                .await
            }
            "git.status" => crate::git::status(&self.store, s(p, "projectId")).await,
            "git.diff" => crate::git::diff(&self.store, s(p, "projectId"), s(p, "fileId")).await,
            "events.replay" => self.store.replay(
                p["cursor"].as_str().unwrap_or("0"),
                p["limit"].as_u64().unwrap_or(100) as usize,
            ),
            "devices.revokeSelf" => {
                self.revoke_device(device)?;
                Ok(json!({"revoked":true}))
            }
            _ => Err(Error::new("INVALID_REQUEST", "Unsupported action")),
        }
    }
    pub fn revoke_device(&self, device: &str) -> Result<()> {
        Pairing::revoke(&self.store, device)?;
        self.authorization_changed.notify_waiters();
        let authorized = self
            .store
            .query("SELECT deviceId FROM devices WHERE revokedAt IS NULL", [])?;
        let any_connected = {
            let connected = self.connected.lock().unwrap();
            authorized
                .iter()
                .any(|row| connected.get(s(row, "deviceId")).copied().unwrap_or(0) > 0)
        };
        if !any_connected {
            self.invalidate_approvals(true)?;
        }
        self.publish();
        Ok(())
    }
    pub async fn shutdown(&self) {
        self.cloud.stop();
        self.discovery.lock().unwrap().take();
        self.request_stop();
        // Detaching this Host must not reject requests owned by the shared
        // runtime. Expire only our local callbacks; other clients can decide.
        let _ = self.invalidate_approvals(!self.attached_runtime.load(Ordering::SeqCst));
        if let Some(rpc) = self.rpc.read().unwrap().clone() {
            rpc.stop();
        }
        if let Some((handle, task)) = self.network.lock().await.take() {
            handle.shutdown();
            let _ = tokio::time::timeout(Duration::from_secs(2), task).await;
        }
        let _ = self.lost();
        let _ = self.store.retain();
    }
    pub async fn poll_git(&self) -> Result<()> {
        if self.connected.lock().unwrap().is_empty() {
            return Ok(());
        }
        let mut hashes = self.git_hashes.lock().await;
        let projects = self.store.projects()?;
        let allowed: HashSet<String> = projects.iter().map(|p| s(p, "projectId").into()).collect();
        hashes.retain(|id, _| allowed.contains(id));
        for project in projects {
            let id = s(&project, "projectId");
            if let Ok(status) = crate::git::status(&self.store, id).await {
                let mut token = status.to_string();
                let names = std::iter::once(".git/index").chain(
                    status["files"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|v| s(v, "path")),
                );
                for name in names {
                    if let Ok(path) = paths::file(&self.store, id, name) {
                        if let Ok(m) = std::fs::symlink_metadata(path) {
                            token.push_str(&format!(
                                "{name}:{}:{:?}:{:?}",
                                m.len(),
                                m.modified().ok(),
                                m.created().ok()
                            ));
                        }
                    }
                }
                let hash = crate::digest(token);
                if hashes.get(id).is_some_and(|old| old != &hash) {
                    self.store.append(
                        "git.changed",
                        json!({"projectId":id,"attribution":"working-tree"}),
                        None,
                        None,
                    )?;
                }
                hashes.insert(id.into(), hash);
            }
        }
        Ok(())
    }
}
pub async fn boundary(exe: &Path) -> Result<Value> {
    boundary_runtime(exe, &std::env::current_exe()?).await
}
pub async fn boundary_runtime(exe: &Path, runtime: &Path) -> Result<Value> {
    // Tests and diagnostics also call this directly, outside main's host gate.
    // A low-integrity parent cannot launch MXC even from a normal terminal.
    security::verify_host_integrity()?;
    // Keep the probe next to the app data instead of the system temp folder:
    // restricted Windows sessions can make %TEMP% read-only for the service.
    let base_root = std::env::var_os("AGENTDECK_DATA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    std::fs::create_dir_all(&base_root)?;
    let base = tempfile::Builder::new()
        .prefix("agentdeck-rust-boundary-")
        .tempdir_in(&base_root)?;
    let inside = base.path().join("authorized");
    let outside = base.path().join("unauthorized");
    std::fs::create_dir(&inside)?;
    std::fs::create_dir(&outside)?;
    // Resolve MSIX AppData redirection before passing paths across the MXC
    // process boundary. The sandbox does not share the host's virtualized
    // namespace: a logical cwd can be readable but miss its writable grant.
    // Keep `base` alive so its temporary directory still owns probe cleanup.
    let inside = paths::canonical(&inside)?;
    let outside = paths::canonical(&outside)?;
    let runtime = paths::canonical(runtime)?;
    std::fs::write(inside.join("sentinel.txt"), "INSIDE")?;
    std::fs::write(outside.join("sentinel.txt"), "OUTSIDE")?;
    let executable = runtime.to_string_lossy().replace('\\', "/");
    let profile=format!("permissions={{agentdeck={{extends=\":workspace\",filesystem={{\":root\"=\"deny\",\":minimal\"=\"read\",\":tmpdir\"=\"deny\",\":slash_tmp\"=\"deny\",{}=\"read\"}},network={{enabled=false}}}}}}",json!(executable));
    let mut command = tokio::process::Command::new(exe);
    #[cfg(windows)]
    command.args(["-c", "windows.sandbox=\"mxc\""]);
    command
        .args([
            "-c",
            profile.as_str(),
            "sandbox",
            "--include-managed-config",
            "--permission-profile",
            "agentdeck",
            "--cd",
        ])
        .arg(&inside)
        .arg("--")
        .arg(&runtime)
        .arg("--sandbox-probe")
        .arg(&inside)
        .arg(&outside)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command.spawn()?;
    use tokio::io::AsyncReadExt;
    // Inspect only this local probe's bounded diagnostics. Never forward raw
    // stderr, which may contain paths or configuration values, to clients/logs.
    let stderr = child.stderr.take().unwrap();
    let diagnostics = tokio::spawn(async move {
        let mut bytes = Vec::new();
        let _ = stderr.take(8192).read_to_end(&mut bytes).await;
        bytes
    });
    let stdout = child.stdout.take().unwrap();
    let mut bytes = vec![];
    tokio::time::timeout(
        Duration::from_secs(30),
        stdout.take(16385).read_to_end(&mut bytes),
    )
    .await
    .map_err(|_| Error::new("SANDBOX_UNVERIFIED", "Boundary probe timed out"))??;
    ensure(
        bytes.len() <= 16384,
        "SANDBOX_UNVERIFIED",
        "Invalid probe output",
    )?;
    let status = tokio::time::timeout(Duration::from_secs(2), child.wait())
        .await
        .map_err(|_| Error::new("SANDBOX_UNVERIFIED", "Boundary probe did not exit"))??;
    let mut diagnostics = diagnostics;
    let diagnostic_bytes =
        match tokio::time::timeout(Duration::from_secs(2), &mut diagnostics).await {
            Ok(Ok(bytes)) => bytes,
            _ => {
                diagnostics.abort();
                Vec::new()
            }
        };
    let report: Value =
        serde_json::from_slice(&bytes).map_err(|_| boundary_launch_error(&diagnostic_bytes))?;
    let passed = status.success()
        && report["insideRead"] == true
        && report["insideWrite"] == true
        && report["outsideReadDenied"] == true
        && report["outsideWriteDenied"] == true
        && !outside.join("written.txt").exists();
    if passed {
        crate::upstream::instruction_probe::check(exe, base.path()).await?;
    }
    Ok(json!({"passed":passed,"at":now(),"details":report,"instructionLoading":passed}))
}
fn boundary_launch_error(stderr: &[u8]) -> Error {
    let message = String::from_utf8_lossy(stderr).to_lowercase();
    if message.contains("native mxc is unavailable on this executor") {
        Error::new(
            "SANDBOX_EXECUTOR_UNAVAILABLE",
            "原生 Codex 无法在当前执行器启动 Windows MXC；请检查进程完整性、Windows MXC 支持及组织策略，切换终端不保证解决",
        )
    } else {
        Error::new(
            "SANDBOX_UNVERIFIED",
            "Windows 隔离检查未返回有效结果；请检查 Codex 隔离组件和启动环境",
        )
    }
}

pub fn sandbox_probe(inside: &Path, outside: &Path) -> bool {
    let read = std::fs::read_to_string(inside.join("sentinel.txt")).is_ok_and(|v| v == "INSIDE");
    let write = std::fs::write(inside.join("written.txt"), "OK").is_ok();
    let denied_read = std::fs::read(outside.join("sentinel.txt")).is_err();
    let denied_write = std::fs::write(outside.join("written.txt"), "BAD").is_err();
    println!(
        "{}",
        json!({"insideRead":read,"insideWrite":write,"outsideReadDenied":denied_read,"outsideWriteDenied":denied_write})
    );
    read && write && denied_read && denied_write
}
