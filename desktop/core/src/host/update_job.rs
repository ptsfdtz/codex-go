//! Persistent, bounded Host updates. No model, arbitrary command, or client URL.
use crate::{ensure, management, security, Error, Result};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(unix)]
use std::process::Stdio;
use std::{fs::File, io::Write, path::PathBuf, process::Command, time::Duration};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Job {
    pub id: String,
    pub version: String,
    pub previous_version: String,
    pub phase: String,
    pub installed: bool,
    pub error: Option<String>,
    pub updated_at: String,
    systemd: bool,
}

fn lock(name: &str) -> Result<File> {
    let directory = super::data_dir()?;
    security::restrict_directory(&directory)?;
    Ok(std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join(name))?)
}
fn guard() -> Result<File> {
    let file = lock("update-job.lock")?;
    for _ in 0..50 {
        if file.try_lock_exclusive().is_ok() {
            return Ok(file);
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    Err(Error::new(
        "UPDATE_BUSY",
        "Update state is changing; query status before retrying",
    ))
}
fn read() -> Result<Option<Job>> {
    let path = super::data_dir()?.join("update-job.json");
    if !path.exists() {
        return Ok(None);
    }
    ensure(
        std::fs::metadata(&path)?.len() <= 16384,
        "UPDATE_STATE_INVALID",
        "Invalid update state",
    )?;
    let job: Job = serde_json::from_slice(&std::fs::read(path)?)
        .map_err(|_| Error::new("UPDATE_STATE_INVALID", "Invalid update state"))?;
    ensure(
        super::updates::valid_version(&job.version) && uuid::Uuid::parse_str(&job.id).is_ok(),
        "UPDATE_STATE_INVALID",
        "Invalid update identity",
    )?;
    Ok(Some(job))
}
fn save(job: &Job) -> Result<()> {
    let directory = super::data_dir()?;
    let mut file = tempfile::NamedTempFile::new_in(&directory)?;
    file.write_all(
        &serde_json::to_vec(job)
            .map_err(|_| Error::new("UPDATE_STATE_INVALID", "Cannot encode update state"))?,
    )?;
    file.as_file().sync_all()?;
    file.persist(directory.join("update-job.json"))
        .map_err(|_| Error::new("IO_ERROR", "Cannot save update state"))?;
    Ok(())
}
fn current_version() -> Result<String> {
    Ok(std::fs::read_to_string(
        std::env::current_exe()?
            .parent()
            .unwrap()
            .join("release.txt"),
    )?
    .trim()
    .to_owned())
}
fn installation() -> Result<PathBuf> {
    let executable = dunce::canonicalize(std::env::current_exe()?)?;
    let versions = executable
        .parent()
        .and_then(|p| p.parent())
        .filter(|p| p.file_name().is_some_and(|n| n == "versions"))
        .ok_or_else(|| {
            Error::new(
                "UPDATE_UNSUPPORTED",
                "Use the installer for a legacy or development installation",
            )
        })?;
    Ok(versions.to_path_buf())
}
fn cli(version: &str) -> Result<PathBuf> {
    ensure(
        super::updates::valid_version(version),
        "INVALID_REQUEST",
        "Invalid release",
    )?;
    Ok(installation()?.join(version).join(if cfg!(windows) {
        "agentdeck.exe"
    } else {
        "agentdeck"
    }))
}
fn active(phase: &str) -> bool {
    matches!(
        phase,
        "installing" | "waitingIdle" | "restarting" | "preparingRuntime"
    )
}
fn systemd_managed() -> bool {
    #[cfg(target_os = "linux")]
    {
        // INVOCATION_ID can be inherited from a terminal or another app unit.
        std::fs::read_to_string("/proc/self/cgroup").is_ok_and(|groups| {
            groups
                .lines()
                .any(|line| line.split('/').any(|part| part == "agentdeck.service"))
        })
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}
pub(crate) fn ensure_idle(store: &crate::store::Store, busy: bool) -> Result<()> {
    // Task submission persists a queued/unknown turn before calling Codex.
    // The service admission barrier drains pending mutation handlers first.
    ensure(!busy && store.turns(None)?.is_empty() && store.approval_rows(None)?.is_empty()
        && store.query("SELECT sessionId FROM sessions WHERE status IN ('queued','running','waitingApproval','unknown') LIMIT 1", [])?.is_empty(),
        "UPDATE_NOT_IDLE", "Active tasks, approvals or unknown outcomes must be reconciled before restarting")
}
pub fn status() -> Result<Value> {
    let _guard = guard()?;
    let mut job = read()?;
    if let Some(value) = job.as_mut() {
        let worker = lock("update-worker.lock")?;
        let age = chrono::DateTime::parse_from_rfc3339(&value.updated_at)
            .ok()
            .map(|at| chrono::Utc::now().signed_duration_since(at).num_seconds())
            .unwrap_or(i64::MAX);
        if matches!(
            value.phase.as_str(),
            "installing" | "restarting" | "preparingRuntime"
        ) && age > 60
            && worker.try_lock_exclusive().is_ok()
        {
            value.phase = "failed".into();
            value.error = Some("更新进程已退出；请查看日志并核对已安装版本后重试".into());
            value.updated_at = crate::now();
            save(value)?;
        }
    }
    Ok(json!({"job":job}))
}
pub fn observe_ready(version: &str, ready: bool) -> Result<()> {
    if !ready {
        return Ok(());
    }
    let _guard = guard()?;
    if let Some(mut job) = read()? {
        if job.version == version && job.phase != "complete" {
            job.phase = "complete".into();
            job.installed = true;
            job.error = None;
            job.updated_at = crate::now();
            save(&job)?;
        }
    }
    Ok(())
}
fn launch(executable: PathBuf, action: &str, job: &Job) -> Result<()> {
    let mut command = Command::new(executable);
    command.env("AGENTDECK_DATA_DIR", super::data_dir()?);
    #[cfg(windows)]
    super::windows::spawn_detached(
        &command,
        &[std::ffi::OsStr::new(action), std::ffi::OsStr::new(&job.id)],
    )?;
    #[cfg(unix)]
    {
        if job.systemd {
            // A transient sibling unit survives stopping agentdeck.service and
            // does not inherit the model service's read-only installation mount.
            let status = Command::new("systemd-run")
                .args(["--user", "--collect", "--quiet"])
                .arg(format!("--unit=agentdeck-update-{}-{action}", job.id))
                .arg(format!(
                    "--setenv=AGENTDECK_DATA_DIR={}",
                    super::data_dir()?.display()
                ))
                .arg(command.get_program())
                .args([action, &job.id])
                .status()?;
            ensure(
                status.success(),
                "UPDATE_START_FAILED",
                "Cannot start the user update service",
            )?;
        } else {
            use std::os::unix::process::CommandExt;
            command
                .args([action, &job.id])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .process_group(0)
                .spawn()?;
        }
    }
    Ok(())
}
pub async fn install(version: &str) -> Result<Value> {
    installation()?;
    let release = super::updates::status()
        .await
        .map_err(|_| Error::new("UPDATE_CHECK_FAILED", "Cannot check the official release"))?;
    ensure(
        release["installation"] == "release"
            && release["latest"] == version
            && release["updateAvailable"] == true,
        "UPDATE_CHANGED",
        "No matching official update; check again",
    )?;
    let _guard = guard()?;
    if let Some(job) = read()? {
        if active(&job.phase)
            || (job.installed && job.version == version && job.phase != "complete")
        {
            ensure(
                job.version == version,
                "UPDATE_BUSY",
                "Another release is being updated",
            )?;
            return Ok(json!({"job":job}));
        }
    }
    let worker = lock("update-worker.lock")?;
    ensure(
        worker.try_lock_exclusive().is_ok(),
        "UPDATE_BUSY",
        "An update worker is still running; query status before retrying",
    )?;
    let job = Job {
        id: uuid::Uuid::new_v4().to_string(),
        version: version.into(),
        previous_version: current_version()?,
        phase: "installing".into(),
        installed: false,
        error: None,
        updated_at: crate::now(),
        systemd: systemd_managed(),
    };
    save(&job)?;
    drop(worker);
    drop(_guard);
    if let Err(error) = launch(cli(&job.previous_version)?, "update-install-worker", &job) {
        change(&job.id, "failed", false, Some(error.message.clone()))?;
        return Err(error);
    }
    Ok(json!({"job":job}))
}
pub fn apply(id: &str) -> Result<Value> {
    ensure(
        super::running()?,
        "UPDATE_UNSUPPORTED",
        "Start the managed Host before applying an update",
    )?;
    let _guard = guard()?;
    let mut job = read()?.ok_or_else(|| Error::new("UPDATE_NOT_FOUND", "No installed update"))?;
    ensure(
        job.id == id && job.installed,
        "UPDATE_CHANGED",
        "Query the installed update before restarting",
    )?;
    if matches!(job.phase.as_str(), "installed" | "failed") {
        job.phase = "waitingIdle".into();
        job.error = None;
        job.updated_at = crate::now();
        save(&job)?;
    }
    Ok(json!({"job":job}))
}
pub fn cancel(id: &str) -> Result<Value> {
    let _guard = guard()?;
    let mut job = read()?.ok_or_else(|| Error::new("UPDATE_NOT_FOUND", "No update"))?;
    ensure(
        job.id == id && job.phase == "waitingIdle",
        "UPDATE_CHANGED",
        "Only waiting restarts can be cancelled",
    )?;
    job.phase = "installed".into();
    job.updated_at = crate::now();
    save(&job)?;
    Ok(json!({"job":job}))
}
fn change(id: &str, phase: &str, installed: bool, error: Option<String>) -> Result<()> {
    let _guard = guard()?;
    let mut job = read()?.ok_or_else(|| Error::new("UPDATE_NOT_FOUND", "No update"))?;
    ensure(job.id == id, "UPDATE_CHANGED", "Update identity changed")?;
    job.phase = phase.into();
    job.installed = installed;
    job.error = error;
    job.updated_at = crate::now();
    save(&job)
}
// Called by the supervisor, outside the service's Windows kill-on-close job.
pub async fn poll_activation() -> Result<()> {
    status()?;
    let Some(mut job) = read()? else {
        return Ok(());
    };
    if job.phase != "waitingIdle" {
        if matches!(job.phase.as_str(), "failed" | "installed" | "complete") {
            let _ = management::call(
                &super::data_dir()?,
                json!({"action":"update.release","jobId":job.id}),
            )
            .await;
        }
        return Ok(());
    }
    let result = management::call(
        &super::data_dir()?,
        json!({"action":"update.prepare","jobId":job.id}),
    )
    .await;
    if let Err(error) = result {
        let message: String = crate::redact(&error.to_string())
            .chars()
            .take(512)
            .collect();
        let _guard = guard()?;
        if let Some(mut current) = read()? {
            if current.id == job.id
                && current.phase == "waitingIdle"
                && current.error.as_deref() != Some(&message)
            {
                current.error = Some(message);
                current.updated_at = crate::now();
                save(&current)?;
            }
        }
        return Ok(());
    }
    let _guard = guard()?;
    let Some(current) = read()? else {
        return Ok(());
    };
    if current.id != job.id || current.phase != "waitingIdle" {
        drop(_guard);
        let _ = management::call(
            &super::data_dir()?,
            json!({"action":"update.release","jobId":job.id}),
        )
        .await;
        return Ok(());
    }
    job.phase = "restarting".into();
    job.updated_at = crate::now();
    save(&job)?;
    drop(_guard);
    if let Err(error) = launch(cli(&job.previous_version)?, "update-activate-worker", &job) {
        change(&job.id, "failed", true, Some(error.message.clone()))?;
        let _ = management::call(
            &super::data_dir()?,
            json!({"action":"update.release","jobId":job.id}),
        )
        .await;
        return Err(error);
    }
    Ok(())
}
pub async fn worker(id: &str, activate: bool) -> Result<()> {
    let worker = lock("update-worker.lock")?;
    worker
        .try_lock_exclusive()
        .map_err(|_| Error::new("UPDATE_BUSY", "Update worker is already running"))?;
    let job = read()?.ok_or_else(|| Error::new("UPDATE_NOT_FOUND", "No update"))?;
    ensure(
        job.id == id && job.phase == if activate { "restarting" } else { "installing" },
        "UPDATE_CHANGED",
        "Stale update worker",
    )?;
    let result = if activate {
        activate_worker(&job).await
    } else {
        super::updates::run_pinned(&job.version)
            .await
            .map_err(|error| {
                Error::new(
                    "UPDATE_INSTALL_FAILED",
                    &format!(
                        "下载、校验或安装失败；原运行服务保留。{}",
                        crate::redact(&error.to_string())
                            .chars()
                            .take(512)
                            .collect::<String>()
                    ),
                )
            })
    };
    match result {
        Ok(()) => change(
            id,
            if activate { "complete" } else { "installed" },
            true,
            None,
        ),
        Err(error) => {
            super::log(&error.code, &error.message);
            change(id, "failed", job.installed, Some(error.message.clone()))?;
            let _ = management::call(
                &super::data_dir()?,
                json!({"action":"update.release","jobId":job.id}),
            )
            .await;
            Err(error)
        }
    }
}

async fn activate_worker(job: &Job) -> Result<()> {
    ensure(
        current_version()? == job.previous_version,
        "UPDATE_VERSION_MISMATCH",
        "Update launcher version differs",
    )?;
    #[cfg(target_os = "linux")]
    if job.systemd {
        let result = Command::new("systemctl")
            .args(["--user", "stop", "agentdeck.service"])
            .status()?;
        ensure(
            result.success(),
            "UPDATE_RESTART_FAILED",
            "Cannot stop the user Host service",
        )?;
    }
    super::stop().await?;
    change(&job.id, "preparingRuntime", true, None)?;
    #[cfg(target_os = "linux")]
    if job.systemd {
        let result = Command::new("systemctl")
            .args(["--user", "start", "agentdeck.service"])
            .status()?;
        ensure(
            result.success(),
            "UPDATE_RESTART_FAILED",
            "Cannot start the updated user Host service",
        )?;
    } else {
        start_target(job)?;
    }
    #[cfg(not(target_os = "linux"))]
    start_target(job)?;
    for _ in 0..600 {
        if let Ok(state) = management::call(&super::data_dir()?, json!({"action":"state"})).await {
            ensure(
                running_target(&state, &job.version)?,
                "UPDATE_VERSION_MISMATCH",
                "Host restarted with a different version",
            )?;
            if state["runtimeError"].is_object() {
                return Err(Error::new(
                    "UPDATE_RUNTIME_FAILED",
                    "新版已启动，但 Codex 初始化失败；请查看 Host 日志",
                ));
            }
            if state["codexReady"] == true && state["cloud"]["online"] == true {
                return Ok(());
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    Err(Error::new(
        "UPDATE_READY_TIMEOUT",
        "新版已启动，但连接或 Codex 尚未就绪；请检查状态与日志",
    ))
}
fn start_target(job: &Job) -> Result<()> {
    // Only the old, already running updater owns the transition. The target
    // needs its existing public `start` entry, not a private updater command.
    let mut command = Command::new(cli(&job.version)?);
    command
        .arg("start")
        .env("AGENTDECK_DATA_DIR", super::data_dir()?)
        .env_remove("AGENTDECK_SERVICE_BIN");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    ensure(
        command.output()?.status.success(),
        "UPDATE_RESTART_FAILED",
        "Cannot start the installed Host; inspect local status and logs",
    )
}
fn running_target(state: &Value, version: &str) -> Result<bool> {
    if !state["runningVersion"].is_null() {
        return Ok(state["runningVersion"] == version);
    }
    // Older Hosts have a PID but no release field. Check the actual process
    // image instead of trusting the installer or the CLI's own version.
    let Some(pid) = state["servicePid"]
        .as_u64()
        .and_then(|pid| u32::try_from(pid).ok())
    else {
        return Ok(false);
    };
    #[cfg(target_os = "linux")]
    let image = std::fs::read_link(format!("/proc/{pid}/exe"))?;
    #[cfg(windows)]
    let image = {
        use windows_sys::Win32::{Foundation::CloseHandle, System::Threading::*};
        let mut buffer = vec![0u16; 32768];
        let mut size = buffer.len() as u32;
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            ensure(
                !process.is_null(),
                "UPDATE_PROCESS_UNAVAILABLE",
                "Cannot verify the running Host process",
            )?;
            let ok = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut size);
            CloseHandle(process);
            ensure(
                ok != 0,
                "UPDATE_PROCESS_UNAVAILABLE",
                "Cannot read the running Host executable",
            )?;
        }
        PathBuf::from(String::from_utf16_lossy(&buffer[..size as usize]))
    };
    #[cfg(not(any(windows, target_os = "linux")))]
    let image = {
        let _ = pid;
        return Ok(false);
    };
    Ok(crate::paths::equal(
        &image,
        &installation()?.join(version).join(if cfg!(windows) {
            "agentdeck-service.exe"
        } else {
            "agentdeck-service"
        }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_protocol_rejects_arbitrary_sources_and_stale_job_ids() {
        let request = |action: &str, payload: Value| {
            crate::protocol::parse(json!({
            "v":1,"type":"request","id":"update-test","action":action,"payload":payload}))
        };
        assert!(request("system.updateStatus", json!({})).is_ok());
        assert!(request("system.updateInstall", json!({"version":"0.4.0"})).is_ok());
        assert!(request(
            "system.updateInstall",
            json!({"version":"0.4.0","origin":"https://example.com"})
        )
        .is_err());
        assert!(request("system.updateInstall", json!({"version":"../other"})).is_err());
        assert!(request("system.updateApply", json!({"jobId":"stale-or-empty"})).is_err());
        assert!(request(
            "system.updateApply",
            json!({"jobId":uuid::Uuid::new_v4().to_string()})
        )
        .is_ok());
    }

    #[test]
    fn restart_requires_idle_and_reconciled_tasks() {
        let directory = tempfile::tempdir().unwrap();
        let store = crate::store::Store::open(&directory.path().join("host.db")).unwrap();
        assert!(ensure_idle(&store, false).is_ok());
        assert!(ensure_idle(&store, true).is_err());
        store
            .exec(
                "INSERT INTO projects VALUES('p','p','/project','identity',1,'now')",
                [],
            )
            .unwrap();
        store
            .exec(
                "INSERT INTO sessions VALUES('s','p','native','session','idle','now','now')",
                [],
            )
            .unwrap();
        for status in ["queued", "running", "waitingApproval", "unknown"] {
            store
                .exec(
                    "INSERT INTO turns VALUES('t','s',NULL,?,'now',NULL,NULL)",
                    [status],
                )
                .unwrap();
            assert_eq!(
                ensure_idle(&store, false).unwrap_err().code,
                "UPDATE_NOT_IDLE"
            );
            store.exec("DELETE FROM turns", []).unwrap();
            store
                .exec("UPDATE sessions SET status=?", [status])
                .unwrap();
            assert!(ensure_idle(&store, false).is_err());
            store.exec("UPDATE sessions SET status='idle'", []).unwrap();
        }
        store
            .exec(
                "INSERT INTO turns VALUES('t','s','native-turn','completed','now','now',NULL)",
                [],
            )
            .unwrap();
        assert!(ensure_idle(&store, false).is_ok());
        store.exec("INSERT INTO approvals VALUES('a','s','t','command','pending','{}','{}','g','now','later',NULL)", []).unwrap();
        assert!(ensure_idle(&store, false).is_err());
        store
            .exec("UPDATE approvals SET status='sending'", [])
            .unwrap();
        assert!(ensure_idle(&store, false).is_err());
        store
            .exec("UPDATE approvals SET status='resolved'", [])
            .unwrap();
        assert!(ensure_idle(&store, false).is_ok());
    }
}
