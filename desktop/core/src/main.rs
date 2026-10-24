#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[cfg(windows)]
use agentdeck_service::service::boundary;
use agentdeck_service::{
    codex, ensure, now, security,
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
    if args.get(1).is_some_and(|v| v == "--sandbox-probe") {
        let passed =
            args.len() == 4 && sandbox_probe(&PathBuf::from(&args[2]), &PathBuf::from(&args[3]));
        std::process::exit(if passed { 0 } else { 3 });
    }
    if let Err(e) = run().await {
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
    let runtime_target = agentdeck_service::runtime::RuntimeTarget::from_environment()?;
    #[cfg(not(windows))]
    if !login_only {
        ensure(
            runtime_target.attached(),
            "CONFIG_ERROR",
            "Linux daemon requires AGENTDECK_RUNTIME_WS_URL and AGENTDECK_RUNTIME_TOKEN_FILE",
        )?;
    }
    let _ = rustls::crypto::ring::default_provider().install_default();
    let directory = std::env::var_os("AGENTDECK_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            #[cfg(windows)]
            {
                std::env::var_os("LOCALAPPDATA").map(|v| PathBuf::from(v).join("AgentDeck"))
            }
            #[cfg(not(windows))]
            {
                std::env::var_os("XDG_STATE_HOME")
                    .map(|v| PathBuf::from(v).join("agentdeck"))
                    .or_else(|| {
                        std::env::var_os("HOME")
                            .map(|v| PathBuf::from(v).join(".local/state/agentdeck"))
                    })
            }
        })
        .ok_or_else(|| Error::new("CONFIG_ERROR", "Data directory unavailable"))?;
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
    core.store.retain()?;
    let owner = core.clone();
    let writer = tokio::spawn(async move {
        use tokio::io::AsyncWriteExt;
        let mut stdout = tokio::io::stdout();
        while let Some(v) = output.recv().await {
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
    eprintln!("AGENTDECK_DIAG finding codex");
    let exe = if runtime_target.attached() {
        PathBuf::from("codex")
    } else {
        codex::find()?
    };
    eprintln!("AGENTDECK_DIAG found codex {}", exe.display());
    if !runtime_target.attached() {
        codex::verify_for(&exe, runtime_target.protocol())?;
    }
    #[cfg(windows)]
    let report = boundary(&exe).await?;
    #[cfg(not(windows))]
    let sandbox_verified = std::env::var("AGENTDECK_LINUX_SANDBOX_VERIFIED").as_deref() == Ok("1");
    #[cfg(not(windows))]
    let report = json!({"passed":sandbox_verified,"platform":"linux","mode":"attached-runtime","verification":"explicit-operator-declaration"});
    #[cfg(windows)]
    let sandbox_verified = report["passed"] == true;
    std::fs::write(
        directory.join("sandbox-verification.json"),
        report.to_string(),
    )?;
    #[cfg(windows)]
    ensure(
        report["passed"] == true,
        "SANDBOX_UNVERIFIED",
        "Native Windows isolation probe failed; inspect sandbox-verification.json",
    )?;
    core.verified.store(sandbox_verified, Ordering::SeqCst);
    core.store.set_meta(
        "sandboxVerifiedVersion",
        if sandbox_verified {
            runtime_target.protocol().version()
        } else {
            ""
        },
    )?;
    let desktop_adapter =
        agentdeck_service::desktop_adapter::DesktopAdapter::from_environment(&runtime_target)
            .await?;
    eprintln!("AGENTDECK_DIAG adapter done");
    if let Some(adapter) = &desktop_adapter {
        core.emit(
            "desktop.adapter.status",
            json!({"status":"listening","port":adapter.port}),
        );
    }
    let owner = core.clone();
    let supervisor = tokio::spawn(async move {
        owner.supervise_runtime(exe, runtime_target).await;
    });
    let owner = core.clone();
    let git_poll = tokio::spawn(async move {
        while !owner.stopping.load(Ordering::SeqCst) {
            let _ = owner.poll_git().await;
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
    if std::env::var("AGENTDECK_STARTUP_CHECK").as_deref() == Ok("1") {
        let until = tokio::time::Instant::now() + Duration::from_secs(90);
        while !core.ready.load(Ordering::SeqCst) && tokio::time::Instant::now() < until {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let passed = core.ready.load(Ordering::SeqCst);
        std::fs::write(directory.join("startup-check.json"),json!({"at":now(),"result":if passed{"PASS"}else{"FAIL"},"backend":"Rust","codexVersion":core.snapshot()?["host"]["codexVersion"],"runtimeMode":if core.attached_runtime.load(Ordering::SeqCst){"attached-local-ws"}else{"managed-stdio"},"codexReady":passed,"sandboxVerified":core.verified.load(Ordering::SeqCst),"dpapiCertificate":true,"address":address}).to_string())?;
        core.shutdown().await;
        ensure(
            passed,
            "UPSTREAM_UNAVAILABLE",
            "Native startup check failed",
        )?;
    } else {
        if headless {
            tokio::select! {
                _ = core.stop.notified() => {},
                result = shutdown_signal() => { result?; core.request_stop(); },
            }
        } else {
            core.stop.notified().await;
        }
        core.shutdown().await;
    }
    drop(desktop_adapter);
    actions.abort();
    refresh.abort();
    git_poll.abort();
    supervisor.abort();
    writer.abort();
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
