//! Explicit updates use the bundled, reviewed installer; never execute a remote script.
use crate::i18n::{message, text};
use std::{path::PathBuf, process::Command, time::Duration};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
pub const DEFAULT_ORIGIN: &str = "https://agent.ptsfdtz.top";

fn candidate_version() -> Result<Option<String>> {
    let path = super::data_dir()?.join("update-candidate.txt");
    match std::fs::read_to_string(path) {
        Ok(value) if value.len() <= 80 && semver::Version::parse(value.trim()).is_ok() => {
            Ok(Some(value.trim().into()))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        _ => Err("Invalid locally selected update candidate".into()),
    }
}
/// Local-only candidate selection. Remote clients cannot change this channel.
pub fn configure_channel(channel: &str, version: Option<&str>) -> Result<()> {
    use std::io::Write;
    let directory = super::data_dir()?;
    crate::security::restrict_directory(&directory)?;
    let path = directory.join("update-candidate.txt");
    if channel == "stable" && version.is_none() {
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    } else if channel == "candidate"
        && version.is_some_and(|v| valid_version(v) && semver::Version::parse(v).is_ok())
    {
        let mut file = tempfile::NamedTempFile::new_in(directory)?;
        file.write_all(version.unwrap().as_bytes())?;
        file.persist(path)?;
    } else {
        return Err("Use update-channel stable or update-channel candidate X.Y.Z".into());
    }
    println!("{}", message("Update channel: {channel}. Refresh the Web update check; running jobs keep their pinned version.", &[("channel", channel.to_string())]));
    Ok(())
}
async fn selected_version(
    client: &reqwest::Client,
    origin: &str,
    pinned: Option<&str>,
) -> Result<String> {
    if let Some(version) = pinned.map(str::to_owned).or(candidate_version()?) {
        if !valid_version(&version) {
            return Err("Invalid release version".into());
        }
        return Ok(version);
    }
    let mut response = client
        .get(format!("{origin}/releases/stable.txt"))
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
    let version = String::from_utf8(bytes)?.trim().to_owned();
    if !valid_version(&version) {
        return Err("Invalid release version".into());
    }
    Ok(version)
}

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
    let selected = selected_version(&client, DEFAULT_ORIGIN, None).await?;
    let latest = selected.trim();
    let notes = release_notes(&client, latest).await;
    Ok(
        serde_json::json!({"current":current,"latest":latest,"channel":if candidate_version()?.is_some() {"candidate"} else {"stable"},"notes":notes,"platform":std::env::consts::OS,
        "installation":if versioned && current.as_deref().is_some_and(|v| !v.starts_with("local-")) {"release"} else {"development"},
        "updateAvailable":versioned && current.as_deref().is_some_and(|v| newer_release(v, latest))}),
    )
}
async fn release_notes(client: &reqwest::Client, version: &str) -> Option<String> {
    let mut response = client
        .get(format!("{DEFAULT_ORIGIN}/releases/{version}/notes.txt"))
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if bytes.len() + chunk.len() > 16384 {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).ok()
}

fn newer_release(current: &str, latest: &str) -> bool {
    if current == latest {
        return false;
    }
    if current.starts_with("local-") || latest.starts_with("local-") {
        return false;
    }
    if let (Ok(current), Ok(latest)) = (
        semver::Version::parse(current),
        semver::Version::parse(latest),
    ) {
        return latest > current;
    }
    fn commit_release(value: &str) -> bool {
        value.strip_prefix("host-").is_some_and(|commit| {
            commit.len() == 40 && commit.bytes().all(|b| b.is_ascii_hexdigit())
        })
    }
    fn dated(value: &str) -> Option<(u32, u32)> {
        let value = value
            .strip_prefix("release-")
            .or_else(|| value.strip_prefix("host-"))?;
        let (date, sequence) = value.split_once('-')?;
        (date.len() == 8 && date.bytes().all(|c| c.is_ascii_digit()))
            .then(|| Some((date.parse().ok()?, sequence.parse().ok()?)))?
    }
    if commit_release(latest) {
        // Hashes have no chronological ordering. The HTTPS stable pointer is
        // authoritative for a recognized release installation, including rollback.
        return commit_release(current)
            || dated(current).is_some()
            || semver::Version::parse(current).is_ok();
    }
    if commit_release(current) && dated(latest).is_some() {
        return true;
    }
    if (commit_release(current) || dated(current).is_some())
        && semver::Version::parse(latest).is_ok()
    {
        return true;
    }
    matches!((dated(current), dated(latest)), (Some(current), Some(latest)) if latest > current)
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
    run_internal(check, override_origin, None).await
}
pub(super) async fn run_pinned(version: &str) -> Result<()> {
    run_internal(false, Some(DEFAULT_ORIGIN.into()), Some(version)).await
}
async fn run_internal(
    check: bool,
    override_origin: Option<String>,
    expected: Option<&str>,
) -> Result<()> {
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
    let selected = selected_version(&client, &origin, expected).await?;
    let version = selected.trim();
    let current = std::fs::read_to_string(directory.join("release.txt"))
        .unwrap_or_else(|_| text("unknown (legacy/development build)"));
    println!(
        "{}",
        message(
            "Installed: {}\nTarget: {version}\nSource: {origin}",
            &[
                ("0", current.trim().to_string()),
                ("version", version.to_string()),
                ("origin", origin.to_string())
            ]
        )
    );
    if current.trim() == version {
        println!("{}", message("Already up to date.", &[]));
        return Ok(());
    }
    if !newer_release(current.trim(), version) {
        println!("{}", message("Cannot migrate this release format automatically. Use the official installer to upgrade. Local/custom builds are not replaced automatically.", &[]));
        return Ok(());
    }
    if check {
        println!(
            "{}",
            message(
                "Run agentdeck update to install; restart explicitly when tasks are idle.",
                &[]
            )
        );
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
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
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
    command.env("AGENTDECK_DATA_DIR", super::data_dir()?);
    let success = if expected.is_some() {
        let output = command.output()?;
        if !output.status.success() {
            super::log(
                "UPDATE_INSTALLER_FAILED",
                &format!(
                    "{}\n{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                ),
            );
        }
        output.status.success()
    } else {
        command.status()?.success()
    };
    if !success {
        return Err("Update installer failed; inspect the output above".into());
    }
    println!("{}", message("Update installed. Running tasks keep their current Host. Run agentdeck restart when idle.", &[]));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::newer_release;

    #[test]
    fn update_check_never_downgrades_or_replaces_local_builds() {
        assert!(!newer_release(
            "local-20261026-shared",
            "release-20261025-2"
        ));
        assert!(!newer_release("release-20261026-1", "release-20261025-2"));
        assert!(!newer_release("0.4.0", "0.3.0"));
        assert!(!newer_release("custom", "release-20261025-2"));
        assert!(!newer_release("release-20261025-2", "release-20261025-2"));
        assert!(newer_release("release-20261025-2", "release-20261026-1"));
        assert!(newer_release("host-20261025-1", "release-20261025-2"));
        assert!(newer_release("0.3.0", "0.4.0"));
    }

    #[test]
    fn stable_commit_pointer_supports_migration_updates_and_rollback() {
        let older = "host-c278b86fe50bb54c04432930ea5b037fbbcccd91";
        let newer = "host-b9817e05cbca6a3058efd4c698ffec0828fb1da3";
        assert!(newer_release("release-20261026-1", newer));
        assert!(newer_release("0.3.0", newer));
        assert!(newer_release(older, newer));
        assert!(newer_release(newer, older));
        assert!(newer_release(newer, "release-20261027-2"));
        assert!(newer_release(newer, "0.4.0"));
        assert!(newer_release("release-20261027-2", "0.4.0"));
        assert!(!newer_release(newer, newer));
        for custom in [
            "local-20261027",
            "custom",
            "unknown (legacy/development build)",
            "host-xyz",
        ] {
            assert!(!newer_release(custom, newer));
        }
    }
}
