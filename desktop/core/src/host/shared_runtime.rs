//! Independent native server owner. Client/Host disconnects do not own this
//! process tree. Explicit configuration is required; never migrate a live Host.
use crate::{codex, ensure, runtime::RuntimeTarget, security, Error, Result};
use fs2::FileExt;
#[cfg(windows)]
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
        #[cfg(windows)]
        {
            self.format_version == 1
                && super::windows::process_birth(self.owner_pid) == Some(self.owner_birth)
                && super::windows::process_birth(self.native_pid) == Some(self.native_birth)
        }
        #[cfg(not(windows))]
        {
            false
        }
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
    #[cfg(windows)]
    fn publish(&self, native_pid: u32, executable: PathBuf, endpoint: String) -> Result<()> {
        let owner_pid = std::process::id();
        let record = Ready {
            format_version: 1,
            owner_pid,
            native_pid,
            executable,
            endpoint,
            owner_birth: super::windows::process_birth(owner_pid)
                .ok_or_else(|| Error::new("RUNTIME_EXITED", "Runtime owner is not live"))?,
            native_birth: super::windows::process_birth(native_pid)
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
    ensure(
        cfg!(windows),
        "UNSUPPORTED",
        "Shared runtime ownership currently requires Windows",
    )?;
    let config = super::Config::load()?;
    let target = config.runtime_target()?;
    ensure(
        target.attached(),
        "SHARED_RUNTIME_REQUIRED",
        "Configure an authenticated shared runtime first",
    )?;
    let requested = config.codex_executable();
    #[cfg(windows)]
    let executable = if running()? {
        requested?
    } else {
        super::runtime_compatibility::resolve(
            requested,
            std::path::Path::new(super::service_command()?.get_program()),
        )
        .await?
        .0
    };
    #[cfg(not(windows))]
    let executable = requested?;
    target.credential()?;
    if !running()? {
        preflight(&executable)?;
        #[cfg(windows)]
        {
            let directory = super::data_dir()?;
            super::windows::spawn_detached(
                &super::service_command()?,
                &[
                    std::ffi::OsStr::new("--runtime-supervisor"),
                    std::ffi::OsStr::new("--data-dir"),
                    directory.as_os_str(),
                ],
            )?;
        }
    }
    let readiness = async {
        loop {
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
    tokio::time::timeout(Duration::from_secs(1000), readiness)
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
    ensure(
        cfg!(windows),
        "UNSUPPORTED",
        "Shared runtime ownership currently requires Windows",
    )?;
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
    #[cfg(windows)]
    let executable = super::runtime_compatibility::resolve(
        requested,
        std::path::Path::new(super::service_command()?.get_program()),
    )
    .await?
    .0;
    #[cfg(not(windows))]
    let executable = requested?;
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
    let mut arguments = codex::args();
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
            #[cfg(windows)]
            ready_file.publish(child.id(), executable.clone(), endpoint.clone())?;
            super::log(
                "SHARED_RUNTIME_READY",
                "Independent native runtime initialized",
            );
            while child.try_wait()?.is_none() {
                tokio::time::sleep(Duration::from_millis(200)).await;
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
