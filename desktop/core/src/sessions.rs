use crate::{ensure, now, s, service::Core, Error, Result};
use serde_json::{json, Value};
use std::collections::HashSet;

impl Core {
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
                    models.push(json!({"model":model["model"],"displayName":model["displayName"],"isDefault":model["isDefault"],"defaultReasoningEffort":model["defaultReasoningEffort"],"supportedReasoningEfforts":model["supportedReasoningEfforts"]}));
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
}
