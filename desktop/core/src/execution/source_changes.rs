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
