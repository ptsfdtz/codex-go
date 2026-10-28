//! Only byte-for-byte official precompiled packages may execute. Versions alone
//! are not proof of origin; an unknown binary is never run, even for --version.
use crate::{ensure, paths, service, Error, Result};
use base64::Engine;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256, Sha512};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Package {
    version: String,
    url: String,
    integrity: String,
    archive_root: String,
    files: Vec<PackageFile>,
}
#[derive(Deserialize)]
struct PackageFile {
    path: String,
    sha256: String,
}
fn package() -> Result<Package> {
    let manifest = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => include_str!("../../../../scripts/codex/compatible-windows.json"),
        ("linux", "x86_64") => include_str!("../../../../scripts/codex/compatible-linux-x64.json"),
        ("linux", "aarch64") => {
            include_str!("../../../../scripts/codex/compatible-linux-arm64.json")
        }
        ("macos", "aarch64") => {
            include_str!("../../../../scripts/codex/compatible-darwin-arm64.json")
        }
        _ => {
            return Err(Error::new(
                "UNSUPPORTED_PLATFORM",
                "此平台尚无经过校验的官方 Codex 运行时",
            ))
        }
    };
    serde_json::from_str(manifest).map_err(|_| {
        Error::new(
            "RUNTIME_MANIFEST_INVALID",
            "Invalid bundled official runtime manifest",
        )
    })
}
fn binary() -> &'static str {
    if cfg!(windows) {
        "bin/codex.exe"
    } else {
        "bin/codex"
    }
}
fn hash(path: &Path) -> Result<String> {
    ensure(
        !std::fs::symlink_metadata(path)?.file_type().is_symlink(),
        "RUNTIME_INTEGRITY_ERROR",
        "Official package files must not be symbolic links",
    )?;
    let mut file = std::fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}
fn installation() -> Result<PathBuf> {
    Ok(super::data_dir()?
        .join("compatible-codex")
        .join(package()?.version))
}
fn verify(directory: &Path) -> Result<PathBuf> {
    for file in package()?.files {
        ensure(
            hash(&directory.join(file.path))? == file.sha256,
            "RUNTIME_INTEGRITY_ERROR",
            "官方 Codex 文件校验失败；不会执行或降级为自编译版本",
        )?;
    }
    paths::canonical(&directory.join(binary()))
}
/// Check origin before executing even --help or --version. Full helper checks
/// remain mandatory at startup through verify_official.
pub fn verify_entry(executable: &Path) -> Result<()> {
    let expected = package()?
        .files
        .into_iter()
        .find(|file| file.path == binary())
        .ok_or_else(|| Error::new("RUNTIME_MANIFEST_INVALID", "Official entry missing"))?;
    ensure(
        hash(executable)? == expected.sha256,
        "RUNTIME_NOT_OFFICIAL",
        "只允许运行已核验的官方预编译 Codex；自编译或未知程序不会执行",
    )
}
/// Validate the complete package, including sandbox and code-mode helpers.
pub fn verify_official(executable: &Path) -> Result<PathBuf> {
    let executable = paths::canonical(executable)?;
    let directory = executable.parent().and_then(Path::parent).ok_or_else(|| {
        Error::new(
            "RUNTIME_INTEGRITY_ERROR",
            "Official runtime package layout required",
        )
    })?;
    let verified = verify(directory)?;
    ensure(
        paths::equal(&verified, &executable),
        "RUNTIME_INTEGRITY_ERROR",
        "Official runtime entry point differs",
    )?;
    Ok(verified)
}
pub fn origin(executable: &Path) -> Result<Value> {
    verify_entry(executable)?;
    let manifest = package()?;
    Ok(
        serde_json::json!({"version":manifest.version,"url":manifest.url,"integrity":manifest.integrity,"executableSha256":hash(executable)?}),
    )
}
pub(super) fn available() -> Result<PathBuf> {
    paths::canonical(&installation()?.join(binary()))
}
pub(super) fn remembered(_requested: &Path) -> Result<Option<PathBuf>> {
    // No path or digest from an old compatibility record can authorize a binary.
    Ok(available().ok())
}
/// Resolve without executing an untrusted candidate. Installed packages are
/// checked on every launch; a damaged managed installation fails closed.
pub async fn official(requested: Result<PathBuf>) -> Result<PathBuf> {
    if let Ok(executable) = requested {
        if let Ok(verified) = verify_official(&executable) {
            return Ok(verified);
        }
    }
    install().await
}
pub async fn resolve(requested: Result<PathBuf>, probe_runtime: &Path) -> Result<(PathBuf, Value)> {
    let executable = official(requested).await?;
    let report = service::boundary_runtime(&executable, probe_runtime).await?;
    ensure(
        report["passed"] == true,
        "SANDBOX_UNVERIFIED",
        "官方 Codex 未通过真实隔离检查；未启动用户任务",
    )?;
    Ok((executable, report))
}
pub async fn select(requested: PathBuf, probe_runtime: &Path) -> Result<(PathBuf, Value)> {
    resolve(Ok(requested), probe_runtime).await
}
async fn install() -> Result<PathBuf> {
    let destination = installation()?;
    let parent = destination.parent().unwrap();
    crate::security::restrict_directory(parent)?;
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(parent.join("install.lock"))?;
    let _lock = tokio::task::spawn_blocking(move || {
        fs2::FileExt::lock_exclusive(&lock)?;
        Ok::<_, std::io::Error>(lock)
    })
    .await
    .map_err(|_| Error::new("IO_ERROR", "Cannot lock official runtime installation"))??;
    if destination.exists() {
        return verify(&destination);
    }
    let manifest = package()?;
    let staging = tempfile::Builder::new()
        .prefix(".install-")
        .tempdir_in(parent)?;
    let archive = staging.path().join("official.tgz");
    super::log(
        "RUNTIME_OFFICIAL_INSTALL",
        &format!("Installing verified official Codex {}", manifest.version),
    );
    let mut response = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(900))
        .build()
        .map_err(|_| {
            Error::new(
                "RUNTIME_DOWNLOAD_FAILED",
                "Cannot create official runtime download client",
            )
        })?
        .get(&manifest.url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|_| {
            Error::new(
                "RUNTIME_DOWNLOAD_FAILED",
                "官方 Codex 下载失败；保留原安装，请检查网络后重试",
            )
        })?;
    let mut file = std::fs::File::create(&archive)?;
    let mut digest = Sha512::new();
    let mut size = 0usize;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| Error::new("RUNTIME_DOWNLOAD_FAILED", "官方 Codex 下载中断；保留原安装"))?
    {
        size += chunk.len();
        ensure(
            size <= 256 * 1024 * 1024,
            "RUNTIME_INTEGRITY_ERROR",
            "Runtime archive exceeds size limit",
        )?;
        digest.update(&chunk);
        file.write_all(&chunk)?;
    }
    drop(file);
    ensure(
        format!(
            "sha512-{}",
            base64::engine::general_purpose::STANDARD.encode(digest.finalize())
        ) == manifest.integrity,
        "RUNTIME_INTEGRITY_ERROR",
        "官方 Codex 下载校验失败；未执行或安装",
    )?;
    #[cfg(windows)]
    let tar = PathBuf::from(
        std::env::var_os("SystemRoot")
            .ok_or_else(|| Error::new("CONFIG_ERROR", "SystemRoot is unavailable"))?,
    )
    .join("System32/tar.exe");
    #[cfg(not(windows))]
    let tar = PathBuf::from("/usr/bin/tar");
    let mut command = tokio::process::Command::new(tar);
    command
        .arg("-xzf")
        .arg(&archive)
        .arg("-C")
        .arg(staging.path())
        .arg(&manifest.archive_root)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.as_std_mut().creation_flags(0x08000000);
    }
    let status = tokio::time::timeout(Duration::from_secs(120), command.status())
        .await
        .map_err(|_| Error::new("UPSTREAM_TIMEOUT", "Runtime extraction timed out"))??;
    ensure(
        status.success(),
        "RUNTIME_INSTALL_FAILED",
        "无法解压已验证的官方 Codex 包",
    )?;
    let extracted = staging.path().join(&manifest.archive_root);
    verify(&extracted)?;
    std::fs::rename(extracted, &destination)?;
    verify(&destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn rejects_a_custom_binary_without_executing_it() {
        let directory = tempfile::tempdir().unwrap();
        let bin = directory.path().join("bin");
        std::fs::create_dir(&bin).unwrap();
        let exe = bin.join(if cfg!(windows) { "codex.exe" } else { "codex" });
        let marker = directory.path().join("executed");
        std::fs::write(
            &exe,
            format!(
                "#!/bin/sh\ntouch '{}'\necho codex-cli 0.166.0-alpha.1\n",
                marker.display()
            ),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        assert!(verify_official(&exe).is_err());
        assert_eq!(
            crate::codex::executable_version(&exe).unwrap_err().code,
            "RUNTIME_NOT_OFFICIAL"
        );
        assert!(!marker.exists());
    }
    #[test]
    fn all_manifests_bind_official_packages_and_helpers() {
        for source in [
            include_str!("../../../../scripts/codex/compatible-windows.json"),
            include_str!("../../../../scripts/codex/compatible-linux-x64.json"),
            include_str!("../../../../scripts/codex/compatible-linux-arm64.json"),
            include_str!("../../../../scripts/codex/compatible-darwin-arm64.json"),
        ] {
            let manifest: Package = serde_json::from_str(source).unwrap();
            assert!(manifest
                .url
                .starts_with("https://registry.npmjs.org/@openai/codex/-/"));
            assert!(manifest.integrity.starts_with("sha512-"));
            assert!(manifest.files.len() > 30);
            assert!(manifest
                .files
                .iter()
                .any(|f| f.path.contains("code-mode-host")));
            assert!(manifest.files.iter().all(|f| f.sha256.len() == 64
                && !f.path.contains("..")
                && !f.path.starts_with('/')));
        }
    }
}
