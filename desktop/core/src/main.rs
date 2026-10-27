#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[cfg(windows)]
use agentdeck_service::service::boundary;
use agentdeck_service::{
    codex, ensure, security,
    service::{sandbox_probe, Core},
    store::Store,
    Error, Result,
};
use fs2::FileExt;
use serde_json::{json, Value};
use std::{
    io::BufRead,
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
    if let Err(e) = run().await {
        agentdeck_service::host::log(&e.code, &e.message);
        println!(
            "{}",
            json!({"type":"error","payload":{"code":e.code,"message":e.message}})
        );
        std::process::exit(1);
    }
}
async fn run() -> Result<()> {
    let login_only = std::env::var("AGENTDECK_LOGIN_ONLY").as_deref() == Ok("1");
    let headless = std::env::var("AGENTDECK_HEADLESS").as_deref() == Ok("1");
    security::verify_host_integrity()?;
    let _ = rustls::crypto::ring::default_provider().install_default();
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
    let (tx, mut output) = tokio::sync::mpsc::channel::<Value>(32);
    let core = Core::new(store, tls, address.clone(), port, tx);
    core.listen(&address).await?;
    core.store.recover()?;
    core.store.set_meta("listenPort", &port.to_string())?;
    core.store.set_meta("sandboxVerifiedVersion", "")?;
    core.store.set_meta("sandboxProbeVersion", "")?;
    core.store.retain()?;
    let owner = core.clone();
    let writer = tokio::spawn(async move {
        use tokio::io::AsyncWriteExt;
        let mut stdout = tokio::io::stdout();
        while let Some(v) = output.recv().await {
            if headless {
                if v["type"] == "error" {
                    agentdeck_service::host::log(
                        v["payload"]["code"].as_str().unwrap_or("SERVICE_ERROR"),
                        v["payload"]["message"].as_str().unwrap_or("Service error"),
                    );
                }
                continue;
            }
            let line = format!("{v}\n");
            if stdout.write_all(line.as_bytes()).await.is_err() || stdout.flush().await.is_err() {
                owner.request_stop();
                break;
            }
        }
    });
    agentdeck_service::cloud::Cloud::start(&core).await?;
    if login_only {
        let origin = std::env::var("AGENTDECK_CLOUD_ORIGIN")
            .map_err(|_| Error::new("CONFIG_ERROR", "AGENTDECK_CLOUD_ORIGIN is required"))?;
        let username = std::env::var("AGENTDECK_CLOUD_USERNAME")
            .map_err(|_| Error::new("CONFIG_ERROR", "AGENTDECK_CLOUD_USERNAME is required"))?;
        let password_path = std::env::var_os("AGENTDECK_CLOUD_PASSWORD_FILE")
            .map(PathBuf::from)
            .ok_or_else(|| {
                Error::new("CONFIG_ERROR", "AGENTDECK_CLOUD_PASSWORD_FILE is required")
            })?;
        let password = std::fs::read_to_string(&password_path)
            .map_err(|_| Error::new("CONFIG_ERROR", "Cannot read cloud login secret"))?;
        let _ = std::fs::remove_file(&password_path);
        let password = password.trim_end_matches(['\r', '\n']);
        core.cloud_login(&origin, &username, password).await?;
        core.shutdown().await;
        return Ok(());
    }
    let _management = if headless {
        Some(agentdeck_service::management::Management::start(core.clone(), &directory).await?)
    } else {
        None
    };
    core.publish();
    eprintln!("AGENTDECK_DIAG published");
    let (commands, mut input) = tokio::sync::mpsc::channel::<Value>(8);
    let owner = core.clone();
    if !headless {
        std::thread::spawn(move || {
            let stdin = std::io::stdin();
            let mut reader = stdin.lock();
            loop {
                let mut bytes = vec![];
                let count = std::io::Read::take(&mut reader, 65537).read_until(b'\n', &mut bytes);
                match count {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if n > 65536 || !bytes.ends_with(b"\n") {
                            break;
                        }
                        let v: Value = match serde_json::from_slice(&bytes) {
                            Ok(v) => v,
                            Err(_) => break,
                        };
                        if commands.blocking_send(v).is_err() {
                            break;
                        }
                    }
                }
            }
            owner.request_stop();
        });
    }
    let owner = core.clone();
    let actions = tokio::spawn(async move {
        while let Some(v) = input.recv().await {
            let id = v["localRequestId"].clone();
            match owner.local_action(v).await {
                Ok(false) => break,
                Ok(true) => {}
                Err(e) => owner.emit(
                    "error",
                    json!({"localRequestId":id,"code":e.code,"message":e.message}),
                ),
            }
        }
    });
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
    if headless {
        tokio::select! {
            _ = core.stop.notified() => {},
            result = shutdown_signal() => { result?; core.request_stop(); },
        }
    } else {
        core.stop.notified().await;
    }
    core.shutdown().await;
    actions.abort();
    refresh.abort();
    git_poll.abort();
    supervisor.abort();
    writer.abort();
    Ok(())
}

async fn run_runtime(core: &Arc<Core>) -> Result<()> {
    let target = agentdeck_service::runtime::RuntimeTarget::from_environment()?;
    #[cfg(not(windows))]
    ensure(target.attached(), "CONFIG_ERROR", "Linux requires a configured authenticated runtime; use agentdeck configure --runtime-ws URL --runtime-token-file PATH --protocol VERSION")?;
    // Windows must probe the selected native executable even when attaching.
    // A PATH lookup for `codex` can select an older npm shim and certify a
    // different binary from the one that actually executes shared threads.
    let exe = if target.attached() && !cfg!(windows) {
        PathBuf::from("codex")
    } else {
        agentdeck_service::host::Config::load()?.codex_executable()?
    };
    if !target.attached() || cfg!(windows) {
        codex::verify_for(&exe, target.protocol())?;
    }
    #[cfg(windows)]
    let report = boundary(&exe).await?;
    #[cfg(not(windows))]
    let report = json!({"passed":std::env::var("AGENTDECK_LINUX_SANDBOX_VERIFIED").as_deref()==Ok("1"),"platform":"linux","mode":"attached-runtime","verification":"explicit-operator-declaration"});
    let verified = report["passed"] == true;
    std::fs::write(
        agentdeck_service::host::data_dir()?.join("sandbox-verification.json"),
        report.to_string(),
    )?;
    #[cfg(windows)]
    ensure(
        verified,
        "SANDBOX_UNVERIFIED",
        "Native Windows isolation probe failed; inspect sandbox-verification.json",
    )?;
    #[cfg(windows)]
    core.store
        .set_meta("sandboxProbeVersion", &codex::executable_version(&exe)?)?;
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
