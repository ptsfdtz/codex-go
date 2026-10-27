use super::{data_dir, log, service_command};
use crate::{ensure, management, security, Error, Result};
use fs2::FileExt;
use serde_json::json;
#[cfg(not(windows))]
use std::process::Command;
use std::{
    fs::File,
    process::Stdio,
    time::{Duration, Instant},
};

fn lock(name: &str) -> Result<File> {
    let directory = data_dir()?;
    security::restrict_directory(&directory)?;
    Ok(std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join(name))?)
}
pub fn running() -> Result<bool> {
    let file = lock("host.lock")?;
    Ok(file.try_lock_exclusive().is_err())
}
pub fn background() -> Result<()> {
    if running()? {
        return Ok(());
    }
    #[cfg(windows)]
    spawn_detached_windows()?;
    #[cfg(unix)]
    let mut child = {
        use std::os::unix::process::CommandExt;
        let mut command = Command::new(std::env::current_exe()?);
        command
            .arg("host-run")
            .env("AGENTDECK_DATA_DIR", data_dir()?)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        // A new process group survives the invoking terminal and its signals.
        command.process_group(0);
        command.spawn()?
    };
    let until = Instant::now() + Duration::from_secs(10);
    while Instant::now() < until {
        if running()? {
            return Ok(());
        }
        #[cfg(unix)]
        if child.try_wait()?.is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Err(Error::new(
        "HOST_START_FAILED",
        "Host did not start; use agentdeck logs / doctor",
    ))
}

#[cfg(windows)]
fn spawn_detached_windows() -> Result<()> {
    let directory = data_dir()?;
    super::windows::spawn_detached(
        &service_command()?,
        &[
            std::ffi::OsStr::new("--host-supervisor"),
            std::ffi::OsStr::new("--data-dir"),
            directory.as_os_str(),
        ],
    )?;
    Ok(())
}

pub async fn stop() -> Result<()> {
    let directory = data_dir()?;
    let managed = running()?;
    if managed {
        std::fs::write(directory.join("host.stop"), b"stop")?;
    }
    let result = management::call(&directory, json!({"action":"stop"})).await;
    if !managed && result.is_err() {
        let file = lock("native-service.lock")?;
        ensure(
            file.try_lock_exclusive().is_ok(),
            "HOST_UNREACHABLE",
            "Service is running but its control endpoint is unavailable",
        )?;
    }
    let until = Instant::now() + Duration::from_secs(20);
    let service_running =
        || -> Result<bool> { Ok(lock("native-service.lock")?.try_lock_exclusive().is_err()) };
    while (running()? || service_running()?) && Instant::now() < until {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    ensure(
        !running()? && !service_running()?,
        "HOST_STOP_TIMEOUT",
        "Host is stopping; inspect status before retrying",
    )
}

pub async fn supervise() -> Result<()> {
    let file = lock("host.lock")?;
    if file.try_lock_exclusive().is_err() {
        return Ok(());
    }
    // Refuse to take over an existing GUI/foreground daemon using the same state.
    let service_lock = lock("native-service.lock")?;
    ensure(
        service_lock.try_lock_exclusive().is_ok(),
        "CONFLICT",
        "An existing AgentDeck service owns this identity; stop it first",
    )?;
    drop(service_lock);
    let directory = data_dir()?;
    let stop_file = directory.join("host.stop");
    let _ = std::fs::remove_file(&stop_file);
    log("HOST_STARTED", "Background supervisor started");
    let mut failures = 0u32;
    loop {
        if stop_file.exists() {
            break;
        }
        let mut command = service_command()?;
        command
            .env("AGENTDECK_HEADLESS", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let started = Instant::now();
        let mut child = command.spawn()?;
        #[cfg(windows)]
        let _job = match Job::assign(&child) {
            Ok(job) => job,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        let status = loop {
            if let Some(status) = child.try_wait()? {
                break status;
            }
            if stop_file.exists() {
                let _ = management::call(&directory, json!({"action":"stop"})).await;
                let until = Instant::now() + Duration::from_secs(10);
                while child.try_wait()?.is_none() && Instant::now() < until {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                if child.try_wait()?.is_none() {
                    let _ = child.kill();
                }
                child.wait()?;
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        };
        if status.success() || stop_file.exists() {
            break;
        }
        failures = if started.elapsed() > Duration::from_secs(60) {
            1
        } else {
            failures + 1
        };
        log(
            "SERVICE_EXITED",
            &format!("Service exited ({status}); restart attempt {failures}"),
        );
        if failures >= 5 {
            return Err(Error::new(
                "HOST_RESTART_LIMIT",
                "Service failed repeatedly; inspect agentdeck logs before restarting",
            ));
        }
        for _ in 0..(1u64 << failures.min(5)) * 5 {
            if stop_file.exists() {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }
    log("HOST_STOPPED", "Host stopped by operator");
    Ok(())
}

#[cfg(windows)]
pub(super) struct Job(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl Job {
    pub(super) fn assign(child: &std::process::Child) -> Result<Self> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::{Foundation::CloseHandle, System::JobObjects::*};
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            ensure(
                !handle.is_null(),
                "HOST_JOB_FAILED",
                "Cannot create process supervision job",
            )?;
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(handle, child.as_raw_handle()) == 0
            {
                CloseHandle(handle);
                return Err(Error::new(
                    "HOST_JOB_FAILED",
                    "Cannot supervise service process tree",
                ));
            }
            Ok(Self(handle))
        }
    }
}
#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
