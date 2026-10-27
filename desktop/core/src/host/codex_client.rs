//! Local native terminal client for the exact runtime attached to this Host.
use crate::{codex, ensure, rpc::Rpc, runtime::RuntimeTarget, Error, Result};
use std::{
    path::{Path, PathBuf},
    process::Command,
};

const TOKEN_ENV: &str = "AGENTDECK_CODEX_REMOTE_TOKEN";

pub async fn command(
    executable: &Path,
    target: RuntimeTarget,
    thread: Option<&str>,
) -> Result<Command> {
    ensure(
        thread.is_none_or(|id| uuid::Uuid::parse_str(id).is_ok()),
        "INVALID_REQUEST",
        "An original Codex thread UUID is required",
    )?;
    let RuntimeTarget::Attached { ref endpoint, .. } = target else {
        return Err(Error::new(
            "SHARED_RUNTIME_REQUIRED",
            "Host 尚未连接共享运行时；不会为 CLI 启动独立的 Codex 会话进程。",
        ));
    };
    let help = codex::sync_command(&executable.to_string_lossy(), &["--help"], None)?;
    ensure(
        help.contains("--remote ") && help.contains("--remote-auth-token-env "),
        "UPSTREAM_FEATURE_UNSUPPORTED",
        "当前 Codex 不支持原生远程终端；请使用支持 --remote 的兼容版本。",
    )?;
    let (token, home) = verify_runtime(executable, &target).await?;
    let mut command = native_command(executable, endpoint, &token, thread);
    command.env("CODEX_HOME", home);
    Ok(command)
}

pub(super) async fn verify_runtime(
    executable: &Path,
    target: &RuntimeTarget,
) -> Result<(String, PathBuf)> {
    let (token, home, _) = verify_runtime_thread(executable, target, None).await?;
    Ok((token, home))
}

pub(super) async fn verify_runtime_thread(
    executable: &Path,
    target: &RuntimeTarget,
    thread: Option<&str>,
) -> Result<(String, PathBuf, Option<PathBuf>)> {
    let RuntimeTarget::Attached { endpoint, .. } = target else {
        return Err(Error::new(
            "SHARED_RUNTIME_REQUIRED",
            "需要已配置的认证共享运行时",
        ));
    };
    let version = codex::executable_version(executable)?;
    let token = target.credential()?;
    let (rpc, mut events) =
        Rpc::connect_local_websocket_profile(endpoint, &token, target.protocol()).await?;
    let drain = tokio::spawn(async move { while events.recv().await.is_some() {} });
    let checked: Result<(PathBuf, Option<PathBuf>)> = async {
        codex::initialize_attached(&rpc).await?;
        ensure(
            rpc.runtime_version().as_deref() == Some(version.as_str()),
            "UPSTREAM_VERSION_MISMATCH",
            "CLI 与共享服务的 Codex 版本不同；请为 Host 选择同一份原生程序。",
        )?;
        let home =
            rpc.codex_home.lock().unwrap().clone().ok_or_else(|| {
                Error::new("UPSTREAM_PROTOCOL_ERROR", "Codex source home missing")
            })?;
        let directory = if let Some(thread) = thread {
            let response = rpc
                .request(
                    "thread/read",
                    serde_json::json!({
                        "threadId":thread,"includeTurns":false
                    }),
                )
                .await?;
            rpc.validate("v2/ThreadReadResponse", &response)?;
            ensure(
                response["thread"]["id"].as_str() == Some(thread),
                "UPSTREAM_PROTOCOL_ERROR",
                "Native conversation identity differs from the requested thread",
            )?;
            let directory = response["thread"]["cwd"]
                .as_str()
                .map(PathBuf::from)
                .ok_or_else(|| {
                    Error::new(
                        "UPSTREAM_PROTOCOL_ERROR",
                        "Native conversation project path missing",
                    )
                })?;
            ensure(
                directory.is_absolute() && directory.is_dir(),
                "PROJECT_UNAVAILABLE",
                "目标会话的本地项目目录不存在或无法访问",
            )?;
            Some(directory)
        } else {
            None
        };
        Ok((home, directory))
    }
    .await;
    rpc.stop();
    drain.abort();
    let (home, directory) = checked?;
    Ok((token, home, directory))
}

fn native_command(executable: &Path, endpoint: &str, token: &str, thread: Option<&str>) -> Command {
    let mut command = Command::new(executable);
    command
        .args(["--remote", endpoint, "--remote-auth-token-env", TOKEN_ENV])
        .env(TOKEN_ENV, token)
        .env_remove("CODEX_CLI_PATH");
    if let Some(thread) = thread {
        command.args(["resume", thread]);
    }
    command
}
