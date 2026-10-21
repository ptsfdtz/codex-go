//! Authorized authoritative thread indexes, never thread copies.
use crate::{ensure, paths, s, service::Core, Error, Result};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::Path,
    time::{Duration, Instant},
};

pub(crate) struct ThreadIndexEntry {
    pub project_id: String,
    pub thread_id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub archived: bool,
    pub metadata: Value,
    pub expected_updated_at: Option<String>,
    pub expected_event_seq: Option<i64>,
}

fn timestamp(value: &Value) -> Result<String> {
    value
        .as_i64()
        .and_then(|n| chrono::DateTime::from_timestamp(n, 0))
        .map(|v| v.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
        .ok_or_else(|| Error::new("UPSTREAM_PROTOCOL_ERROR", "Invalid thread timestamp"))
}
impl Core {
    pub(crate) fn note_thread_index_change(&self, thread: &str) -> Result<()> {
        let mut pending = self.thread_index_pending.lock().unwrap();
        ensure(
            pending.len() < 20000 || pending.contains_key(thread),
            "SYNC_LIMIT",
            "Too many pending thread metadata changes",
        )?;
        if !thread.is_empty() {
            pending.insert(thread.to_owned(), crate::uid("change"));
        }
        self.thread_index_changed.notify_one();
        Ok(())
    }
    /// Attached runtimes reconcile on connect and validated metadata notifications.
    /// This worker never blocks the RPC event reader or grants a new directory.
    pub(crate) async fn watch_thread_index(
        self: std::sync::Arc<Self>,
        rpc: std::sync::Arc<crate::rpc::Rpc>,
    ) {
        use std::sync::atomic::Ordering;
        self.thread_index_changed.notify_one();
        let mut last_error = None;
        let mut failures = 0u32;
        loop {
            self.thread_index_changed.notified().await;
            tokio::time::sleep(Duration::from_millis(250)).await;
            if self.stopping.load(Ordering::SeqCst)
                || !rpc.alive.load(Ordering::SeqCst)
                || !self
                    .upstream()
                    .is_ok_and(|current| current.generation == rpc.generation)
            {
                break;
            }
            if let Err(error) = self.sync_thread_index().await {
                if !["CONFLICT", "SYNC_CONFLICT", "UPSTREAM_UNAVAILABLE"]
                    .contains(&error.code.as_str())
                    && last_error.as_deref() != Some(error.code.as_str())
                {
                    self.emit("error", json!({"code":"THREAD_SYNC_FAILED","message":format!("会话索引同步尚未完成（{}）",error.code)}));
                }
                last_error = Some(error.code);
                // Keep the last committed index and retry after contention or
                // transient source failure; never replace it with partial data.
                tokio::time::sleep(Duration::from_secs((2u64 << failures.min(4)).min(30))).await;
                failures = failures.saturating_add(1);
                self.thread_index_changed.notify_one();
            } else {
                failures = 0;
                last_error = None;
                self.publish();
            }
        }
    }

    // Also called by Windows-local sync; both paths use existing local grants.
    pub async fn sync_thread_index(&self) -> Result<usize> {
        let _sync = self
            .thread_sync
            .try_lock()
            .map_err(|_| Error::new("CONFLICT", "Thread index sync already in progress"))?;
        let rpc = self.upstream()?;
        {
            let busy = self.busy.lock().unwrap();
            ensure(
                busy.is_empty(),
                "CONFLICT",
                "Local conversation operation in progress; retry sync after it finishes",
            )?;
            for thread in self.store.purge_deleted_threads()? {
                self.loaded.lock().unwrap().remove(&thread);
            }
        }
        let pending = self.thread_index_pending.lock().unwrap().clone();
        let projects = self.store.projects()?;
        let mut authorized = Vec::new();
        for project in projects {
            authorized.push((
                s(&project, "projectId").to_owned(),
                paths::root(&self.store, s(&project, "projectId"))?,
            ));
        }
        if authorized.is_empty() {
            return Ok(0);
        }
        let before: HashMap<String, (String, i64)> = self
            .store
            .query("SELECT s.upstreamThreadId,s.updatedAt,COALESCE(q.seq,0) AS eventSeq FROM sessions s JOIN projects p USING(projectId) LEFT JOIN event_sequences q ON q.sessionKey=s.sessionId WHERE p.enabled=1", [])?
            .iter()
            .map(|v| {
                (
                    s(v, "upstreamThreadId").to_owned(),
                    (s(v, "updatedAt").to_owned(), v["eventSeq"].as_i64().unwrap()),
                )
            })
            .collect();
        let mut entries = BTreeMap::new();
        let started = Instant::now();
        // Newly created loaded threads may not have a persisted rollout yet and
        // therefore be absent even from state-DB thread/list. Read them through
        // public APIs; never inspect private desktop storage.
        let mut loaded = Vec::new();
        let mut loaded_ids = HashSet::new();
        let mut cursor = Value::Null;
        let mut seen = HashSet::new();
        let mut complete = false;
        for _ in 0..100 {
            let response = rpc
                .request_timeout(
                    "thread/loaded/list",
                    json!({"cursor":cursor,"limit":100}),
                    Duration::from_secs(15),
                )
                .await?;
            rpc.validate("v2/ThreadLoadedListResponse", &response)?;
            for id in response["data"].as_array().unwrap() {
                ensure(
                    loaded_ids.insert(id.clone().as_str().unwrap().to_owned()),
                    "UPSTREAM_PROTOCOL_ERROR",
                    "Repeated loaded thread identity; index unchanged",
                )?;
                loaded.push(id.clone());
            }
            cursor = response["nextCursor"].clone();
            if cursor.is_null() {
                complete = true;
                break;
            }
            ensure(
                seen.insert(cursor.to_string()),
                "UPSTREAM_PROTOCOL_ERROR",
                "Repeated loaded thread cursor; index unchanged",
            )?;
        }
        ensure(
            complete,
            "SYNC_LIMIT",
            "Loaded thread page limit reached; index unchanged",
        )?;
        // Zero-turn threads can disappear from both list and loaded/list after
        // unarchive. Read validated notification identities through public APIs.
        for id in pending.keys() {
            if loaded_ids.insert(id.clone()) {
                loaded.push(json!(id));
            }
        }
        // Persisted archive membership takes precedence over this fallback.
        let mut loaded_threads = Vec::new();
        for id in loaded {
            if self.store.thread_deleted(id.as_str().unwrap())? {
                continue;
            }
            ensure(
                started.elapsed() < Duration::from_secs(60),
                "SYNC_LIMIT",
                "Thread index sync timed out; index unchanged",
            )?;
            let response = rpc
                .request_timeout(
                    "thread/read",
                    json!({"threadId":id,"includeTurns":false}),
                    Duration::from_secs(15),
                )
                .await;
            let response = match response {
                Ok(response) => response,
                Err(_) if self.store.thread_deleted(id.as_str().unwrap())? => continue,
                Err(error) => return Err(error),
            };
            rpc.validate("v2/ThreadReadResponse", &response)?;
            ensure(
                response["thread"]["id"] == id,
                "UPSTREAM_PROTOCOL_ERROR",
                "Loaded thread identity mismatch",
            )?;
            loaded_threads.push(response["thread"].clone());
        }
        for archived in [false, true] {
            let mut cursor = Value::Null;
            let mut seen = HashSet::new();
            let mut complete = false;
            for _ in 0..100 {
                ensure(
                    started.elapsed() < Duration::from_secs(60),
                    "SYNC_LIMIT",
                    "Thread index sync timed out; index unchanged",
                )?;
                let response = rpc.request_timeout("thread/list", json!({
                    "cursor":cursor,"limit":100,"archived":archived,"modelProviders":[],
                    "cwd":authorized.iter().map(|(_,root)| root).collect::<Vec<_>>(),
                    "sourceKinds":["cli","vscode","exec","appServer","subAgent","subAgentReview","subAgentCompact","subAgentThreadSpawn","subAgentOther","unknown"]
                }), Duration::from_secs(15)).await?;
                rpc.validate("v2/ThreadListResponse", &response)?;
                let mut page = response["data"].as_array().unwrap().clone();
                if archived && response["nextCursor"].is_null() {
                    page.extend(
                        loaded_threads
                            .iter()
                            .filter(|v| {
                                !entries.contains_key(s(v, "id"))
                                    && !response["data"]
                                        .as_array()
                                        .unwrap()
                                        .iter()
                                        .any(|listed| listed["id"] == v["id"])
                            })
                            .cloned(),
                    );
                }
                for thread in &page {
                    if self.store.thread_deleted(s(thread, "id"))? {
                        continue;
                    }
                    let Ok(root) = paths::canonical(Path::new(s(thread, "cwd"))) else {
                        continue;
                    };
                    let Some((project_id, _)) =
                        authorized.iter().find(|(_, p)| paths::equal(p, &root))
                    else {
                        continue;
                    };
                    if thread["ephemeral"] == true {
                        continue;
                    }
                    let thread_id = s(thread, "id").to_owned();
                    ensure(
                        !thread_id.is_empty() && !entries.contains_key(&thread_id),
                        "SYNC_CONFLICT",
                        "Thread listing changed or repeated an identity; index unchanged",
                    )?;
                    let title = thread["name"]
                        .as_str()
                        .filter(|n| !n.is_empty())
                        .map(str::to_owned)
                        .unwrap_or_else(|| {
                            thread["preview"]
                                .as_str()
                                .unwrap_or("")
                                .lines()
                                .next()
                                .unwrap_or("")
                                .chars()
                                .take(160)
                                .collect()
                        });
                    let mut metadata = json!({});
                    for key in [
                        "source",
                        "originator",
                        "parentThreadId",
                        "forkedFromId",
                        "sessionId",
                        "projectId",
                        "status",
                        "model",
                        "reasoningEffort",
                        "section",
                    ] {
                        if let Some(value) = thread.get(key) {
                            metadata[key] = value.clone();
                        }
                    }
                    let loaded_fallback = !response["data"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|v| v["id"] == thread["id"]);
                    let entry = ThreadIndexEntry {
                        project_id: project_id.clone(),
                        thread_id: thread_id.clone(),
                        title: if title.is_empty() {
                            "Codex 会话".into()
                        } else {
                            title
                        },
                        created_at: timestamp(&thread["createdAt"])?,
                        updated_at: timestamp(&thread["updatedAt"])?,
                        archived: archived && !loaded_fallback,
                        metadata,
                        expected_updated_at: before.get(&thread_id).map(|v| v.0.clone()),
                        expected_event_seq: before.get(&thread_id).map(|v| v.1),
                    };
                    entries.insert(thread_id, entry);
                    ensure(
                        entries.len() <= 20000,
                        "SYNC_LIMIT",
                        "Thread index exceeds sync limit; index unchanged",
                    )?;
                }
                cursor = response["nextCursor"].clone();
                if cursor.is_null() {
                    complete = true;
                    break;
                }
                ensure(
                    seen.insert(cursor.to_string()),
                    "UPSTREAM_PROTOCOL_ERROR",
                    "Repeated thread index cursor; index unchanged",
                )?;
            }
            ensure(
                complete,
                "SYNC_LIMIT",
                "Thread index page limit reached; index unchanged",
            )?;
        }
        let busy = self.busy.lock().unwrap();
        ensure(
            self.upstream()?.generation == rpc.generation,
            "SYNC_CONFLICT",
            "Runtime connection changed during sync; index unchanged",
        )?;
        ensure(
            busy.is_empty(),
            "CONFLICT",
            "Local conversation operation in progress; retry sync after it finishes",
        )?;
        for (id, _) in &authorized {
            paths::root(&self.store, id)?;
        }
        let count = self
            .store
            .apply_thread_index(&entries.into_values().collect::<Vec<_>>())?;
        self.thread_index_pending
            .lock()
            .unwrap()
            .retain(|id, revision| pending.get(id) != Some(revision));
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authoritative_deletion_survives_restart_is_atomic_and_prevents_resurrection() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("test.db");
        let store = crate::store::Store::open(&database).unwrap();
        let project = paths::add_local(&store, directory.path()).unwrap();
        let stale = || ThreadIndexEntry {
            project_id: s(&project, "projectId").to_owned(),
            thread_id: "deleted-thread".into(),
            title: "original".into(),
            created_at: "2026-10-01T00:00:00.000Z".into(),
            updated_at: "2026-10-01T00:00:00.000Z".into(),
            archived: false,
            metadata: json!({"status":{"type":"idle"}}),
            expected_updated_at: None,
            expected_event_seq: None,
        };
        store.apply_thread_index(&[stale()]).unwrap();
        let session = store.sessions(None).unwrap().remove(0);
        let id = s(&session, "sessionId");
        let old = store
            .append(
                "turn.progress",
                json!({"text":"retained before deletion"}),
                Some(id),
                None,
            )
            .unwrap();
        store.exec("DROP TABLE thread_deletions", []).unwrap();
        store
            .exec("DELETE FROM migrations WHERE version=5", [])
            .unwrap();
        drop(store);
        let store = crate::store::Store::open(&database).unwrap();
        assert_eq!(
            store.session(id).unwrap()["upstreamThreadId"],
            "deleted-thread"
        );
        assert_eq!(store.cursor().unwrap(), s(&old, "eventId"));
        store.record_thread_deletion("deleted-thread").unwrap();
        drop(store);
        let store = crate::store::Store::open(&database).unwrap();
        assert!(store.thread_deleted("deleted-thread").unwrap());
        store.exec("CREATE TRIGGER reject_delete_event BEFORE INSERT ON events WHEN NEW.action='session.deleted' BEGIN SELECT RAISE(ABORT,'test rollback'); END",[]).unwrap();
        assert!(store.purge_deleted_threads().is_err());
        assert!(store.session(id).is_ok());
        assert_eq!(store.cursor().unwrap(), s(&old, "eventId"));
        store.exec("DROP TRIGGER reject_delete_event", []).unwrap();
        assert_eq!(
            store.purge_deleted_threads().unwrap(),
            vec!["deleted-thread"]
        );
        assert!(store.session(id).is_err());
        assert_eq!(store.replay("0", 100).unwrap_err().code, "REPLAY_GAP");
        let replay = store.replay(s(&old, "eventId"), 100).unwrap();
        assert_eq!(replay["events"][0]["action"], "session.deleted");
        assert_eq!(replay["events"][0]["sessionId"], id);
        let cursor = store.cursor().unwrap();
        assert!(store.purge_deleted_threads().unwrap().is_empty());
        assert_eq!(store.apply_thread_index(&[stale()]).unwrap(), 0);
        assert_eq!(store.cursor().unwrap(), cursor);
        assert_eq!(store.projects().unwrap().len(), 1);
        assert!(store
            .query("SELECT * FROM session_metadata", [])
            .unwrap()
            .is_empty());
    }
    #[test]
    fn stale_local_revision_rolls_back_the_entire_index_and_journal() {
        let directory = tempfile::tempdir().unwrap();
        let store = crate::store::Store::open(&directory.path().join("test.db")).unwrap();
        let project = paths::add_local(&store, directory.path()).unwrap();
        let entry = |id: &str, expected: Option<String>| ThreadIndexEntry {
            project_id: s(&project, "projectId").to_owned(),
            thread_id: id.to_owned(),
            title: id.to_owned(),
            created_at: "2026-10-01T00:00:00.000Z".into(),
            updated_at: "2026-10-01T00:00:00.000Z".into(),
            archived: false,
            metadata: json!({"status":{"type":"idle"},"source":"appServer"}),
            expected_event_seq: expected.as_ref().map(|_| 0),
            expected_updated_at: expected,
        };
        store
            .apply_thread_index(&[entry("existing", None)])
            .unwrap();
        let original = store.sessions(None).unwrap().remove(0);
        store
            .exec("UPDATE sessions SET title='local-newer'", [])
            .unwrap();
        store
            .append(
                "session.updated",
                json!({"title":"local-newer"}),
                Some(s(&original, "sessionId")),
                None,
            )
            .unwrap();
        let cursor = store.cursor().unwrap();
        let error = store
            .apply_thread_index(&[
                entry("must-rollback", None),
                entry("existing", Some(s(&original, "updatedAt").to_owned())),
            ])
            .unwrap_err();
        assert_eq!(error.code, "SYNC_CONFLICT");
        assert_eq!(store.sessions(None).unwrap().len(), 1);
        assert_eq!(
            store.session(s(&original, "sessionId")).unwrap()["title"],
            "local-newer"
        );
        assert_eq!(store.cursor().unwrap(), cursor);
        assert_eq!(
            store
                .query("SELECT * FROM session_metadata", [])
                .unwrap()
                .len(),
            1
        );
        store.delete_session(s(&original, "sessionId")).unwrap();
        assert!(store
            .query("SELECT * FROM session_metadata", [])
            .unwrap()
            .is_empty());
    }
}
