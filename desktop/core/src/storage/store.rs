use crate::{digest, ensure, future, now, redact_value, s, uid, Error, Result};
use rusqlite::{params, types::ValueRef, Connection};
use serde_json::{json, Map, Value};
use std::{path::Path, sync::Mutex};
use tokio::sync::broadcast;

pub struct Store {
    db: Mutex<Connection>,
    pub events: broadcast::Sender<Value>,
}
impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let db = Connection::open(path)?;
        db.pragma_update(None, "journal_mode", "WAL")?;
        db.pragma_update(None, "foreign_keys", "ON")?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        db.execute_batch(include_str!("schema.sql"))?;
        let (events, _) = broadcast::channel(512);
        let store = Self {
            db: Mutex::new(db),
            events,
        };
        if store.meta("hostId")?.is_none() {
            store.set_meta("hostId", &uid("host"))?;
        }
        Ok(store)
    }
    pub fn query(&self, sql: &str, p: impl rusqlite::Params) -> Result<Vec<Value>> {
        let db = self.db.lock().unwrap();
        Self::query_db(&db, sql, p)
    }
    fn query_db(db: &Connection, sql: &str, p: impl rusqlite::Params) -> Result<Vec<Value>> {
        let mut stmt = db.prepare(sql)?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let rows = stmt.query_map(p, |row| {
            let mut obj = Map::new();
            for (i, k) in names.iter().enumerate() {
                let v = match row.get_ref(i)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(v) => json!(v),
                    ValueRef::Real(v) => json!(v),
                    ValueRef::Text(v) => json!(String::from_utf8_lossy(v)),
                    ValueRef::Blob(_) => Value::Null,
                };
                obj.insert(k.clone(), v);
            }
            Ok(Value::Object(obj))
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }
    pub fn one(&self, sql: &str, p: impl rusqlite::Params) -> Result<Value> {
        self.query(sql, p)?
            .into_iter()
            .next()
            .ok_or_else(|| Error::new("NOT_FOUND", "Record not found"))
    }
    pub fn exec(&self, sql: &str, p: impl rusqlite::Params) -> Result<usize> {
        Ok(self.db.lock().unwrap().execute(sql, p)?)
    }
    pub fn meta(&self, k: &str) -> Result<Option<String>> {
        Ok(self
            .query("SELECT value FROM meta WHERE key=?", [k])?
            .first()
            .and_then(|v| v["value"].as_str().map(str::to_owned)))
    }
    pub fn set_meta(&self, k: &str, v: &str) -> Result<()> {
        self.exec("INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)", [k, v])?;
        Ok(())
    }
    pub fn project(&self, id: &str) -> Result<Value> {
        self.one(
            "SELECT * FROM projects WHERE projectId=? AND enabled=1",
            [id],
        )
        .map_err(|_| Error::new("WORKSPACE_FORBIDDEN", "Project is not locally authorized"))
    }
    pub fn projects(&self) -> Result<Vec<Value>> {
        let mut rows=self.query("SELECT projectId,name,canonicalPath,enabled,createdAt FROM projects WHERE enabled=1 ORDER BY name",[])?;
        for r in &mut rows {
            r["enabled"] = json!(true);
        }
        Ok(rows)
    }
    /// Reuse a concurrent upstream-index import of this exact new thread.
    pub(crate) fn index_fork(
        &self,
        project: &str,
        parent: &str,
        thread: &Value,
        title: &str,
    ) -> Result<String> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction()?;
        ensure(
            !Self::query_db(
                &tx,
                "SELECT projectId FROM projects WHERE projectId=? AND enabled=1",
                [project],
            )?
            .is_empty(),
            "WORKSPACE_FORBIDDEN",
            "Project grant removed before fork indexing",
        )?;
        ensure(
            Self::query_db(
                &tx,
                "SELECT threadId FROM thread_deletions WHERE threadId=?",
                [s(thread, "id")],
            )?
            .is_empty(),
            "THREAD_NOT_FOUND",
            "Fork deleted before indexing",
        )?;
        let existing = Self::query_db(
            &tx,
            "SELECT sessionId,projectId FROM sessions WHERE upstreamThreadId=?",
            [s(thread, "id")],
        )?;
        let id = if let Some(row) = existing.first() {
            ensure(
                s(row, "projectId") == project,
                "SYNC_CONFLICT",
                "Fork indexed under another grant",
            )?;
            s(row, "sessionId").to_owned()
        } else {
            let id = uid("session");
            let ts = now();
            tx.execute(
                "INSERT INTO sessions VALUES(?,?,?,?,?,?,?)",
                params![id, project, s(thread, "id"), title, "idle", ts, ts],
            )?;
            id
        };
        let mut metadata = json!({"forkedFromId":parent});
        for key in [
            "projectId",
            "source",
            "originator",
            "parentThreadId",
            "sessionId",
            "section",
            "model",
            "reasoningEffort",
            "status",
        ] {
            if let Some(value) = thread.get(key) {
                metadata[key] = value.clone();
            }
        }
        tx.execute("INSERT INTO session_metadata VALUES(?,?,?) ON CONFLICT(sessionId) DO UPDATE SET upstreamJson=excluded.upstreamJson,syncedAt=excluded.syncedAt",params![id,metadata.to_string(),now()])?;
        tx.commit()?;
        Ok(id)
    }
    pub fn session(&self, id: &str) -> Result<Value> {
        let v = self.one("SELECT s.*,(SELECT upstreamJson FROM session_metadata WHERE sessionId=s.sessionId) AS upstreamJson,COALESCE(o.archived,0) AS archived,COALESCE(o.pinned,0) AS pinned,COALESCE(o.model,'') AS model,COALESCE(o.effort,'') AS effort,COALESCE((SELECT value FROM meta WHERE key='composerMode:'||s.sessionId),'default') AS mode FROM sessions s LEFT JOIN session_options o USING(sessionId) WHERE s.sessionId=?", [id])?;
        self.project(s(&v, "projectId"))?;
        Self::indexed_session(v)
    }
    fn indexed_session(mut value: Value) -> Result<Value> {
        if let Some(Value::String(text)) = value.as_object_mut().unwrap().remove("upstreamJson") {
            value["upstream"] = serde_json::from_str(&text)
                .map_err(|_| Error::new("DATABASE_ERROR", "Invalid thread index metadata"))?;
        }
        Ok(value)
    }
    pub fn sessions(&self, id: Option<&str>) -> Result<Vec<Value>> {
        let rows = match id{Some(id)=>{self.project(id)?;self.query("SELECT s.*,(SELECT upstreamJson FROM session_metadata WHERE sessionId=s.sessionId) AS upstreamJson,COALESCE(o.archived,0) AS archived,COALESCE(o.pinned,0) AS pinned,COALESCE(o.model,'') AS model,COALESCE(o.effort,'') AS effort,COALESCE((SELECT value FROM meta WHERE key='composerMode:'||s.sessionId),'default') AS mode FROM sessions s LEFT JOIN session_options o USING(sessionId) WHERE projectId=? ORDER BY updatedAt DESC",[id])},None=>self.query("SELECT s.*,(SELECT upstreamJson FROM session_metadata WHERE sessionId=s.sessionId) AS upstreamJson,COALESCE(o.archived,0) AS archived,COALESCE(o.pinned,0) AS pinned,COALESCE(o.model,'') AS model,COALESCE(o.effort,'') AS effort,COALESCE((SELECT value FROM meta WHERE key='composerMode:'||s.sessionId),'default') AS mode FROM sessions s JOIN projects p ON s.projectId=p.projectId LEFT JOIN session_options o USING(sessionId) WHERE p.enabled=1 ORDER BY updatedAt DESC",[])}?;
        rows.into_iter().map(Self::indexed_session).collect()
    }
    pub fn delete_session(&self, id: &str) -> Result<()> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction()?;
        Self::erase_session(&tx, id)?;
        tx.commit()?;
        Ok(())
    }
    fn erase_session(tx: &rusqlite::Transaction<'_>, id: &str) -> Result<()> {
        let removed: Option<i64> = tx.query_row(
            "SELECT MAX(eventId) FROM events WHERE sessionId=?",
            [id],
            |row| row.get(0),
        )?;
        if let Some(floor) = removed {
            // A cursor before erased history must get a fresh authoritative snapshot.
            tx.execute("INSERT INTO meta(key,value) VALUES('retentionFloor',?) ON CONFLICT(key) DO UPDATE SET value=CAST(MAX(CAST(meta.value AS INTEGER),CAST(excluded.value AS INTEGER)) AS TEXT)", [floor.to_string()])?;
        }
        for table in [
            "approvals",
            "turns",
            "events",
            "session_options",
            "sessions",
        ] {
            tx.execute(&format!("DELETE FROM {table} WHERE sessionId=?"), [id])?;
        }
        Ok(())
    }
    pub(crate) fn record_thread_deletion(&self, thread: &str) -> Result<()> {
        self.exec(
            "INSERT OR IGNORE INTO thread_deletions VALUES(?,?)",
            params![thread, now()],
        )?;
        Ok(())
    }
    pub(crate) fn thread_deleted(&self, thread: &str) -> Result<bool> {
        Ok(!self
            .query(
                "SELECT threadId FROM thread_deletions WHERE threadId=?",
                [thread],
            )?
            .is_empty())
    }
    /// The authority already deleted these threads. Persist cache removal and
    /// replay-safe announcements together, even after Bridge process restart.
    pub(crate) fn purge_deleted_threads(&self) -> Result<Vec<String>> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction()?;
        let rows = Self::query_db(&tx, "SELECT s.sessionId,s.upstreamThreadId FROM sessions s JOIN thread_deletions d ON d.threadId=s.upstreamThreadId", [])?;
        let mut events = Vec::new();
        let mut threads = Vec::new();
        for row in rows {
            let id = s(&row, "sessionId");
            Self::erase_session(&tx, id)?;
            let seq:i64=tx.query_row("INSERT INTO event_sequences(sessionKey,seq) VALUES(?,1) ON CONFLICT(sessionKey) DO UPDATE SET seq=seq+1 RETURNING seq",[id],|r|r.get(0))?;
            let ts = now();
            let payload = json!({"sessionId":id,"source":"upstream"});
            tx.execute("INSERT INTO events(sessionId,turnId,seq,action,payloadJson,ts) VALUES(?,NULL,?,'session.deleted',?,?)",params![id,seq,payload.to_string(),ts])?;
            events.push(json!({"v":1,"type":"event","eventId":tx.last_insert_rowid().to_string(),"seq":seq,"sessionId":id,"turnId":null,"action":"session.deleted","payload":payload,"ts":ts}));
            threads.push(s(&row, "upstreamThreadId").to_owned());
        }
        tx.commit()?;
        drop(db);
        for event in events {
            let _ = self.events.send(event);
        }
        Ok(threads)
    }
    pub(crate) fn apply_thread_index(
        &self,
        entries: &[crate::thread_index::ThreadIndexEntry],
    ) -> Result<usize> {
        if entries.is_empty() {
            return Ok(0);
        }
        let (event, indexed) = {
            let mut db = self.db.lock().unwrap();
            let tx = db.transaction()?;
            let mut indexed = 0;
            for entry in entries {
                let deleted: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM thread_deletions WHERE threadId=?)",
                    [&entry.thread_id],
                    |r| r.get(0),
                )?;
                if deleted {
                    continue;
                }
                indexed += 1;
                let project = Self::query_db(
                    &tx,
                    "SELECT projectId FROM projects WHERE projectId=? AND enabled=1",
                    [&entry.project_id],
                )?;
                ensure(
                    !project.is_empty(),
                    "WORKSPACE_FORBIDDEN",
                    "Project grant changed during sync",
                )?;
                let rows = Self::query_db(
                    &tx,
                    "SELECT s.*,COALESCE((SELECT seq FROM event_sequences WHERE sessionKey=s.sessionId),0) AS eventSeq FROM sessions s WHERE upstreamThreadId=?",
                    [&entry.thread_id],
                )?;
                let external_status = s(&entry.metadata["status"], "type");
                let unknown = !["idle", "notLoaded"].contains(&external_status);
                let id = if let Some(existing) = rows.first() {
                    let current_seq = existing["eventSeq"].as_i64();
                    let mut revision_matches = entry.expected_event_seq == current_seq;
                    if !revision_matches {
                        if let (Some(before), Some(current)) =
                            (entry.expected_event_seq, current_seq)
                        {
                            // Streaming item output does not change index metadata.
                            // Require the complete intervening journal so retention
                            // gaps or any control/metadata event still reject it.
                            let (count, changes): (i64, i64) = tx.query_row(
                                "SELECT COUNT(*),COALESCE(SUM(CASE WHEN action='session.tokenUsage' OR (action='turn.progress' AND (json_extract(payloadJson,'$.method') LIKE 'item/%' OR json_extract(payloadJson,'$.method')='turn/plan/updated')) THEN 0 ELSE 1 END),0) FROM events WHERE sessionId=? AND seq>? AND seq<=?",
                                params![s(existing, "sessionId"), before, current],
                                |row| Ok((row.get(0)?, row.get(1)?)),
                            )?;
                            revision_matches =
                                current > before && count == current - before && changes == 0;
                        }
                    }
                    ensure(
                        existing["projectId"] == entry.project_id
                            && revision_matches
                            && entry.expected_updated_at.as_deref()
                                == existing["updatedAt"].as_str(),
                        "SYNC_CONFLICT",
                        "Conversation changed during sync; index unchanged",
                    )?;
                    let id = s(existing, "sessionId").to_owned();
                    let active = Self::query_db(&tx, "SELECT turnId FROM turns WHERE sessionId=? AND status IN ('queued','running','waitingApproval','unknown') LIMIT 1", [&id])?;
                    let status = if !active.is_empty() {
                        s(existing, "status")
                    } else if unknown {
                        "unknown"
                    } else if crate::tasks::terminal(s(existing, "status")) {
                        s(existing, "status")
                    } else {
                        "idle"
                    };
                    tx.execute("UPDATE sessions SET title=?,status=?,updatedAt=MAX(updatedAt,?) WHERE sessionId=?", params![entry.title,status,entry.updated_at,id])?;
                    id
                } else {
                    ensure(
                        entry.expected_updated_at.is_none(),
                        "SYNC_CONFLICT",
                        "Conversation removed during sync; index unchanged",
                    )?;
                    let id = uid("session");
                    tx.execute(
                        "INSERT INTO sessions VALUES(?,?,?,?,?,?,?)",
                        params![
                            id,
                            entry.project_id,
                            entry.thread_id,
                            entry.title,
                            if unknown { "unknown" } else { "idle" },
                            entry.created_at,
                            entry.updated_at
                        ],
                    )?;
                    id
                };
                tx.execute("INSERT INTO session_options(sessionId,archived,model,effort) VALUES(?1,?2,COALESCE(?3,''),?4) ON CONFLICT(sessionId) DO UPDATE SET archived=excluded.archived,model=CASE WHEN ?3 IS NOT NULL THEN excluded.model ELSE session_options.model END,effort=CASE WHEN ?5 THEN excluded.effort ELSE session_options.effort END", params![id,entry.archived,entry.metadata["model"].as_str(),entry.metadata["reasoningEffort"].as_str().unwrap_or(""),entry.metadata.get("reasoningEffort").is_some()])?;
                tx.execute("INSERT INTO session_metadata VALUES(?,?,?) ON CONFLICT(sessionId) DO UPDATE SET upstreamJson=excluded.upstreamJson,syncedAt=excluded.syncedAt", params![id,entry.metadata.to_string(),now()])?;
            }
            if indexed == 0 {
                return Ok(0);
            }
            let seq:i64 = tx.query_row("INSERT INTO event_sequences(sessionKey,seq) VALUES('',1) ON CONFLICT(sessionKey) DO UPDATE SET seq=seq+1 RETURNING seq", [], |r| r.get(0))?;
            let ts = now();
            let payload = json!({"indexed":indexed});
            tx.execute("INSERT INTO events(sessionId,turnId,seq,action,payloadJson,ts) VALUES(NULL,NULL,?,'sessions.synced',?,?)",params![seq,payload.to_string(),ts])?;
            let event_id = tx.last_insert_rowid().to_string();
            tx.commit()?;
            (
                json!({"v":1,"type":"event","eventId":event_id,"seq":seq,"sessionId":null,"turnId":null,"action":"sessions.synced","payload":payload,"ts":ts}),
                indexed,
            )
        };
        let _ = self.events.send(event);
        Ok(indexed)
    }
    pub fn turns(&self, id: Option<&str>) -> Result<Vec<Value>> {
        match id{Some(id)=>self.query("SELECT * FROM turns WHERE sessionId=? ORDER BY startedAt",[id]),None=>self.query("SELECT * FROM turns WHERE status IN ('queued','running','waitingApproval','unknown') ORDER BY startedAt",[])}
    }
    pub fn turn(&self, id: &str) -> Result<Value> {
        self.one("SELECT * FROM turns WHERE turnId=?", [id])
    }
    pub fn status(
        &self,
        session: &str,
        turn: Option<&str>,
        status: &str,
        error: Option<&str>,
    ) -> Result<()> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction()?;
        let ts = now();
        tx.execute(
            "UPDATE sessions SET status=?,updatedAt=? WHERE sessionId=?",
            params![status, ts, session],
        )?;
        if let Some(turn) = turn {
            let end = if ["completed", "failed", "interrupted"].contains(&status) {
                Some(&ts)
            } else {
                None
            };
            tx.execute(
                "UPDATE turns SET status=?,endedAt=?,error=? WHERE turnId=?",
                params![status, end, error.map(crate::redact), turn],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn approval_rows(&self, id: Option<&str>) -> Result<Vec<Value>> {
        match id{Some(id)=>self.query("SELECT * FROM approvals WHERE sessionId=? AND status IN ('pending','sending') ORDER BY createdAt",[id]),None=>self.query("SELECT * FROM approvals WHERE status IN ('pending','sending') ORDER BY createdAt",[])}
    }
    pub fn public_approval(&self, row: &Value) -> Result<Value> {
        let context: Value = serde_json::from_str(s(row, "contextJson"))
            .map_err(|_| Error::new("DATABASE_ERROR", "Invalid approval context"))?;
        let decisions = if row["status"] == "pending" {
            crate::approval::choices(s(row, "method"), &context)?
        } else {
            vec![]
        };
        Ok(
            json!({"approvalId":row["approvalId"],"sessionId":row["sessionId"],"turnId":row["turnId"],"method":row["method"],"status":row["status"],"context":redact_value(context),"createdAt":row["createdAt"],"expiresAt":row["expiresAt"],"allowedDecisions":decisions}),
        )
    }
    pub fn approvals(&self, id: Option<&str>) -> Result<Vec<Value>> {
        self.approval_rows(id)?
            .iter()
            .map(|v| self.public_approval(v))
            .collect()
    }
    // The native authority replaced history. Remove journal previews rather than
    // allowing stale local turns to reappear beside the fresh native prefix.
    pub(crate) fn invalidate_history(&self, id: &str) -> Result<()> {
        {
            let mut db = self.db.lock().unwrap();
            let tx = db.transaction()?;
            let floor: Option<i64> = tx.query_row(
                "SELECT MAX(eventId) FROM events WHERE sessionId=?",
                [id],
                |row| row.get(0),
            )?;
            if let Some(floor) = floor {
                tx.execute("INSERT INTO meta(key,value) VALUES('retentionFloor',?) ON CONFLICT(key) DO UPDATE SET value=CAST(MAX(CAST(meta.value AS INTEGER),CAST(excluded.value AS INTEGER)) AS TEXT)", [floor.to_string()])?;
            }
            tx.execute("DELETE FROM events WHERE sessionId=?", [id])?;
            tx.execute("DELETE FROM turns WHERE sessionId=? AND status NOT IN ('queued','running','waitingApproval','unknown')", [id])?;
            tx.commit()?;
        }
        self.append(
            "session.historyChanged",
            json!({"sessionId":id}),
            Some(id),
            None,
        )?;
        Ok(())
    }
    pub fn append(
        &self,
        action: &str,
        payload: Value,
        session: Option<&str>,
        turn: Option<&str>,
    ) -> Result<Value> {
        self.append_inner(action, payload, session, turn, false)
    }
    pub(crate) fn append_native_terminal(&self, session: &str, payload: Value) -> Result<()> {
        self.append_inner(
            "upstream.turn.completed",
            payload,
            Some(session),
            None,
            true,
        )
        .map(|_| ())
    }
    fn append_inner(
        &self,
        action: &str,
        payload: Value,
        session: Option<&str>,
        turn: Option<&str>,
        deduplicate_terminal: bool,
    ) -> Result<Value> {
        let mut payload = redact_value(payload);
        let text = payload.to_string();
        if text.len() > 256 * 1024 {
            payload = json!({"truncated":true,"originalBytes":text.len(),"method":payload["method"],"itemId":payload["itemId"],"upstreamTurnId":payload["upstreamTurnId"],"delta":payload["delta"].as_str().map(|t|t.chars().take(64000).collect::<String>()),"turn":{"turnId":payload["turn"]["turnId"],"status":payload["turn"]["status"]},"note":"Event preview limit exceeded; inspect locally"});
        }
        let event = {
            let mut db = self.db.lock().unwrap();
            let tx = db.transaction()?;
            if deduplicate_terminal {
                let seen: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM events WHERE sessionId=? AND action='upstream.turn.completed' AND json_extract(payloadJson,'$.upstreamTurnId')=?)",params![session,payload["upstreamTurnId"].as_str()], |row| row.get(0))?;
                if seen {
                    return Ok(Value::Null);
                }
            }
            let seq:i64=tx.query_row("INSERT INTO event_sequences(sessionKey,seq) VALUES(?,1) ON CONFLICT(sessionKey) DO UPDATE SET seq=seq+1 RETURNING seq",[session.unwrap_or("")],|r|r.get(0))?;
            let ts = now();
            tx.execute("INSERT INTO events(sessionId,turnId,seq,action,payloadJson,ts) VALUES(?,?,?,?,?,?)",params![session,turn,seq,action,payload.to_string(),ts])?;
            let id = tx.last_insert_rowid().to_string();
            tx.commit()?;
            json!({"v":1,"type":"event","eventId":id,"seq":seq,"sessionId":session,"turnId":turn,"action":action,"payload":payload,"ts":ts})
        };
        let _ = self.events.send(event.clone());
        Ok(event)
    }
    pub fn cursor(&self) -> Result<String> {
        Ok(
            self.one("SELECT COALESCE(MAX(eventId),0) AS id FROM events", [])?["id"]
                .as_i64()
                .unwrap_or(0)
                .max(
                    self.meta("retentionFloor")?
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(0),
                )
                .to_string(),
        )
    }
    fn event(row: &Value) -> Value {
        json!({"v":1,"type":"event","eventId":row["eventId"].as_i64().unwrap_or(0).to_string(),"seq":row["seq"],"sessionId":row["sessionId"],"turnId":row["turnId"],"action":row["action"],"payload":serde_json::from_str::<Value>(s(row,"payloadJson")).unwrap_or(Value::Null),"ts":row["ts"]})
    }
    pub fn replay(&self, cursor: &str, limit: usize) -> Result<Value> {
        ensure(
            !cursor.is_empty() && cursor.len() <= 16 && cursor.bytes().all(|c| c.is_ascii_digit()),
            "INVALID_REQUEST",
            "Invalid cursor",
        )?;
        let n = cursor
            .parse::<i64>()
            .map_err(|_| Error::new("INVALID_REQUEST", "Invalid cursor"))?;
        ensure(
            n >= self
                .meta("retentionFloor")?
                .and_then(|s| s.parse().ok())
                .unwrap_or(0)
                && n <= self.cursor()?.parse().unwrap_or(0),
            "REPLAY_GAP",
            "Request a fresh snapshot",
        )?;
        let rows = self.query(
            "SELECT * FROM events WHERE eventId>? ORDER BY eventId LIMIT ?",
            params![n, limit + 1],
        )?;
        let mut bytes = 0;
        let events: Vec<Value> = rows
            .iter()
            .take(limit)
            .take_while(|r| {
                let length = s(r, "payloadJson").len();
                let keep = bytes == 0 || bytes + length <= 512 * 1024;
                if keep {
                    bytes += length;
                }
                keep
            })
            .map(Self::event)
            .collect();
        Ok(
            json!({"cursor":events.last().map(|e|e["eventId"].clone()).unwrap_or(json!(cursor)),"more":rows.len()>events.len(),"events":events}),
        )
    }
    pub fn history(&self, id: &str, before: Option<&str>, limit: usize) -> Result<Vec<Value>> {
        self.session(id)?;
        let rows = self.query(
            "SELECT * FROM events WHERE sessionId=? AND eventId<? ORDER BY eventId DESC LIMIT ?",
            params![
                id,
                before
                    .and_then(|n| n.parse::<i64>().ok())
                    .unwrap_or(i64::MAX),
                limit
            ],
        )?;
        let mut bytes = 0;
        let mut events: Vec<Value> = rows
            .iter()
            .take_while(|r| {
                let l = s(r, "payloadJson").len();
                let keep = bytes == 0 || bytes + l <= 512 * 1024;
                if keep {
                    bytes += l;
                }
                keep
            })
            .map(Self::event)
            .collect();
        events.reverse();
        Ok(events)
    }
    pub fn recover(&self) -> Result<()> {
        self.db.lock().unwrap().execute_batch("BEGIN IMMEDIATE; UPDATE requests SET status='unknown' WHERE status='pending'; UPDATE approvals SET status='expired',resolvedAt=datetime('now') WHERE status IN ('pending','sending'); UPDATE sessions SET status='unknown' WHERE status IN ('queued','running','waitingApproval'); UPDATE turns SET status='unknown' WHERE status IN ('queued','running','waitingApproval'); COMMIT;")?;
        Ok(())
    }
    pub fn retention(&self) -> Value {
        let v = self
            .meta("retention")
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .unwrap_or(json!({"days":30,"maxMiB":256}));
        if crate::protocol::integer(&v, "days", 1, 365).is_ok()
            && crate::protocol::integer(&v, "maxMiB", 16, 1024).is_ok()
        {
            v
        } else {
            json!({"days":30,"maxMiB":256})
        }
    }
    pub fn retain(&self) -> Result<()> {
        let setting = self.retention();
        let cutoff = future(-setting["days"].as_i64().unwrap_or(30) * 86400);
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction()?;
        let expired: Option<i64> = tx.query_row(
            "SELECT MAX(eventId) FROM events WHERE ts<?",
            [&cutoff],
            |r| r.get(0),
        )?;
        let mut floor = expired.unwrap_or(0);
        if floor > 0 {
            tx.execute("DELETE FROM events WHERE eventId<=?", [floor])?;
        }
        let max = setting["maxMiB"].as_i64().unwrap_or(256) * 1024 * 1024;
        loop {
            let size: i64 = tx.query_row(
                "SELECT COALESCE(SUM(length(CAST(payloadJson AS BLOB))),0) FROM events",
                [],
                |r| r.get(0),
            )?;
            if size <= max {
                break;
            }
            let batch:i64=tx.query_row("SELECT eventId FROM events ORDER BY eventId LIMIT 1 OFFSET (SELECT MAX(0,COUNT(*)/4-1) FROM events)",[],|r|r.get(0))?;
            floor = floor.max(batch);
            tx.execute("DELETE FROM events WHERE eventId<=?", [floor])?;
        }
        if floor > 0 {
            tx.execute("INSERT INTO meta(key,value) VALUES('retentionFloor',?) ON CONFLICT(key) DO UPDATE SET value=CAST(MAX(CAST(meta.value AS INTEGER),CAST(excluded.value AS INTEGER)) AS TEXT)",[floor.to_string()])?;
        }
        // Never forget the outcome of an old mutation: deleting idempotency rows could replay a task.
        tx.execute("UPDATE requests SET responseJson=NULL,status='unknown' WHERE createdAt<? AND responseJson IS NOT NULL",[&cutoff])?;
        tx.execute("DELETE FROM requests WHERE deviceId IN (SELECT deviceId FROM devices WHERE revokedAt IS NOT NULL AND revokedAt<?)",[cutoff])?;
        tx.commit()?;
        Ok(())
    }
    pub fn reserve(
        &self,
        device: &str,
        id: &str,
        action: &str,
        payload: &Value,
    ) -> Result<Option<Value>> {
        let hash = digest(json!({"action":action,"payload":payload}).to_string());
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction()?;
        let mut stmt = tx.prepare(
            "SELECT requestHash,responseJson FROM requests WHERE deviceId=? AND requestId=?",
        )?;
        let existing: Option<(String, Option<String>)> = stmt
            .query_row([device, id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?;
        drop(stmt);
        if let Some((previous, response)) = existing {
            ensure(
                previous == hash,
                "CONFLICT",
                "Request id reused with different content",
            )?;
            return match response {
                Some(v) => Ok(Some(serde_json::from_str(&v).map_err(|_| {
                    Error::new("DATABASE_ERROR", "Invalid saved response")
                })?)),
                None => Err(Error::new(
                    "OUTCOME_UNKNOWN",
                    "Reconcile snapshot; do not repeat this mutation",
                )),
            };
        }
        let count: i64 = tx.query_row(
            "SELECT COUNT(*) FROM requests WHERE deviceId=?",
            [device],
            |r| r.get(0),
        )?;
        ensure(
            count < 100_000,
            "RATE_LIMITED",
            "Device mutation journal limit reached; pair again locally",
        )?;
        tx.execute(
            "INSERT INTO requests VALUES(?,?,?,'pending',NULL,?)",
            params![device, id, hash, now()],
        )?;
        tx.commit()?;
        Ok(None)
    }
    /// Add one independently revocable device without changing existing grants.
    pub fn add_device(&self, id: &str, name: &str, hash: &str) -> Result<()> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction()?;
        let count: i64 = tx.query_row(
            "SELECT COUNT(*) FROM devices WHERE revokedAt IS NULL",
            [],
            |row| row.get(0),
        )?;
        ensure(
            count < 64,
            "DEVICE_LIMIT",
            "Revoke an unused device before pairing another",
        )?;
        tx.execute(
            "INSERT INTO devices(deviceId,displayName,credentialHash,createdAt,revokedAt) VALUES(?,?,?,?,NULL)",
            params![id, name, hash, now()],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn replace_device(&self, id: &str, name: &str, hash: &str) -> Result<()> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction()?;
        tx.execute(
            "UPDATE devices SET revokedAt=? WHERE revokedAt IS NULL",
            [now()],
        )?;
        tx.execute(
            "INSERT INTO devices VALUES(?,?,?,?,NULL)",
            params![id, name, hash, now()],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn snapshot(&self, ready: bool) -> Result<Value> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction()?;
        let host = Self::query_db(&tx, "SELECT value FROM meta WHERE key='hostId'", [])?;
        let cursor=Self::query_db(&tx,"SELECT MAX(COALESCE((SELECT MAX(eventId) FROM events),0),COALESCE(CAST((SELECT value FROM meta WHERE key='retentionFloor') AS INTEGER),0)) AS id",[])?;
        let mut projects=Self::query_db(&tx,"SELECT projectId,name,canonicalPath,enabled,createdAt FROM projects WHERE enabled=1 ORDER BY name",[])?;
        for p in &mut projects {
            p["enabled"] = json!(true);
        }
        let sessions=Self::query_db(&tx,"SELECT s.*,(SELECT upstreamJson FROM session_metadata WHERE sessionId=s.sessionId) AS upstreamJson,COALESCE(o.archived,0) AS archived,COALESCE(o.pinned,0) AS pinned,COALESCE(o.model,'') AS model,COALESCE(o.effort,'') AS effort,COALESCE((SELECT value FROM meta WHERE key='composerMode:'||s.sessionId),'default') AS mode FROM sessions s JOIN projects p ON s.projectId=p.projectId LEFT JOIN session_options o USING(sessionId) WHERE p.enabled=1 ORDER BY updatedAt DESC",[])?;
        let sessions = sessions
            .into_iter()
            .map(Self::indexed_session)
            .collect::<Result<Vec<_>>>()?;
        let turns=Self::query_db(&tx,"SELECT * FROM turns WHERE status IN ('queued','running','waitingApproval','unknown') ORDER BY startedAt",[])?;
        let rows = Self::query_db(
            &tx,
            "SELECT * FROM approvals WHERE status IN ('pending','sending') ORDER BY createdAt",
            [],
        )?;
        let approvals: Vec<_> = rows
            .iter()
            .map(|r| self.public_approval(r))
            .collect::<Result<_>>()?;
        tx.commit()?;
        Ok(
            json!({"cursor":cursor[0]["id"].as_i64().unwrap_or(0).to_string(),"host":{"hostId":host[0]["value"],"status":if ready{"connected"}else{"disconnected"},"codexVersion":crate::codex::VERSION},"projects":projects,"sessions":sessions,"turns":turns,"approvals":approvals}),
        )
    }
}
use rusqlite::OptionalExtension;
