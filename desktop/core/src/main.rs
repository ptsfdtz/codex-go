#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use agentdeck_service::codex;
use agentdeck_service::{
    ensure, security,
    service::{sandbox_probe, Core},
    store::Store,
    Error, Result,
};
use fs2::FileExt;
use serde_json::{json, Value};
use std::{
    ffi::OsString,
    path::PathBuf,
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
#[tokio::main]
async fn main() {
    let args: Vec<_> = std::env::args_os().collect();
    if let Some(index) = args.iter().position(|v| v == "--data-dir") {
        if let Some(directory) = args.get(index + 1) {
            std::env::set_var("AGENTDECK_DATA_DIR", directory);
        }
    }
    if args.get(1).is_some_and(|v| v == "--runtime-supervisor") {
        if let Err(error) = agentdeck_service::host::shared_runtime::supervise().await {
            agentdeck_service::host::log(&error.code, &error.message);
            std::process::exit(1);
        }
        return;
    }
    if args.get(1).is_some_and(|v| v == "--host-supervisor") {
        if let Err(error) = agentdeck_service::host::supervise().await {
            agentdeck_service::host::log(&error.code, &error.message);
            std::process::exit(1);
        }
        return;
    }
    if args.get(1).is_some_and(|v| v == "--sandbox-probe") {
        let passed =
            args.len() == 4 && sandbox_probe(&PathBuf::from(&args[2]), &PathBuf::from(&args[3]));
        std::process::exit(if passed { 0 } else { 3 });
    }
    if let Err(e) = run(args.get(1..).unwrap_or_default()).await {
        agentdeck_service::host::log(&e.code, &e.message);
        println!(
            "{}",
            json!({"type":"error","payload":{"code":e.code,"message":e.message}})
        );
        std::process::exit(1);
    }
}
async fn run(args: &[OsString]) -> Result<()> {
    ensure(
        !args.iter().any(|arg| arg == "--desktop-stdio")
            && std::env::var("AGENTDECK_LOGIN_ONLY").as_deref() != Ok("1"),
        "UNSUPPORTED",
        "Remove --desktop-stdio or clear AGENTDECK_LOGIN_ONLY, then use agentdeck serve or agentdeck login",
    )?;
    security::verify_host_integrity()?;
    let _ = rustls::crypto::ring::default_provider().install_default();
    agentdeck_service::host::shared_runtime::initialize()?;
    let directory = agentdeck_service::host::data_dir()?;
    security::restrict_directory(&directory)
        .map_err(|e| Error::new(&e.code, &format!("准备服务数据目录失败：{}", e.message)))?;
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join("native-service.lock"))
        .map_err(|e| {
            Error::new(
                "DATA_DIRECTORY_ERROR",
                &format!("无法打开服务锁（系统错误 {:?}）", e.raw_os_error()),
            )
        })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        lock.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    lock.try_lock_exclusive()
        .map_err(|_| Error::new("CONFLICT", "Native service already uses this directory"))?;
    let store = Arc::new(Store::open(&directory.join("agentdeck.db"))?);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            directory.join("agentdeck.db"),
            std::fs::Permissions::from_mode(0o600),
        )?;
    }
    let tls = security::Certificate::load(&directory)?;
    let address = tls.restore(store.meta("listenAddress")?);
    let port = std::env::var("AGENTDECK_PORT")
        .ok()
        .or(store.meta("listenPort")?)
        .unwrap_or("49321".into())
        .parse::<u16>()
        .map_err(|_| Error::new("CONFIG_ERROR", "Invalid port"))?;
    ensure(port > 1024, "CONFIG_ERROR", "Invalid port")?;
    let (tx, mut local_events) = tokio::sync::mpsc::channel::<Value>(32);
    let core = Core::new(store, tls, address.clone(), port, tx);
    core.listen(&address).await?;
    core.store.recover()?;
    core.store.set_meta("listenPort", &port.to_string())?;
    core.store.set_meta("sandboxVerifiedVersion", "")?;
    core.store.set_meta("sandboxProbeVersion", "")?;
    core.store.retain()?;
    let diagnostics = tokio::spawn(async move {
        while let Some(v) = local_events.recv().await {
            if v["type"] == "error" {
                agentdeck_service::host::log(
                    v["payload"]["code"].as_str().unwrap_or("SERVICE_ERROR"),
                    v["payload"]["message"].as_str().unwrap_or("Service error"),
                );
            }
        }
    });
    agentdeck_service::cloud::Cloud::start(&core).await?;
    let _management =
        agentdeck_service::management::Management::start(core.clone(), &directory).await?;
    core.publish();
    let owner = core.clone();
    let refresh = tokio::spawn(async move {
        let mut count = 0;
        while !owner.stopping.load(Ordering::SeqCst) {
            let _ = owner.expire_due();
            owner.publish();
            count += 1;
            if count % 5 == 0 {
                let _ = owner.refresh_network().await;
            }
            if count % 300 == 0 {
                let _ = owner.store.retain();
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
    let owner = core.clone();
    let supervisor = tokio::spawn(async move {
        while !owner.stopping.load(Ordering::SeqCst) {
            if let Err(error) = run_runtime(&owner).await {
                *owner.runtime_error.write().unwrap() =
                    Some(json!({"code":error.code,"message":error.message}));
                owner.emit("error", json!({"code":error.code,"message":error.message}));
            }
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
    let owner = core.clone();
    let git_poll = tokio::spawn(async move {
        while !owner.stopping.load(Ordering::SeqCst) {
            let _ = owner.poll_git().await;
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
    tokio::select! {
        _ = core.stop.notified() => {},
        result = shutdown_signal() => { result?; core.request_stop(); },
    }
    core.shutdown().await;
    refresh.abort();
    git_poll.abort();
    supervisor.abort();
    diagnostics.abort();
    Ok(())
}

async fn run_runtime(core: &Arc<Core>) -> Result<()> {
    agentdeck_service::host::shared_runtime::background().await?;
    let config = agentdeck_service::host::Config::load()?;
    let target = config.runtime_target()?;
    let exe = config.codex_executable()?;
    agentdeck_service::host::runtime_compatibility::verify_official(&exe)?;
    let report = agentdeck_service::service::boundary(&exe).await?;
    let verified = report["passed"] == true;
    std::fs::write(
        agentdeck_service::host::data_dir()?.join("sandbox-verification.json"),
        report.to_string(),
    )?;
    ensure(
        verified,
        "SANDBOX_UNVERIFIED",
        "Native isolation probe failed; inspect sandbox-verification.json",
    )?;
    core.store
        .set_meta("sandboxProbeVersion", &codex::executable_version(&exe)?)?;
    core.store.set_meta(
        "officialRuntime",
        &agentdeck_service::host::runtime_compatibility::origin(&exe)?.to_string(),
    )?;
    core.verified.store(verified, Ordering::SeqCst);
    // Record the actual negotiated runtime version after initialization. A schema
    // hint is not evidence that this executable passed a boundary check.
    let _adapter =
        agentdeck_service::desktop_adapter::DesktopAdapter::from_environment(&target).await?;
    core.supervise_runtime(exe, target).await;
    Ok(())
}

async fn shutdown_signal() -> Result<()> {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut terminate = signal(SignalKind::terminate())?;
        tokio::select! {
            result = tokio::signal::ctrl_c() => { result?; },
            _ = terminate.recv() => {},
        }
    }
    #[cfg(not(unix))]
    tokio::signal::ctrl_c().await?;
    Ok(())
}
