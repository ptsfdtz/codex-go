#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use agentdeck_service::{
    codex, ensure, now, security,
    service::{boundary, sandbox_probe, Core},
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
    let runtime_target = agentdeck_service::runtime::RuntimeTarget::from_environment()?;
    ensure(
        cfg!(windows),
        "UNSUPPORTED_PLATFORM",
        "AgentDeck production Bridge requires Windows",
    )?;
    let _ = rustls::crypto::ring::default_provider().install_default();
    let directory = std::env::var_os("AGENTDECK_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("LOCALAPPDATA").map(|v| PathBuf::from(v).join("AgentDeck")))
        .ok_or_else(|| Error::new("CONFIG_ERROR", "Data directory unavailable"))?;
    security::restrict_directory(&directory)?;
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join("native-service.lock"))?;
    lock.try_lock_exclusive()
        .map_err(|_| Error::new("CONFLICT", "Native service already uses this directory"))?;
    let store = Arc::new(Store::open(&directory.join("agentdeck.db"))?);
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
    core.publish();
    let (commands, mut input) = tokio::sync::mpsc::channel::<Value>(8);
    let owner = core.clone();
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
            if count % 300 == 0 {
                let _ = owner.store.retain();
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
    let exe = codex::find()?;
    codex::verify_for(&exe, runtime_target.protocol())?;
    let report = boundary(&exe).await?;
    std::fs::write(
        directory.join("sandbox-verification.json"),
        report.to_string(),
    )?;
    ensure(
        report["passed"] == true,
        "SANDBOX_UNVERIFIED",
        "Native Windows isolation probe failed; inspect sandbox-verification.json",
    )?;
    core.verified.store(true, Ordering::SeqCst);
    core.store.set_meta(
        "sandboxVerifiedVersion",
        runtime_target.protocol().version(),
    )?;
    let desktop_adapter =
        agentdeck_service::desktop_adapter::DesktopAdapter::from_environment(&runtime_target)
            .await?;
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
        std::fs::write(directory.join("startup-check.json"),json!({"at":now(),"result":if passed{"PASS"}else{"FAIL"},"backend":"Rust","codexVersion":core.snapshot()?["host"]["codexVersion"],"runtimeMode":if core.attached_runtime.load(Ordering::SeqCst){"attached-local-ws"}else{"managed-stdio"},"codexReady":passed,"sandboxVerified":true,"dpapiCertificate":true,"address":address}).to_string())?;
        core.shutdown().await;
        ensure(
            passed,
            "UPSTREAM_UNAVAILABLE",
            "Native startup check failed",
        )?;
    } else {
        core.stop.notified().await;
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
