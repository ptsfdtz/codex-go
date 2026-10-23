use crate::{ensure, now, s, service::Core, Error, Result};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

fn goal_revision(goal: &Value) -> String {
    format!("{:x}", Sha256::digest(goal.to_string().as_bytes()))
}

impl Core {
    pub async fn session_goal(&self, id: &str) -> Result<Value> {
        use std::sync::atomic::Ordering;
        let session = self.store.session(id)?;
        let root = crate::paths::root(&self.store, s(&session, "projectId"))?;
        let rpc = self.upstream()?;
        ensure(
            !self.store.thread_deleted(s(&session, "upstreamThreadId"))?,
            "THREAD_NOT_FOUND",
            "Original thread was deleted",
        )?;
        let read = rpc
            .request(
                "thread/read",
                json!({"threadId":session["upstreamThreadId"],"includeTurns":false}),
            )
            .await?;
        rpc.validate("v2/ThreadReadResponse", &read)?;
        ensure(
            read["thread"]["id"] == session["upstreamThreadId"]
                && crate::paths::equal(
                    &root,
                    &crate::paths::canonical(std::path::Path::new(s(&read["thread"], "cwd")))?,
                ),
            "WORKSPACE_FORBIDDEN",
            "Goal source identity or workspace changed",
        )?;
        let result = rpc
            .request(
                "thread/goal/get",
                json!({"threadId":session["upstreamThreadId"]}),
            )
            .await?;
        rpc.validate("v2/ThreadGoalGetResponse", &result)?;
        let goal = &result["goal"];
        ensure(
            goal.is_null() || goal["threadId"] == session["upstreamThreadId"],
            "UPSTREAM_PROTOCOL_ERROR",
            "Goal belongs to another thread",
        )?;
        ensure(
            goal.is_null() || s(goal, "objective").len() <= 128000,
            "UPSTREAM_CONTENT_TOO_LARGE",
            "Goal objective too large",
        )?;
        let current = self.store.session(id)?;
        ensure(
            current["upstreamThreadId"] == session["upstreamThreadId"]
                && current["projectId"] == session["projectId"]
                && crate::paths::equal(
                    &root,
                    &crate::paths::root(&self.store, s(&current, "projectId"))?,
                )
                && !self.store.thread_deleted(s(&current, "upstreamThreadId"))?
                && rpc.alive.load(Ordering::SeqCst)
                && self.upstream()?.generation == rpc.generation,
            "SYNC_CONFLICT",
            "Goal source changed during read",
        )?;
        Ok(
            json!({"sessionId":id,"upstreamThreadId":session["upstreamThreadId"],"goal":goal,"goalRevision":if goal.is_null(){Value::Null}else{json!(goal_revision(goal))},"readAt":now()}),
        )
    }
    async fn edit_idle_goal(&self, p: &Value, session: &Value, clear: bool) -> Result<Value> {
        use std::sync::atomic::Ordering;
        let id = s(p, "sessionId");
        ensure(
            clear || (!s(p, "objective").trim().is_empty() && s(p, "objective").len() <= 128000),
            "INVALID_REQUEST",
            "Goal objective too large or empty",
        )?;
        let root = crate::paths::root(&self.store, s(session, "projectId"))?;
        ensure(
            session["archived"] != 1,
            "CONFLICT",
            "Restore archived conversation before editing goal",
        )?;
        let rpc = self.upstream()?;
        let check = || -> Result<()> {
            let current = self.store.session(id)?;
            ensure(
                current["projectId"] == session["projectId"]
                    && current["upstreamThreadId"] == session["upstreamThreadId"]
                    && current["archived"] != 1
                    && crate::paths::equal(
                        &root,
                        &crate::paths::root(&self.store, s(&current, "projectId"))?,
                    )
                    && !self.store.thread_deleted(s(session, "upstreamThreadId"))?
                    && rpc.alive.load(Ordering::SeqCst)
                    && self.upstream()?.generation == rpc.generation,
                "SYNC_CONFLICT",
                "Goal source or authorization changed",
            )
        };
        check()?;
        let before = self.session_goal(id).await?;
        let goal = &before["goal"];
        ensure(
            !goal.is_null() && goal["status"] != "active",
            "CONFLICT",
            "Pause an existing goal before editing",
        )?;
        ensure(
            before["goalRevision"] == p["expectedGoalRevision"],
            "SYNC_CONFLICT",
            "Goal changed; refresh before editing",
        )?;
        let latest = self.latest_upstream_turn(id).await?;
        ensure(
            latest["threadStatus"] == "idle" && latest["turn"]["status"] != "inProgress",
            "CONFLICT",
            "Stop or reconcile upstream activity before editing goal",
        )?;
        let fresh = self.session_goal(id).await?;
        ensure(
            fresh["goalRevision"] == before["goalRevision"]
                && self.upstream()?.generation == rpc.generation,
            "SYNC_CONFLICT",
            "Goal or runtime changed before edit",
        )?;
        let mut params = json!({"threadId":session["upstreamThreadId"]});
        if !clear {
            params["objective"] = p["objective"].clone();
            if let Some(budget) = p.get("tokenBudget") {
                params["tokenBudget"] = budget.clone();
            }
        }
        let params =
            crate::composer::goal_params(rpc.protocol(), params, crate::composer::GoalOrigin::User);
        rpc.validate(
            if clear {
                "v2/ThreadGoalClearParams"
            } else {
                "v2/ThreadGoalSetParams"
            },
            &params,
        )?;
        check()?;
        let response = rpc
            .request(
                if clear {
                    "thread/goal/clear"
                } else {
                    "thread/goal/set"
                },
                params,
            )
            .await;
        let checked: Result<Value> = async {
            let response = response?;
            rpc.validate(
                if clear {
                    "v2/ThreadGoalClearResponse"
                } else {
                    "v2/ThreadGoalSetResponse"
                },
                &response,
            )?;
            let current = self.session_goal(id).await?;
            check()?;
            if clear {
                ensure(
                    response["cleared"] == true && current["goal"].is_null(),
                    "SYNC_CONFLICT",
                    "Goal clear result changed",
                )?;
                return Ok(current);
            }
            ensure(
                rpc.alive.load(Ordering::SeqCst)
                    && self.upstream()?.generation == rpc.generation
                    && current["upstreamThreadId"] == session["upstreamThreadId"]
                    && response["goal"]["threadId"] == session["upstreamThreadId"]
                    && response["goal"]["objective"] == p["objective"]
                    && response["goal"]["status"] == goal["status"]
                    && response["goal"]["tokenBudget"]
                        == *p.get("tokenBudget").unwrap_or(&goal["tokenBudget"])
                    && current["goal"] == response["goal"],
                "SYNC_CONFLICT",
                "Goal edit result or source changed",
            )?;
            Ok(current)
        }
        .await;
        checked.map_err(|_| {
            Error::new(
                "OUTCOME_UNKNOWN",
                "Goal may have changed; refresh before editing again",
            )
        })
    }
    pub async fn models(&self) -> Result<Vec<Value>> {
        let rpc = self.upstream()?;
        let mut cursor = Value::Null;
        let mut seen = HashSet::new();
        let mut models = Vec::new();
        for _ in 0..20 {
            let result = rpc
                .request(
                    "model/list",
                    json!({"limit":100,"cursor":cursor,"includeHidden":false}),
                )
                .await?;
            rpc.validate("v2/ModelListResponse", &result)?;
            for model in result["data"].as_array().unwrap() {
                if model["hidden"] == false {
                    models.push(json!({"model":model["model"],"displayName":model["displayName"],"description":model["description"].as_str().unwrap_or(""),"inputModalities":model["inputModalities"].as_array().cloned().unwrap_or_default(),"isDefault":model["isDefault"],"defaultReasoningEffort":model["defaultReasoningEffort"],"supportedReasoningEfforts":model["supportedReasoningEfforts"]}));
                }
            }
            cursor = result["nextCursor"].clone();
            if cursor.is_null() {
                return Ok(models);
            }
            ensure(
                seen.insert(cursor.to_string()),
                "UPSTREAM_PROTOCOL_ERROR",
                "Model pagination repeated",
            )?;
        }
        Err(Error::new(
            "UPSTREAM_PROTOCOL_ERROR",
            "Model catalog too large",
        ))
    }
    pub async fn check_model(&self, model: &str, effort: &str) -> Result<()> {
        let models = self.models().await?;
        let selected = models.iter().find(|v| v["model"] == model).ok_or_else(|| {
            Error::new("INVALID_REQUEST", "Model is not available to this account")
        })?;
        ensure(
            effort.is_empty()
                || selected["supportedReasoningEfforts"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|v| v["reasoningEffort"] == effort),
            "INVALID_REQUEST",
            "Reasoning effort is not supported by this model",
        )
    }
    async fn compact_idle_session(&self, session: &Value, p: &Value) -> Result<Value> {
        use std::sync::atomic::Ordering;
        ensure(
            self.verified.load(Ordering::SeqCst),
            "SANDBOX_UNVERIFIED",
            "Execution boundary must be verified before compaction",
        )?;
        let id = s(p, "sessionId");
        ensure(
            session["archived"] != 1,
            "CONFLICT",
            "Restore archived conversation before compaction",
        )?;
        let rpc = self.upstream()?;
        let root = crate::paths::root(&self.store, s(session, "projectId"))?;
        let check = || -> Result<()> {
            let current = self.store.session(id)?;
            ensure(
                current["projectId"] == session["projectId"]
                    && current["upstreamThreadId"] == session["upstreamThreadId"]
                    && current["archived"] != 1
                    && crate::paths::equal(
                        &root,
                        &crate::paths::root(&self.store, s(&current, "projectId"))?,
                    )
                    && !self.store.thread_deleted(s(session, "upstreamThreadId"))?
                    && rpc.alive.load(Ordering::SeqCst)
                    && self.upstream()?.generation == rpc.generation,
                "SYNC_CONFLICT",
                "Compaction source changed",
            )
        };
        check()?;
        let before = self.latest_upstream_turn(id).await?;
        ensure(
            before["threadStatus"] == "idle"
                && before["turn"]["status"] != "inProgress"
                && !before["turn"].is_null(),
            "CONFLICT",
            "An idle saved turn is required for compaction",
        )?;
        ensure(
            before["turn"]["upstreamTurnId"] == p["expectedLastTurnId"],
            "SYNC_CONFLICT",
            "Latest turn changed before compaction",
        )?;
        let goal = self.session_goal(id).await?;
        ensure(
            goal["goal"]["status"] != "active",
            "CONFLICT",
            "Pause the active goal before compaction",
        )?;
        let fresh = self.latest_upstream_turn(id).await?;
        ensure(
            fresh == before,
            "SYNC_CONFLICT",
            "Source activity changed before compaction",
        )?;
        check()?;
        let params = json!({"threadId":session["upstreamThreadId"]});
        rpc.validate("v2/ThreadCompactStartParams", &params)?;
        let submitted = rpc.request("thread/compact/start", params).await;
        let confirmed:Result<Value>=async{
            let response=submitted?;
            rpc.validate("v2/ThreadCompactStartResponse",&response)?;
            check()?;
            // This acknowledges submission only. Native lifecycle events remain authoritative.
            self.store.append("session.compactionRequested",json!({"upstreamThreadId":session["upstreamThreadId"],"expectedLastTurnId":p["expectedLastTurnId"]}),Some(id),None)?;
            Ok(json!({"sessionId":id,"upstreamThreadId":session["upstreamThreadId"],"accepted":true,"completed":false}))
        }.await;
        confirmed.map_err(|_| {
            Error::new(
                "OUTCOME_UNKNOWN",
                "Compaction submission was not confirmed; refresh source history before retrying",
            )
        })
    }
    pub async fn manage_session(&self, action: &str, p: &Value) -> Result<Value> {
        let id = s(p, "sessionId");
        let session = self.store.session(id)?;
        {
            let mut busy = self.busy.lock().unwrap();
            let current = self.store.session(id)?;
            ensure(
                !["queued", "running", "waitingApproval", "unknown"]
                    .contains(&s(&current, "status")),
                "CONFLICT",
                "Conversation has active or unreconciled upstream work",
            )?;
            ensure(
                !busy.contains(id)
                    && !self.store.turns(Some(id))?.iter().any(|v| {
                        ["queued", "running", "waitingApproval", "unknown"]
                            .contains(&s(v, "status"))
                    }),
                "CONFLICT",
                "Stop or reconcile the active turn before managing this conversation",
            )?;
            busy.insert(id.into());
        }
        let result = self.manage_idle_session(action, p, &session).await;
        self.busy.lock().unwrap().remove(id);
        result
    }
    async fn manage_idle_session(&self, action: &str, p: &Value, session: &Value) -> Result<Value> {
        let id = s(p, "sessionId");
        let thread = s(session, "upstreamThreadId");
        let rpc = self.upstream()?;
        if action == "sessions.goal.edit" || action == "sessions.goal.clear" {
            return self
                .edit_idle_goal(p, session, action == "sessions.goal.clear")
                .await;
        }
        if action == "sessions.compact" {
            return self.compact_idle_session(session, p).await;
        }
        if action == "sessions.revise" {
            return self.revise_idle_session(session, p).await;
        }
        if action == "sessions.revert" {
            return self.revert_idle_session(session, p).await;
        }
        if action == "sessions.fork" {
            return self
                .fork_idle_session(session, p["lastTurnId"].as_str())
                .await;
        }
        let (method, schema) = match action {
            "sessions.rename" => ("thread/name/set", "v2/ThreadSetNameResponse"),
            "sessions.archive" => ("thread/archive", "v2/ThreadArchiveResponse"),
            "sessions.restore" => ("thread/unarchive", "v2/ThreadUnarchiveResponse"),
            "sessions.delete" => ("thread/delete", "v2/ThreadDeleteResponse"),
            "sessions.pin" => ("", ""),
            _ => return Err(Error::new("INVALID_REQUEST", "Unsupported session action")),
        };
        if !method.is_empty() {
            let mut params = json!({"threadId":thread});
            if action == "sessions.rename" {
                params["name"] = p["title"].clone();
            }
            let result = rpc.request(method, params).await?;
            rpc.validate(schema, &result)?;
        }
        self.loaded.lock().unwrap().remove(thread);
        if action == "sessions.delete" {
            self.store.record_thread_deletion(thread)?;
            self.store.delete_session(id)?;
            self.store
                .append("session.deleted", json!({"sessionId":id}), Some(id), None)?;
            return Ok(json!({"deleted":true,"sessionId":id}));
        }
        self.store.exec(
            "INSERT OR IGNORE INTO session_options(sessionId) VALUES(?)",
            [id],
        )?;
        match action {
            "sessions.rename" => {
                self.store.exec(
                    "UPDATE sessions SET title=? WHERE sessionId=?",
                    [s(p, "title"), id],
                )?;
            }
            "sessions.archive" | "sessions.restore" => {
                self.store.exec(
                    "UPDATE session_options SET archived=? WHERE sessionId=?",
                    rusqlite::params![i32::from(action == "sessions.archive"), id],
                )?;
            }
            "sessions.pin" => {
                self.store.exec(
                    "UPDATE session_options SET pinned=? WHERE sessionId=?",
                    rusqlite::params![i32::from(p["pinned"] == true), id],
                )?;
            }
            _ => {}
        }
        self.store.exec(
            "UPDATE sessions SET updatedAt=? WHERE sessionId=?",
            [now().as_str(), id],
        )?;
        let updated = self.store.session(id)?;
        self.store
            .append("session.updated", updated.clone(), Some(id), None)?;
        Ok(json!({"session":updated}))
    }
    async fn revise_idle_session(&self, session: &Value, p: &Value) -> Result<Value> {
        use std::sync::atomic::Ordering;
        let id = s(session, "sessionId");
        let _permit = self
            .task_limit
            .try_acquire()
            .map_err(|_| Error::new("RATE_LIMITED", "Two task starts are active"))?;
        let active = self
            .store
            .turns(None)?
            .iter()
            .filter(|turn| ["queued", "running", "waitingApproval"].contains(&s(turn, "status")))
            .count();
        ensure(
            active + self.busy.lock().unwrap().len() <= 2,
            "RATE_LIMITED",
            "Two tasks are already active",
        )?;
        ensure(
            self.verified.load(Ordering::SeqCst),
            "SANDBOX_UNVERIFIED",
            "Execution boundary must be verified before revising",
        )?;
        let rpc = self.upstream()?;
        let root = crate::paths::root(&self.store, s(session, "projectId"))?;
        crate::codex::settings(&rpc, &root).await?;
        let model = p["model"].as_str().unwrap_or(s(session, "model"));
        let effort = p["effort"].as_str().unwrap_or(s(session, "effort"));
        if !model.is_empty() {
            self.check_model(model, effort).await?;
        } else {
            ensure(
                effort.is_empty(),
                "INVALID_REQUEST",
                "Select a model before reasoning effort",
            )?;
        }
        let mut cursor = None::<String>;
        let mut seen = HashSet::new();
        let mut source = None;
        let mut user_count = 0;
        let mut complete = false;
        for _ in 0..100 {
            let (source_rpc, page) = self
                .history_source(id, cursor.as_deref(), 50, "desc")
                .await?;
            ensure(
                source_rpc.generation == rpc.generation,
                "SYNC_CONFLICT",
                "Runtime changed while preparing revision",
            )?;
            for entry in page["data"].as_array().unwrap() {
                if entry["turnId"] == p["beforeTurnId"] && entry["item"]["type"] == "userMessage" {
                    user_count += 1;
                    if entry["item"]["id"] == p["itemId"] {
                        source = Some(entry["item"].clone());
                    }
                }
            }
            cursor = page["nextCursor"].as_str().map(str::to_owned);
            let Some(next) = &cursor else {
                complete = true;
                break;
            };
            ensure(
                seen.insert(next.clone()),
                "UPSTREAM_PROTOCOL_ERROR",
                "Repeated revision input cursor",
            )?;
        }
        ensure(
            complete,
            "UPSTREAM_CONTENT_TOO_LARGE",
            "Saved history exceeds bounded revision scan",
        )?;
        ensure(
            user_count == 1,
            "UNSUPPORTED",
            "Replaying multiple user inputs requires preserving their ordering",
        )?;
        let source = source
            .ok_or_else(|| Error::new("CONTENT_CHANGED", "Original user input was not found"))?;
        let parts = source["content"]
            .as_array()
            .ok_or_else(|| Error::new("UPSTREAM_PROTOCOL_ERROR", "Invalid original input"))?;
        ensure(
            parts.len() <= 128,
            "UNSUPPORTED",
            "Original input exceeds revision capacity",
        )?;
        let input = crate::queue::replace_resource_text(&json!({"input":parts}), s(p, "text"))?;
        self.authorize_native_resources(s(session, "projectId"), &root, &json!({"input":input}))
            .await?;
        ensure(
            self.upstream()?.generation == rpc.generation
                && crate::paths::equal(
                    &root,
                    &crate::paths::root(&self.store, s(session, "projectId"))?,
                ),
            "SYNC_CONFLICT",
            "Runtime changed before revision",
        )?;
        self.revert_idle_session(session, p).await?;
        let result = async {
            let current = self.store.session(id)?;
            ensure(
                self.upstream()?.generation == rpc.generation
                    && current["upstreamThreadId"] == session["upstreamThreadId"]
                    && current["projectId"] == session["projectId"]
                    && crate::paths::equal(
                        &root,
                        &crate::paths::root(&self.store, s(session, "projectId"))?,
                    ),
                "SYNC_CONFLICT",
                "Revision source changed after revert",
            )?;
            self.start_inner(
                &rpc,
                id,
                s(p, "text"),
                crate::tasks::ComposerOptions {
                    model: p["model"].as_str(),
                    effort: p["effort"].as_str(),
                    permission_mode: p["permissionMode"].as_str().unwrap_or("workspace"),
                    mode: p["mode"].as_str().unwrap_or("default"),
                    attachments: None,
                    native_input: Some(&input),
                    skills: None,
                    goal_resume_revision: None,
                },
            )
            .await
        }
        .await;
        result.map(|turn|json!({"sessionId":id,"upstreamThreadId":session["upstreamThreadId"],"turn":turn,"retainedImages":input.iter().filter(|part|part["type"]=="localImage").count(),"retainedSkills":input.iter().filter(|part|part["type"]=="skill").count()})).map_err(|error|Error::new("REVISION_SEND_FAILED",&format!("History was reverted; replacement send is not confirmed. Refresh before retrying. {}",error.message)))
    }
    async fn revert_idle_session(&self, session: &Value, p: &Value) -> Result<Value> {
        use std::sync::atomic::Ordering;
        let id = s(session, "sessionId");
        ensure(
            session["archived"] != 1,
            "CONFLICT",
            "Restore conversation before editing history",
        )?;
        let root = crate::paths::root(&self.store, s(session, "projectId"))?;
        let rpc = self.upstream()?;
        let latest = self.latest_upstream_turn(id).await?;
        ensure(
            latest["threadStatus"] == "idle"
                && latest["turn"]["upstreamTurnId"] == p["expectedLastTurnId"]
                && crate::tasks::terminal(s(&latest["turn"], "status")),
            "SYNC_CONFLICT",
            "History or activity changed; refresh before reverting",
        )?;
        let mut cursor = Value::Null;
        let mut seen = HashSet::new();
        let mut found = false;
        for _ in 0..100 {
            let page = rpc.request("thread/turns/list", json!({"threadId":session["upstreamThreadId"],"cursor":cursor,"limit":100,"sortDirection":"desc","itemsView":"notLoaded"})).await?;
            rpc.validate("v2/ThreadTurnsListResponse", &page)?;
            let turns = page["data"].as_array().unwrap();
            ensure(
                turns.len() <= 100,
                "UPSTREAM_PROTOCOL_ERROR",
                "Turn page exceeded bound",
            )?;
            if let Some(turn) = turns.iter().find(|turn| turn["id"] == p["beforeTurnId"]) {
                ensure(
                    crate::tasks::terminal(s(turn, "status")),
                    "CONFLICT",
                    "History boundary is not terminal",
                )?;
                found = true;
                break;
            }
            cursor = page["nextCursor"].clone();
            if cursor.is_null() {
                break;
            }
            ensure(
                seen.insert(cursor.to_string()),
                "UPSTREAM_PROTOCOL_ERROR",
                "Repeated history cursor",
            )?;
        }
        ensure(
            found,
            "TURN_NOT_FOUND",
            "Requested history boundary was not found",
        )?;
        let check = || -> Result<()> {
            let current = self.store.session(id)?;
            ensure(
                current["upstreamThreadId"] == session["upstreamThreadId"]
                    && current["projectId"] == session["projectId"]
                    && current["archived"] != 1
                    && crate::paths::equal(
                        &root,
                        &crate::paths::root(&self.store, s(session, "projectId"))?,
                    )
                    && !self.store.thread_deleted(s(session, "upstreamThreadId"))?
                    && self.upstream()?.generation == rpc.generation
                    && rpc.alive.load(Ordering::SeqCst),
                "SYNC_CONFLICT",
                "History source authorization changed",
            )
        };
        check()?;
        let goal = rpc
            .request(
                "thread/goal/get",
                json!({"threadId":session["upstreamThreadId"]}),
            )
            .await?;
        rpc.validate("v2/ThreadGoalGetResponse", &goal)?;
        ensure(
            goal["goal"]["status"] != "active",
            "CONFLICT",
            "Pause the active goal before reverting history",
        )?;
        let fresh = self.latest_upstream_turn(id).await?;
        ensure(
            fresh["threadStatus"] == "idle"
                && fresh["turn"]["upstreamTurnId"] == p["expectedLastTurnId"],
            "SYNC_CONFLICT",
            "History changed before revert",
        )?;
        check()?;
        // Native revert is a persisted-history operation; it does not execute or
        // undo workspace files. Native API has no atomic expected-revision field.
        let response = rpc
            .request(
                "thread/revert",
                json!({"threadId":session["upstreamThreadId"],"beforeTurnId":p["beforeTurnId"]}),
            )
            .await;
        // A notification may already have invalidated the journal. Repeating the
        // invalidation is conservative and also handles a lost notification.
        self.store.invalidate_history(id)?;
        let result: Result<Value> = (|| {
            let response = response?;
            rpc.validate("v2/ThreadRevertResponse", &response)?;
            check()?;
            ensure(
                response["thread"]["id"] == session["upstreamThreadId"]
                    && crate::paths::equal(
                        &root,
                        &crate::paths::canonical(std::path::Path::new(s(
                            &response["thread"],
                            "cwd",
                        )))?,
                    ),
                "UPSTREAM_PROTOCOL_ERROR",
                "Revert changed thread identity or workspace",
            )?;
            Ok(
                json!({"sessionId":id,"upstreamThreadId":session["upstreamThreadId"],"beforeTurnId":p["beforeTurnId"]}),
            )
        })();
        result.map_err(|_| {
            Error::new(
                "OUTCOME_UNKNOWN",
                "History may have changed; refresh before any new revert or send",
            )
        })
    }
    async fn fork_idle_session(&self, session: &Value, last_turn: Option<&str>) -> Result<Value> {
        use std::sync::atomic::Ordering;
        let id = s(session, "sessionId");
        let project = s(session, "projectId");
        let thread = s(session, "upstreamThreadId");
        let root = crate::paths::root(&self.store, project)?;
        let rpc = self.upstream()?;
        // Resolve the source through the authority before creating a derived identity.
        let latest = self.latest_upstream_turn(id).await?;
        ensure(
            latest["threadStatus"] == "idle" && latest["turn"]["status"] != "inProgress",
            "CONFLICT",
            "Reconcile or stop source activity before forking",
        )?;
        ensure(
            self.upstream()?.generation == rpc.generation,
            "UPSTREAM_UNAVAILABLE",
            "Runtime changed before fork",
        )?;
        if let Some(target) = last_turn {
            let mut cursor = Value::Null;
            let mut seen = HashSet::new();
            let mut found = false;
            for _ in 0..100 {
                let page = rpc.request("thread/turns/list",json!({"threadId":thread,"cursor":cursor,"limit":100,"sortDirection":"desc","itemsView":"notLoaded"})).await?;
                rpc.validate("v2/ThreadTurnsListResponse", &page)?;
                let turns = page["data"].as_array().unwrap();
                ensure(
                    turns.len() <= 100,
                    "UPSTREAM_PROTOCOL_ERROR",
                    "Turn page exceeded requested bound",
                )?;
                if let Some(turn) = turns.iter().find(|turn| turn["id"] == target) {
                    ensure(
                        crate::tasks::terminal(s(turn, "status")),
                        "CONFLICT",
                        "Fork boundary is not terminal",
                    )?;
                    found = true;
                    break;
                }
                cursor = page["nextCursor"].clone();
                if cursor.is_null() {
                    break;
                }
                ensure(
                    seen.insert(cursor.to_string()),
                    "UPSTREAM_PROTOCOL_ERROR",
                    "Repeated turn cursor",
                )?;
            }
            ensure(
                found,
                "TURN_NOT_FOUND",
                "Requested fork boundary was not found in bounded source history",
            )?;
        }
        crate::codex::settings(&rpc, &root).await?;
        ensure(
            self.verified.load(Ordering::SeqCst),
            "SANDBOX_UNVERIFIED",
            "Native boundary probe must pass before forking",
        )?;
        let current = self.store.session(id)?;
        ensure(
            current["upstreamThreadId"] == session["upstreamThreadId"]
                && current["projectId"] == session["projectId"]
                && crate::paths::equal(&root, &crate::paths::root(&self.store, project)?)
                && self.upstream()?.generation == rpc.generation
                && !self.store.thread_deleted(thread)?,
            "SYNC_CONFLICT",
            "Source changed before fork submission",
        )?;
        let mut params = json!({"threadId":thread,"cwd":root,
            "approvalPolicy":"on-request","approvalsReviewer":"user",
            "config":{"default_permissions":"agentdeck"},"excludeTurns":true});
        if let Some(target) = last_turn {
            params["lastTurnId"] = json!(target);
        }
        let response = rpc.request("thread/fork", params).await.map_err(|e| {
            if ["UPSTREAM_TIMEOUT", "UPSTREAM_UNAVAILABLE"].contains(&e.code.as_str()) {
                Error::new(
                    "OUTCOME_UNKNOWN",
                    "Fork outcome unknown; refresh the thread index before any new fork",
                )
            } else {
                e
            }
        })?;
        // Once submitted, any validation/index failure is uncertain, never safe to retry.
        let result: Result<Value> = (|| {
            rpc.validate("v2/ThreadForkResponse", &response)?;
            crate::codex::checked_thread(&response, &root, self.verified.load(Ordering::SeqCst))?;
            let fork = &response["thread"];
            ensure(
                !s(fork, "id").is_empty() && fork["id"] != session["upstreamThreadId"],
                "UPSTREAM_PROTOCOL_ERROR",
                "Fork did not create a distinct identity",
            )?;
            if let Some(parent) = fork["forkedFromId"].as_str() {
                ensure(
                    parent == thread,
                    "UPSTREAM_PROTOCOL_ERROR",
                    "Unexpected fork parent",
                )?;
            }
            let current = self.store.session(id)?;
            let current_root = crate::paths::root(&self.store, project)?;
            ensure(
                current["upstreamThreadId"] == session["upstreamThreadId"]
                    && current["projectId"] == session["projectId"]
                    && crate::paths::equal(&root, &current_root)
                    && !self.store.thread_deleted(thread)?
                    && rpc.alive.load(Ordering::SeqCst)
                    && self.upstream()?.generation == rpc.generation,
                "SYNC_CONFLICT",
                "Fork source or authorization changed",
            )?;
            let fork_id = self
                .store
                .index_fork(project, thread, fork, s(session, "title"))?;
            let forked = self.store.session(&fork_id)?;
            self.store
                .append("session.updated", forked.clone(), Some(&fork_id), None)?;
            Ok(json!({"session":forked,"sourceSessionId":id}))
        })();
        result.map_err(|_| {
            Error::new(
                "OUTCOME_UNKNOWN",
                "Fork may exist upstream; refresh the thread index before any new fork",
            )
        })
    }
}
