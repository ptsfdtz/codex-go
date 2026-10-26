//! Start the original desktop against this Host's explicitly attached runtime.
//! No account migration, private database edits or independent app-server.
use crate::{codex, ensure, runtime::RuntimeTarget, security, Error, Result};
use std::{io::Write, path::Path, process::Command};

/// Bootstrap the combined desktop's local project route before selecting an
/// existing conversation. Observe public protocol acknowledgements only.
pub async fn launch(desktop: &Path, thread: Option<&str>) -> Result<()> {
    if thread.is_none() {
        command(desktop, None).await?.spawn()?;
        return Ok(());
    }
    let thread = thread.unwrap();
    ensure(
        uuid::Uuid::parse_str(thread).is_ok(),
        "INVALID_REQUEST",
        "An original Codex thread UUID is required",
    )?;
    let mut bootstrap = prepare(desktop, Some(thread), true).await?;
    let root = super::data_dir()?.join("desktop-client");
    let observation = tempfile::Builder::new()
        .prefix("launch-")
        .tempdir_in(root)?;
    security::restrict_directory(observation.path())?;
    bootstrap
        .env("AGENTDECK_DESKTOP_LAUNCH_STATUS", observation.path())
        .env("AGENTDECK_DESKTOP_LAUNCH_THREAD", thread);
    let mut link = Command::new(desktop);
    for (key, value) in bootstrap.get_envs() {
        if let Some(value) = value {
            link.env(key, value);
        }
    }
    link.args([
        "--single-argument",
        &format!("codex://threads/{thread}?hostId=local"),
    ]);
    bootstrap.spawn()?;
    wait_for_route(&observation.path().join("indexed")).await?;
    // Let the renderer apply the index response before navigating away.
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    link.spawn()?;
    wait_for_route(&observation.path().join("resumed")).await
}

async fn wait_for_route(path: &Path) -> Result<()> {
    for _ in 0..300 {
        if path.is_file() {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err(Error::new(
        "DESKTOP_ROUTE_NOT_READY",
        "桌面已启动，但未确认目标会话加载；请查看桌面状态。不会关闭应用或重发消息。",
    ))
}

pub async fn command(desktop: &Path, thread: Option<&str>) -> Result<Command> {
    prepare(desktop, thread, false).await
}

async fn prepare(desktop: &Path, thread: Option<&str>, bootstrap: bool) -> Result<Command> {
    ensure(
        cfg!(windows),
        "UNSUPPORTED",
        "原版桌面接入目前仅支持 Windows",
    )?;
    ensure(
        desktop.is_absolute() && desktop.is_file(),
        "CONFIG_ERROR",
        "请提供原版 Codex 桌面程序的绝对路径",
    )?;
    ensure(
        thread.is_none_or(|id| uuid::Uuid::parse_str(id).is_ok()),
        "INVALID_REQUEST",
        "An original Codex thread UUID is required",
    )?;
    // The existing Electron instance retains its launch environment. Handing it
    // a link would not switch its stdio backend and could silently split state.
    #[cfg(windows)]
    {
        let image = desktop
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or_else(|| Error::new("CONFIG_ERROR", "Invalid desktop executable name"))?;
        let running = codex::sync_command(
            "tasklist.exe",
            &["/FI", &format!("IMAGENAME eq {image}"), "/FO", "CSV", "/NH"],
            None,
        )?;
        ensure(
            !running.lines().any(|line| {
                line.split(',')
                    .next()
                    .is_some_and(|name| name.trim_matches('"').eq_ignore_ascii_case(image))
            }),
            "DESKTOP_ALREADY_RUNNING",
            "原版桌面已运行，无法更换它的运行时；请在任务空闲并退出原版桌面后重试。不会终止现有任务。",
        )?;
    }
    let config = super::Config::load()?;
    let target = config.runtime_target()?;
    let RuntimeTarget::Attached {
        ref endpoint,
        ref token_file,
        ..
    } = target
    else {
        return Err(Error::new(
            "SHARED_RUNTIME_REQUIRED",
            "Host 尚未连接认证共享服务；不会为原版桌面启动另一份 Codex 运行时。",
        ));
    };
    let native = config.codex_executable()?;
    // Use the original server's public home metadata for the desktop's native
    // startup policy read as well as its transport. Never copy credentials or
    // silently select a different local configuration directory.
    let (_, source_home, project) =
        super::codex_client::verify_runtime_thread(&native, &target, thread).await?;
    let source = std::env::current_exe()?
        .parent()
        .unwrap()
        .join("agentdeck-codex-proxy.exe");
    ensure(
        source.is_file(),
        "HOST_COMPONENT_MISSING",
        "当前 Host 缺少桌面代理组件；请安装包含 agentdeck-codex-proxy 的版本。",
    )?;
    let bytes = std::fs::read(&source)?;
    let fingerprint = crate::digest(&bytes);
    let directory = super::data_dir()?.join("desktop-client").join(fingerprint);
    security::restrict_directory(&directory)?;
    let proxy = directory.join("agentdeck-codex-proxy.exe");
    if !proxy.is_file() {
        let mut file = tempfile::NamedTempFile::new_in(&directory)?;
        file.write_all(&bytes)?;
        file.persist(&proxy)
            .map_err(|_| Error::new("IO_ERROR", "Cannot install desktop runtime adapter"))?;
    } else {
        ensure(
            crate::digest(std::fs::read(&proxy)?) == crate::digest(&bytes),
            "HOST_COMPONENT_INVALID",
            "Desktop runtime adapter integrity check failed",
        )?;
    }
    let manifest = serde_json::json!({
        "formatVersion": 1,
        "nativeExecutable": native,
        "endpoint": endpoint,
        "tokenFile": token_file,
        "protocolVersion": codex::executable_version(&native)?
    });
    let mut file = tempfile::NamedTempFile::new_in(&directory)?;
    file.write_all(manifest.to_string().as_bytes())?;
    file.persist(proxy.with_extension("json")).map_err(|_| {
        Error::new(
            "IO_ERROR",
            "Cannot save desktop runtime adapter configuration",
        )
    })?;
    let mut command = Command::new(desktop);
    command
        .env("CODEX_CLI_PATH", proxy)
        .env("CODEX_HOME", source_home)
        .arg("--single-argument");
    if let Some(thread) = thread.filter(|_| !bootstrap) {
        command.arg(format!("codex://threads/{thread}?hostId=local"));
    } else {
        // The combined ChatGPT desktop otherwise opens its default chat route.
        // Select the native local project explicitly, using one protocol URL.
        let directory = match project {
            Some(directory) => directory,
            None => std::env::current_dir()?,
        };
        let directory = directory.to_str().ok_or_else(|| {
            Error::new("CONFIG_ERROR", "Desktop project path must be valid Unicode")
        })?;
        let mut link = reqwest::Url::parse("codex://threads/new").unwrap();
        link.query_pairs_mut()
            .append_pair("mode", "codex")
            .append_pair("path", directory);
        command.arg(link.as_str());
    }
    Ok(command)
}
