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
    let startup = if version {
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
        println!("codex-cli {}", protocol.version());
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
