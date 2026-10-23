use agentdeck_cloud::{config::Config, security, State};
use std::sync::Arc;

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("AgentDeck cloud: {error}");
        std::process::exit(1)
    }
}
async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::environment()?;
    let state = State::open(config).await?;
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).is_some_and(|a| a == "create-admin") {
        if args.len() != 3 {
            return Err("Usage: agentdeck-cloud create-admin USERNAME (password is read securely from the terminal)".into());
        }
        let name = security::username(&args[2])?;
        let password = rpassword::prompt_password("Temporary administrator password: ")?;
        let confirm = rpassword::prompt_password("Confirm password: ")?;
        if password != confirm {
            return Err("Passwords differ".into());
        }
        let hash = state.passwords.hash(&password).await?;
        state
            .store
            .create_account(None, &name, &hash, "admin")
            .await?;
        println!("Administrator created; change the temporary password at first login.");
        return Ok(());
    }
    if args.len() != 1 {
        return Err("Unknown command".into());
    }
    let listener = tokio::net::TcpListener::bind(state.config.listen).await?;
    let owner = state.clone();
    let cleanup = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));
        loop {
            interval.tick().await;
            if owner.store.cleanup().await.is_err() {
                eprintln!("AgentDeck cloud: retention cleanup unavailable");
            }
        }
    });
    println!("AgentDeck cloud listening on {}", state.config.listen);
    let app = agentdeck_cloud::api::router(state.clone())
        .into_make_service_with_connect_info::<std::net::SocketAddr>();
    let stop = state.clone();
    axum::serve(listener, app)
        .with_graceful_shutdown(async move { shutdown(stop).await })
        .await?;
    cleanup.abort();
    Ok(())
}
async fn shutdown(state: Arc<State>) {
    #[cfg(unix)]
    {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                tokio::select! {_=signal.recv()=>{},_=tokio::signal::ctrl_c()=>{}}
            }
            Err(_) => {
                let _ = tokio::signal::ctrl_c().await;
            }
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
    state.hub.shutdown();
}
