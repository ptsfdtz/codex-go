//! Local host lifecycle. Shared by the CLI and daemon; independent of a GUI.
pub mod autostart;
pub mod codex_client;
pub mod desktop_client;
mod process;
#[cfg(windows)]
pub mod runtime_compatibility;
pub mod shared_runtime;
pub mod update_job;
pub mod updates;
#[cfg(windows)]
mod windows;
pub use process::{background, running, stop, supervise};
#[cfg(windows)]
use windows::command as windows_command;

use crate::{security, Error, Result};
use serde::{Deserialize, Serialize};
use std::{io::Write, path::PathBuf, process::Command};

pub fn data_dir() -> Result<PathBuf> {
    let directory = std::env::var_os("AGENTDECK_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            if cfg!(windows) {
                std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("AgentDeck"))
            } else {
                std::env::var_os("XDG_STATE_HOME")
                    .map(|p| PathBuf::from(p).join("agentdeck"))
                    .or_else(|| {
                        std::env::var_os("HOME")
                            .map(|p| PathBuf::from(p).join(".local/state/agentdeck"))
                    })
            }
        })
        .ok_or_else(|| {
            Error::new(
                "CONFIG_ERROR",
                "Cannot locate the current user's state directory",
            )
        })?;
    // Resolve an existing MSIX-redirected database before a detached process opens it.
    if directory.join("agentdeck.db").is_file() {
        let database = dunce::canonicalize(directory.join("agentdeck.db"))?;
        return Ok(database.parent().unwrap().to_path_buf());
    }
    Ok(if directory.is_absolute() {
        directory
    } else {
        std::env::current_dir()?.join(directory)
    })
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub runtime_ws: Option<String>,
    pub runtime_token_file: Option<PathBuf>,
    pub protocol: Option<String>,
    #[serde(default)]
    pub sandbox_verified: bool,
    pub codex_exe: Option<PathBuf>,
}
impl Config {
    /// Match service configuration precedence for local terminal/diagnostic use.
    pub fn codex_executable(&self) -> Result<PathBuf> {
        let requested = self.requested_codex_executable()?;
        #[cfg(windows)]
        if let Some(compatible) = runtime_compatibility::remembered(&requested)? {
            return Ok(compatible);
        }
        Ok(requested)
    }
    fn requested_codex_executable(&self) -> Result<PathBuf> {
        if std::env::var_os("AGENTDECK_CODEX_EXE").is_none() {
            if let Some(executable) = &self.codex_exe {
                return crate::paths::canonical(executable);
            }
            if let Some(executable) = shared_runtime::active_executable(&self.runtime_target()?)? {
                return Ok(executable);
            }
        }
        let found = crate::codex::find();
        #[cfg(windows)]
        if found
            .as_ref()
            .is_err_and(|e| e.code == "CODEX_CLI_NOT_FOUND")
        {
            if let Ok(compatible) = runtime_compatibility::available() {
                return Ok(compatible);
            }
        }
        found
    }
    /// The CLI client and service resolve the same explicit attachment. An absent
    /// attachment must never silently launch an independent conversation runtime.
    pub fn runtime_target(&self) -> Result<crate::runtime::RuntimeTarget> {
        crate::runtime::RuntimeTarget::from_versioned_options(
            std::env::var_os("AGENTDECK_RUNTIME_WS_URL")
                .or_else(|| self.runtime_ws.as_ref().map(Into::into)),
            std::env::var_os("AGENTDECK_RUNTIME_TOKEN_FILE").or_else(|| {
                self.runtime_token_file
                    .as_ref()
                    .map(|p| p.as_os_str().to_owned())
            }),
            std::env::var_os("AGENTDECK_RUNTIME_PROTOCOL_VERSION")
                .or_else(|| self.protocol.as_ref().map(Into::into)),
        )
    }
    pub fn load() -> Result<Self> {
        let path = data_dir()?.join("host.json");
        match std::fs::read(path) {
            Ok(bytes) if bytes.len() <= 16384 => serde_json::from_slice(&bytes)
                .map_err(|_| Error::new("CONFIG_ERROR", "Invalid host.json")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            _ => Err(Error::new("CONFIG_ERROR", "Cannot read host.json")),
        }
    }
    pub fn save(&self) -> Result<()> {
        crate::runtime::RuntimeTarget::from_versioned_options(
            self.runtime_ws.clone().map(Into::into),
            self.runtime_token_file.clone().map(Into::into),
            self.protocol.clone().map(Into::into),
        )?;
        let directory = data_dir()?;
        security::restrict_directory(&directory)?;
        let mut file = tempfile::NamedTempFile::new_in(&directory)?;
        file.write_all(
            &serde_json::to_vec_pretty(self)
                .map_err(|_| Error::new("CONFIG_ERROR", "Cannot encode host settings"))?,
        )?;
        file.persist(directory.join("host.json"))
            .map_err(|_| Error::new("IO_ERROR", "Cannot save host settings"))?;
        Ok(())
    }
    pub fn apply(&self, command: &mut Command) {
        for (name, value) in [
            ("AGENTDECK_RUNTIME_WS_URL", self.runtime_ws.as_deref()),
            (
                "AGENTDECK_RUNTIME_PROTOCOL_VERSION",
                self.protocol.as_deref(),
            ),
        ] {
            if std::env::var_os(name).is_none() {
                if let Some(value) = value {
                    command.env(name, value);
                }
            }
        }
        if std::env::var_os("AGENTDECK_RUNTIME_TOKEN_FILE").is_none() {
            if let Some(path) = &self.runtime_token_file {
                command.env("AGENTDECK_RUNTIME_TOKEN_FILE", path);
            }
        }
        if std::env::var_os("AGENTDECK_CODEX_EXE").is_none() {
            if let Some(path) = &self.codex_exe {
                // Earlier configure versions persisted std::fs::canonicalize's
                // Windows verbatim prefix. Restore a regular local path before
                // the child's explicit executable admission check.
                command.env("AGENTDECK_CODEX_EXE", dunce::simplified(path));
            }
        }
        if self.sandbox_verified && std::env::var_os("AGENTDECK_LINUX_SANDBOX_VERIFIED").is_none() {
            command.env("AGENTDECK_LINUX_SANDBOX_VERIFIED", "1");
        }
    }
}

pub fn service_command() -> Result<Command> {
    let binary = std::env::var_os("AGENTDECK_SERVICE_BIN")
        .map(PathBuf::from)
        .unwrap_or(
            std::env::current_exe()?
                .parent()
                .unwrap()
                .join(if cfg!(windows) {
                    "agentdeck-service.exe"
                } else {
                    "agentdeck-service"
                }),
        );
    let mut command = Command::new(binary);
    command.env("AGENTDECK_DATA_DIR", data_dir()?);
    Config::load()?.apply(&mut command);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    Ok(command)
}

/// Only diagnostics go to disk, never the daemon's state or conversation events.
pub fn log(code: &str, message: &str) {
    let _ = (|| -> Result<()> {
        let directory = data_dir()?;
        security::restrict_directory(&directory)?;
        let path = directory.join("host.log");
        if std::fs::metadata(&path).is_ok_and(|m| m.len() > 1024 * 1024) {
            let _ = std::fs::remove_file(directory.join("host.log.1"));
            std::fs::rename(&path, directory.join("host.log.1"))?;
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        }
        let message: String = crate::redact(message).chars().take(2048).collect();
        writeln!(
            file,
            "{}",
            serde_json::json!({"at":crate::now(),"code":code,"message":message})
        )?;
        Ok(())
    })();
}
