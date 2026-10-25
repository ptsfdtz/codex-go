//! Android protocol v1. This is intentionally separate from Codex JSON-RPC.
use crate::{ensure, Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub v: u8,
    pub r#type: String,
    pub id: String,
    pub action: String,
    pub payload: Value,
    #[serde(rename = "projectId")]
    pub project_id: Option<String>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    pub ts: Option<String>,
}
pub fn fields(v: &Value, required: &[&str], optional: &[&str]) -> Result<()> {
    let obj = v
        .as_object()
        .ok_or_else(|| Error::new("INVALID_REQUEST", "JSON object required"))?;
    ensure(
        required.iter().all(|k| obj.contains_key(*k))
            && obj
                .keys()
                .all(|k| required.contains(&k.as_str()) || optional.contains(&k.as_str())),
        "INVALID_REQUEST",
        "Unexpected or missing fields",
    )
}
pub fn text(v: &Value, key: &str, min: usize, max: usize) -> Result<()> {
    ensure(
        v[key].as_str().is_some_and(|s| {
            let n = s.chars().count();
            n >= min && n <= max
        }),
        "INVALID_REQUEST",
        "Invalid text field",
    )
}
pub fn integer(v: &Value, key: &str, min: u64, max: u64) -> Result<()> {
    ensure(
        v[key].as_u64().is_some_and(|n| n >= min && n <= max),
        "INVALID_REQUEST",
        "Invalid integer field",
    )
}
pub fn parse(v: Value) -> Result<Request> {
    let mut r: Request = serde_json::from_value(v)
        .map_err(|_| Error::new("INVALID_REQUEST", "Invalid protocol request"))?;
    ensure(
        r.v == 1 && r.r#type == "request" && !r.id.is_empty() && r.id.chars().count() <= 160,
        "INVALID_REQUEST",
        "Invalid version or request id",
    )?;
    for id in [&r.project_id, &r.session_id].into_iter().flatten() {
        ensure(
            !id.is_empty() && id.chars().count() <= 160,
            "INVALID_REQUEST",
            "Invalid context id",
        )?;
    }
    if let Some(ts) = &r.ts {
        ensure(
            ts.ends_with('Z') && chrono::DateTime::parse_from_rfc3339(ts).is_ok(),
            "INVALID_REQUEST",
            "Invalid timestamp",
        )?;
    }
    let p = &mut r.payload;
    let (required, optional): (&[&str], &[&str]) = match r.action.as_str() {
        "system.hello" => (&["client", "version"], &[]),
        "system.capabilities"
        | "system.updateCheck"
        | "system.diagnostics"
        | "snapshot.get"
        | "models.list"
        | "projects.list"
        | "projects.add"
        | "settings.get"
        | "devices.revokeSelf" => (&[], &[]),
        "requests.status" => (&["requestId"], &[]),
        "sessions.refreshIndex" => (&["contractVersion"], &[]),
        "projects.nativePage" => (&["contractVersion"], &["cursor", "limit"]),
        "settings.update" => (&["days", "maxMiB"], &[]),
        "projects.remove" | "git.status" => (&["projectId"], &[]),
        "sessions.list" => (&[], &["projectId"]),
        "approvals.list" => (&[], &["sessionId"]),
        "sessions.create" => (&["projectId", "title"], &[]),
        "sessions.detail" => (&["sessionId"], &["before", "limit"]),
        "sessions.goal.resume" => (&["sessionId", "expectedGoalRevision"], &[]),
        "sessions.goal.clear" => (&["sessionId", "expectedGoalRevision"], &[]),
        "sessions.goal.edit" => (
            &["sessionId", "objective", "expectedGoalRevision"],
            &["tokenBudget"],
        ),
        "sessions.goal" => (&["sessionId"], &[]),
        "sessions.image" => (
            &["sessionId", "turnId", "itemId", "offset"],
            &["contentIndex", "sha256"],
        ),
        "sessions.observe" => (&["sessionId"], &[]),
        "sessions.history" => (&["sessionId"], &["cursor", "limit", "sortDirection"]),
        "sessions.historyContent" => (
            &["sessionId", "sha256", "offset"],
            &["cursor", "sortDirection"],
        ),
        "turn.start" => (
            &["sessionId", "text"],
            &[
                "model",
                "effort",
                "permissionMode",
                "mode",
                "attachments",
                "skills",
            ],
        ),
        "settings.execution" => (&[], &["projectId"]),
        "settings.outputDefaults" => (&["verbosity", "summary", "expectedUserRevision"], &[]),
        "settings.modelDefaults" => (&["model", "expectedUserRevision"], &["effort"]),
        "skills.catalog" => (&["projectId"], &[]),
        "skills.setEnabled" => (&["projectId", "skillId", "enabled", "expectedEnabled"], &[]),
        "files.list" => (&["projectId"], &["directory"]),
        "files.readText" => (&["projectId", "path"], &[]),
        "files.reference" => (&["projectId", "path"], &[]),
        "account.status" => (&[], &[]),
        "queue.list" => (&["sessionId"], &[]),
        "queue.add" => (&["sessionId", "text"], &["attachments", "skills"]),
        "queue.update" => (
            &["sessionId", "submissionId", "text"],
            &["expectedInputRevision"],
        ),
        "queue.start" => (&["sessionId", "submissionId"], &[]),
        "queue.delete" => (&["sessionId", "submissionId"], &[]),
        "queue.reorder" => (&["sessionId", "submissionIds"], &[]),
        "sessions.revise" => (
            &[
                "sessionId",
                "beforeTurnId",
                "expectedLastTurnId",
                "itemId",
                "text",
            ],
            &["model", "effort", "permissionMode", "mode"],
        ),
        "sessions.compact" => (&["sessionId", "expectedLastTurnId"], &[]),
        "sessions.revert" => (&["sessionId", "beforeTurnId", "expectedLastTurnId"], &[]),
        "sessions.fork" => (&["sessionId"], &["lastTurnId"]),
        "sessions.rename" => (&["sessionId", "title"], &[]),
        "sessions.archive" | "sessions.restore" | "sessions.delete" => (&["sessionId"], &[]),
        "sessions.pin" => (&["sessionId", "pinned"], &[]),
        "turn.interrupt" => (&["sessionId", "turnId"], &[]),
        "turn.active" => (&["sessionId"], &[]),
        "turn.latest" => (&["sessionId", "contractVersion"], &[]),
        "turn.steer" => (&["sessionId", "expectedTurnId", "text"], &[]),
        "turn.interruptActive" => (&["sessionId", "expectedTurnId"], &[]),
        "approvals.decide" => (
            &["sessionId", "turnId", "approvalId", "decision"],
            &["answers"],
        ),
        "git.diff" => (&["projectId", "fileId"], &[]),
        "events.replay" => (&[], &["cursor", "limit"]),
        _ => return Err(Error::new("INVALID_REQUEST", "Unsupported action")),
    };
    fields(p, required, optional)?;
    if r.action == "sessions.goal.edit"
        || r.action == "sessions.goal.clear"
        || r.action == "sessions.goal.resume"
    {
        if r.action == "sessions.goal.edit" {
            text(p, "objective", 1, 128000)?;
            ensure(
                !crate::s(p, "objective").trim().is_empty(),
                "INVALID_REQUEST",
                "Goal objective required",
            )?;
        }
        text(p, "expectedGoalRevision", 64, 64)?;
        ensure(
            crate::s(p, "expectedGoalRevision")
                .bytes()
                .all(|b| b.is_ascii_hexdigit()),
            "INVALID_REQUEST",
            "Invalid goal revision",
        )?;
        if let Some(budget) = p.get("tokenBudget") {
            ensure(
                budget.as_i64().is_some_and(|v| v > 0),
                "INVALID_REQUEST",
                "Positive token budget required",
            )?;
        }
    }

    if let Some(mode) = p.get("mode") {
        ensure(
            ["default", "plan", "goal"].iter().any(|m| mode == *m),
            "INVALID_REQUEST",
            "Invalid conversation mode",
        )?;
    }
    if let Some(files) = p.get("attachments") {
        crate::composer::decode_attachments(files)?;
    }
    if let Some(mode) = p.get("permissionMode") {
        ensure(
            mode == "full" || mode == "workspace",
            "INVALID_REQUEST",
            "Invalid permission mode",
        )?;
    }
    for key in [
        "projectId",
        "sessionId",
        "turnId",
        "approvalId",
        "fileId",
        "itemId",
        "submissionId",
        "expectedTurnId",
        "lastTurnId",
        "beforeTurnId",
        "expectedLastTurnId",
        "requestId",
    ] {
        if p.get(key).is_some() {
            text(p, key, 1, 160)?;
        }
    }
    if p.get("sortDirection").is_some() {
        ensure(
            ["asc", "desc"].iter().any(|d| p["sortDirection"] == *d),
            "INVALID_REQUEST",
            "Invalid history direction",
        )?;
    }
    if p.get("pinned").is_some() {
        ensure(
            p["pinned"].is_boolean(),
            "INVALID_REQUEST",
            "Boolean required",
        )?;
    }
    for key in ["model", "effort"] {
        if p.get(key).is_some() {
            text(p, key, 1, 160)?;
        }
    }
    if ["settings.modelDefaults", "settings.outputDefaults"].contains(&r.action.as_str()) {
        text(p, "expectedUserRevision", 64, 64)?;
    }
    if r.action == "skills.setEnabled" {
        text(p, "skillId", 64, 64)?;
        ensure(
            p["enabled"].is_boolean() && p["expectedEnabled"].is_boolean(),
            "INVALID_REQUEST",
            "Boolean skill states required",
        )?;
    }
    if p.get("directory").is_some() {
        text(p, "directory", 0, 4096)?;
    }
    if ["files.readText", "files.reference"].contains(&r.action.as_str()) {
        text(p, "path", 1, 4096)?;
    }
    if r.action == "system.hello" {
        text(p, "client", 0, 100)?;
        ensure(
            p["version"] == 1,
            "VERSION_REQUIRED",
            "Protocol version 1 required",
        )?;
    }
    for (key, max) in [("title", 160), ("text", 64000)] {
        if let Some(t) = p[key].as_str() {
            let t = t.trim().to_owned();
            p[key] = json!(t);
            text(p, key, 1, max)?;
        } else if p.get(key).is_some() {
            return Err(Error::new("INVALID_REQUEST", "Text required"));
        }
    }
    if p.get("decision").is_some() {
        ensure(
            ["approve", "reject", "cancel"]
                .iter()
                .any(|d| p["decision"] == *d),
            "INVALID_REQUEST",
            "Invalid decision",
        )?;
    }
    if p.get("days").is_some() {
        integer(p, "days", 1, 365)?;
        integer(p, "maxMiB", 16, 1024)?;
    }
    for key in ["cursor", "before"] {
        if p.get(key).is_some() {
            text(
                p,
                key,
                0,
                if r.action.starts_with("sessions.history") {
                    32768
                } else {
                    160
                },
            )?;
        }
    }
    if matches!(r.action.as_str(), "events.replay" | "sessions.detail") {
        if p.get("limit").is_none() {
            p["limit"] = json!(100);
        }
        integer(p, "limit", 1, 500)?;
    }
    if matches!(r.action.as_str(), "sessions.refreshIndex" | "turn.latest") {
        integer(p, "contractVersion", 1, 1)?;
    }
    if r.action == "projects.nativePage" {
        integer(p, "contractVersion", 1, 1)?;
        if p.get("limit").is_none() {
            p["limit"] = json!(50);
        }
        integer(p, "limit", 1, 100)?;
        if let Some(cursor) = p.get("cursor") {
            ensure(
                cursor.as_str().is_some_and(crate::security::valid_token),
                "INVALID_REQUEST",
                "Invalid project cursor",
            )?;
        }
    }
    if r.action == "sessions.history" {
        if p.get("limit").is_none() {
            p["limit"] = json!(20);
        }
        integer(p, "limit", 1, 50)?;
    }
    if r.action == "queue.reorder" {
        let ids = p["submissionIds"]
            .as_array()
            .ok_or_else(|| Error::new("INVALID_REQUEST", "Submission IDs required"))?;
        ensure(
            ids.len() <= 128
                && ids.iter().all(|id| {
                    id.as_str()
                        .is_some_and(|id| !id.is_empty() && id.len() <= 160)
                })
                && ids
                    .iter()
                    .map(Value::to_string)
                    .collect::<std::collections::HashSet<_>>()
                    .len()
                    == ids.len(),
            "INVALID_REQUEST",
            "Invalid submission IDs",
        )?;
    }
    if r.action == "sessions.image" {
        integer(p, "offset", 0, 8 * 1024 * 1024)?;
        if p.get("contentIndex").is_some() {
            integer(p, "contentIndex", 0, 255)?;
        }
        ensure(
            p["offset"] == 0 || p.get("sha256").is_some(),
            "INVALID_REQUEST",
            "Continuation requires content hash",
        )?;
        if p.get("sha256").is_some() {
            text(p, "sha256", 64, 64)?;
            ensure(
                p["sha256"]
                    .as_str()
                    .unwrap()
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
                "INVALID_REQUEST",
                "Invalid content hash",
            )?;
        }
    }
    if r.action == "sessions.historyContent" {
        integer(p, "offset", 0, 8 * 1024 * 1024)?;
        text(p, "sha256", 64, 64)?;
        ensure(
            p["sha256"]
                .as_str()
                .unwrap()
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
            "INVALID_REQUEST",
            "Invalid content hash",
        )?;
    }
    Ok(r)
}
