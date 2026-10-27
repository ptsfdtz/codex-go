use crate::{ensure, paths, rpc::Rpc, s, Error, Result};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
// Preserve the public schema-baseline constant independently of admission policy.
pub const VERSION: &str = "0.159.2";
pub const MIN_SUPPORTED_VERSION: &str = VERSION;
pub fn protocol_for_version(version: &str) -> Result<crate::rpc::ProtocolVersion> {
    super::codex_version::profile(version)
}
pub fn executable_version(exe: &Path) -> Result<String> {
    super::codex_version::cli(&sync_command(&exe.to_string_lossy(), &["--version"], None)?)
}
pub fn sync_command(exe: &str, args: &[&str], cwd: Option<&Path>) -> Result<String> {
    let mut cmd = std::process::Command::new(exe);
    cmd.args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd.spawn()?;
    let out = child.stdout.take().unwrap();
    let reader = std::thread::spawn(move || {
        use std::io::Read;
        let mut bytes = vec![];
        out.take(1024 * 1024).read_to_end(&mut bytes).map(|_| bytes)
    });
    let until = std::time::Instant::now() + Duration::from_secs(15);
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if std::time::Instant::now() > until {
            let _ = child.kill();
            let _ = child.wait();
            return Err(Error::new("UPSTREAM_TIMEOUT", "Local process timed out"));
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    ensure(status.success(), "PROCESS_FAILED", "Local process failed")?;
    let bytes = reader
        .join()
        .map_err(|_| Error::new("IO_ERROR", "Output read failed"))??;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
pub fn find() -> Result<PathBuf> {
    if let Some(v) = std::env::var_os("AGENTDECK_CODEX_EXE") {
        let p = PathBuf::from(v);
        paths::valid(&p)?;
        #[cfg(windows)]
        ensure(
            p.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")),
            "CONFIG_ERROR",
            "Native Codex executable required",
        )?;
        return paths::canonical(&p);
    }
    #[cfg(windows)]
    let paths = sync_command("where.exe", &["codex"], None).unwrap_or_default();
    #[cfg(not(windows))]
    let paths = sync_command("which", &["-a", "codex"], None).unwrap_or_default();
    let mut candidates = Vec::new();
    for line in paths.lines() {
        let p = PathBuf::from(line.trim());
        if cfg!(not(windows)) || p.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")) {
            candidates.push(p.clone());
        }
        if let Some(parent) = p.parent() {
            let candidate=parent.join("node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe");
            if candidate.is_file() {
                candidates.push(candidate);
            }
        }
    }
    // Desktop updates use hash directories, not version directory names. Probe
    // the actual native binary and reuse it instead of requiring a private copy.
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        candidates.extend(super::codex_version::desktop_candidates(
            &PathBuf::from(&local_app_data).join("OpenAI/Codex/bin"),
        ));
    }
    if let Some(candidate) = super::codex_version::select_candidate(candidates, executable_version)
    {
        return paths::canonical(&candidate);
    }
    // AgentDeck's older isolated installations remain a last-resort fallback.
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let directory = PathBuf::from(local_app_data).join("AgentDeck/tools/codex-cli");
        for candidate in super::codex_version::installed_candidates(&directory) {
            if verify(&candidate).is_ok() {
                return paths::canonical(&candidate);
            }
        }
    }
    Err(Error::new(
        "CODEX_CLI_NOT_FOUND",
        "找不到 Codex CLI。请安装兼容版本，或执行 agentdeck configure --codex-exe PATH。",
    ))
}
pub fn verify(exe: &Path) -> Result<()> {
    verify_for(exe, crate::rpc::ProtocolVersion::Managed)
}
/// The profile argument is retained for source compatibility. Executable
/// admission uses the common minimum; initialize negotiates the schema adapter.
pub fn verify_for(exe: &Path, _protocol: crate::rpc::ProtocolVersion) -> Result<()> {
    executable_version(exe).map(|_| ())
}
pub fn filtered_path(path: &str) -> String {
    path.split(';')
        .filter(|entry| {
            let p = entry.replace('\\', "/").to_lowercase();
            !((p.contains("/.cache/codex-runtimes/")
                && p.contains("/dependencies/native/powershell"))
                || p.trim_end_matches(['/', '"'])
                    .ends_with("/appdata/local/microsoft/windowsapps")
                || p.contains("/windowsapps/microsoft.powershell"))
        })
        .collect::<Vec<_>>()
        .join(";")
}
pub fn args() -> Vec<String> {
    let mut args: Vec<String> = ["app-server", "--listen", "stdio://"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    #[cfg(windows)]
    args.extend(["-c", "windows.sandbox=\"mxc\""].map(str::to_string));
    // macOS keeps a legacy sandbox_mode even when a permissions profile is
    // active. Override a broader user setting before the managed server starts.
    #[cfg(target_os = "macos")]
    args.extend(["-c", "sandbox_mode=\"workspace-write\""].map(str::to_string));
    args.extend(
        [
            "-c",
            "approval_policy=\"on-request\"",
            "-c",
            "approvals_reviewer=\"user\"",
            "-c",
            "default_permissions=\"agentdeck\"",
            "-c",
            "permissions={agentdeck={extends=\":workspace\",filesystem={\":root\"=\"deny\",\":minimal\"=\"read\",\":tmpdir\"=\"deny\",\":slash_tmp\"=\"deny\"},network={enabled=false}}}",
            "-c",
            "web_search=\"disabled\"",
            "-c",
            "mcp_servers={}",
            "-c",
            "hooks={}",
            "-c",
            "shell_environment_policy.inherit=\"core\"",
        ]
        .map(str::to_string),
    );
    args
}
pub async fn initialize(rpc: &Arc<Rpc>) -> Result<()> {
    initialize_checked(rpc).await
}
pub async fn initialize_attached(rpc: &Arc<Rpc>) -> Result<()> {
    initialize_checked(rpc).await
}
pub fn check_runtime_identity(user_agent: &str) -> Result<()> {
    check_runtime_identity_for(user_agent, crate::rpc::ProtocolVersion::Managed)
}
pub(crate) fn check_runtime_identity_for(
    user_agent: &str,
    _protocol: crate::rpc::ProtocolVersion,
) -> Result<()> {
    super::codex_version::identity(user_agent).map(|_| ())
}
async fn initialize_checked(rpc: &Arc<Rpc>) -> Result<()> {
    let v=rpc.request("initialize",json!({"clientInfo":{"name":"agentdeck","title":"AgentDeck","version":"0.3.0"},"capabilities":{"experimentalApi":true,"requestAttestation":false}})).await?;
    rpc.validate("v1/InitializeResponse", &v)?;
    let version = super::codex_version::identity(s(&v, "userAgent"))?;
    rpc.set_runtime_version(&version)?;
    let source_home = PathBuf::from(s(&v, "codexHome"));
    ensure(
        source_home.is_absolute(),
        "UPSTREAM_PROTOCOL_ERROR",
        "Codex returned a relative state directory",
    )?;
    *rpc.codex_home.lock().unwrap() = Some(source_home);
    rpc.send(json!({"method":"initialized","params":{}}))
}
pub fn check_policy(v: &Value) -> Result<()> {
    let c = &v["config"];
    let profile = &c["permissions"]["agentdeck"];
    let fs = &profile["filesystem"];
    let sandbox_mode = if cfg!(target_os = "macos") {
        c["sandbox_mode"] == "workspace-write"
    } else {
        c["sandbox_mode"].is_null()
    };
    ensure(
        c["default_permissions"] == "agentdeck"
            && sandbox_mode
            && profile["extends"] == ":workspace",
        "UNSAFE_UPSTREAM_CONFIG",
        "Workspace permission profile overridden",
    )?;
    ensure(
        fs[":root"] == "deny"
            && fs[":minimal"] == "read"
            && fs[":tmpdir"] == "deny"
            && fs[":slash_tmp"] == "deny"
            && fs.as_object().is_some_and(|o| {
                o.iter().all(|(k, v)| {
                    [":root", ":minimal", ":tmpdir", ":slash_tmp"].contains(&k.as_str())
                        || (k == "glob_scan_max_depth" && v.is_null())
                })
            }),
        "UNSAFE_UPSTREAM_CONFIG",
        "Filesystem profile broadened",
    )?;
    ensure(
        profile["workspace_roots"]
            .as_object()
            .is_none_or(|o| o.is_empty())
            && profile["network"]["enabled"] == false,
        "UNSAFE_UPSTREAM_CONFIG",
        "Network or roots broadened",
    )?;
    ensure(
        c["mcp_servers"]
            .as_object()
            .is_none_or(|o| o.values().all(|v| v["enabled"] == false))
            && c["hooks"].as_object().is_none_or(|o| {
                o.values()
                    .all(|v| v.is_null() || v.as_array().is_some_and(|a| a.is_empty()))
            }),
        "UNSAFE_UPSTREAM_CONFIG",
        "External MCP or hooks enabled",
    )
}
pub async fn settings(rpc: &Rpc, root: &Path) -> Result<()> {
    let v = rpc
        .request("config/read", json!({"includeLayers":false,"cwd":root}))
        .await?;
    rpc.validate("v2/ConfigReadResponse", &v)?;
    check_policy(&v)
}
pub fn checked_thread(v: &Value, root: &Path, verified: bool) -> Result<()> {
    checked_thread_with_full(v, root, verified, false)
}
pub fn checked_thread_with_full(
    v: &Value,
    root: &Path,
    verified: bool,
    previously_full: bool,
) -> Result<()> {
    checked_thread_for_turn(v, root, verified, previously_full, false)
}
// Loaded shared threads report their original workspace roots on resume,
// even after a desktop continuation changes cwd. Only the immediate turn
// path may accept those historical roots: it supplies a complete sandboxPolicy
// for the authorized current root before any execution can start.
pub(crate) fn checked_thread_for_turn(
    v: &Value,
    root: &Path,
    verified: bool,
    previously_full: bool,
    replaces_workspace_policy: bool,
) -> Result<()> {
    for cwd in [&v["cwd"], &v["thread"]["cwd"]] {
        let p = paths::canonical(Path::new(cwd.as_str().unwrap_or("")))?;
        ensure(
            paths::equal(root, &p),
            "WORKSPACE_FORBIDDEN",
            "Unexpected upstream workspace",
        )?;
    }
    let b = &v["sandbox"];
    // Resuming an already loaded thread can return its previous turn's policy.
    // Only tolerate full access when our own journal records that explicit choice;
    // start_inner sets both requested policies again before executing the new turn.
    if previously_full && b["type"] == "dangerFullAccess" {
        return ensure(
            verified && v["approvalPolicy"] == "never" && v["approvalsReviewer"] == "user",
            "UNSAFE_UPSTREAM_CONFIG",
            "Unexpected full-access thread policy",
        );
    }
    ensure(
        v["approvalPolicy"] == "on-request"
            && v["approvalsReviewer"] == "user"
            && ["readOnly", "workspaceWrite"].contains(&s(b, "type"))
            && b["networkAccess"] == false,
        "UNSAFE_UPSTREAM_CONFIG",
        &format!(
            "Unsafe thread policy: approval={}, reviewer={}, sandbox={}",
            v["approvalPolicy"], v["approvalsReviewer"], b
        ),
    )?;
    if b["type"] == "workspaceWrite" {
        ensure(
            b["excludeTmpdirEnvVar"] == true && b["excludeSlashTmp"] == true,
            "UNSAFE_UPSTREAM_CONFIG",
            "Temporary access broadened",
        )?;
        for p in b["writableRoots"]
            .as_array()
            .ok_or_else(|| Error::new("UPSTREAM_PROTOCOL_ERROR", "Missing roots"))?
        {
            let previous_root = paths::canonical(Path::new(p.as_str().unwrap_or("")))?;
            ensure(
                replaces_workspace_policy || paths::within(root, &previous_root),
                "WORKSPACE_FORBIDDEN",
                "Writable root outside project",
            )?;
        }
    }
    ensure(
        verified,
        "SANDBOX_UNVERIFIED",
        "Native boundary probe must pass before tasks",
    )
}
#[cfg(windows)]
pub struct Job(usize);
#[cfg(windows)]
impl Job {
    /// # Safety
    /// `process` must be a live owned child process handle for the duration of this call.
    pub unsafe fn assign(process: windows_sys::Win32::Foundation::HANDLE) -> Result<Self> {
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            ensure(
                !handle.is_null(),
                "IO_ERROR",
                "Cannot create child process job",
            )?;
            let job = Self(handle as usize);
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            ensure(
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as _,
                    std::mem::size_of_val(&info) as u32,
                ) != 0
                    && AssignProcessToJobObject(handle, process) != 0,
                "IO_ERROR",
                "Cannot contain child process",
            )?;
            Ok(job)
        }
    }
}
#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0 as _);
        }
    }
}
#[cfg(test)]
mod shared_resume_policy_tests {
    use super::*;

    #[test]
    fn historical_roots_require_explicit_turn_policy_and_keep_other_guards() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("current");
        let old = directory.path().join("previous");
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(&old).unwrap();
        let root = paths::canonical(&root).unwrap();
        let response = json!({
            "cwd":root,"thread":{"cwd":root},
            "approvalPolicy":"on-request","approvalsReviewer":"user",
            "sandbox":{"type":"workspaceWrite","writableRoots":[old],
                "networkAccess":false,"excludeTmpdirEnvVar":true,"excludeSlashTmp":true}
        });
        assert!(checked_thread(&response, &root, true).is_err());
        assert!(checked_thread_for_turn(&response, &root, true, false, true).is_ok());
        assert!(checked_thread_for_turn(&response, &root, false, false, true).is_err());
        for (pointer, value) in [
            ("/sandbox/networkAccess", json!(true)),
            ("/sandbox/excludeTmpdirEnvVar", json!(false)),
            ("/sandbox/excludeSlashTmp", json!(false)),
            ("/sandbox/type", json!("dangerFullAccess")),
            ("/approvalPolicy", json!("never")),
            ("/approvalsReviewer", json!("auto_review")),
            ("/thread/cwd", json!(old)),
        ] {
            let mut unsafe_response = response.clone();
            *unsafe_response.pointer_mut(pointer).unwrap() = value;
            assert!(checked_thread_for_turn(&unsafe_response, &root, true, false, true).is_err());
        }
    }
}
