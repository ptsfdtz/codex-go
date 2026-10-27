//! Exercise native filesystem helpers without credentials, models or user history.
use crate::{codex, ensure, paths, rpc::Rpc, s, security, Error, Result};
use serde_json::json;
use std::{path::Path, time::Duration};

pub(crate) async fn check(executable: &Path, directory: &Path) -> Result<()> {
    let home = directory.join("codex-home");
    let project = directory.join("instruction-project");
    security::restrict_directory(&home)?;
    security::restrict_directory(&project)?;
    // Stop ancestor discovery at our own root; never probe user instructions.
    std::fs::create_dir(project.join(".git"))?;
    std::fs::write(
        project.join("AGENTS.md"),
        "AgentDeck compatibility check. No model turn is requested.\n",
    )?;
    std::fs::write(
        home.join("config.toml"),
        "cli_auth_credentials_store = \"file\"\n",
    )?;
    let home = paths::canonical(&home)?;
    let project = paths::canonical(&project)?;
    let (rpc, mut events) = Rpc::start_with_home(executable, &codex::args(), Some(&home))?;
    let observer = rpc.clone();
    let mut task = tokio::spawn(async move {
        while let Some(event) = events.recv().await {
            if event.get("id").is_some() || event["method"] == "$lost" {
                // No request is authorized to invoke a model or approve execution.
                observer.stop();
                break;
            }
        }
    });
    let result = tokio::time::timeout(Duration::from_secs(40), async {
        codex::initialize(&rpc).await?;
        let reported_home = rpc.codex_home.lock().unwrap().clone();
        ensure(reported_home.as_ref().is_some_and(|p| paths::equal(p, &home)), "UPSTREAM_PROTOCOL_ERROR", "Compatibility probe did not use isolated Codex state")?;
        let config = rpc.request("config/read", json!({"includeLayers":false})).await?;
        rpc.validate("v2/ConfigReadResponse", &config)?;
        codex::check_policy(&config)?;
        let models = rpc.request("model/list", json!({})).await?;
        rpc.validate("v2/ModelListResponse", &models)?;
        ensure(rpc.protocol() == crate::rpc::ProtocolVersion::DesktopBaseline, "UPSTREAM_FEATURE_UNSUPPORTED", "当前 Codex 缺少 AgentDeck 所需的原生项目协议")?;
        let projects = rpc.request("project/list", json!({})).await?;
        rpc.validate("experimental/ProjectListResponse", &projects)?;
        let response = rpc.request("thread/start", json!({"cwd":project,"ephemeral":true,"approvalPolicy":"on-request","approvalsReviewer":"user","config":{"default_permissions":"agentdeck"}})).await?;
        rpc.validate("v2/ThreadStartResponse", &response)?;
        codex::checked_thread(&response, &project, true)?;
        ensure(!s(&response["thread"], "id").is_empty(), "UPSTREAM_PROTOCOL_ERROR", "Compatibility probe did not create a native thread")
    }).await.map_err(|_| Error::new("UPSTREAM_TIMEOUT", "Codex instruction compatibility check timed out"));
    rpc.stop();
    // The monitor publishes $lost after waiting for the child and closing its
    // process job. Wait before the owning temporary directory is removed.
    if tokio::time::timeout(Duration::from_secs(5), &mut task)
        .await
        .is_err()
    {
        task.abort();
        let _ = task.await;
    }
    result?
}
