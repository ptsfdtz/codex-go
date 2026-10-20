use crate::{
    codex, ensure, now, paths,
    rpc::{validate, Rpc},
    s,
    service::Core,
    uid, Error, Result,
};
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
impl Core {
    pub fn upstream(&self) -> Result<Arc<Rpc>> {
        ensure(
            self.ready.load(Ordering::SeqCst),
            "UPSTREAM_UNAVAILABLE",
            "Codex is not ready",
        )?;
        self.rpc
            .read()
            .unwrap()
            .clone()
            .ok_or_else(|| Error::new("UPSTREAM_UNAVAILABLE", "Codex disconnected"))
    }
    pub async fn create_session(&self, project: &str, title: &str) -> Result<Value> {
        let rpc = self.upstream()?;
        let root = paths::root(&self.store, project)?;
        codex::settings(&rpc, &root).await?;
        let response=rpc.request("thread/start",json!({"cwd":root,"approvalPolicy":"on-request","approvalsReviewer":"user","config":{"default_permissions":"agentdeck"}})).await?;
        validate("v2/ThreadStartResponse", &response)?;
        codex::checked_thread(&response, &root, self.verified.load(Ordering::SeqCst))?;
        let id = uid("session");
        let ts = now();
        self.store.exec(
            "INSERT INTO sessions VALUES(?,?,?,?,?,?,?)",
            rusqlite::params![
                id,
                project,
                s(&response["thread"], "id"),
                title,
                "idle",
                ts,
                ts
            ],
        )?;
        self.loaded
            .lock()
            .unwrap()
            .insert(s(&response["thread"], "id").into());
        let session = self.store.session(&id)?;
        self.store
            .append("session.updated", session.clone(), Some(&id), None)?;
        Ok(session)
    }
    pub async fn start_turn(&self, session_id: &str, text: &str) -> Result<Value> {
        let rpc = self.upstream()?;
        let _permit = self
            .task_limit
            .try_acquire()
            .map_err(|_| Error::new("RATE_LIMITED", "Two task starts are active"))?;
        {
            let mut busy = self.busy.lock().unwrap();
            ensure(!busy.contains(session_id), "CONFLICT", "Session is busy")?;
            let turns = self.store.turns(Some(session_id))?;
            ensure(
                !turns.iter().any(|v| {
                    ["queued", "running", "waitingApproval", "unknown"].contains(&s(v, "status"))
                }),
                "CONFLICT",
                "Session has active or unreconciled turn",
            )?;
            let active = self
                .store
                .turns(None)?
                .iter()
                .filter(|v| ["queued", "running", "waitingApproval"].contains(&s(v, "status")))
                .count();
            ensure(
                active + busy.len() < 2,
                "RATE_LIMITED",
                "Two tasks are already active",
            )?;
            busy.insert(session_id.into());
        }
        let result = self.start_inner(&rpc, session_id, text).await;
        self.busy.lock().unwrap().remove(session_id);
        result
    }
    async fn start_inner(&self, rpc: &Rpc, session_id: &str, text: &str) -> Result<Value> {
        let mut session = self.store.session(session_id)?;
        let root = paths::root(&self.store, s(&session, "projectId"))?;
        codex::settings(rpc, &root).await?;
        let loaded = self
            .loaded
            .lock()
            .unwrap()
            .contains(s(&session, "upstreamThreadId"));
        if !loaded {
            let result=rpc.request("thread/resume",json!({"threadId":session["upstreamThreadId"],"cwd":root,"approvalPolicy":"on-request","approvalsReviewer":"user","config":{"default_permissions":"agentdeck"},"excludeTurns":true})).await;
            let response = match result {
                Ok(v) => {
                    validate("v2/ThreadResumeResponse", &v)?;
                    v
                }
                Err(e)
                    if e.code == "UPSTREAM_ERROR"
                        && e.message.starts_with("no rollout found for thread id ")
                        && self.store.turns(Some(session_id))?.is_empty() =>
                {
                    let v=rpc.request("thread/start",json!({"cwd":root,"approvalPolicy":"on-request","approvalsReviewer":"user","config":{"default_permissions":"agentdeck"}})).await?;
                    validate("v2/ThreadStartResponse", &v)?;
                    codex::checked_thread(&v, &root, self.verified.load(Ordering::SeqCst))?;
                    self.store.exec(
                        "UPDATE sessions SET upstreamThreadId=? WHERE sessionId=?",
                        [s(&v["thread"], "id"), session_id],
                    )?;
                    session["upstreamThreadId"] = v["thread"]["id"].clone();
                    v
                }
                Err(e) => return Err(e),
            };
            codex::checked_thread(&response, &root, self.verified.load(Ordering::SeqCst))?;
            self.loaded
                .lock()
                .unwrap()
                .insert(s(&session, "upstreamThreadId").into());
        }
        let turn = uid("turn");
        self.store.exec(
            "INSERT INTO turns VALUES(?,?,NULL,?,?,NULL,NULL)",
            rusqlite::params![turn, session_id, "queued", now()],
        )?;
        self.store.status(session_id, Some(&turn), "queued", None)?;
        self.store.append(
            "turn.queued",
            json!({"turn":self.store.turn(&turn)?,"text":text}),
            Some(session_id),
            Some(&turn),
        )?;
        let result=async{let response=rpc.request("turn/start",json!({"threadId":session["upstreamThreadId"],"input":[{"type":"text","text":text,"text_elements":[]}],"approvalPolicy":"on-request","approvalsReviewer":"user"})).await?;validate("v2/TurnStartResponse",&response)?;
        let current=self.store.turn(&turn)?;ensure(current["upstreamTurnId"].is_null()||current["upstreamTurnId"]==response["turn"]["id"],"UPSTREAM_PROTOCOL_ERROR","Turn identity mismatch")?;
        self.store.exec("UPDATE turns SET upstreamTurnId=? WHERE turnId=? AND upstreamTurnId IS NULL",[s(&response["turn"],"id"),&turn])?;
        if self.store.turn(&turn)?["status"]=="queued"{self.store.status(session_id,Some(&turn),"running",None)?;self.store.append("turn.started",json!({"turn":self.store.turn(&turn)?}),Some(session_id),Some(&turn))?;}self.store.turn(&turn)
    }.await;
        if let Err(e) = &result {
            let current = self.store.turn(&turn)?;
            if !terminal(s(&current, "status")) {
                self.store
                    .status(session_id, Some(&turn), "unknown", Some(&e.message))?;
                self.store.append(
                    "session.updated",
                    json!({"status":"unknown","error":crate::redact(&e.message)}),
                    Some(session_id),
                    Some(&turn),
                )?;
            }
        }
        result
    }
    pub async fn interrupt(&self, session_id: &str, turn_id: &str) -> Result<Value> {
        let rpc = self.upstream()?;
        let session = self.store.session(session_id)?;
        let turn = self.store.turn(turn_id)?;
        ensure(
            turn["sessionId"] == session_id
                && !s(&turn, "upstreamTurnId").is_empty()
                && ["running", "waitingApproval", "unknown"].contains(&s(&turn, "status")),
            "CONFLICT",
            "Turn is not active in this session",
        )?;
        self.store.append(
            "turn.interruptRequested",
            json!({}),
            Some(session_id),
            Some(turn_id),
        )?;
        for _ in 0..30 {
            let current = self.store.turn(turn_id)?;
            if terminal(s(&current, "status")) {
                return Ok(json!({"requested":false,"status":current["status"]}));
            }
            match rpc
                .request(
                    "turn/interrupt",
                    json!({"threadId":session["upstreamThreadId"],"turnId":turn["upstreamTurnId"]}),
                )
                .await
            {
                Ok(v) => {
                    validate("v2/TurnInterruptResponse", &v)?;
                    return Ok(
                        json!({"requested":true,"status":self.store.turn(turn_id)?["status"]}),
                    );
                }
                Err(e)
                    if e.code == "UPSTREAM_ERROR" && e.message == "no active turn to interrupt" =>
                {
                    tokio::time::sleep(Duration::from_millis(100)).await
                }
                Err(e) => return Err(e),
            }
        }
        Err(Error::new(
            "UPSTREAM_TIMEOUT",
            "Interrupt not confirmed; state remains unknown",
        ))
    }
    pub fn route(
        &self,
        thread: &str,
        turn: Option<&str>,
        bind: bool,
    ) -> Result<Option<(Value, Option<Value>)>> {
        let sessions = self
            .store
            .query("SELECT * FROM sessions WHERE upstreamThreadId=?", [thread])?;
        let Some(session) = sessions.into_iter().next() else {
            return Ok(None);
        };
        let id = s(&session, "sessionId");
        let mut found = if let Some(turn) = turn {
            self.store
                .query(
                    "SELECT * FROM turns WHERE sessionId=? AND upstreamTurnId=?",
                    [id, turn],
                )?
                .into_iter()
                .next()
        } else {
            None
        };
        if bind && found.is_none() {
            if let Some(turn) = turn {
                let queued=self.store.query("SELECT * FROM turns WHERE sessionId=? AND status='queued' AND upstreamTurnId IS NULL",[id])?;
                if queued.len() == 1 {
                    self.store.exec("UPDATE turns SET upstreamTurnId=? WHERE turnId=? AND upstreamTurnId IS NULL",[turn,s(&queued[0],"turnId")])?;
                    found = Some(self.store.turn(s(&queued[0], "turnId"))?);
                }
            }
        }
        Ok(Some((session, found)))
    }
    pub fn notification(&self, rpc: &Rpc, v: &Value) -> Result<()> {
        let method = s(v, "method");
        let p = &v["params"];
        if method == "serverRequest/resolved" {
            validate("v2/ServerRequestResolvedNotification", p)?;
            let rows=self.store.query("SELECT * FROM approvals WHERE generation=? AND upstreamRequestJson=? AND status IN ('pending','sending')",[rpc.generation.clone(),p["requestId"].to_string()])?;
            for row in rows {
                if let Some((session, _)) = self.route(s(p, "threadId"), None, false)? {
                    if session["sessionId"] == row["sessionId"] {
                        self.finish_approval(&row, "resolved")?;
                    }
                }
            }
            return Ok(());
        }
        let name = match method {
            "turn/started" => "TurnStarted",
            "turn/completed" => "TurnCompleted",
            "turn/plan/updated" => "TurnPlanUpdated",
            "turn/diff/updated" => "TurnDiffUpdated",
            "item/started" => "ItemStarted",
            "item/completed" => "ItemCompleted",
            "item/agentMessage/delta" => "AgentMessageDelta",
            "item/plan/delta" => "PlanDelta",
            "item/commandExecution/outputDelta" => "CommandExecutionOutputDelta",
            "item/fileChange/outputDelta" => "FileChangeOutputDelta",
            "item/fileChange/patchUpdated" => "FileChangePatchUpdated",
            "item/mcpToolCall/progress" => "McpToolCallProgress",
            "error" => "Error",
            _ => return Ok(()),
        };
        validate(&format!("v2/{name}Notification"), p)?;
        let tid = p["turnId"].as_str().or(p["turn"]["id"].as_str());
        let Some((session, turn)) = self.route(s(p, "threadId"), tid, true)? else {
            return Ok(());
        };
        let session_id = s(&session, "sessionId");
        if method == "turn/completed" {
            let turn = turn.ok_or_else(|| {
                Error::new("UPSTREAM_PROTOCOL_ERROR", "Completion has no matching turn")
            })?;
            let status = s(&p["turn"], "status");
            ensure(
                terminal(status),
                "UPSTREAM_PROTOCOL_ERROR",
                "Nonterminal completion",
            )?;
            if terminal(s(&turn, "status")) {
                return Ok(());
            }
            self.store.status(
                session_id,
                Some(s(&turn, "turnId")),
                status,
                p["turn"]["error"]["message"].as_str(),
            )?;
            for row in self
                .store
                .approval_rows(Some(session_id))?
                .into_iter()
                .filter(|r| r["turnId"] == turn["turnId"])
            {
                self.finish_approval(&row, "expired")?;
            }
            self.store.append(
                &format!("turn.{status}"),
                json!({"turn":self.store.turn(s(&turn,"turnId"))?,"upstream":p["turn"]}),
                Some(session_id),
                Some(s(&turn, "turnId")),
            )?;
            return Ok(());
        }
        if method == "turn/started" {
            if let Some(turn) = &turn {
                if turn["status"] == "queued" {
                    self.store
                        .status(session_id, Some(s(turn, "turnId")), "running", None)?;
                }
            }
        }
        let mut payload = p.clone();
        payload["method"] = json!(method);
        self.store.append(
            "turn.progress",
            payload,
            Some(session_id),
            turn.as_ref().map(|t| s(t, "turnId")),
        )?;
        Ok(())
    }
    pub fn lost(&self) -> Result<()> {
        self.ready.store(false, Ordering::SeqCst);
        self.loaded.lock().unwrap().clear();
        self.invalidate_approvals(false)?;
        for turn in self.store.turns(None)? {
            if ["running", "queued", "waitingApproval"].contains(&s(&turn, "status")) {
                self.store.status(
                    s(&turn, "sessionId"),
                    Some(s(&turn, "turnId")),
                    "unknown",
                    None,
                )?;
                self.store.append(
                    "session.updated",
                    json!({"status":"unknown"}),
                    Some(s(&turn, "sessionId")),
                    Some(s(&turn, "turnId")),
                )?;
            }
        }
        self.store
            .append("host.status", json!({"status":"disconnected"}), None, None)?;
        Ok(())
    }
    pub async fn reconcile(&self, rpc: &Rpc) -> Result<()> {
        for turn in self
            .store
            .turns(None)?
            .into_iter()
            .filter(|v| v["status"] == "unknown" && !s(v, "upstreamTurnId").is_empty())
        {
            let result:Result<()>=async{let session=self.store.session(s(&turn,"sessionId"))?;paths::root(&self.store,s(&session,"projectId"))?;let response=rpc.request("thread/read",json!({"threadId":session["upstreamThreadId"],"includeTurns":false})).await?;validate("v2/ThreadReadResponse",&response)?;let mut cursor=Value::Null;let mut seen=std::collections::HashSet::new();for _ in 0..100{let response=rpc.request("thread/turns/list",json!({"threadId":session["upstreamThreadId"],"cursor":cursor,"limit":100,"itemsView":"summary"})).await?;validate("v2/ThreadTurnsListResponse",&response)?;if let Some(found)=response["data"].as_array().unwrap().iter().find(|v|v["id"]==turn["upstreamTurnId"]){if terminal(s(found,"status")){self.notification(rpc,&json!({"method":"turn/completed","params":{"threadId":session["upstreamThreadId"],"turn":found}}))?;}break;}cursor=response["nextCursor"].clone();if cursor.is_null(){break;}ensure(seen.insert(cursor.to_string()),"UPSTREAM_PROTOCOL_ERROR","Repeated history cursor")?;}Ok(())}.await;
            let _ = result;
        }
        Ok(())
    }
    pub async fn sync_workspaces(&self) -> Result<Value> {
        let rpc = self.upstream()?;
        let config = rpc
            .request("config/read", json!({"includeLayers":false}))
            .await?;
        validate("v2/ConfigReadResponse", &config)?;
        let mut paths = std::collections::HashSet::new();
        if let Some(projects) = config["config"]["projects"].as_object() {
            for (path, p) in projects {
                if p["trust_level"] == "trusted" {
                    paths.insert(path.clone());
                }
            }
        }
        let started = std::time::Instant::now();
        for archived in [false, true] {
            let mut cursor = Value::Null;
            let mut seen = std::collections::HashSet::new();
            let mut done = false;
            for _ in 0..100 {
                ensure(
                    started.elapsed() < Duration::from_secs(60),
                    "SYNC_LIMIT",
                    "Workspace sync timed out; grants unchanged",
                )?;
                let response=rpc.request_timeout("thread/list",json!({"cursor":cursor,"limit":100,"modelProviders":[],"sourceKinds":["cli","vscode","appServer"],"archived":archived}),Duration::from_secs(15)).await?;
                validate("v2/ThreadListResponse", &response)?;
                for thread in response["data"].as_array().unwrap() {
                    paths.insert(s(thread, "cwd").to_owned());
                }
                ensure(
                    paths.len() <= 1000,
                    "SYNC_LIMIT",
                    "More than 1000 project directories",
                )?;
                cursor = response["nextCursor"].clone();
                if cursor.is_null() {
                    done = true;
                    break;
                }
                ensure(
                    seen.insert(cursor.to_string()),
                    "UPSTREAM_PROTOCOL_ERROR",
                    "Repeated workspace cursor",
                )?;
            }
            ensure(
                done,
                "SYNC_LIMIT",
                "Too many history pages; grants unchanged",
            )?;
        }
        let home = std::env::var_os("USERPROFILE")
            .map(std::path::PathBuf::from)
            .unwrap_or_default();
        let codex = std::env::var_os("CODEX_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| home.join(".codex"));
        let excluded = [std::env::temp_dir(), codex];
        let mut roots = std::collections::BTreeMap::new();
        let mut skipped = 0;
        for path in paths {
            match paths::canonical(Path::new(&path)) {
                Ok(root)
                    if root.is_dir()
                        && root.parent().is_some()
                        && !paths::equal(&root, &home)
                        && !excluded.iter().any(|p| paths::within(p, &root)) =>
                {
                    roots.insert(root.to_string_lossy().to_lowercase(), root);
                }
                _ => skipped += 1,
            }
        }
        let mut synced = 0;
        for root in roots.values() {
            if paths::add_local(&self.store, root).is_ok() {
                synced += 1;
            } else {
                skipped += 1;
            }
        }
        ensure(
            synced > 0,
            "NO_WORKSPACES",
            "未找到可同步项目，请在 Codex 建立会话，或从更多菜单添加目录",
        )?;
        self.store.set_meta("lastWorkspaceSync", &now())?;
        Ok(json!({"synced":synced,"skipped":skipped,"at":now()}))
    }
}
pub fn terminal(status: &str) -> bool {
    ["completed", "failed", "interrupted"].contains(&status)
}
