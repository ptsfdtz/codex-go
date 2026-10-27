//! Select an official fallback before loading user threads. Existing installations
//! and the authoritative Codex home are never copied or modified by the installer.
use crate::{ensure, paths, service, Error, Result};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
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
fn package() -> Package {
    serde_json::from_str(include_str!(
        "../../../../scripts/codex/compatible-windows.json"
    ))
    .expect("bundled runtime manifest")
}
fn hash(path: &Path) -> Result<String> {
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
        .join(package().version))
}
fn verify(directory: &Path) -> Result<PathBuf> {
    for file in package().files {
        ensure(
            hash(&directory.join(file.path))? == file.sha256,
            "RUNTIME_INTEGRITY_ERROR",
            "官方兼容运行时文件校验失败",
        )?;
    }
    paths::canonical(&directory.join("bin/codex.exe"))
}
pub(super) fn remembered(requested: &Path) -> Result<Option<PathBuf>> {
    let Ok(bytes) = std::fs::read(super::data_dir()?.join("runtime-compatibility.json")) else {
        return Ok(None);
    };
    if bytes.len() > 16384 {
        return Ok(None);
    }
    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
        return Ok(None);
    };
    if value["requestedExecutable"].as_str() != requested.to_str()
        || value["requestedSha256"].as_str() != Some(hash(requested)?.as_str())
        || value["compatibilityVersion"] != package().version
    {
        return Ok(None);
    }
    // Paths and digests from the record cannot override the compiled manifest.
    // Resolution is also used by local status/attach commands. Verify the full
    // package at launch, instead of hashing hundreds of MB on every lookup.
    paths::canonical(&installation()?.join("bin/codex.exe")).map(Some)
}
pub(super) fn available() -> Result<PathBuf> {
    paths::canonical(&installation()?.join("bin/codex.exe"))
}

pub async fn resolve(requested: Result<PathBuf>, probe_runtime: &Path) -> Result<(PathBuf, Value)> {
    match requested {
        Ok(executable) => select(executable, probe_runtime).await,
        Err(error)
            if ["CODEX_CLI_NOT_FOUND", "UPSTREAM_VERSION_UNSUPPORTED"]
                .contains(&error.code.as_str()) =>
        {
            select(install().await?, probe_runtime).await
        }
        Err(error) => Err(error),
    }
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
    .map_err(|_| Error::new("IO_ERROR", "Cannot lock compatible runtime installation"))??;
    if destination.exists() {
        return verify(&destination);
    }
    let manifest = package();
    let staging = tempfile::Builder::new()
        .prefix(".install-")
        .tempdir_in(parent)?;
    let archive = staging.path().join("official.tgz");
    super::log(
        "RUNTIME_COMPATIBILITY_INSTALL",
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
                "Cannot create runtime download client",
            )
        })?
        .get(&manifest.url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|_| {
            Error::new(
                "RUNTIME_DOWNLOAD_FAILED",
                "官方兼容运行时下载失败；保留原安装，请检查网络后重试",
            )
        })?;
    let mut file = std::fs::File::create(&archive)?;
    let mut digest = Sha512::new();
    let mut size = 0usize;
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        Error::new(
            "RUNTIME_DOWNLOAD_FAILED",
            "官方兼容运行时下载中断；保留原安装",
        )
    })? {
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
        "官方兼容运行时下载校验失败；未执行或安装",
    )?;
    let system_root = std::env::var_os("SystemRoot")
        .ok_or_else(|| Error::new("CONFIG_ERROR", "SystemRoot is unavailable"))?;
    let mut command =
        tokio::process::Command::new(PathBuf::from(system_root).join("System32/tar.exe"));
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
    use std::os::windows::process::CommandExt;
    command.as_std_mut().creation_flags(0x08000000);
    let status = tokio::time::timeout(Duration::from_secs(120), command.status())
        .await
        .map_err(|_| Error::new("UPSTREAM_TIMEOUT", "Runtime extraction timed out"))??;
    ensure(
        status.success(),
        "RUNTIME_INSTALL_FAILED",
        "无法解压已验证的官方兼容运行时",
    )?;
    let extracted = staging.path().join(&manifest.archive_root);
    verify(&extracted)?;
    std::fs::rename(extracted, &destination)?;
    verify(&destination)
}
pub async fn select(requested: PathBuf, probe_runtime: &Path) -> Result<(PathBuf, Value)> {
    let requested = paths::canonical(&requested)?;
    let selected = remembered(&requested)?.unwrap_or_else(|| requested.clone());
    let installed_binary = installation()?.join("bin/codex.exe");
    if installed_binary.is_file() && paths::equal(&selected, &paths::canonical(&installed_binary)?)
    {
        verify(&installation()?)?;
    }
    let initial = async {
        crate::codex::executable_version(&selected)?;
        service::boundary_runtime(&selected, probe_runtime).await
    }
    .await;
    match initial {
        Ok(report) => {
            ensure(
                report["passed"] == true,
                "SANDBOX_UNVERIFIED",
                "当前 Codex 未通过隔离检查；未启动用户任务",
            )?;
            return Ok((selected, report));
        }
        Err(error)
            if [
                "UPSTREAM_SANDBOX_HELPER_INCOMPATIBLE",
                "UPSTREAM_FEATURE_UNSUPPORTED",
                "UPSTREAM_VERSION_UNSUPPORTED",
            ]
            .contains(&error.code.as_str()) =>
        {
            super::log(
                "RUNTIME_COMPATIBILITY_FALLBACK",
                &format!(
                    "Selected Codex is incompatible ({}); using a verified official runtime",
                    error.code
                ),
            );
        }
        Err(error) => return Err(error),
    }
    let compatible = install().await?;
    let report = service::boundary_runtime(&compatible, probe_runtime).await?;
    ensure(
        report["passed"] == true,
        "SANDBOX_UNVERIFIED",
        "官方兼容运行时未通过隔离检查；未启动用户任务",
    )?;
    let directory = super::data_dir()?;
    let mut record = tempfile::NamedTempFile::new_in(&directory)?;
    record.write_all(json!({"requestedExecutable":requested,"requestedSha256":hash(&requested)?,"compatibilityVersion":package().version}).to_string().as_bytes())?;
    record
        .persist(directory.join("runtime-compatibility.json"))
        .map_err(|_| Error::new("IO_ERROR", "Cannot save compatible runtime selection"))?;
    Ok((compatible, report))
}
