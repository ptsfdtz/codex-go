//! Explicit updates use the bundled, reviewed installer; never execute a remote script.
use std::{path::PathBuf, process::Command, time::Duration};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
pub const DEFAULT_ORIGIN: &str = "https://agent.ptsfdtz.top";

/// Read-only, bounded release check. Remote clients cannot choose a URL or execute an installer.
pub async fn status() -> Result<serde_json::Value> {
    let executable = dunce::canonicalize(std::env::current_exe()?)?;
    let directory = executable.parent().ok_or("Cannot locate installation")?;
    let current = std::fs::read_to_string(directory.join("release.txt"))
        .ok()
        .map(|v| v.trim().to_owned())
        .filter(|v| valid_version(v));
    let versioned = directory
        .parent()
        .is_some_and(|p| p.file_name().is_some_and(|n| n == "versions"));
    let client = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()?;
    let mut response = client
        .get(format!("{DEFAULT_ORIGIN}/releases/stable.txt"))
        .header("Cache-Control", "no-cache")
        .send()
        .await?
        .error_for_status()?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > 128 {
            return Err("Invalid release pointer".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let latest = std::str::from_utf8(&bytes)?.trim();
    if !valid_version(latest) {
        return Err("Invalid release version".into());
    }
    Ok(
        serde_json::json!({"current":current,"latest":latest,"platform":std::env::consts::OS,
        "installation":if versioned {"release"} else {"development"},
        "updateAvailable":versioned && current.as_deref().is_some_and(|v| v != latest)}),
    )
}

pub fn valid_version(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && !value.contains("..")
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
}

pub fn origin(value: &str) -> Result<String> {
    let url = reqwest::Url::parse(value)?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Update origin must be HTTPS without a path or credentials".into());
    }
    Ok(value.trim_end_matches('/').to_owned())
}

pub async fn run(check: bool, override_origin: Option<String>) -> Result<()> {
    let executable = dunce::canonicalize(std::env::current_exe()?)?;
    let directory = executable.parent().ok_or("Cannot locate installation")?;
    let origin = origin(
        override_origin
            .or_else(|| std::env::var("AGENTDECK_DOWNLOAD_ORIGIN").ok())
            .or_else(|| std::fs::read_to_string(directory.join("update-origin.txt")).ok())
            .unwrap_or_else(|| DEFAULT_ORIGIN.into())
            .trim(),
    )?;
    let client = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .build()?;
    let response = client
        .get(format!("{origin}/releases/stable.txt"))
        .header("Cache-Control", "no-cache")
        .send()
        .await?
        .error_for_status()?;
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > 128 {
            return Err("Invalid release pointer".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let version = std::str::from_utf8(&bytes)?.trim();
    if !valid_version(version) {
        return Err("Invalid release version".into());
    }
    let current = std::fs::read_to_string(directory.join("release.txt"))
        .unwrap_or_else(|_| "unknown (legacy/development build)".into());
    println!(
        "Installed: {}\nStable: {version}\nSource: {origin}",
        current.trim()
    );
    if current.trim() == version {
        println!("Already up to date.");
        return Ok(());
    }
    if check {
        println!("Run agentdeck update to install; restart explicitly when tasks are idle.");
        return Ok(());
    }
    // Refuse to silently install a second copy when invoked from a development/custom layout.
    let versions = directory
        .parent()
        .filter(|p| p.file_name().is_some_and(|n| n == "versions"))
        .ok_or("This is not a versioned installation; run install.ps1/install.sh first")?;
    let install_dir: PathBuf = versions
        .parent()
        .ok_or("Invalid installation directory")?
        .into();
    let temporary = tempfile::tempdir()?;
    #[cfg(windows)]
    let mut command = {
        let script = temporary.path().join("install.ps1");
        std::fs::write(
            &script,
            include_str!("../../../../scripts/host/install.ps1"),
        )?;
        let mut command = Command::new("powershell.exe");
        // PowerShell 7's inherited module path can hide Windows PowerShell's script modules.
        command.env_remove("PSModulePath");
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(script)
            .arg("-Origin")
            .arg(&origin)
            .arg("-Version")
            .arg(version)
            .arg("-InstallDir")
            .arg(&install_dir)
            .arg("-NoPath");
        command
    };
    #[cfg(not(windows))]
    let mut command = {
        let script = temporary.path().join("install.sh");
        std::fs::write(&script, include_str!("../../../../scripts/host/install.sh"))?;
        let mut command = Command::new("sh");
        command
            .arg(script)
            .env("AGENTDECK_DOWNLOAD_ORIGIN", &origin)
            .env("AGENTDECK_VERSION", version)
            .env("AGENTDECK_INSTALL_DIR", &install_dir);
        command
    };
    if !command.status()?.success() {
        return Err("Update installer failed; inspect the output above".into());
    }
    println!(
        "Update installed. Running tasks keep their current Host. Run agentdeck restart when idle."
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_update_check_cannot_select_url_or_install() {
        use crate::protocol;
        use serde_json::json;
        assert!(protocol::parse(
            json!({"v":1,"type":"request","id":"check","action":"system.updateCheck","payload":{}})
        )
        .is_ok());
        for payload in [
            json!({"origin":"http://127.0.0.1"}),
            json!({"install":true}),
            json!({"command":"restart"}),
        ] {
            assert!(protocol::parse(json!({"v":1,"type":"request","id":"check","action":"system.updateCheck","payload":payload})).is_err());
        }
    }
    #[test]
    fn reject_untrusted_paths_and_origins() {
        for value in ["../x", "a..b", "a/b", "", "-x", "a\nx"] {
            assert!(!valid_version(value));
        }
        assert!(valid_version("host-20261025-2"));
        for value in [
            "http://example.com",
            "https://example.com/x",
            "https://user@example.com",
            "https://example.com/?x",
        ] {
            assert!(origin(value).is_err());
        }
        assert_eq!(
            origin("https://agent.ptsfdtz.top/").unwrap(),
            DEFAULT_ORIGIN
        );
    }
}
