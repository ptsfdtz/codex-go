use crate::{
    ensure, paths,
    rpc::{validate, Rpc},
    s, Error, Result,
};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
pub const VERSION: &str = "0.159.2";
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
        ensure(
            p.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")),
            "CONFIG_ERROR",
            "Native Codex executable required",
        )?;
        return paths::canonical(&p);
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let managed = PathBuf::from(local_app_data)
            .join("AgentDeck/tools/codex-cli")
            .join(VERSION)
            .join("codex.exe");
        let packaged = managed.parent().unwrap().join("bin/codex.exe");
        if packaged.is_file() {
            return paths::canonical(&packaged);
        }
        if managed.is_file() {
            // Resolve MSIX filesystem redirection before MXC launches its helper.
            // The sandbox service cannot see the parent's virtualized path.
            return paths::canonical(&managed);
        }
    }
    let paths = sync_command("where.exe", &["codex"], None).map_err(|_| {
        Error::new(
            "CODEX_CLI_NOT_FOUND",
            "找不到 Codex CLI。请安装 Codex，或使用 AgentDeck 提供的兼容版本安装按钮。",
        )
    })?;
    for line in paths.lines() {
        let p = PathBuf::from(line.trim());
        if p.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")) {
            return paths::canonical(&p);
        }
        if let Some(parent) = p.parent() {
            let candidate=parent.join("node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe");
            if candidate.is_file() {
                return paths::canonical(&candidate);
            }
        }
    }
    Err(Error::new(
        "CODEX_CLI_NOT_FOUND",
        "找不到 Codex CLI。请安装 Codex，或使用 AgentDeck 提供的兼容版本安装按钮。",
    ))
}
pub fn verify(exe: &Path) -> Result<()> {
    let output = sync_command(&exe.to_string_lossy(), &["--version"], None)?;
    let expected = format!("codex-cli {VERSION}");
    let actual = output.trim();
    if actual == expected {
        return Ok(());
    }
    Err(Error::new(
        "UPSTREAM_VERSION_UNSUPPORTED",
        &format!(
            "检测到 {actual}；AgentDeck 当前使用 codex-cli {VERSION} 的稳定 App Server 协议 schema，并仅验证过该版本的 Windows 沙箱与审批行为。可以安装 AgentDeck 管理的兼容版本；不会替换你的全局 Codex CLI。"
        ),
    ))
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
    ["app-server","--listen","stdio://","-c","windows.sandbox=\"mxc\"","-c","approval_policy=\"on-request\"","-c","approvals_reviewer=\"user\"","-c","default_permissions=\"agentdeck\"","-c","permissions={agentdeck={extends=\":workspace\",filesystem={\":root\"=\"deny\",\":minimal\"=\"read\",\":tmpdir\"=\"deny\",\":slash_tmp\"=\"deny\"},network={enabled=false}}}","-c","web_search=\"disabled\"","-c","mcp_servers={}","-c","hooks={}","-c","shell_environment_policy.inherit=\"core\""].iter().map(|s|s.to_string()).collect()
}
pub async fn initialize(rpc: &Arc<Rpc>) -> Result<()> {
    let v=rpc.request("initialize",json!({"clientInfo":{"name":"agentdeck","title":"AgentDeck","version":"0.3.0"},"capabilities":{"experimentalApi":true,"requestAttestation":false}})).await?;
    validate("v1/InitializeResponse", &v)?;
    rpc.send(json!({"method":"initialized","params":{}}))
}
pub fn check_policy(v: &Value) -> Result<()> {
    let c = &v["config"];
    let profile = &c["permissions"]["agentdeck"];
    let fs = &profile["filesystem"];
    ensure(
        c["default_permissions"] == "agentdeck"
            && c["sandbox_mode"].is_null()
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
    validate("v2/ConfigReadResponse", &v)?;
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
            ensure(
                paths::within(
                    root,
                    &paths::canonical(Path::new(p.as_str().unwrap_or("")))?,
                ),
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
