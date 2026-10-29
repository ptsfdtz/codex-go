//! Discover workspace roots through public Codex APIs, never private storage.
use crate::{
    ensure, paths,
    rpc::{ProtocolVersion, Rpc},
    s,
    service::Core,
    store::Store,
    Result,
};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::PathBuf,
    time::{Duration, Instant},
};

async fn native_catalog(rpc: &Rpc) -> Result<Option<Vec<Value>>> {
    let mut roots = HashSet::<PathBuf>::new();
    let started = Instant::now();
    let mut catalog = None;
    if rpc.protocol() == ProtocolVersion::DesktopBaseline {
        catalog = Some(Vec::new());
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
                    catalog = None;
                    break;
                }
                Err(error) => return Err(error),
            };
            for project in response["data"].as_array().unwrap() {
                for root in project["roots"].as_array().unwrap() {
                    roots.insert(PathBuf::from(s(root, "path")));
                    catalog
                        .as_mut()
                        .unwrap()
                        .push(json!({"path":root["path"],"name":project["name"]}));
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
    Ok(catalog)
}

fn missing_native_roots(store: &Store, catalog: &[Value]) -> Result<Vec<PathBuf>> {
    let mut missing = Vec::new();
    for grant in store.projects()? {
        if s(&grant, "projectId") == "agentdeck-chat" {
            continue;
        }
        // Invalid directory identities need explicit reauthorization, never repair.
        let Ok(root) = paths::root(store, s(&grant, "projectId")) else {
            continue;
        };
        if !catalog
            .iter()
            .any(|entry| paths::equal(std::path::Path::new(s(entry, "path")), &root))
        {
            missing.push(root);
        }
    }
    Ok(missing)
}

impl Core {
    pub(crate) async fn discover_codex_workspaces(&self) -> Result<Option<Vec<Value>>> {
        let rpc = self.upstream()?;
        let started = Instant::now();
        let mut catalog = native_catalog(&rpc).await?;
        let mut roots = HashSet::<PathBuf>::new();
        if let Some(source) = &catalog {
            roots.extend(source.iter().map(|entry| PathBuf::from(s(entry, "path"))));
        }
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
        ensure(
            roots.len() <= 20000,
            "SYNC_LIMIT",
            "Too many Codex workspaces",
        )?;
        for archived in [false, true] {
            let mut cursor = Value::Null;
            let mut seen = HashSet::new();
            for page in 0..100 {
                ensure(
                    started.elapsed() < Duration::from_secs(60),
                    "SYNC_LIMIT",
                    "Workspace discovery timed out",
                )?;
                let response = rpc
                    .request_timeout(
                        "thread/list",
                        json!({
                            "cursor":cursor,"limit":100,"archived":archived,"modelProviders":[]
                        }),
                        Duration::from_secs(15),
                    )
                    .await?;
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
        if let Some(source) = &catalog {
            let missing = missing_native_roots(&self.store, source)?;
            for root in &missing {
                ensure(
                    started.elapsed() < Duration::from_secs(60),
                    "SYNC_LIMIT",
                    "Workspace registration timed out",
                )?;
                rpc.ensure_native_project(root).await?;
            }
            if !missing.is_empty() {
                // Use the authoritative names and ordering after creating projects.
                catalog = native_catalog(&rpc).await?;
            }
            for grant in self.store.projects()? {
                let key = format!("pendingNativeProject:{}", s(&grant, "projectId"));
                if self
                    .store
                    .meta(&key)?
                    .is_some_and(|value| !value.is_empty())
                    && catalog.as_ref().is_some_and(|source| {
                        source.iter().any(|entry| {
                            paths::equal(
                                std::path::Path::new(s(entry, "path")),
                                std::path::Path::new(s(&grant, "canonicalPath")),
                            )
                        })
                    })
                {
                    self.store.set_meta(&key, "")?;
                }
            }
        }
        let catalog = catalog
            .map(|source| -> Result<Vec<Value>> {
                let grants = self.store.projects()?;
                let mut seen = HashSet::new();
                let mut visible = Vec::new();
                for entry in source {
                    let Ok(path) = paths::canonical(std::path::Path::new(s(&entry, "path"))) else {
                        continue;
                    };
                    if let Some(grant) = grants.iter().find(|grant| {
                        paths::equal(std::path::Path::new(s(grant, "canonicalPath")), &path)
                    }) {
                        let id = s(grant, "projectId");
                        if seen.insert(id.to_owned()) && paths::root(&self.store, id).is_ok() {
                            visible.push(json!({"projectId":id,"name":entry["name"]}));
                        }
                    }
                }
                Ok(visible)
            })
            .transpose()?;
        Ok(catalog)
    }
}

#[cfg(test)]
mod automatic_project_registration_tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires AGENTDECK_TEST_OFFICIAL_CODEX pointing to a verified official runtime"]
    async fn official_runtime_discovers_trusted_projects_and_repairs_legacy_grants() {
        let executable = PathBuf::from(
            std::env::var_os("AGENTDECK_TEST_OFFICIAL_CODEX").expect("official runtime path"),
        );
        let directory = tempfile::tempdir().unwrap();
        let state = directory.path().join("state");
        let home = directory.path().join("codex-home");
        let trusted = directory.path().join("trusted-project");
        let legacy = directory.path().join("legacy-project");
        let removed = directory.path().join("removed-project");
        for path in [&state, &home, &trusted, &legacy, &removed] {
            std::fs::create_dir(path).unwrap();
        }
        let mut projects = serde_json::Map::new();
        for root in [&trusted, &removed] {
            projects.insert(
                root.to_string_lossy().into_owned(),
                json!({"trust_level":"trusted"}),
            );
        }
        std::fs::write(
            home.join("config.toml"),
            toml::to_string(&json!({"projects":projects})).unwrap(),
        )
        .unwrap();
        let store = std::sync::Arc::new(Store::open(&state.join("test.db")).unwrap());
        paths::add_discovered(&store, &legacy).unwrap();
        paths::add_discovered(&store, &removed).unwrap();
        let removed_id = store
            .projects()
            .unwrap()
            .into_iter()
            .find(|grant| grant["name"] == "removed-project")
            .unwrap()["projectId"]
            .as_str()
            .unwrap()
            .to_owned();
        paths::remove_local(&store, &removed_id).unwrap();
        let (rpc, mut events) =
            Rpc::start_with_home(&executable, &["app-server".into()], Some(&home)).unwrap();
        let drain = tokio::spawn(async move { while events.recv().await.is_some() {} });
        let result: Result<()> = async {
            crate::codex::initialize(&rpc).await?;
            let (local, _receiver) = tokio::sync::mpsc::channel(16);
            let core = Core::new(
                store.clone(),
                crate::security::Certificate::load(&state)?,
                "127.0.0.1".into(),
                0,
                local,
            );
            *core.rpc.write().unwrap() = Some(rpc.clone());
            core.ready.store(true, std::sync::atomic::Ordering::SeqCst);
            assert!(native_catalog(&rpc).await?.unwrap().is_empty());
            let first = core.discover_codex_workspaces().await?.unwrap();
            assert_eq!(first.len(), 2);
            let catalog = native_catalog(&rpc).await?.unwrap();
            for root in [&trusted, &legacy] {
                assert!(catalog
                    .iter()
                    .any(|entry| paths::equal(std::path::Path::new(s(entry, "path")), root)));
            }
            assert_eq!(catalog.len(), 2);
            let second = core.discover_codex_workspaces().await?.unwrap();
            assert_eq!(first, second);
            assert_eq!(native_catalog(&rpc).await?.unwrap().len(), 2);
            assert!(store.project(&removed_id).is_err());
            Ok(())
        }
        .await;
        rpc.stop();
        drain.abort();
        result.unwrap();
    }

    #[test]
    fn discovered_workspace_without_pending_intent_is_registered_once() {
        let directory = tempfile::tempdir().unwrap();
        let state = directory.path().join("state");
        std::fs::create_dir(&state).unwrap();
        let store = Store::open(&state.join("test.db")).unwrap();
        let root = directory.path().join("project");
        std::fs::create_dir(&root).unwrap();
        paths::add_discovered(&store, &root).unwrap();
        let grant = store.projects().unwrap().remove(0);
        assert!(store
            .meta(&format!("pendingNativeProject:{}", s(&grant, "projectId")))
            .unwrap()
            .is_none());
        let canonical = paths::canonical(&root).unwrap();
        assert_eq!(
            missing_native_roots(&store, &[]).unwrap(),
            vec![canonical.clone()]
        );
        let catalog = vec![json!({"path":canonical,"name":"Native project"})];
        assert!(missing_native_roots(&store, &catalog).unwrap().is_empty());
        paths::add_discovered(&store, &root).unwrap();
        assert_eq!(store.projects().unwrap().len(), 1);
        paths::remove_local(&store, s(&grant, "projectId")).unwrap();
        paths::add_discovered(&store, &root).unwrap();
        assert!(missing_native_roots(&store, &[]).unwrap().is_empty());
        assert!(store.projects().unwrap().is_empty());
    }

    #[test]
    fn ordinary_chat_and_changed_directory_identity_are_not_registered() {
        let directory = tempfile::tempdir().unwrap();
        let state = directory.path().join("state");
        std::fs::create_dir(&state).unwrap();
        let store = Store::open(&state.join("test.db")).unwrap();
        for name in ["chat", "changed"] {
            let root = directory.path().join(name);
            std::fs::create_dir(&root).unwrap();
            paths::add_discovered(&store, &root).unwrap();
        }
        store
            .exec(
                "UPDATE projects SET projectId='agentdeck-chat' WHERE name='chat'",
                [],
            )
            .unwrap();
        let changed = directory.path().join("changed");
        std::fs::rename(&changed, directory.path().join("previous")).unwrap();
        std::fs::create_dir(&changed).unwrap();
        assert!(missing_native_roots(&store, &[]).unwrap().is_empty());
    }
}
