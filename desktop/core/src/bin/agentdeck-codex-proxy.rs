//! Development CLI override. Paths/version live beside this binary, not tokens.
use agentdeck_service::{
    desktop_stdio::{relay, Manifest, Startup},
    Result,
};
#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        // Code only: never print arguments, paths, credentials or task text.
        eprintln!("AgentDeck desktop proxy: {}", error.code);
        if let Some(diagnostic) = agentdeck_service::desktop_stdio::startup_diagnostic(&error) {
            eprintln!("AgentDeck desktop startup: {diagnostic}");
        }
        std::process::exit(1);
    }
}
async fn run() -> Result<()> {
    let executable = std::env::current_exe()?;
    let manifest = Manifest::load(&executable.with_extension("json"), &executable)?;
    let target = manifest.target()?;
    let protocol = target.protocol();
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let version = args == ["--version"] || args == ["-V"];
    // The desktop's node_repl uses CODEX_CLI_PATH for its native sandbox
    // kernel too. Delegate that helper verbatim; it creates no app-server or
    // conversation, and the native sandbox remains responsible for policy.
    let sandbox = args.first().is_some_and(|arg| arg == "sandbox");
    let policy = agentdeck_service::desktop_stdio::is_startup_policy_command(&args)?;
    let startup = if version || policy || sandbox {
        None
    } else {
        Some(Startup::parse(&args)?)
    };
    agentdeck_service::codex::verify_for(&manifest.native_executable, protocol).map_err(|_| {
        agentdeck_service::Error::new(
            "PROXY_NATIVE_VERSION_MISMATCH",
            "Native CLI version check failed",
        )
    })?;
    if version {
        println!(
            "codex-cli {}",
            agentdeck_service::codex::executable_version(&manifest.native_executable)?
        );
        return Ok(());
    }
    if sandbox {
        let mut command = tokio::process::Command::new(&manifest.native_executable);
        command
            .args(&args)
            .env_remove("CODEX_CLI_PATH")
            .env_remove("AGENTDECK_DESKTOP_LAUNCH_STATUS")
            .env_remove("AGENTDECK_DESKTOP_LAUNCH_THREAD")
            .stdin(std::process::Stdio::inherit())
            .stdout(std::process::Stdio::inherit())
            .stderr(std::process::Stdio::inherit())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let status = command.status().await?;
        if !status.success() {
            std::process::exit(status.code().unwrap_or(1));
        }
        return Ok(());
    }
    if policy {
        let mut command = tokio::process::Command::new(&manifest.native_executable);
        command
            .args(&args)
            .env_remove("CODEX_CLI_PATH")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::inherit())
            .stderr(std::process::Stdio::inherit())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let status = tokio::time::timeout(std::time::Duration::from_secs(30), command.status())
            .await
            .map_err(|_| {
                agentdeck_service::Error::new("PROXY_IO_TIMEOUT", "Native startup policy timed out")
            })??;
        if !status.success() {
            std::process::exit(status.code().unwrap_or(1));
        }
        return Ok(());
    }
    relay(
        tokio::io::stdin(),
        tokio::io::stdout(),
        target,
        startup.unwrap(),
    )
    .await
}
