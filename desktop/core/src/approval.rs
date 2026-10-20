use crate::{
    ensure, future, now, paths,
    rpc::{validate, Rpc},
    s,
    service::Core,
    tasks, uid, Error, Result,
};
use serde_json::{json, Value};
use std::{path::Path, sync::atomic::Ordering};
pub fn contract(method: &str) -> Result<&'static str> {
    match method {
        "item/commandExecution/requestApproval" => Ok("CommandExecutionRequestApproval"),
        "item/fileChange/requestApproval" => Ok("FileChangeRequestApproval"),
        "item/permissions/requestApproval" => Ok("PermissionsRequestApproval"),
        _ => Err(Error::new(
            "UPSTREAM_UNSUPPORTED_REQUEST",
            "Unsupported upstream approval method",
        )),
    }
}
pub fn choices(method: &str, context: &Value) -> Result<Vec<&'static str>> {
    let base = contract(method)?;
    if method == "item/permissions/requestApproval" || context.get("availableDecisions").is_none() {
        return Ok(vec!["approve", "reject", "cancel"]);
    }
    let values = context["availableDecisions"]
        .as_array()
        .ok_or_else(|| Error::new("UPSTREAM_PROTOCOL_ERROR", "Invalid approval decisions"))?;
    ensure(
        !values.is_empty() && values.len() <= 16,
        "UPSTREAM_PROTOCOL_ERROR",
        "Invalid available decisions",
    )?;
    for value in values {
        validate(&format!("{base}Response"), &json!({"decision":value}))?;
    }
    ensure(
        values.contains(&json!("decline")) || values.contains(&json!("cancel")),
        "UPSTREAM_UNSUPPORTED_REQUEST",
        "No supported denial",
    )?;
    let mut choices = vec![];
    if values.contains(&json!("accept")) {
        choices.push("approve");
    }
    choices.push("reject");
    if values.contains(&json!("cancel")) {
        choices.push("cancel");
    }
    Ok(choices)
}
pub fn response(method: &str, decision: &str, context: &Value) -> Result<Value> {
    ensure(
        choices(method, context)?.contains(&decision),
        "UPSTREAM_UNSUPPORTED_REQUEST",
        "Decision unavailable",
    )?;
    let v = if method == "item/permissions/requestApproval" {
        let mut permission = json!({});
        if decision == "approve" {
            for key in ["fileSystem", "network"] {
                if let Some(v) = context["permissions"].get(key) {
                    permission[key] = v.clone();
                }
            }
        }
        json!({"permissions":permission,"scope":"turn"})
    } else {
        let reject = if context.get("availableDecisions").is_none()
            || context["availableDecisions"]
                .as_array()
                .is_some_and(|a| a.contains(&json!("decline")))
        {
            "decline"
        } else {
            "cancel"
        };
        json!({"decision":match decision{"approve"=>"accept","cancel"=>"cancel",_=>reject}})
    };
    validate(&format!("{}Response", contract(method)?), &v)?;
    Ok(v)
}
impl Core {
    pub fn receive_approval(&self, rpc: &Rpc, v: &Value) -> Result<()> {
        let result: Result<()> = (|| {
            let method = s(v, "method");
            let base = contract(method)?;
            let p = &v["params"];
            ensure(
                p.to_string().len() <= 128 * 1024,
                "UPSTREAM_PROTOCOL_ERROR",
                "Approval context exceeds review limit",
            )?;
            validate(&format!("{base}Params"), p)?;
            choices(method, p)?;
            ensure(
                self.ready.load(Ordering::SeqCst),
                "UPSTREAM_UNAVAILABLE",
                "Codex is not ready",
            )?;
            let route = self.route(s(p, "threadId"), Some(s(p, "turnId")), true)?;
            let (session, turn) =
                route.ok_or_else(|| Error::new("APPROVAL_STALE", "Unknown thread"))?;
            let turn = turn.ok_or_else(|| Error::new("APPROVAL_STALE", "Unknown turn"))?;
            ensure(
                ["queued", "running", "waitingApproval"].contains(&s(&turn, "status")),
                "APPROVAL_STALE",
                "Approval has no active turn",
            )?;
            paths::root(&self.store, s(&session, "projectId"))?;
            let count = self.store.approval_rows(None)?.len();
            ensure(count < 128, "RATE_LIMITED", "Too many approval requests")?;
            let id = uid("approval");
            self.store.exec(
                "INSERT INTO approvals VALUES(?,?,?,?,?,?,?,?,?,?,NULL)",
                rusqlite::params![
                    id,
                    s(&session, "sessionId"),
                    s(&turn, "turnId"),
                    method,
                    "pending",
                    p.to_string(),
                    v["id"].to_string(),
                    rpc.generation,
                    now(),
                    future(300)
                ],
            )?;
            self.store.status(
                s(&session, "sessionId"),
                Some(s(&turn, "turnId")),
                "waitingApproval",
                None,
            )?;
            let row = self
                .store
                .one("SELECT * FROM approvals WHERE approvalId=?", [id])?;
            self.store.append(
                "approval.requested",
                self.store.public_approval(&row)?,
                Some(s(&session, "sessionId")),
                Some(s(&turn, "turnId")),
            )?;
            Ok(())
        })();
        if result.is_err() {
            let _ = rpc.reject(v["id"].clone());
            rpc.stop();
            self.store.append("bridge.error",json!({"code":"UPSTREAM_UNSUPPORTED_REQUEST","message":"Approval rejected: unsupported, stale or invalid request"}),None,None)?;
        }
        result
    }
    pub fn decide(
        &self,
        session_id: &str,
        turn_id: &str,
        id: &str,
        decision: &str,
    ) -> Result<Value> {
        let rpc = self.upstream()?;
        let session = self.store.session(session_id)?;
        let turn = self.store.turn(turn_id)?;
        let row = self
            .store
            .one("SELECT * FROM approvals WHERE approvalId=?", [id])?;
        ensure(
            row["sessionId"] == session_id
                && row["turnId"] == turn_id
                && turn["sessionId"] == session_id
                && row["status"] == "pending"
                && row["generation"] == rpc.generation
                && s(&row, "expiresAt") > now().as_str()
                && ["running", "waitingApproval"].contains(&s(&turn, "status")),
            "APPROVAL_STALE",
            "Approval expired, handled or session mismatch",
        )?;
        let context: Value = serde_json::from_str(s(&row, "contextJson"))
            .map_err(|_| Error::new("DATABASE_ERROR", "Invalid approval context"))?;
        if decision == "approve" {
            let root = paths::root(&self.store, s(&session, "projectId"))?;
            if let Some(cwd) = context["cwd"].as_str() {
                ensure(
                    paths::within(&root, &paths::canonical(Path::new(cwd))?),
                    "WORKSPACE_FORBIDDEN",
                    "Approval cwd leaves project",
                )?;
            }
            if !context["grantRoot"].is_null() {
                ensure(
                    context["grantRoot"].as_str().is_some_and(|p| {
                        paths::canonical(Path::new(p)).is_ok_and(|p| paths::equal(&root, &p))
                    }),
                    "WORKSPACE_FORBIDDEN",
                    "Approval broadens workspace",
                )?;
            }
            if row["method"] == "item/permissions/requestApproval" {
                let fs = &context["permissions"]["fileSystem"];
                let mut paths: Vec<&str> = vec![];
                for key in ["read", "write"] {
                    if let Some(a) = fs[key].as_array() {
                        for p in a {
                            paths.push(p.as_str().unwrap_or(""));
                        }
                    }
                }
                if let Some(entries) = fs["entries"].as_array() {
                    for e in entries {
                        ensure(
                            e["path"]["type"] == "path",
                            "WORKSPACE_FORBIDDEN",
                            "Special permission roots forbidden",
                        )?;
                        paths.push(s(&e["path"], "path"));
                    }
                }
                for p in paths {
                    paths::valid(Path::new(p))?;
                    ensure(
                        paths::within(&root, Path::new(p)),
                        "WORKSPACE_FORBIDDEN",
                        "Permission leaves project",
                    )?;
                    if !paths::equal(&root, Path::new(p)) {
                        let relative = Path::new(p).strip_prefix(&root).map_err(|_| {
                            Error::new("WORKSPACE_FORBIDDEN", "Invalid permission path")
                        })?;
                        paths::checked_file(&root, &relative.to_string_lossy())?;
                    }
                }
            }
        }
        let response = response(s(&row, "method"), decision, &context)?;
        ensure(
            self.store.exec(
                "UPDATE approvals SET status='sending' WHERE approvalId=? AND status='pending'",
                [id],
            )? == 1,
            "APPROVAL_STALE",
            "Approval already claimed",
        )?;
        if rpc.send(json!({"id":serde_json::from_str::<Value>(s(&row,"upstreamRequestJson")).map_err(|_|Error::new("DATABASE_ERROR","Invalid saved request id"))?,"result":response})).is_err(){self.finish_approval(&row,"unknown")?;return Err(Error::new("OUTCOME_UNKNOWN","Approval delivery unknown; do not retry"));}
        let status = match decision {
            "approve" => "approved",
            "cancel" => "cancelled",
            _ => "rejected",
        };
        self.finish_approval(&row, status)?;
        Ok(json!({"status":status}))
    }
    pub fn finish_approval(&self, row: &Value, status: &str) -> Result<()> {
        let changed=self.store.exec("UPDATE approvals SET status=?,resolvedAt=? WHERE approvalId=? AND status IN ('pending','sending')",[status,&now(),s(row,"approvalId")])?;
        if changed == 0 {
            return Ok(());
        }
        let turn = self.store.turn(s(row, "turnId"))?;
        if turn["status"] == "waitingApproval"
            && !self
                .store
                .approval_rows(Some(s(row, "sessionId")))?
                .iter()
                .any(|r| r["turnId"] == row["turnId"])
        {
            self.store
                .status(s(row, "sessionId"), Some(s(row, "turnId")), "running", None)?;
        }
        self.store.append(
            "approval.resolved",
            json!({"approvalId":row["approvalId"],"status":status}),
            Some(s(row, "sessionId")),
            Some(s(row, "turnId")),
        )?;
        Ok(())
    }
    pub fn expire_approval(&self, row: &Value, send: bool) -> Result<()> {
        if send && row["status"] == "pending" {
            if let Some(rpc) = self.rpc.read().unwrap().clone() {
                if row["generation"] == rpc.generation {
                    let changed=self.store.exec("UPDATE approvals SET status='sending' WHERE approvalId=? AND status='pending'",[s(row,"approvalId")])?;
                    if changed > 0 {
                        let result: Result<()> = (|| {
                            let context: Value = serde_json::from_str(s(row, "contextJson"))
                                .map_err(|_| {
                                    Error::new("DATABASE_ERROR", "Invalid approval context")
                                })?;
                            let id: Value = serde_json::from_str(s(row, "upstreamRequestJson"))
                                .map_err(|_| Error::new("DATABASE_ERROR", "Invalid request id"))?;
                            rpc.send(json!({"id":id,"result":response(s(row,"method"),"reject",&context)?}))
                        })();
                        if result.is_err() {
                            rpc.stop();
                        }
                    }
                }
            }
        }
        self.finish_approval(row, "expired")
    }
    pub fn invalidate_approvals(&self, send: bool) -> Result<()> {
        for row in self.store.approval_rows(None)? {
            self.expire_approval(&row, send)?;
        }
        Ok(())
    }
    pub fn expire_due(&self) -> Result<()> {
        for row in self.store.approval_rows(None)? {
            let terminal = self
                .store
                .turn(s(&row, "turnId"))
                .is_ok_and(|t| tasks::terminal(s(&t, "status")));
            if s(&row, "expiresAt") <= now().as_str() || terminal {
                self.expire_approval(&row, true)?;
            }
        }
        Ok(())
    }
}
