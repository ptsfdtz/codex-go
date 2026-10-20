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
    pub fn session(&self, id: &str) -> Result<Value> {
        let v = self.one("SELECT * FROM sessions WHERE sessionId=?", [id])?;
        self.project(s(&v, "projectId"))?;
        Ok(v)
    }
    pub fn sessions(&self, id: Option<&str>) -> Result<Vec<Value>> {
        match id{Some(id)=>{self.project(id)?;self.query("SELECT * FROM sessions WHERE projectId=? ORDER BY updatedAt DESC",[id])},None=>self.query("SELECT s.* FROM sessions s JOIN projects p ON s.projectId=p.projectId WHERE p.enabled=1 ORDER BY updatedAt DESC",[])}
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
    pub fn append(
        &self,
        action: &str,
        payload: Value,
        session: Option<&str>,
        turn: Option<&str>,
    ) -> Result<Value> {
        let mut payload = redact_value(payload);
        let text = payload.to_string();
        if text.len() > 256 * 1024 {
            payload = json!({"truncated":true,"originalBytes":text.len(),"method":payload["method"],"delta":payload["delta"].as_str().map(|t|t.chars().take(64000).collect::<String>()),"turn":{"turnId":payload["turn"]["turnId"],"status":payload["turn"]["status"]},"note":"Event preview limit exceeded; inspect locally"});
        }
        let event = {
            let mut db = self.db.lock().unwrap();
            let tx = db.transaction()?;
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
        let sessions=Self::query_db(&tx,"SELECT s.* FROM sessions s JOIN projects p ON s.projectId=p.projectId WHERE p.enabled=1 ORDER BY updatedAt DESC",[])?;
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
