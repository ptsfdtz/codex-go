//! Native queue state stays upstream; Bridge never stores a second execution queue.
use crate::{
    ensure, paths,
    rpc::{ProtocolVersion, Rpc},
    s,
    service::Core,
    Error, Result,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::atomic::Ordering;

struct QueueBusy<'a>(&'a Core, String);
impl Drop for QueueBusy<'_> {
    fn drop(&mut self) {
        self.0.busy.lock().unwrap().remove(&self.1);
    }
}

impl Core {
    pub(crate) fn queue_notification(&self, rpc: &Rpc, p: &Value) -> Result<()> {
        if rpc.protocol() != ProtocolVersion::DesktopBaseline {
            return Ok(());
        }
        rpc.validate("v2/ThreadQueueChangedNotification", p)?;
        if !self
            .rpc
            .read()
            .unwrap()
            .as_ref()
            .is_some_and(|current| current.generation == rpc.generation)
        {
            return Ok(());
        }
        if let Some((session, _)) = self.route(s(p, "threadId"), None, false)? {
            if paths::root(&self.store, s(&session, "projectId")).is_ok()
                && !self.store.thread_deleted(s(p, "threadId"))?
            {
                self.store.append(
                    "queue.changed",
                    json!({"sessionId":session["sessionId"]}),
                    Some(s(&session, "sessionId")),
                    None,
                )?;
            }
        }
        Ok(())
    }
    pub async fn native_queue(&self, action: &str, p: &Value, message_id: &str) -> Result<Value> {
        let id = s(p, "sessionId");
        ensure(
            self.busy.lock().unwrap().insert(id.to_owned()),
            "CONFLICT",
            "Conversation operation in progress",
        )?;
        let _busy = QueueBusy(self, id.to_owned());
        let session = self.store.session(id)?;
        let root = paths::root(&self.store, s(&session, "projectId"))?;
        let rpc = self.upstream()?;
        ensure(
            rpc.protocol() == ProtocolVersion::DesktopBaseline,
            "UNSUPPORTED",
            "Native queue requires locked desktop profile",
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
                && paths::equal(
                    &root,
                    &paths::canonical(std::path::Path::new(s(&read["thread"], "cwd")))?,
                ),
            "WORKSPACE_FORBIDDEN",
            "Queue source identity or workspace changed",
        )?;
        let check = || -> Result<()> {
            let current = self.store.session(id)?;
            ensure(
                current["upstreamThreadId"] == session["upstreamThreadId"]
                    && current["projectId"] == session["projectId"]
                    && paths::equal(&root, &paths::root(&self.store, s(&current, "projectId"))?)
                    && !self.store.thread_deleted(s(&session, "upstreamThreadId"))?
                    && rpc.alive.load(Ordering::SeqCst)
                    && self.upstream()?.generation == rpc.generation,
                "SYNC_CONFLICT",
                "Queue source or authorization changed",
            )
        };
        let entries = queue_entries(&rpc, s(&session, "upstreamThreadId")).await?;
        check()?;
        if action == "queue.list" {
            let entries = entries
                .iter()
                .map(|entry| {
                    let mut view = entry.clone();
                    view["inputRevision"] = json!(input_revision(entry));
                    view
                })
                .collect::<Vec<_>>();
            return Ok(
                json!({"sessionId":id,"upstreamThreadId":session["upstreamThreadId"],"data":entries}),
            );
        }
        ensure(
            session["archived"] != 1,
            "CONFLICT",
            "Restore archived conversation before editing its queue",
        )?;
        if action == "queue.start" {
            let entry = entries
                .iter()
                .find(|entry| entry["id"] == p["submissionId"])
                .ok_or_else(|| Error::new("QUEUE_CHANGED", "Queued message no longer exists"))?;
            return self.start_queued_submission(&rpc, &session, entry).await;
        }
        let mut params = json!({"threadId":session["upstreamThreadId"]});
        let (method, operation) = match action {
            "queue.add" => {
                ensure(
                    entries.len() < 128
                        && serde_json::to_vec(&entries).unwrap().len() + s(p, "text").len() + 1024
                            <= 384 * 1024,
                    "UPSTREAM_CONTENT_TOO_LARGE",
                    "Queue has reached the bounded client capacity",
                )?;
                params["clientUserMessageId"] = json!(message_id);
                let skill_input = if let Some(selected) = p.get("skills") {
                    self.resolve_skill_input(s(&session, "projectId"), selected)
                        .await?
                } else {
                    Vec::new()
                };
                let (mut input, _) =
                    crate::composer::prepare_input(&root, s(p, "text"), p.get("attachments"))?;
                input.extend(skill_input);
                params["input"] = json!(input);
                ensure(
                    serde_json::to_vec(&entries).unwrap().len()
                        + serde_json::to_vec(&params).unwrap().len()
                        <= 384 * 1024,
                    "UPSTREAM_CONTENT_TOO_LARGE",
                    "Queue input exceeds bounded capacity",
                )?;
                ("thread/queue/add", "Add")
            }
            "queue.update" | "queue.delete" => {
                let entry = entries
                    .iter()
                    .find(|entry| entry["id"] == p["submissionId"])
                    .ok_or_else(|| {
                        Error::new("QUEUE_CHANGED", "Queued message no longer exists; refresh")
                    })?;
                params["queuedSubmissionId"] = p["submissionId"].clone();
                if action == "queue.update" {
                    let resources = entry["input"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|part| part["type"] != "text");
                    if resources || p.get("expectedInputRevision").is_some() {
                        ensure(
                            p["expectedInputRevision"].as_str()
                                == Some(input_revision(entry).as_str()),
                            "QUEUE_CHANGED",
                            "Queued input changed; refresh before editing",
                        )?;
                    }
                    params["input"] = json!(replace_resource_text(entry, s(p, "text"))?);
                    self.authorize_native_resources(
                        s(&session, "projectId"),
                        &root,
                        &json!({"input":params["input"]}),
                    )
                    .await?;
                    ("thread/queue/update", "Update")
                } else {
                    ("thread/queue/delete", "Delete")
                }
            }
            "queue.reorder" => {
                let ids = p["submissionIds"].as_array().unwrap();
                ensure(
                    ids.len() == entries.len()
                        && entries.iter().all(|entry| ids.contains(&entry["id"])),
                    "QUEUE_CHANGED",
                    "Queue membership changed; refresh before reordering",
                )?;
                params["queuedSubmissionIds"] = p["submissionIds"].clone();
                ("thread/queue/reorder", "Reorder")
            }
            _ => return Err(Error::new("INVALID_REQUEST", "Unsupported queue action")),
        };
        check()?;
        let response = rpc.request(method, params).await.map_err(|error| {
            if ["UPSTREAM_TIMEOUT", "UPSTREAM_UNAVAILABLE"].contains(&error.code.as_str()) {
                Error::new(
                    "OUTCOME_UNKNOWN",
                    "Queue mutation outcome unknown; refresh instead of resubmitting",
                )
            } else {
                error
            }
        })?;
        let result = (|| -> Result<Value> {
            rpc.validate(
                &format!("experimental/ThreadQueue{operation}Response"),
                &response,
            )?;
            check()?;
            self.store
                .append("queue.changed", json!({"sessionId":id}), Some(id), None)?;
            Ok(
                json!({"sessionId":id,"upstreamThreadId":session["upstreamThreadId"],"result":response}),
            )
        })();
        result.map_err(|_| {
            Error::new(
                "OUTCOME_UNKNOWN",
                "Queue mutation may have succeeded; refresh before retrying",
            )
        })
    }
    async fn start_queued_submission(
        &self,
        rpc: &Rpc,
        session: &Value,
        entry: &Value,
    ) -> Result<Value> {
        let id = s(session, "sessionId");
        let _permit = self
            .task_limit
            .try_acquire()
            .map_err(|_| Error::new("RATE_LIMITED", "Two task starts are active"))?;
        ensure(
            self.verified.load(Ordering::SeqCst),
            "SANDBOX_UNVERIFIED",
            "Native boundary probe must pass before queue execution",
        )?;
        ensure(
            !self.store.turns(Some(id))?.iter().any(|turn| {
                ["queued", "running", "waitingApproval", "unknown"].contains(&s(turn, "status"))
            }),
            "CONFLICT",
            "Stop or reconcile existing work before starting a queued message",
        )?;
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
        let latest = self.latest_upstream_turn(id).await?;
        ensure(
            latest["threadStatus"] == "idle" && latest["turn"]["status"] != "inProgress",
            "CONFLICT",
            "Original thread is not idle",
        )?;
        // Queue start has no per-turn policy overrides. Establish and validate the
        // same conservative thread defaults used by normal workspace execution.
        let root = paths::root(&self.store, s(session, "projectId"))?;
        crate::codex::settings(rpc, &root).await?;
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
            "Pause the active goal before starting a queued message",
        )?;
        self.authorize_native_resources(s(session, "projectId"), &root, entry)
            .await?;
        let resumed=rpc.request("thread/resume",json!({"threadId":session["upstreamThreadId"],"cwd":root,"approvalPolicy":"on-request","approvalsReviewer":"user","sandbox":"workspace-write","config":{"default_permissions":"agentdeck"},"excludeTurns":true})).await?;
        rpc.validate("v2/ThreadResumeResponse", &resumed)?;
        crate::codex::checked_thread(&resumed, &root, self.verified.load(Ordering::SeqCst))?;
        ensure(
            resumed["thread"]["id"] == session["upstreamThreadId"],
            "UPSTREAM_PROTOCOL_ERROR",
            "Queue resume changed thread identity",
        )?;
        self.authorize_native_resources(s(session, "projectId"), &root, entry)
            .await?;
        let current = self.store.session(id)?;
        ensure(
            current["upstreamThreadId"] == session["upstreamThreadId"]
                && current["projectId"] == session["projectId"]
                && current["archived"] != 1
                && !self.store.thread_deleted(s(session, "upstreamThreadId"))?
                && paths::equal(&root, &paths::root(&self.store, s(session, "projectId"))?)
                && rpc.alive.load(Ordering::SeqCst)
                && self.upstream()?.generation == rpc.generation,
            "SYNC_CONFLICT",
            "Source authorization or runtime changed before queue start",
        )?;
        let local = crate::uid("turn");
        self.store.exec(
            "INSERT INTO turns VALUES(?,?,NULL,?,?,NULL,NULL)",
            rusqlite::params![local, id, "queued", crate::now()],
        )?;
        self.store.status(id, Some(&local), "queued", None)?;
        let text = entry["input"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|part| part["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let skills = entry["input"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|part| part["type"] == "skill")
            .map(|part| part["name"].clone())
            .collect::<Vec<_>>();
        self.store.append("turn.queued",json!({"turn":self.store.turn(&local)?,"text":text,"permissionMode":"workspace","source":"native-queue","queuedSubmissionId":entry["id"],"attachments":[],"skills":skills}),Some(id),Some(&local))?;
        self.store
            .set_meta(&format!("permissionMode:{id}"), "workspace")?;
        let result:Result<Value>=async{
            let response=rpc.request("thread/queue/start",json!({"threadId":session["upstreamThreadId"],"queuedSubmissionId":entry["id"]})).await?;
            rpc.validate("experimental/ThreadQueueStartResponse",&response)?;
            ensure(rpc.alive.load(Ordering::SeqCst)&&self.upstream()?.generation==rpc.generation,"UPSTREAM_UNAVAILABLE","Runtime changed during queue start")?;
            let current=self.store.session(id)?;
            ensure(current["upstreamThreadId"]==session["upstreamThreadId"]&&current["projectId"]==session["projectId"]
                && !self.store.thread_deleted(s(session,"upstreamThreadId"))?
                && paths::equal(&root,&paths::root(&self.store,s(session,"projectId"))?),"SYNC_CONFLICT","Queue start authorization changed")?;
            let turn=&response["turn"];
            ensure(!s(turn,"id").is_empty(),"UPSTREAM_PROTOCOL_ERROR","Queue start returned no native turn identity")?;
            let current=self.store.turn(&local)?;
            ensure(current["upstreamTurnId"].is_null()||current["upstreamTurnId"]==turn["id"],"UPSTREAM_PROTOCOL_ERROR","Queue start turn identity mismatch")?;
            self.store.exec("UPDATE turns SET upstreamTurnId=? WHERE turnId=? AND upstreamTurnId IS NULL",[s(turn,"id"),&local])?;
            if self.store.turn(&local)?["status"]=="queued"{
                self.store.status(id,Some(&local),"running",None)?;
                self.store.append("turn.started",json!({"turn":self.store.turn(&local)?}),Some(id),Some(&local))?;
            }
            if crate::tasks::terminal(s(turn,"status")){
                self.notification(rpc,&json!({"method":"turn/completed","params":{"threadId":session["upstreamThreadId"],"turn":turn}}))?;
            }
            self.loaded.lock().unwrap().insert(s(session,"upstreamThreadId").to_owned());
            self.store.append("queue.changed",json!({"sessionId":id}),Some(id),None)?;
            Ok(json!({"sessionId":id,"upstreamThreadId":session["upstreamThreadId"],"result":{"turn":self.store.turn(&local)?,"queuedSubmissionId":entry["id"]}}))
        }.await;
        if result.is_err() {
            if !crate::tasks::terminal(s(&self.store.turn(&local)?, "status")) {
                self.store.status(id, Some(&local), "unknown", None)?;
                self.store.append(
                    "session.updated",
                    json!({"status":"unknown"}),
                    Some(id),
                    Some(&local),
                )?;
            }
        }
        result.map_err(|_| {
            Error::new(
                "OUTCOME_UNKNOWN",
                "Queued message may have started; reconcile original turn before retrying",
            )
        })
    }

    pub(crate) async fn authorize_native_resources(
        &self,
        project_id: &str,
        root: &std::path::Path,
        entry: &Value,
    ) -> Result<()> {
        let input = entry["input"]
            .as_array()
            .ok_or_else(|| Error::new("UPSTREAM_PROTOCOL_ERROR", "Missing queued input"))?;
        self.authorize_skill_parts(project_id, input).await?;
        let resources = input
            .iter()
            .filter(|part| part["type"] != "skill")
            .cloned()
            .collect::<Vec<_>>();
        authorize_queue_input(root, &json!({"input":resources}))
    }
}

fn input_revision(entry: &Value) -> String {
    format!(
        "{:x}",
        Sha256::digest(entry["input"].to_string().as_bytes())
    )
}

#[cfg(test)]
mod edit_tests {
    use super::*;
    #[test]
    fn queue_text_edit_preserves_resources_and_rejects_structured_or_multiple_texts() {
        let entry = json!({"input":[{"type":"localImage","path":"C:/fixture/image.png"},{"type":"text","text":"old","text_elements":[]},{"type":"skill","name":"review","path":"C:/fixture/SKILL.md"}]});
        let edited = replace_resource_text(&entry, "new").unwrap();
        assert_eq!(edited[0], entry["input"][0]);
        assert_eq!(edited[2], entry["input"][2]);
        assert_eq!(edited[1]["text"], "new");
        assert_ne!(
            input_revision(&entry),
            input_revision(&json!({"input":edited}))
        );
        let mut structured = entry.clone();
        structured["input"][1]["text_elements"] = json!([{"byteRange":{"start":0,"end":3}}]);
        assert!(replace_resource_text(&structured, "new").is_err());
        structured["input"] = json!([{"type":"text","text":"a"},{"type":"text","text":"b"}]);
        assert!(replace_resource_text(&structured, "new").is_err());
    }
}

pub(crate) fn replace_resource_text(entry: &Value, text: &str) -> Result<Vec<Value>> {
    let input = entry["input"]
        .as_array()
        .ok_or_else(|| Error::new("UPSTREAM_PROTOCOL_ERROR", "Missing queued input"))?;
    ensure(
        input.iter().filter(|part| part["type"] == "text").count() <= 1,
        "UNSUPPORTED",
        "Multiple text inputs cannot yet be edited without changing their order",
    )?;
    let mut result = Vec::new();
    let mut replaced = false;
    for part in input {
        match s(part, "type") {
            "text" => {
                ensure(
                    part.get("text_elements")
                        .is_none_or(|v| v.as_array().is_some_and(Vec::is_empty)),
                    "UNSUPPORTED",
                    "Structured text elements must be preserved; editing is not yet supported",
                )?;
                result.push(json!({"type":"text","text":text,"text_elements":[]}));
                replaced = true;
            }
            "skill" | "localImage" => result.push(part.clone()),
            _ => {
                return Err(Error::new(
                    "UNSUPPORTED",
                    "Unsupported queued input cannot be edited",
                ))
            }
        }
    }
    if !replaced {
        result.insert(0, json!({"type":"text","text":text,"text_elements":[]}));
    }
    Ok(result)
}

async fn queue_entries(rpc: &Rpc, thread: &str) -> Result<Vec<Value>> {
    let mut data = Vec::new();
    let mut cursor = Value::Null;
    let mut seen = std::collections::HashSet::new();
    let mut ids = std::collections::HashSet::new();
    for _ in 0..10 {
        let page = rpc
            .request(
                "thread/queue/list",
                json!({"threadId":thread,"cursor":cursor,"limit":100}),
            )
            .await?;
        rpc.validate("experimental/ThreadQueueListResponse", &page)?;
        let entries = page["data"].as_array().unwrap();
        ensure(
            entries.len() <= 100,
            "UPSTREAM_PROTOCOL_ERROR",
            "Queue page exceeded bound",
        )?;
        for entry in entries {
            ensure(
                !s(entry, "id").is_empty() && ids.insert(s(entry, "id").to_owned()),
                "UPSTREAM_PROTOCOL_ERROR",
                "Repeated queue identity",
            )?;
            data.push(entry.clone());
        }
        ensure(
            data.len() <= 128 && serde_json::to_vec(&data).unwrap().len() <= 384 * 1024,
            "UPSTREAM_CONTENT_TOO_LARGE",
            "Queue exceeds bounded view",
        )?;
        cursor = page["nextCursor"].clone();
        if cursor.is_null() {
            return Ok(data);
        }
        ensure(
            seen.insert(cursor.to_string()),
            "UPSTREAM_PROTOCOL_ERROR",
            "Repeated queue cursor",
        )?;
    }
    Err(Error::new(
        "UPSTREAM_CONTENT_TOO_LARGE",
        "Queue page limit exceeded",
    ))
}

// Validate resources before native execution. The native runtime reopens paths;
// this check cannot make subsequent external file replacement atomic.
pub(crate) fn authorize_queue_input(root: &std::path::Path, entry: &Value) -> Result<()> {
    use std::io::Read;
    for part in entry["input"].as_array().unwrap() {
        match s(part, "type") {
            "text" => {}
            "localImage" => {
                let path = paths::canonical(std::path::Path::new(s(part, "path")))?;
                ensure(
                    paths::within(root, &path),
                    "WORKSPACE_FORBIDDEN",
                    "Queued image is outside granted workspace",
                )?;
                let mut file = std::fs::File::open(&path)?;
                ensure(
                    paths::within(root, &paths::opened_path(&file)?),
                    "WORKSPACE_FORBIDDEN",
                    "Queued image handle is outside granted workspace",
                )?;
                let metadata = file.metadata()?;
                ensure(
                    metadata.is_file() && metadata.len() <= 8 * 1024 * 1024,
                    "UNSUPPORTED",
                    "Queued image must be a bounded regular file",
                )?;
                let mut header = [0u8; 12];
                let count = file.read(&mut header)?;
                let bytes = &header[..count];
                ensure(
                    bytes.starts_with(b"\x89PNG\r\n\x1a\n")
                        || bytes.starts_with(b"\xff\xd8\xff")
                        || bytes.starts_with(b"GIF8")
                        || (bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP")),
                    "UNSUPPORTED",
                    "Unsupported queued image format",
                )?;
            }
            _ => {
                return Err(Error::new(
                    "UNSUPPORTED",
                    "Queued input requires unsupported resource authorization",
                ))
            }
        }
    }
    Ok(())
}

#[cfg(all(test, windows))]
mod resource_tests {
    use super::*;
    #[test]
    fn queued_images_require_granted_resource_and_supported_format() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let granted = paths::canonical(root.path()).unwrap();
        let image = granted.join("image.png");
        std::fs::write(&image, b"\x89PNG\r\n\x1a\nimage").unwrap();
        let entry = |path: &std::path::Path| json!({"input":[{"type":"localImage","path":path}]});
        assert!(authorize_queue_input(&granted, &entry(&image)).is_ok());
        let external = outside.path().join("image.png");
        std::fs::copy(&image, &external).unwrap();
        assert!(authorize_queue_input(&granted, &entry(&external)).is_err());
        std::fs::write(&image, b"not an image").unwrap();
        assert!(authorize_queue_input(&granted, &entry(&image)).is_err());
        assert!(authorize_queue_input(
            &granted,
            &json!({"input":[{"type":"image","url":"https://example.com/image.png"}]})
        )
        .is_err());
    }
}
