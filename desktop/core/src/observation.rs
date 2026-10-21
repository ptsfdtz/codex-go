//! Subscribe to original native threads without applying execution overrides.
use crate::{ensure, paths, s, service::Core, Result};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;

impl Core {
    pub async fn observe_session(&self, session_id: &str) -> Result<Value> {
        let _serial = self.observation_lock.lock().await;
        ensure(
            self.attached_runtime.load(Ordering::SeqCst),
            "UNSUPPORTED",
            "Shared observation requires an attached runtime",
        )?;
        let session = self.store.session(session_id)?;
        let root = paths::root(&self.store, s(&session, "projectId"))?;
        let thread_id = s(&session, "upstreamThreadId");
        ensure(
            !self.store.thread_deleted(thread_id)?,
            "THREAD_NOT_FOUND",
            "Original thread was deleted",
        )?;
        let rpc = self.upstream()?;
        let current = self.observed.lock().unwrap().get(session_id).cloned();
        if current.as_deref() != Some(&rpc.generation) {
            ensure(
                current.is_some() || self.observed.lock().unwrap().len() < 128,
                "OBSERVATION_LIMIT",
                "Too many observed conversations",
            )?;
            let read = rpc
                .request(
                    "thread/read",
                    json!({"threadId":thread_id,"includeTurns":false}),
                )
                .await?;
            rpc.validate("v2/ThreadReadResponse", &read)?;
            check_identity(&read["thread"], thread_id, &root)?;
            // Never use observation to load an unloaded thread from disk: that
            // can initialize a new execution environment with different defaults.
            let mut cursor = Value::Null;
            let mut seen = std::collections::HashSet::new();
            let mut loaded = false;
            let mut complete = false;
            for _ in 0..100 {
                let page = rpc
                    .request("thread/loaded/list", json!({"cursor":cursor,"limit":100}))
                    .await?;
                rpc.validate("v2/ThreadLoadedListResponse", &page)?;
                if page["data"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|id| id == thread_id)
                {
                    loaded = true;
                    break;
                }
                cursor = page["nextCursor"].clone();
                if cursor.is_null() {
                    complete = true;
                    break;
                }
                ensure(
                    seen.insert(cursor.to_string()),
                    "UPSTREAM_PROTOCOL_ERROR",
                    "Repeated loaded thread cursor",
                )?;
            }
            ensure(
                loaded || complete,
                "SYNC_LIMIT",
                "Loaded thread lookup did not finish",
            )?;
            if !loaded {
                self.observed
                    .lock()
                    .unwrap()
                    .insert(session_id.to_owned(), String::new());
                return Ok(
                    json!({"sessionId":session_id,"upstreamThreadId":thread_id,"observing":false,"state":"waitingForSource"}),
                );
            }
            // Rejoining a running thread establishes the native notification
            // subscription. Omitted overrides preserve the source configuration.
            let joined = rpc
                .request(
                    "thread/resume",
                    json!({"threadId":thread_id,"cwd":root,"excludeTurns":true}),
                )
                .await?;
            rpc.validate("v2/ThreadResumeResponse", &joined)?;
            check_identity(&joined["thread"], thread_id, &root)?;
            paths::root(&self.store, s(&session, "projectId"))?;
            ensure(
                !self.store.thread_deleted(thread_id)?,
                "THREAD_NOT_FOUND",
                "Original thread was deleted",
            )?;
            ensure(
                self.upstream()?.generation == rpc.generation,
                "UPSTREAM_UNAVAILABLE",
                "Runtime changed during subscription",
            )?;
            self.observed
                .lock()
                .unwrap()
                .insert(session_id.to_owned(), rpc.generation.clone());
            self.store.append(
                "session.observed",
                json!({"upstreamThreadId":thread_id,"observing":true,"model":joined["model"],"approvalPolicy":joined["approvalPolicy"],"sandbox":joined["sandbox"]}),
                Some(session_id),
                None,
            )?;
            // Do not add to `loaded`: execution still performs its own policy checks.
        }
        Ok(json!({"sessionId":session_id,"upstreamThreadId":thread_id,"observing":true}))
    }

    pub(crate) async fn restore_observations(&self) -> Result<()> {
        let ids: Vec<_> = self.observed.lock().unwrap().keys().cloned().collect();
        let mut failure = None;
        for id in ids {
            if self
                .store
                .session(&id)
                .ok()
                .is_none_or(|session| paths::root(&self.store, s(&session, "projectId")).is_err())
            {
                self.observed.lock().unwrap().remove(&id);
                continue;
            }
            if let Err(error) = self.observe_session(&id).await {
                failure.get_or_insert(error);
            }
        }
        failure.map_or(Ok(()), Err)
    }
}

fn check_identity(thread: &Value, expected: &str, root: &std::path::Path) -> Result<()> {
    ensure(
        thread["id"] == expected
            && paths::equal(
                root,
                &paths::canonical(std::path::Path::new(s(thread, "cwd")))?,
            ),
        "WORKSPACE_FORBIDDEN",
        "Original thread identity or directory changed",
    )
}
