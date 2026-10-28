//! Independent native server owner. Client/Host disconnects do not own this
//! process tree. Initialize missing local configuration without migrating a live Host.
use crate::{codex, ensure, runtime::RuntimeTarget, security, Error, Result};
use fs2::FileExt;
use std::io::Write;
use std::{io::Read, path::PathBuf, process::Stdio, time::Duration};

const READY_FILE: &str = "shared-runtime-ready.json";

pub fn configuration_guard() -> Result<std::fs::File> {
    let directory = super::data_dir()?;
    security::restrict_directory(&directory)?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join("host-configuration.lock"))?;
    file.try_lock_exclusive().map_err(|_| {
        Error::new(
            "CONFIGURATION_BUSY",
            "Another local command is changing runtime configuration",
        )
    })?;
    Ok(file)
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Ready {
    format_version: u32,
    owner_pid: u32,
    owner_birth: u64,
    native_pid: u32,
    native_birth: u64,
    executable: PathBuf,
    endpoint: String,
}
impl Ready {
    fn live(&self) -> bool {
        self.format_version == 1
            && process_birth(self.owner_pid) == Some(self.owner_birth)
            && process_birth(self.native_pid) == Some(self.native_birth)
    }
    fn read() -> Result<Self> {
        let mut bytes = Vec::new();
        std::fs::File::open(super::data_dir()?.join(READY_FILE))?
            .take(16385)
            .read_to_end(&mut bytes)?;
        ensure(
            bytes.len() <= 16384,
            "CONFIG_ERROR",
            "Runtime readiness record exceeds limit",
        )?;
        serde_json::from_slice(&bytes)
            .map_err(|_| Error::new("CONFIG_ERROR", "Invalid runtime readiness record"))
    }
}
struct ReadyFile(PathBuf);
impl ReadyFile {
    fn clear(&self) -> Result<()> {
        match std::fs::remove_file(&self.0) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
    fn publish(&self, native_pid: u32, executable: PathBuf, endpoint: String) -> Result<()> {
        let owner_pid = std::process::id();
        let record = Ready {
            format_version: 1,
            owner_pid,
            native_pid,
            executable,
            endpoint,
            owner_birth: process_birth(owner_pid)
                .ok_or_else(|| Error::new("RUNTIME_EXITED", "Runtime owner is not live"))?,
            native_birth: process_birth(native_pid)
                .ok_or_else(|| Error::new("RUNTIME_EXITED", "Native runtime is not live"))?,
        };
        let mut file = tempfile::NamedTempFile::new_in(self.0.parent().unwrap())?;
        file.write_all(
            &serde_json::to_vec(&record)
                .map_err(|_| Error::new("IO_ERROR", "Cannot encode runtime readiness"))?,
        )?;
        file.persist(&self.0)
            .map_err(|_| Error::new("IO_ERROR", "Cannot publish runtime readiness"))?;
        Ok(())
    }
}
impl Drop for ReadyFile {
    fn drop(&mut self) {
        let _ = self.clear();
    }
}

pub fn running() -> Result<bool> {
    let directory = super::data_dir()?;
    security::restrict_directory(&directory)?;
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join("shared-runtime.lock"))?;
    match lock.try_lock_exclusive() {
        Ok(()) => Ok(false),
        Err(error) if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() => {
            Ok(true)
        }
        Err(error) => Err(error.into()),
    }
}

/// Auto discovery must keep using the active owner's native executable when a
/// desktop update or PATH change exposes a newer binary during a conversation.
/// Explicit operator selections keep their existing precedence.
pub(super) fn active_executable(target: &RuntimeTarget) -> Result<Option<PathBuf>> {
    let RuntimeTarget::Attached { endpoint, .. } = target else {
        return Ok(None);
    };
    if let Ok(ready) = Ready::read() {
        if ready.endpoint == *endpoint && running()? && ready.live() {
            return crate::paths::canonical(&ready.executable).map(Some);
        }
    }
    Ok(None)
}

/// Start a separate owner, never a child of the Host service's process job.
pub async fn background() -> Result<()> {
    // Serialize simultaneous first launches (Host, desktop shortcut, CLI). The
    // configuration lock is held only for short atomic writes, never downloads.
    let directory = super::data_dir()?;
    security::restrict_directory(&directory)?;
    let startup = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join("runtime-startup.lock"))?;
    let until = std::time::Instant::now() + Duration::from_secs(1000);
    loop {
        match startup.try_lock_exclusive() {
            Ok(()) => break,
            Err(error) if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() => {
                ensure(std::time::Instant::now() < until, "RUNTIME_START_TIMEOUT", "Another official runtime startup is still in progress; retry after checking status")?;
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
            Err(error) => return Err(error.into()),
        }
    }
    initialize()?;
    let config = super::Config::load()?;
    let target = config.runtime_target()?;
    ensure(
        target.attached(),
        "SHARED_RUNTIME_REQUIRED",
        "Configure an authenticated shared runtime first",
    )?;
    let requested = config.codex_executable();
    let executable = if running()? {
        super::runtime_compatibility::verify_official(&requested?)?
    } else {
        super::runtime_compatibility::official(requested).await?
    };
    target.credential()?;
    #[cfg(unix)]
    let mut started: Option<std::process::Child> = None;
    #[cfg(windows)]
    let mut owner_pid = None;
    if !running()? {
        preflight(&executable)?;
        {
            let _configuration = configuration_guard()?;
            let mut selected = super::Config::load()?;
            selected.codex_exe = Some(executable.clone());
            selected.save()?;
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            let mut command = super::service_command()?;
            command
                .arg("--runtime-supervisor")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            command.process_group(0);
            started = Some(command.spawn()?);
        }
        #[cfg(windows)]
        {
            let directory = super::data_dir()?;
            owner_pid = Some(super::windows::spawn_detached(
                &super::service_command()?,
                &[
                    std::ffi::OsStr::new("--runtime-supervisor"),
                    std::ffi::OsStr::new("--data-dir"),
                    directory.as_os_str(),
                ],
            )?);
        }
    }
    let readiness = async {
        loop {
            #[cfg(unix)]
            if let Some(child) = started.as_mut() {
                if child.try_wait()?.is_some() {
                    return Err(Error::new("SHARED_RUNTIME_START_FAILED", "官方共享运行时启动失败；运行 agentdeck runtime-check 和 agentdeck logs 查看原因"));
                }
            }
            #[cfg(windows)]
            if owner_pid.is_some_and(|pid| process_birth(pid).is_none()) {
                return Err(Error::new("SHARED_RUNTIME_START_FAILED", "官方共享运行时启动失败；运行 agentdeck runtime-check 和 agentdeck logs 查看原因"));
            }
            if let Ok(ready) = Ready::read() {
                let RuntimeTarget::Attached { endpoint, .. } = &target else {
                    unreachable!()
                };
                if running()?
                    && ready.executable == config.codex_executable()?
                    && ready.endpoint == *endpoint
                    && ready.live()
                    && super::codex_client::verify_runtime(&ready.executable, &target)
                        .await
                        .is_ok()
                    && ready.live()
                {
                    return Ok::<_, Error>(());
                }
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    };
    // A first compatibility repair may need to download the official runtime.
    tokio::time::timeout(Duration::from_secs(120), readiness)
        .await
        .map_err(|_| {
            Error::new(
                "RUNTIME_START_TIMEOUT",
                "Shared runtime did not become ready; inspect agentdeck logs",
            )
        })?
}

/// Foreground supervisor, intentionally separate from the Host supervisor's
/// kill-on-close job. A caller may launch it from its own service manager.
pub async fn supervise() -> Result<()> {
    initialize()?;
    let directory = super::data_dir()?;
    security::restrict_directory(&directory)?;
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join("shared-runtime.lock"))?;
    lock.try_lock_exclusive().map_err(|_| {
        Error::new(
            "SHARED_RUNTIME_ALREADY_RUNNING",
            "This Host environment already has a runtime supervisor",
        )
    })?;
    let ready_file = ReadyFile(directory.join(READY_FILE));
    ready_file.clear()?;
    let configuration = configuration_guard()?;
    let config = super::Config::load()?;
    let target = config.runtime_target()?;
    let RuntimeTarget::Attached {
        endpoint,
        token_file,
        ..
    } = &target
    else {
        return Err(Error::new(
            "SHARED_RUNTIME_REQUIRED",
            "Configure an authenticated loopback endpoint and token file first",
        ));
    };
    // Validate credential and CLI capabilities before launching any process.
    target.credential()?;
    let requested = config.codex_executable();
    drop(configuration);
    let executable = super::runtime_compatibility::resolve(
        requested,
        std::path::Path::new(super::service_command()?.get_program()),
    )
    .await?
    .0;
    let version = preflight(&executable)?;
    // Do not attach to or replace another listener, even one with matching auth.
    let url = reqwest::Url::parse(endpoint)
        .map_err(|_| Error::new("CONFIG_ERROR", "Invalid runtime endpoint"))?;
    let address = std::net::SocketAddr::new(
        url.host_str()
            .unwrap()
            .trim_matches(['[', ']'])
            .parse()
            .map_err(|_| Error::new("CONFIG_ERROR", "Runtime endpoint must use a loopback IP"))?,
        url.port_or_known_default()
            .ok_or_else(|| Error::new("CONFIG_ERROR", "Explicit runtime port required"))?,
    );
    ensure(
        tokio::net::TcpStream::connect(address).await.is_err(),
        "RUNTIME_ENDPOINT_IN_USE",
        "The configured runtime endpoint is already occupied",
    )?;
    let mut arguments = codex::args_for(&executable);
    // Preserve every Host execution-policy override; only replace stdio transport.
    let listen = arguments.iter().position(|arg| arg == "--listen").unwrap();
    arguments[listen + 1] = endpoint.trim_end_matches('/').to_owned();
    // Desktop reconciles its built-in REPL into user configuration after launch.
    // Keep the shared server's global MCP policy disabled; desktop supplies its
    // own complete REPL configuration when opening a native thread. Append after
    // mcp_servers={} so the table override does not erase this disabled entry.
    arguments.extend([
        "-c".into(),
        "mcp_servers.node_repl={enabled=false,command=\"\"}".into(),
    ]);
    arguments.extend([
        "--ws-auth".into(),
        "capability-token".into(),
        "--ws-token-file".into(),
    ]);
    let mut failures = 0u32;
    let shutdown = shutdown_signal();
    tokio::pin!(shutdown);
    loop {
        ensure(
            codex::executable_version(&executable)? == version,
            "UPSTREAM_VERSION_MISMATCH",
            "Native executable changed; runtime owner requires explicit restart",
        )?;
        let mut command = std::process::Command::new(&executable);
        command
            .args(&arguments)
            .arg(token_file)
            .env_remove("CODEX_CLI_PATH")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            if let Some(path) = std::env::var_os("PATH") {
                command.env("PATH", codex::filtered_path(&path.to_string_lossy()));
            }
            command.creation_flags(0x08000000);
        }
        let started = std::time::Instant::now();
        let mut child = command.spawn()?;
        #[cfg(windows)]
        let job = match super::process::Job::assign(&child) {
            Ok(job) => job,
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(Error::new(
                    "HOST_JOB_FAILED",
                    "Cannot own native process tree",
                ));
            }
        };
        // Never claim readiness from a listening port alone. Authenticate and
        // initialize the actual server, then close only this observer connection.
        let ready = async {
            loop {
                if child.try_wait()?.is_some() {
                    return Err(Error::new(
                        "RUNTIME_EXITED",
                        "Native runtime exited before initialization",
                    ));
                }
                if super::codex_client::verify_runtime(&executable, &target)
                    .await
                    .is_ok()
                    && child.try_wait()?.is_none()
                {
                    return Ok::<_, Error>(());
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        };
        if !matches!(
            tokio::time::timeout(Duration::from_secs(30), ready).await,
            Ok(Ok(()))
        ) {
            let _ = child.kill();
            let _ = child.wait();
            super::log(
                "SHARED_RUNTIME_START_FAILED",
                "Native runtime did not pass authenticated initialization",
            );
        } else {
            ready_file.publish(child.id(), executable.clone(), endpoint.clone())?;
            super::log(
                "SHARED_RUNTIME_READY",
                "Independent native runtime initialized",
            );
            while child.try_wait()?.is_none() {
                tokio::select! {
                    _ = &mut shutdown => {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Ok(());
                    }
                    _ = tokio::time::sleep(Duration::from_millis(200)) => {}
                }
            }
        }
        ready_file.clear()?;
        #[cfg(windows)]
        drop(job); // Reap descendants before attempting another server.
        failures = if started.elapsed() > Duration::from_secs(60) {
            1
        } else {
            failures + 1
        };
        ensure(
            failures < 5,
            "RUNTIME_RESTART_LIMIT",
            "Native runtime failed repeatedly; inspect Host logs",
        )?;
        super::log(
            "SHARED_RUNTIME_RESTART",
            "Native runtime exited; bounded restart pending",
        );
        tokio::time::sleep(Duration::from_secs(1 << failures)).await;
    }
}

fn preflight(executable: &std::path::Path) -> Result<String> {
    let version = codex::executable_version(executable)?;
    let help = codex::sync_command(
        &executable.to_string_lossy(),
        &["app-server", "--help"],
        None,
    )?;
    ensure(
        help.contains("--ws-auth") && help.contains("--ws-token-file"),
        "UPSTREAM_FEATURE_UNSUPPORTED",
        "Codex lacks authenticated WebSocket server support",
    )?;
    Ok(version)
}

/// Generate local transport credentials once. Explicit attachments remain intact;
/// an old running managed Host is never silently reconfigured.
pub fn initialize() -> Result<()> {
    let _configuration = configuration_guard()?;
    let mut config = super::Config::load()?;
    if config.runtime_target()?.attached() {
        return Ok(());
    }
    let directory = super::data_dir()?;
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join("native-service.lock"))?;
    ensure(
        lock.try_lock_exclusive().is_ok(),
        "SHARED_RUNTIME_MIGRATION_REQUIRED",
        "现有 Host 尚未使用共享运行时；请在任务空闲后重启，不会中断任务",
    )?;
    ensure(
        !running()?,
        "SHARED_RUNTIME_MIGRATION_REQUIRED",
        "共享运行时仍在运行；保留现有配置",
    )?;
    let credentials = directory.join("runtime");
    security::restrict_directory(&credentials)?;
    let token_file = credentials.join("token");
    if !token_file.exists() {
        let mut token = tempfile::NamedTempFile::new_in(&credentials)?;
        token.write_all(security::token().as_bytes())?;
        token
            .persist_noclobber(&token_file)
            .map_err(|_| Error::new("IO_ERROR", "Cannot create private runtime credential"))?;
    }
    crate::runtime::read_local_credential(&token_file)?;
    let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
    config.runtime_ws = Some(format!("ws://127.0.0.1:{}", listener.local_addr()?.port()));
    config.runtime_token_file = Some(token_file);
    config.protocol = Some("auto".into());
    config.save()
}

fn process_birth(pid: u32) -> Option<u64> {
    #[cfg(windows)]
    {
        super::windows::process_birth(pid)
    }
    #[cfg(target_os = "linux")]
    {
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        // Process names may contain spaces and parentheses. Field 22 follows
        // the closing name delimiter and 19 preceding whitespace fields.
        stat.rsplit_once(") ")?
            .1
            .split_whitespace()
            .nth(19)?
            .parse()
            .ok()
    }
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("/bin/ps")
            .args(["-p", &pid.to_string(), "-o", "lstart="])
            .output()
            .ok()?;
        if !output.status.success() || output.stdout.is_empty() {
            return None;
        }
        u64::from_str_radix(&crate::digest(output.stdout)[..16], 16).ok()
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = pid;
        None
    }
}
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        if let Ok(mut terminate) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            tokio::select! { _ = terminate.recv() => {}, _ = tokio::signal::ctrl_c() => {} }
        } else {
            let _ = tokio::signal::ctrl_c().await;
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn birth_identifies_a_live_process_and_rejects_missing_pid() {
        assert!(super::process_birth(std::process::id()).is_some());
        assert!(super::process_birth(u32::MAX).is_none());
    }
}
