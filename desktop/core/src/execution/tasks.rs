use crate::{codex, ensure, now, paths, rpc::Rpc, s, service::Core, uid, Error, Result};
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
pub(crate) struct ComposerOptions<'a> {
    pub(crate) model: Option<&'a str>,
    pub(crate) effort: Option<&'a str>,
    pub(crate) response_speed: Option<&'a str>,
    pub(crate) permission_mode: &'a str,
    pub(crate) mode: &'a str,
    pub(crate) attachments: Option<&'a Value>,
    pub(crate) references: Option<&'a Value>,
    pub(crate) native_input: Option<&'a [Value]>,
    pub(crate) skills: Option<&'a Value>,
    pub(crate) goal_resume_revision: Option<&'a str>,
}
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
        let mut params = json!({"cwd":root,"approvalPolicy":"on-request","approvalsReviewer":"user","config":{"default_permissions":"agentdeck"}});
        if project == paths::CHAT_PROJECT {
            params["developerInstructions"] = json!("This is a general conversation, not a coding task. Answer the user's questions directly. There is no user project attached. Do not inspect projects, run commands, edit files, or create tasks unless the user switches to a project conversation.");
        }
        let response = rpc.request("thread/start", params).await?;
        rpc.validate("v2/ThreadStartResponse", &response)?;
        codex::checked_thread(&response, &root, self.verified.load(Ordering::SeqCst))?;
        // Publish the initial title to the authoritative thread, not only our index.
        // Empty-history resume still depends on the upstream version and must not
        // be repaired by silently replacing this thread's identity.
        let named = rpc
            .request(
                "thread/name/set",
                json!({"threadId":response["thread"]["id"],"name":title}),
            )
            .await?;
        rpc.validate("v2/ThreadSetNameResponse", &named)?;
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
        self.store
            .set_meta(&format!("freshThread:{id}"), s(&response["thread"], "id"))?;
        let session = self.store.session(&id)?;
        self.store
            .append("session.updated", session.clone(), Some(&id), None)?;
        Ok(session)
    }
    pub async fn start_turn(&self, session_id: &str, text: &str) -> Result<Value> {
        self.start_turn_options(session_id, text, None, None).await
    }
    pub async fn start_turn_options(
        &self,
        session_id: &str,
        text: &str,
        model: Option<&str>,
        effort: Option<&str>,
    ) -> Result<Value> {
        self.start_turn_permissions(session_id, text, model, effort, "workspace")
            .await
    }
    pub async fn start_turn_permissions(
        &self,
        session_id: &str,
        text: &str,
        model: Option<&str>,
        effort: Option<&str>,
        permission_mode: &str,
    ) -> Result<Value> {
        self.start_turn_composer(
            session_id,
            text,
            model,
            effort,
            permission_mode,
            "default",
            None,
        )
        .await
    }
    // Preserve the existing public entry point used by service and acceptance clients.
    #[allow(clippy::too_many_arguments)]
    pub async fn start_turn_composer(
        &self,
        session_id: &str,
        text: &str,
        model: Option<&str>,
        effort: Option<&str>,
        permission_mode: &str,
        mode: &str,
        attachments: Option<&Value>,
    ) -> Result<Value> {
        self.start_turn_with_skills(
            session_id,
            text,
            model,
            effort,
            permission_mode,
            mode,
            attachments,
            None,
        )
        .await
    }
    #[allow(clippy::too_many_arguments)]
    pub async fn start_turn_with_skills(
        &self,
        session_id: &str,
        text: &str,
        model: Option<&str>,
        effort: Option<&str>,
        permission_mode: &str,
        mode: &str,
        attachments: Option<&Value>,
        skills: Option<&Value>,
    ) -> Result<Value> {
        self.start_turn_with_references(
            session_id,
            text,
            model,
            effort,
            permission_mode,
            mode,
            attachments,
            skills,
            None,
            None,
        )
        .await
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn start_turn_with_references(
        &self,
        session_id: &str,
        text: &str,
        model: Option<&str>,
        effort: Option<&str>,
        permission_mode: &str,
        mode: &str,
        attachments: Option<&Value>,
        skills: Option<&Value>,
        references: Option<&Value>,
        response_speed: Option<&str>,
    ) -> Result<Value> {
        self.start_composer_reserving(
            session_id,
            text,
            model,
            effort,
            permission_mode,
            mode,
            attachments,
            skills,
            references,
            response_speed,
            None,
        )
        .await
    }
    pub async fn resume_session_goal(&self, p: &Value) -> Result<Value> {
        // This explicit user action preserves the existing goal instead of treating
        // the continuation instruction as a new objective. Never inherits full access.
        self.start_composer_reserving(
            s(p, "sessionId"),
            "继续推进当前已有目标。",
            None,
            None,
            "workspace",
            "goal",
            None,
            None,
            None,
            None,
            Some(s(p, "expectedGoalRevision")),
        )
        .await
    }
    #[allow(clippy::too_many_arguments)]
    async fn start_composer_reserving(
        &self,
        session_id: &str,
        text: &str,
        model: Option<&str>,
        effort: Option<&str>,
        permission_mode: &str,
        mode: &str,
        attachments: Option<&Value>,
        skills: Option<&Value>,
        references: Option<&Value>,
        response_speed: Option<&str>,
        goal_resume_revision: Option<&str>,
    ) -> Result<Value> {
        ensure(
            ["default", "plan", "goal"].contains(&mode),
            "INVALID_REQUEST",
            "Invalid conversation mode",
        )?;
        if let Some(files) = attachments {
            crate::composer::decode_attachments(files)?;
        }
        ensure(
            ["workspace", "full"].contains(&permission_mode),
            "INVALID_REQUEST",
            "Invalid permission mode",
        )?;
        let rpc = self.upstream()?;
        let _permit = self
            .task_limit
            .try_acquire()
            .map_err(|_| Error::new("RATE_LIMITED", "Five task starts are active"))?;
        {
            let mut busy = self.busy.lock().unwrap();
            let current = self.store.session(session_id)?;
            ensure(
                !["queued", "running", "waitingApproval", "unknown"]
                    .contains(&s(&current, "status")),
                "CONFLICT",
                "Conversation has active or unreconciled upstream work",
            )?;
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
                active + busy.len() < crate::service::MAX_CONCURRENT_TASKS,
                "RATE_LIMITED",
                "Five tasks are already active",
            )?;
            busy.insert(session_id.into());
        }
        let result = self
            .start_inner(
                &rpc,
                session_id,
                text,
                ComposerOptions {
                    model,
                    effort,
                    response_speed,
                    permission_mode,
                    mode,
                    attachments,
                    references,
                    native_input: None,
                    skills,
                    goal_resume_revision,
                },
            )
            .await;
        self.busy.lock().unwrap().remove(session_id);
        result
    }
    pub(crate) async fn start_inner(
        &self,
        rpc: &Rpc,
        session_id: &str,
        text: &str,
        options: ComposerOptions<'_>,
    ) -> Result<Value> {
        let ComposerOptions {
            model,
            effort,
            response_speed,
            permission_mode,
            mode,
            attachments,
            native_input,
            references,
            skills,
            goal_resume_revision,
        } = options;
        let session = self.store.session(session_id)?;
        if s(&session, "projectId") == paths::CHAT_PROJECT {
            ensure(
                mode == "default"
                    && goal_resume_revision.is_none()
                    && skills.is_none_or(|v| v.as_array().is_some_and(|a| a.is_empty())),
                "INVALID_REQUEST",
                "General chat does not support project skills or task modes",
            )?;
        }
        ensure(
            session["archived"] != 1,
            "CONFLICT",
            "Restore archived conversation before sending",
        )?;
        let selected_model = model.unwrap_or(s(&session, "model")).to_owned();
        let selected_effort = effort.unwrap_or(s(&session, "effort")).to_owned();
        let service_tier = self
            .check_turn_model(&selected_model, &selected_effort, response_speed)
            .await?;

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
                    rpc.validate("v2/ThreadResumeResponse", &v)?;
                    v
                }
                Err(e)
                    if e.code == "UPSTREAM_ERROR"
                        && (e.message.starts_with("no rollout found for thread id ")
                            || (e
                                .message
                                .starts_with("invalid paginated history lineage for ")
                                && e.message.ends_with(": missing source rollout"))) =>
                {
                    return Err(Error::new(
                        "THREAD_NOT_FOUND",
                        "The original Codex thread is unavailable; no replacement was created",
                    ));
                }
                Err(e)
                    if e.code == "UPSTREAM_ERROR"
                        && e.message.contains("already has an active writer") =>
                {
                    // A writer conflict must never silently replace the conversation.
                    // Shared-runtime support is required to operate the same loaded thread.
                    return Err(Error::new(
                        "THREAD_IN_USE",
                        "Conversation is open in another Codex client; its thread identity has been preserved",
                    ));
                }
                Err(e) => return Err(e),
            };
            let previously_full = self
                .store
                .meta(&format!("permissionMode:{session_id}"))?
                .as_deref()
                == Some("full");
            codex::checked_thread_for_turn(
                &response,
                &root,
                self.verified.load(Ordering::SeqCst),
                previously_full,
                self.attached_runtime.load(Ordering::SeqCst),
            )?;
            self.loaded
                .lock()
                .unwrap()
                .insert(s(&session, "upstreamThreadId").into());
        }
        // Always send an explicit mode, so Plan cannot leak into subsequent normal turns.
        let mode_model = if !selected_model.is_empty() {
            selected_model.clone()
        } else {
            let models = rpc.request("model/list", json!({})).await?;
            rpc.validate("v2/ModelListResponse", &models)?;
            models["data"]
                .as_array()
                .and_then(|rows| rows.iter().find(|m| m["isDefault"] == true))
                .and_then(|m| m["model"].as_str())
                .ok_or_else(|| Error::new("UPSTREAM_PROTOCOL_ERROR", "No default model"))?
                .to_owned()
        };
        let skill_input = if let Some(selected) = skills {
            self.resolve_skill_input(s(&session, "projectId"), selected)
                .await?
        } else {
            Vec::new()
        };
        ensure(
            paths::equal(&root, &paths::root(&self.store, s(&session, "projectId"))?)
                && self.upstream()?.generation == rpc.generation
                && rpc.alive.load(Ordering::SeqCst),
            "SYNC_CONFLICT",
            "Project or runtime changed while preparing input",
        )?;
        let (mut input, file_names) = if let Some(input) = native_input {
            self.authorize_native_resources(
                s(&session, "projectId"),
                session_id,
                &root,
                &json!({"input":input}),
            )
            .await?;
            let names = input
                .iter()
                .filter(|part| part["type"] == "localImage")
                .map(|part| {
                    std::path::Path::new(s(part, "path"))
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned()
                })
                .collect::<Vec<_>>();
            (input.to_vec(), names)
        } else {
            crate::composer::prepare_stored_input(&self.store, session_id, text, attachments)?
        };
        input.extend(skill_input);
        input.extend(self.resolve_file_references(s(&session, "projectId"), references)?);
        ensure(
            paths::equal(&root, &paths::root(&self.store, s(&session, "projectId"))?)
                && self.upstream()?.generation == rpc.generation
                && rpc.alive.load(Ordering::SeqCst),
            "SYNC_CONFLICT",
            "Source changed during resource authorization",
        )?;
        let skill_names = input
            .iter()
            .filter(|part| part["type"] == "skill")
            .map(|part| part["name"].clone())
            .collect::<Vec<_>>();
        // Goal is native persistent thread state, not a prompt pretending to be Goal mode.
        let previous_goal = self
            .store
            .meta(&format!("goalMode:{session_id}"))?
            .as_deref()
            == Some("active");
        let resume_goal = if let Some(expected) = goal_resume_revision {
            let source = self.session_goal(session_id).await?;
            ensure(
                source["goalRevision"] == expected
                    && source["upstreamThreadId"] == session["upstreamThreadId"],
                "SYNC_CONFLICT",
                "Goal changed before resume",
            )?;
            ensure(
                source["goal"]["status"] == "paused" || source["goal"]["status"] == "blocked",
                "CONFLICT",
                "Only paused or blocked goals can be resumed",
            )?;
            let latest = self.latest_upstream_turn(session_id).await?;
            ensure(
                latest["threadStatus"] == "idle" && latest["turn"]["status"] != "inProgress",
                "CONFLICT",
                "Reconcile source activity before resuming goal",
            )?;
            let fresh = self.session_goal(session_id).await?;
            ensure(
                fresh["goalRevision"] == source["goalRevision"]
                    && self.upstream()?.generation == rpc.generation
                    && paths::equal(&root, &paths::root(&self.store, s(&session, "projectId"))?),
                "SYNC_CONFLICT",
                "Goal source changed before resume",
            )?;
            Some(source["goal"].clone())
        } else {
            None
        };
        if mode == "goal" || previous_goal {
            let goal_params = if resume_goal.is_some() {
                json!({"threadId":session["upstreamThreadId"],"status":"active"})
            } else if mode == "goal" {
                json!({"threadId":session["upstreamThreadId"],"objective":text,"status":"active"})
            } else {
                json!({"threadId":session["upstreamThreadId"],"status":"paused"})
            };
            // Both enabling Goal and leaving it here follow an explicit composer send.
            let goal_params = crate::composer::goal_params(
                rpc.protocol(),
                goal_params,
                crate::composer::GoalOrigin::User,
            );
            let response = rpc
                .request("thread/goal/set", goal_params)
                .await
                .map_err(|e| {
                    if resume_goal.is_some() {
                        Error::new(
                            "OUTCOME_UNKNOWN",
                            "Goal resume was not confirmed; refresh before retrying",
                        )
                    } else {
                        e
                    }
                })?;
            let validated = rpc.validate("v2/ThreadGoalSetResponse", &response);
            if resume_goal.is_some() && validated.is_err() {
                return Err(Error::new(
                    "OUTCOME_UNKNOWN",
                    "Goal resume response was invalid; refresh before retrying",
                ));
            }
            validated?;
            if let Some(goal) = &resume_goal {
                ensure(
                    response["goal"]["threadId"] == session["upstreamThreadId"]
                        && response["goal"]["objective"] == goal["objective"]
                        && response["goal"]["tokenBudget"] == goal["tokenBudget"]
                        && response["goal"]["createdAt"] == goal["createdAt"]
                        && response["goal"]["status"] == "active"
                        && ["tokensUsed", "timeUsedSeconds"].iter().all(|key| {
                            response["goal"][*key]
                                .as_u64()
                                .zip(goal[*key].as_u64())
                                .is_some_and(|(after, before)| after >= before)
                        }),
                    "OUTCOME_UNKNOWN",
                    "Goal resume identity or objective changed; refresh before retrying",
                )?;
            }
            self.store
                .set_meta(
                    &format!("goalMode:{session_id}"),
                    if mode == "goal" { "active" } else { "paused" },
                )
                .map_err(|e| {
                    if resume_goal.is_some() {
                        Error::new(
                            "OUTCOME_UNKNOWN",
                            "Goal activated but local tracking failed; refresh before retrying",
                        )
                    } else {
                        e
                    }
                })?;
        }
        let submitted:Result<Value>=async {
        let turn = uid("turn");
        self.store.exec(
            "INSERT INTO turns VALUES(?,?,NULL,?,?,NULL,NULL)",
            rusqlite::params![turn, session_id, "queued", now()],
        )?;
        self.store.set_meta(&format!("freshThread:{session_id}"), "")?;
        self.store.status(session_id, Some(&turn), "queued", None)?;
        self.store.append(
            "turn.queued",
            json!({"turn":self.store.turn(&turn)?,"text":text,"permissionMode":permission_mode,"mode":mode,"attachments":file_names,"skills":skill_names}),
            Some(session_id),
            Some(&turn),
        )?;
        let mut params = json!({"threadId":session["upstreamThreadId"],"input":input,"collaborationMode":{"mode":if mode == "plan" { "plan" } else { "default" },"settings":{"model":mode_model,"reasoning_effort":if selected_effort.is_empty() { Value::Null } else { json!(selected_effort) },"developer_instructions":null}},"approvalPolicy":"on-request","approvalsReviewer":"user"});
        // Reset roots and permissions every turn, including after full access or
        // a native client continuation. Legacy workspaceWrite drops :minimal
        // reads when combined with our deny-root profile, breaking Linux tools.
        params["cwd"] = json!(root);
        params["runtimeWorkspaceRoots"] = json!([root]);
        if permission_mode == "full" {
            params["approvalPolicy"] = json!("never");
            params["sandboxPolicy"] = json!({"type":"dangerFullAccess"});
        } else {
            params["permissions"] = json!("agentdeck");
        }
        if !selected_model.is_empty() {
            params["model"] = json!(selected_model);
        }
        if !selected_effort.is_empty() {
            params["effort"] = json!(selected_effort);
        }
        if let Some(tier) = service_tier {
            params["serviceTierForTurn"] = json!(tier);
        }
        self.store
            .set_meta(&format!("composerMode:{session_id}"), mode)?;
        self.store
            .set_meta(&format!("permissionMode:{session_id}"), permission_mode)?;
        crate::composer::validate_turn_for(rpc.protocol(), &params)?;
        let result=async{let response=rpc.request("turn/start",params).await?;rpc.validate("v2/TurnStartResponse",&response)?;
        self.store.exec("INSERT INTO session_options(sessionId,model,effort) VALUES(?,?,?) ON CONFLICT(sessionId) DO UPDATE SET model=excluded.model,effort=excluded.effort",rusqlite::params![session_id,selected_model,selected_effort])?;
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
        }.await;
        submitted.map_err(|e| if resume_goal.is_some(){Error::new("OUTCOME_UNKNOWN", "Goal activation may have succeeded, but the continuation turn was not confirmed; refresh before retrying")}else{e})
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
        self.latest_upstream_turn(session_id).await?;
        let current = self.store.turn(turn_id)?;
        ensure(
            terminal(s(&current, "status"))
                || ["running", "waitingApproval", "unknown"].contains(&s(&current, "status")),
            "CONFLICT",
            "Turn is not active in this session",
        )?;
        if self
            .store
            .meta(&format!("goalMode:{session_id}"))?
            .as_deref()
            == Some("active")
        {
            let response = rpc
                .request(
                    "thread/goal/set",
                    crate::composer::goal_params(
                        rpc.protocol(),
                        json!({"threadId":session["upstreamThreadId"],"status":"paused"}),
                        crate::composer::GoalOrigin::User,
                    ),
                )
                .await?;
            rpc.validate("v2/ThreadGoalSetResponse", &response)?;
            self.store
                .set_meta(&format!("goalMode:{session_id}"), "paused")?;
        }
        let current = self.store.turn(turn_id)?;
        if terminal(s(&current, "status")) {
            return Ok(json!({"requested":false,"status":current["status"]}));
        }
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
                    rpc.validate("v2/TurnInterruptResponse", &v)?;
                    return Ok(
                        json!({"requested":true,"status":self.store.turn(turn_id)?["status"]}),
                    );
                }
                Err(e)
                    if e.code == "UPSTREAM_ERROR" && e.message == "no active turn to interrupt" =>
                {
                    self.latest_upstream_turn(session_id).await?;
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
        if bind
            && found.is_none()
            && self.store.meta(&format!("goalMode:{id}"))?.as_deref() == Some("active")
        {
            if let Some(turn) = turn {
                let local = uid("turn");
                self.store.exec(
                    "INSERT INTO turns VALUES(?,?,?,?,?,NULL,NULL)",
                    rusqlite::params![local, id, turn, "running", now()],
                )?;
                self.store.status(id, Some(&local), "running", None)?;
                found = Some(self.store.turn(&local)?);
                self.store.append(
                    "turn.started",
                    json!({"turn":found,"source":"goal"}),
                    Some(id),
                    Some(&local),
                )?;
            }
        }
        Ok(Some((session, found)))
    }
    pub fn notification(&self, rpc: &Rpc, v: &Value) -> Result<()> {
        let method = s(v, "method");
        let p = &v["params"];
        if method == "thread/tokenUsage/updated" {
            rpc.validate("v2/ThreadTokenUsageUpdatedNotification", p)?;
            ensure(
                self.upstream()?.generation == rpc.generation,
                "SYNC_CONFLICT",
                "Stale usage notification",
            )?;
            if let Some((session, turn)) =
                self.route(s(p, "threadId"), p["turnId"].as_str(), false)?
            {
                paths::root(&self.store, s(&session, "projectId"))?;
                // Usage is observational: never bind queued turns or change execution state.
                self.store.append(
                    "session.tokenUsage",
                    json!({"upstreamTurnId":p["turnId"],"tokenUsage":p["tokenUsage"]}),
                    Some(s(&session, "sessionId")),
                    turn.as_ref().map(|turn| s(turn, "turnId")),
                )?;
            }
            return Ok(());
        }
        if method == "thread/reverted" {
            rpc.validate("v2/ThreadRevertedNotification", p)?;
            ensure(
                self.upstream()?.generation == rpc.generation,
                "SYNC_CONFLICT",
                "Stale history notification",
            )?;
            if let Some((session, _)) = self.route(s(p, "threadId"), None, false)? {
                paths::root(&self.store, s(&session, "projectId"))?;
                self.store.invalidate_history(s(&session, "sessionId"))?;
            }
            return Ok(());
        }
        if method == "thread/queue/changed" {
            return self.queue_notification(rpc, p);
        }
        if method == "thread/deleted" {
            rpc.validate("v2/ThreadDeletedNotification", p)?;
            if self.attached_runtime.load(Ordering::SeqCst) {
                self.store.record_thread_deletion(s(p, "threadId"))?;
                self.thread_index_changed.notify_one();
            }
            return Ok(());
        }
        let index_schema = match method {
            "thread/started" => Some("v2/ThreadStartedNotification"),
            "thread/name/updated" => Some("v2/ThreadNameUpdatedNotification"),
            "thread/archived" => Some("v2/ThreadArchivedNotification"),
            "thread/unarchived" => Some("v2/ThreadUnarchivedNotification"),
            "thread/status/changed" => Some("v2/ThreadStatusChangedNotification"),
            _ => None,
        };
        if let Some(schema) = index_schema {
            rpc.validate(schema, p)?;
            if self.attached_runtime.load(Ordering::SeqCst) {
                if method == "thread/archived"
                    || (method == "thread/status/changed" && p["status"]["type"] == "notLoaded")
                {
                    if let Some((session, _)) = self.route(s(p, "threadId"), None, false)? {
                        if let Some(generation) = self
                            .observed
                            .lock()
                            .unwrap()
                            .get_mut(s(&session, "sessionId"))
                        {
                            generation.clear();
                        }
                    }
                }
                self.note_thread_index_change(if method == "thread/started" {
                    s(&p["thread"], "id")
                } else {
                    s(p, "threadId")
                })?;
            }
            return Ok(());
        }
        if method == "thread/goal/updated" || method == "thread/goal/cleared" {
            rpc.validate(
                if method.ends_with("updated") {
                    "v2/ThreadGoalUpdatedNotification"
                } else {
                    "v2/ThreadGoalClearedNotification"
                },
                p,
            )?;
            if let Some((session, _)) = self.route(s(p, "threadId"), None, false)? {
                self.store.set_meta(
                    &format!("goalMode:{}", s(&session, "sessionId")),
                    if method.ends_with("updated") {
                        s(&p["goal"], "status")
                    } else {
                        "paused"
                    },
                )?;
                self.store.append(
                    "goal.updated",
                    p.clone(),
                    Some(s(&session, "sessionId")),
                    None,
                )?;
            }
            return Ok(());
        }
        if method == "serverRequest/resolved" {
            rpc.validate("v2/ServerRequestResolvedNotification", p)?;
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
            "item/reasoning/summaryTextDelta" => "ReasoningSummaryTextDelta",
            "item/reasoning/summaryPartAdded" => "ReasoningSummaryPartAdded",
            "item/reasoning/textDelta" => "ReasoningTextDelta",
            "item/commandExecution/outputDelta" => "CommandExecutionOutputDelta",
            "item/fileChange/outputDelta" => "FileChangeOutputDelta",
            "item/fileChange/patchUpdated" => "FileChangePatchUpdated",
            "item/mcpToolCall/progress" => "McpToolCallProgress",
            "error" => "Error",
            _ => return Ok(()),
        };
        rpc.validate(&format!("v2/{name}Notification"), p)?;
        let tid = p["turnId"].as_str().or(p["turn"]["id"].as_str());
        let Some((session, turn)) = self.route(s(p, "threadId"), tid, true)? else {
            return Ok(());
        };
        let session_id = s(&session, "sessionId");
        if turn.is_none() && self.attached_runtime.load(Ordering::SeqCst) {
            // External turns have no local turn identity yet. Do not fabricate
            // progress records or reject their valid completion as corruption.
            if paths::root(&self.store, s(&session, "projectId")).is_err() {
                return Ok(());
            }
            if method == "turn/completed" {
                let status = s(&p["turn"], "status");
                ensure(
                    terminal(status),
                    "UPSTREAM_PROTOCOL_ERROR",
                    "Nonterminal external completion",
                )?;
                self.store.append_native_terminal(session_id,json!({"upstreamTurnId":p["turn"]["id"],"status":status,"error":p["turn"]["error"]["message"]}))?;
            } else if let Some(native_turn) = tid {
                let mut payload = p.clone();
                payload["method"] = json!(method);
                payload["upstreamTurnId"] = json!(native_turn);
                self.store
                    .append("upstream.progress", payload, Some(session_id), None)?;
            }
            if matches!(method, "turn/started" | "turn/completed") {
                self.note_thread_index_change(s(p, "threadId"))?;
            }
            return Ok(());
        }
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
            let result:Result<()>=async{let session=self.store.session(s(&turn,"sessionId"))?;paths::root(&self.store,s(&session,"projectId"))?;let response=rpc.request("thread/read",json!({"threadId":session["upstreamThreadId"],"includeTurns":false})).await?;rpc.validate("v2/ThreadReadResponse",&response)?;let mut cursor=Value::Null;let mut seen=std::collections::HashSet::new();for _ in 0..100{let response=rpc.request("thread/turns/list",json!({"threadId":session["upstreamThreadId"],"cursor":cursor,"limit":100,"itemsView":"summary"})).await?;rpc.validate("v2/ThreadTurnsListResponse",&response)?;if let Some(found)=response["data"].as_array().unwrap().iter().find(|v|v["id"]==turn["upstreamTurnId"]){if terminal(s(found,"status")){self.notification(rpc,&json!({"method":"turn/completed","params":{"threadId":session["upstreamThreadId"],"turn":found}}))?;}break;}cursor=response["nextCursor"].clone();if cursor.is_null(){break;}ensure(seen.insert(cursor.to_string()),"UPSTREAM_PROTOCOL_ERROR","Repeated history cursor")?;}Ok(())}.await;
            let _ = result;
        }
        Ok(())
    }
    pub async fn sync_workspaces(&self) -> Result<Value> {
        let rpc = self.upstream()?;
        let config = rpc
            .request("config/read", json!({"includeLayers":false}))
            .await?;
        rpc.validate("v2/ConfigReadResponse", &config)?;
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
                rpc.validate("v2/ThreadListResponse", &response)?;
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
        let mut removed = 0;
        for root in roots.values() {
            // Removal is a persistent local decision; only explicit add may restore it.
            let disabled = self.store.query(
                "SELECT projectId FROM projects WHERE canonicalPath=? COLLATE NOCASE AND enabled=0",
                [root.to_string_lossy().as_ref()],
            )?;
            if !disabled.is_empty() {
                removed += 1;
                skipped += 1;
                continue;
            }
            if paths::add_discovered(&self.store, root).is_ok() {
                synced += 1;
            } else {
                skipped += 1;
            }
        }
        ensure(
            synced > 0 || removed > 0,
            "NO_WORKSPACES",
            "未找到可同步项目，请在 Codex 建立会话，或从更多菜单添加目录",
        )?;
        let indexed = self.sync_thread_index().await?;
        self.store.set_meta("lastWorkspaceSync", &now())?;
        Ok(json!({"synced":synced,"skipped":skipped,"indexed":indexed,"at":now()}))
    }
}
pub fn terminal(status: &str) -> bool {
    ["completed", "failed", "interrupted"].contains(&status)
}
