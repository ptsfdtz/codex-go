//! Discover workspace roots through public Codex APIs, never private storage.
use crate::{ensure, paths, rpc::ProtocolVersion, s, service::Core, Result};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::PathBuf,
    time::{Duration, Instant},
};

impl Core {
    pub(crate) async fn discover_codex_workspaces(&self) -> Result<()> {
        let rpc = self.upstream()?;
        let mut roots = HashSet::<PathBuf>::new();
        let started = Instant::now();
        let config = rpc
            .request("config/read", json!({"includeLayers":false}))
            .await?;
        rpc.validate("v2/ConfigReadResponse", &config)?;
        if let Some(projects) = config["config"]["projects"].as_object() {
            for (path, project) in projects {
                if project["trust_level"] == "trusted" {
                    roots.insert(PathBuf::from(path));
                }
            }
        }
        // Native project/list also includes workspaces with no conversations.
        if rpc.protocol() == ProtocolVersion::DesktopBaseline {
            let mut cursor = None;
            let mut seen = HashSet::new();
            for page in 0..100 {
                ensure(
                    started.elapsed() < Duration::from_secs(60),
                    "SYNC_LIMIT",
                    "Workspace discovery timed out",
                )?;
                let response = match rpc.project_page(cursor.as_deref(), 100).await {
                    Ok(value) => value,
                    // Older runtimes can lack the experimental project catalog.
                    Err(error)
                        if page == 0
                            && error.code == "UPSTREAM_ERROR"
                            && error.message.to_lowercase().contains("method")
                            && ["unknown", "not found", "unsupported"]
                                .iter()
                                .any(|word| error.message.to_lowercase().contains(word)) =>
                    {
                        break
                    }
                    Err(error) => return Err(error),
                };
                for project in response["data"].as_array().unwrap() {
                    for root in project["roots"].as_array().unwrap() {
                        roots.insert(PathBuf::from(s(root, "path")));
                    }
                }
                ensure(
                    roots.len() <= 20000,
                    "SYNC_LIMIT",
                    "Too many Codex workspaces",
                )?;
                cursor = response["nextCursor"].as_str().map(str::to_owned);
                let Some(next) = &cursor else { break };
                ensure(
                    page < 99 && seen.insert(next.clone()),
                    "SYNC_LIMIT",
                    "Workspace page limit reached",
                )?;
            }
        }
        for archived in [false, true] {
            let mut cursor = Value::Null;
            let mut seen = HashSet::new();
            for page in 0..100 {
                ensure(
                    started.elapsed() < Duration::from_secs(60),
                    "SYNC_LIMIT",
                    "Workspace discovery timed out",
                )?;
                let response = rpc.request_timeout("thread/list", json!({
                    "cursor":cursor,"limit":100,"archived":archived,"modelProviders":[],
                    "sourceKinds":["cli","vscode","exec","appServer","subAgent","subAgentReview","subAgentCompact","subAgentThreadSpawn","subAgentOther","unknown"]
                }), Duration::from_secs(15)).await?;
                rpc.validate("v2/ThreadListResponse", &response)?;
                for thread in response["data"].as_array().unwrap() {
                    if thread["ephemeral"] != true {
                        roots.insert(PathBuf::from(s(thread, "cwd")));
                    }
                }
                ensure(
                    roots.len() <= 20000,
                    "SYNC_LIMIT",
                    "Too many Codex workspaces",
                )?;
                cursor = response["nextCursor"].clone();
                if cursor.is_null() {
                    break;
                }
                ensure(
                    page < 99 && seen.insert(cursor.to_string()),
                    "UPSTREAM_PROTOCOL_ERROR",
                    "Repeated workspace cursor or page limit reached",
                )?;
            }
        }
        ensure(
            self.upstream()?.generation == rpc.generation,
            "UPSTREAM_UNAVAILABLE",
            "Runtime changed during discovery",
        )?;
        ensure(
            roots.len() <= 20000,
            "SYNC_LIMIT",
            "Too many Codex workspaces",
        )?;
        // Collect all pages before registering anything. Removed roots remain
        // disabled; automatic discovery never renews an existing authorization.
        for path in roots {
            paths::add_discovered(&self.store, &path)?;
        }
        Ok(())
    }
}
