//! Filesystem events are invalidation hints only. All identities, authorization
//! and content still come from the public Codex API; no private DB is read.
use crate::{ensure, paths, rpc::Rpc, s, service::Core, Result};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Arc, Mutex},
    time::Duration,
};
use tokio::sync::Notify;

#[derive(Default)]
struct Hints {
    threads: HashSet<String>,
    index: bool,
    rescan: bool,
    rewatch: bool,
}

fn record(home: &Path, paths: &[PathBuf], hints: &mut Hints) {
    for path in paths {
        let Ok(relative) = path.strip_prefix(home) else {
            continue;
        };
        let Some(first) = relative.components().next() else {
            continue;
        };
        let first = first.as_os_str();
        if first == "sessions" || first == "archived_sessions" {
            if path
                .extension()
                .is_some_and(|extension| extension == "jsonl")
            {
                if let Some(stem) = path.file_stem().and_then(|name| name.to_str()) {
                    if let Some(id) = stem.get(stem.len().saturating_sub(36)..) {
                        if uuid::Uuid::parse_str(id).is_ok() {
                            if hints.threads.len() < 20000 {
                                hints.threads.insert(id.to_owned());
                            } else {
                                hints.index = true;
                                hints.rescan = true;
                            }
                        }
                    }
                }
            } else {
                hints.index = true;
            }
        } else if relative.components().count() == 1 {
            let name = first.to_string_lossy();
            // Observe names only. WAL notifications cover metadata updates that
            // need not append a rollout; logs/cache/locks must not cause loops.
            if name == "session_index.jsonl"
                || (name.starts_with("state_")
                    && (name.ends_with(".sqlite") || name.ends_with(".sqlite-wal")))
            {
                hints.index = true;
            }
        }
    }
}

struct SourceWatcher {
    watcher: RecommendedWatcher,
    watched: HashSet<PathBuf>,
    home: PathBuf,
    hints: Arc<Mutex<Hints>>,
    changed: Arc<Notify>,
}
impl SourceWatcher {
    fn new(home: PathBuf) -> notify::Result<Self> {
        let hints = Arc::new(Mutex::new(Hints::default()));
        let changed = Arc::new(Notify::new());
        let callback_hints = hints.clone();
        let callback_changed = changed.clone();
        let callback_home = home.clone();
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            let mut pending = callback_hints.lock().unwrap();
            match event {
                Ok(event) if !matches!(event.kind, EventKind::Access(_)) => {
                    record(&callback_home, &event.paths, &mut pending);
                    if matches!(
                        event.kind,
                        EventKind::Create(_)
                            | EventKind::Remove(_)
                            | EventKind::Modify(notify::event::ModifyKind::Name(_))
                    ) && event.paths.iter().any(|path| {
                        path.starts_with(callback_home.join("sessions"))
                            || path.starts_with(callback_home.join("archived_sessions"))
                    }) {
                        pending.index = true;
                    }
                    if event.need_rescan() {
                        pending.index = true;
                        pending.rescan = true;
                    }
                    if event.paths.iter().any(|path| {
                        path == &callback_home.join("sessions")
                            || path == &callback_home.join("archived_sessions")
                    }) {
                        pending.rewatch = true;
                        pending.rescan = true;
                    }
                }
                Ok(_) => return,
                Err(_) => {
                    pending.index = true;
                    pending.rescan = true;
                    pending.rewatch = true;
                }
            }
            if pending.index || !pending.threads.is_empty() {
                callback_changed.notify_one();
            }
        })?;
        let mut result = Self {
            watcher,
            watched: HashSet::new(),
            home,
            hints,
            changed,
        };
        result
            .watcher
            .watch(&result.home, RecursiveMode::NonRecursive)?;
        result.watch_directories()?;
        Ok(result)
    }
    fn watch_directories(&mut self) -> notify::Result<()> {
        for name in ["sessions", "archived_sessions"] {
            let directory = self.home.join(name);
            if directory.is_dir() && !self.watched.contains(&directory) {
                self.watcher.watch(&directory, RecursiveMode::Recursive)?;
                self.watched.insert(directory);
            }
        }
        Ok(())
    }
}

impl Core {
    pub(crate) async fn watch_source_changes(self: Arc<Self>, rpc: Arc<Rpc>) {
        // Shared servers already provide authoritative native notifications.
        if self.attached_runtime.load(Ordering::SeqCst) {
            return;
        }
        let Some(home) = rpc.codex_home.lock().unwrap().clone() else {
            return;
        };
        let source = match SourceWatcher::new(home) {
            Ok(source) => source,
            Err(_) => {
                self.emit("error", json!({"code":"SOURCE_WATCH_UNAVAILABLE","message":"会话变化监听不可用，索引仍会定期核对"}));
                return;
            }
        };
        self.run_source_changes(rpc, source).await;
    }

    async fn run_source_changes(self: Arc<Self>, rpc: Arc<Rpc>, mut source: SourceWatcher) {
        let mut retries = HashMap::<String, u8>::new();
        loop {
            source.changed.notified().await;
            // Bound bursts even during continuous writes; no quiet-period wait
            // that could postpone delivery until a long answer has finished.
            tokio::time::sleep(Duration::from_millis(250)).await;
            if self.stopping.load(Ordering::SeqCst)
                || !rpc.alive.load(Ordering::SeqCst)
                || !self
                    .upstream()
                    .is_ok_and(|current| current.generation == rpc.generation)
            {
                return;
            }
            let mut pending = std::mem::take(&mut *source.hints.lock().unwrap());
            if pending.rewatch {
                for directory in source.watched.drain() {
                    let _ = source.watcher.unwatch(&directory);
                }
            }
            if source.watch_directories().is_err() {
                pending.rescan = true;
            }
            if self.connected.lock().unwrap().is_empty() {
                continue;
            }
            if pending.index {
                self.thread_index_changed.notify_one();
            }
            if pending.rescan {
                for session in self
                    .store
                    .sessions(None)
                    .unwrap_or_default()
                    .into_iter()
                    .take(20000)
                {
                    pending
                        .threads
                        .insert(s(&session, "upstreamThreadId").to_owned());
                }
            }
            for thread in pending.threads {
                match self.check_source_content(&rpc, &thread).await {
                    Ok(()) => {
                        retries.remove(&thread);
                    }
                    Err(error) => {
                        // A rename/archive or startup flush can race with this read.
                        // Retry the hint, never a mutation or the underlying write.
                        if ["UPSTREAM_ERROR", "UPSTREAM_TIMEOUT", "SYNC_CONFLICT"]
                            .contains(&error.code.as_str())
                            && *retries.entry(thread.clone()).or_default() < 3
                        {
                            *retries.get_mut(&thread).unwrap() += 1;
                            let mut hints = source.hints.lock().unwrap();
                            if hints.threads.len() < 20000 {
                                hints.threads.insert(thread);
                            } else {
                                hints.index = true;
                                hints.rescan = true;
                            }
                            source.changed.notify_one();
                        } else {
                            retries.remove(&thread);
                        }
                    }
                }
            }
        }
    }

    async fn check_source_content(&self, rpc: &Rpc, thread: &str) -> Result<()> {
        if self.store.thread_deleted(thread)? {
            return Ok(());
        }
        let rows = self.store.query(
            "SELECT sessionId FROM sessions WHERE upstreamThreadId=?",
            [thread],
        )?;
        let Some(row) = rows.first() else {
            self.thread_index_changed.notify_one();
            return Ok(());
        };
        let id = s(row, "sessionId");
        let session = self.store.session(id)?;
        if !self.source_session_idle(id)? {
            return Ok(());
        }
        let root = paths::root(&self.store, s(&session, "projectId"))?;
        let response = rpc
            .request_timeout(
                "thread/read",
                json!({"threadId":thread,"includeTurns":false}),
                Duration::from_secs(5),
            )
            .await?;
        rpc.validate("v2/ThreadReadResponse", &response)?;
        ensure(
            response["thread"]["id"] == thread
                && paths::equal(
                    &root,
                    &paths::canonical(Path::new(s(&response["thread"], "cwd")))?,
                ),
            "WORKSPACE_FORBIDDEN",
            "Source thread identity or workspace changed",
        )?;
        ensure(
            self.upstream()?.generation == rpc.generation,
            "SYNC_CONFLICT",
            "Source runtime changed",
        )?;
        let current = self.store.session(id)?;
        ensure(
            current["projectId"] == session["projectId"]
                && current["upstreamThreadId"] == thread
                && paths::equal(&root, &paths::root(&self.store, s(&current, "projectId"))?),
            "WORKSPACE_FORBIDDEN",
            "Source authorization changed during read",
        )?;
        if !self.store.thread_deleted(thread)? && self.source_session_idle(id)? {
            self.store.append(
                "session.contentChanged",
                json!({"upstreamThreadId":thread}),
                Some(id),
                None,
            )?;
        }
        Ok(())
    }

    fn source_session_idle(&self, session: &str) -> Result<bool> {
        Ok(!self.busy.lock().unwrap().contains(session) && self.store.query(
            "SELECT turnId FROM turns WHERE sessionId=? AND status IN ('queued','running','waitingApproval','unknown') LIMIT 1", [session])?.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "explicit pinned native executable; two isolated runtimes and loopback synthetic model"]
    async fn real_separate_runtimes_push_saved_content_without_taking_writer() {
        use crate::rpc::ProtocolVersion;
        let executable =
            std::env::var_os("AGENTDECK_DESKTOP_PROBE_EXE").expect("set pinned native executable");
        crate::codex::verify_for(Path::new(&executable), ProtocolVersion::DesktopBaseline).unwrap();
        let directory = tempfile::tempdir().unwrap();
        let home = directory.path().join("home");
        let project = directory.path().join("project");
        std::fs::create_dir(&home).unwrap();
        std::fs::create_dir(&project).unwrap();
        let provider_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let provider_address = provider_listener.local_addr().unwrap();
        let answer = "Independent runtime saved answer 中文";
        let router = axum::Router::new().route("/v1/responses", axum::routing::post(move || async move {
            let item = json!({"id":"answer","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":answer,"annotations":[]}]});
            let events = [
                json!({"type":"response.created","response":{"id":"probe","status":"in_progress","output":[]}}),
                json!({"type":"response.output_item.added","output_index":0,"item":{"id":"answer","type":"message","role":"assistant","status":"in_progress","content":[]}}),
                json!({"type":"response.output_text.delta","item_id":"answer","output_index":0,"content_index":0,"delta":answer}),
                json!({"type":"response.output_item.done","output_index":0,"item":item.clone()}),
                json!({"type":"response.completed","response":{"id":"probe","status":"completed","output":[item],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}),
            ];
            let body = events.into_iter().map(|event| format!("event: {}\ndata: {}\n\n", s(&event, "type"), event)).collect::<String>();
            ([("content-type", "text/event-stream")], body)
        }));
        let provider =
            tokio::spawn(async move { axum::serve(provider_listener, router).await.unwrap() });
        std::fs::write(home.join("config.toml"), format!(
            "model=\"source-probe\"\nmodel_provider=\"source_probe\"\n[model_providers.source_probe]\nname=\"isolated loopback\"\nbase_url=\"http://{provider_address}/v1\"\nwire_api=\"responses\"\nrequires_openai_auth=false\nsupports_websockets=false\n")).unwrap();
        let token_file = directory.path().join("runtime-token");
        let token = crate::security::token();
        std::fs::write(&token_file, &token).unwrap();
        async fn server(
            executable: &Path,
            home: &Path,
            token_file: &Path,
            token: &str,
        ) -> (tokio::process::Child, Arc<Rpc>, tokio::task::JoinHandle<()>) {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let endpoint = format!("ws://{}", listener.local_addr().unwrap());
            drop(listener);
            let mut command = tokio::process::Command::new(executable);
            command
                .args([
                    "app-server",
                    "--listen",
                    &endpoint,
                    "--ws-auth",
                    "capability-token",
                    "--ws-token-file",
                ])
                .arg(token_file)
                .args([
                    "-c",
                    "analytics.enabled=false",
                    "-c",
                    "mcp_servers={}",
                    "-c",
                    "hooks={}",
                    "-c",
                    "features.code_mode_host=true",
                ])
                .env("CODEX_HOME", home)
                .env_remove("OPENAI_API_KEY")
                .env_remove("CODEX_API_KEY")
                .env_remove("HTTP_PROXY")
                .env_remove("HTTPS_PROXY")
                .env_remove("ALL_PROXY")
                .env("NO_PROXY", "127.0.0.1,localhost")
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .kill_on_drop(true);
            #[cfg(windows)]
            command.creation_flags(0x08000000);
            let mut child = command.spawn().unwrap();
            let (rpc, mut events) = tokio::time::timeout(Duration::from_secs(15), async {
                loop {
                    assert!(child.try_wait().unwrap().is_none());
                    if let Ok(client) = Rpc::connect_local_websocket_profile(
                        &endpoint,
                        token,
                        ProtocolVersion::DesktopBaseline,
                    )
                    .await
                    {
                        break client;
                    }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            })
            .await
            .unwrap();
            let drain = tokio::spawn(async move { while events.recv().await.is_some() {} });
            crate::codex::initialize(&rpc).await.unwrap();
            (child, rpc, drain)
        }
        async fn complete(rpc: &Rpc, thread: &str) -> String {
            let result = rpc.request("turn/start", json!({"threadId":thread,"input":[{"type":"text","text":"Complete isolated synchronization probe.","text_elements":[]}]})).await.unwrap();
            let id = s(&result["turn"], "id").to_owned();
            tokio::time::timeout(Duration::from_secs(15), async {
                loop {
                    let page = rpc.request("thread/turns/list", json!({"threadId":thread,"limit":1,"sortDirection":"desc","itemsView":"notLoaded"})).await.unwrap();
                    if page["data"][0]["id"] == id && page["data"][0]["status"] == "completed" { break; }
                    tokio::time::sleep(Duration::from_millis(25)).await;
                }
            }).await.unwrap();
            id
        }
        let (mut writer_child, writer, writer_drain) =
            server(Path::new(&executable), &home, &token_file, &token).await;
        let (mut reader_child, reader, reader_drain) =
            server(Path::new(&executable), &home, &token_file, &token).await;
        let created = writer
            .request(
                "thread/start",
                json!({"cwd":project,"sandbox":"read-only","approvalPolicy":"on-request"}),
            )
            .await
            .unwrap();
        let thread = s(&created["thread"], "id");
        complete(&writer, thread).await;
        let store =
            Arc::new(crate::store::Store::open(&directory.path().join("bridge.db")).unwrap());
        paths::add_local(&store, &project).unwrap();
        let tls = crate::security::Certificate::load(directory.path()).unwrap();
        let (local, _local_events) = tokio::sync::mpsc::channel(128);
        let core = Core::new(store, tls, "127.0.0.1".into(), 18443, local);
        *core.rpc.write().unwrap() = Some(reader.clone());
        core.ready.store(true, Ordering::SeqCst);
        core.connected.lock().unwrap().insert("web".into(), 1);
        core.sync_thread_index().await.unwrap();
        let session = core
            .store
            .sessions(None)
            .unwrap()
            .into_iter()
            .find(|session| session["upstreamThreadId"] == thread)
            .unwrap();
        let mut events = core.store.events.subscribe();
        let source = SourceWatcher::new(home.clone()).unwrap();
        let worker = tokio::spawn(core.clone().run_source_changes(reader.clone(), source));
        let next_turn = complete(&writer, thread).await;
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let event = events.recv().await.unwrap();
                if event["action"] == "session.contentChanged"
                    && event["sessionId"] == session["sessionId"]
                {
                    let history = core
                        .upstream_history_ordered(s(&session, "sessionId"), None, 50, "desc")
                        .await
                        .unwrap();
                    if history["data"].as_array().unwrap().iter().any(|entry| {
                        entry["turnId"] == next_turn && entry["item"]["text"] == answer
                    }) {
                        break;
                    }
                }
            }
        })
        .await
        .expect("saved changes must reach the public history API before the 15-second index poll");
        assert!(
            reader
                .request("thread/loaded/list", json!({}))
                .await
                .unwrap()["data"]
                .as_array()
                .unwrap()
                .is_empty(),
            "passive reads must not acquire the original writer"
        );
        let index_worker = tokio::spawn(core.clone().watch_thread_index(reader.clone()));
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if events.recv().await.unwrap()["action"] == "sessions.synced" {
                    break;
                }
            }
        })
        .await
        .unwrap();
        writer
            .request(
                "thread/name/set",
                json!({"threadId":thread,"name":"Renamed in separate desktop runtime"}),
            )
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if core.store.session(s(&session, "sessionId")).unwrap()["title"]
                    == "Renamed in separate desktop runtime"
                {
                    break;
                }
                events.recv().await.unwrap();
            }
        })
        .await
        .expect("metadata changes must wake index sync without waiting for polling");
        writer
            .request("thread/archive", json!({"threadId":thread}))
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if core.store.session(s(&session, "sessionId")).unwrap()["archived"] == 1 {
                    break;
                }
                events.recv().await.unwrap();
            }
        })
        .await
        .expect("archive movement must wake index sync");
        core.store
            .exec("UPDATE projects SET enabled=0", [])
            .unwrap();
        assert_eq!(
            core.check_source_content(&reader, thread)
                .await
                .unwrap_err()
                .code,
            "WORKSPACE_FORBIDDEN"
        );
        worker.abort();
        index_worker.abort();
        reader.stop();
        writer.stop();
        reader_drain.abort();
        writer_drain.abort();
        writer_child.kill().await.unwrap();
        reader_child.kill().await.unwrap();
        provider.abort();
    }

    #[tokio::test]
    async fn watches_append_and_archive_without_opening_content() {
        let directory = tempfile::tempdir().unwrap();
        let home = directory.path().to_path_buf();
        std::fs::create_dir(home.join("sessions")).unwrap();
        std::fs::create_dir(home.join("archived_sessions")).unwrap();
        let source = SourceWatcher::new(home.clone()).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let file = home.join("sessions").join(format!("rollout-{id}.jsonl"));
        std::fs::write(&file, b"not JSON: watcher must never parse content").unwrap();
        async fn wait_for(source: &SourceWatcher, id: &str) {
            tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    if source.hints.lock().unwrap().threads.contains(id) {
                        break;
                    }
                    source.changed.notified().await;
                }
            })
            .await
            .unwrap();
        }
        wait_for(&source, &id).await;
        *source.hints.lock().unwrap() = Hints::default();
        std::fs::rename(
            &file,
            home.join("archived_sessions")
                .join(file.file_name().unwrap()),
        )
        .unwrap();
        wait_for(&source, &id).await;
    }

    #[test]
    fn ignores_private_content_logs_locks_and_foreign_paths() {
        let directory = tempfile::tempdir().unwrap();
        let home = directory.path();
        let mut hints = Hints::default();
        record(
            home,
            &[
                home.join("logs_2.sqlite-wal"),
                home.join("thread-writer-locks/file"),
                home.join("config.toml"),
                home.join("../sessions/rollout.jsonl"),
            ],
            &mut hints,
        );
        assert!(!hints.index);
        assert!(hints.threads.is_empty());
        record(home, &[home.join("state_5.sqlite-wal")], &mut hints);
        assert!(hints.index);
    }

    #[test]
    fn notification_overflow_requests_authoritative_reconciliation() {
        let directory = tempfile::tempdir().unwrap();
        let home = directory.path();
        let mut hints = Hints::default();
        for _ in 0..20001 {
            record(
                home,
                &[home
                    .join("sessions")
                    .join(format!("rollout-{}.jsonl", uuid::Uuid::new_v4()))],
                &mut hints,
            );
        }
        assert_eq!(hints.threads.len(), 20000);
        assert!(hints.index && hints.rescan);
    }
}
