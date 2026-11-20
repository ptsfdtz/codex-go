//! Read committed, locally authorized events independently of the live browser.
//! Only opaque routing identities leave the Host.
use super::{AbortTask, Saved};
use crate::{paths, s, service::Core, store::Store, Result};
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};

pub(super) fn cursor_key(saved: &Saved) -> String {
    format!(
        "pushCursor:{}",
        crate::digest(format!(
            "{}/{}/{}",
            saved.origin, saved.tokens.account_id, saved.tokens.cloud_device_id
        ))
    )
}

#[derive(Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Window {
    since: i64,
    completion_since: Option<i64>,
}

pub(super) fn start(core: &Arc<Core>, saved: &Saved, window: Window) -> AbortTask {
    let owner = Arc::clone(core);
    let identity = cursor_key(saved);
    AbortTask(tokio::spawn(async move {
        let _ = forward(owner, identity, window).await;
    }))
}

const NOTICES: &str = "
    SELECT e.eventId,e.sessionId,s.projectId,e.ts,
        CASE WHEN e.action='approval.requested' THEN json_extract(e.payloadJson,'$.approvalId') END AS approvalId,
        CASE WHEN e.action='approval.requested' THEN json_extract(e.payloadJson,'$.approvalId')
            WHEN e.action IN ('upstream.progress','turn.progress') THEN json_extract(e.payloadJson,'$.item.id')
            ELSE COALESCE(json_extract(e.payloadJson,'$.upstreamTurnId'),json_extract(e.payloadJson,'$.turn.upstreamTurnId'),
                json_extract(e.payloadJson,'$.upstream.id'),e.turnId) END AS sourceId,
        CASE e.action WHEN 'approval.requested' THEN CASE json_extract(e.payloadJson,'$.method')
            WHEN 'item/tool/requestUserInput' THEN 'question' ELSE 'approval' END
            WHEN 'upstream.turn.completed' THEN json_extract(e.payloadJson,'$.status')
            WHEN 'turn.completed' THEN 'completed' WHEN 'turn.failed' THEN 'failed'
            WHEN 'turn.interrupted' THEN 'interrupted' ELSE 'question' END AS kind
        FROM events e JOIN sessions s ON s.sessionId=e.sessionId
    WHERE e.eventId>?1 AND e.eventId<=?2 AND e.ts>=?3 AND (
        e.action IN ('approval.requested','turn.completed','turn.failed','turn.interrupted','upstream.turn.completed') OR
        e.eventId IN (SELECT eventId FROM question_item_events WHERE eventId>?1 AND eventId<=?2))
    ORDER BY e.eventId LIMIT 16";

fn notices(store: &Store, after: i64, through: i64) -> Result<Vec<Value>> {
    store.query(
        NOTICES,
        rusqlite::params![after, through, crate::future(-300)],
    )
}

fn notification_key(owner: &str, row: &Value) -> String {
    let source = row["sourceId"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map_or_else(|| row["eventId"].to_string(), str::to_owned);
    crate::digest(json!([owner, row["sessionId"], row["kind"], source]).to_string())
}

async fn forward(core: Arc<Core>, identity: String, window: Window) -> Result<()> {
    let mut cursor = core
        .store
        .meta(&identity)?
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    core.store.set_meta(&identity, &cursor.to_string())?;
    let mut delay = Duration::from_secs(2);
    loop {
        tokio::time::sleep(delay).await;
        let mut events = core.store.events.subscribe();
        let through = core.store.cursor()?.parse::<i64>().unwrap_or(cursor);
        if through <= cursor {
            // Sleep while the Host is idle. A lagged broadcast also wakes us:
            // the SQLite journal, not the channel, is the delivery source.
            if matches!(
                events.recv().await,
                Err(tokio::sync::broadcast::error::RecvError::Closed)
            ) {
                return Ok(());
            }
            continue;
        }
        let rows = notices(&core.store, cursor, through)?;
        let count = rows.len();
        let mut failed = false;
        for row in rows {
            let id = row["eventId"].as_i64().unwrap_or_default();
            let session = s(&row, "sessionId");
            let completion = matches!(s(&row, "kind"), "completed" | "failed" | "interrupted");
            let since = if completion {
                window.completion_since
            } else {
                Some(window.since)
            };
            let time = chrono::DateTime::parse_from_rfc3339(s(&row, "ts"))
                .ok()
                .map(|t| t.timestamp_millis());
            if !since.zip(time).is_some_and(|(start, time)| time >= start) {
                cursor = id;
                continue;
            }
            // Authorization may have changed while the device was disconnected.
            if paths::root(&core.store, s(&row, "projectId")).is_ok() {
                let saved = core.cloud.access(&core).await?;
                if cursor_key(&saved) != identity {
                    return Ok(());
                }
                let key = notification_key(&identity, &row);
                let mut notice = json!({"sessionId":session,"eventKey":key,"kind":row["kind"],"occurredAt":time});
                if let Some(id) = row["approvalId"].as_str() {
                    notice["approvalId"] = json!(id);
                }
                let response = core
                    .cloud
                    .client
                    .post(format!("{}/api/v1/hosts/self/push", saved.origin))
                    .bearer_auth(&saved.tokens.access_token)
                    .json(&notice)
                    .send()
                    .await;
                // Malformed or stale routing hints are permanent for this
                // event. They cannot hold back later valid approvals.
                if !response.is_ok_and(|reply| {
                    reply.status().is_success() || matches!(reply.status().as_u16(), 400 | 422)
                }) {
                    failed = true;
                    break;
                }
            }
            cursor = id;
        }
        if !failed && count < 16 {
            cursor = through;
        }
        core.store.set_meta(&identity, &cursor.to_string())?;
        delay = if failed {
            (delay * 2).min(Duration::from_secs(30))
        } else {
            Duration::from_secs(2)
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_committed_task_approval_and_question_identities_are_emitted() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(&temp.path().join("push.db")).unwrap();
        let session = crate::uid("session");
        store
            .exec(
                "INSERT INTO projects VALUES('p','Project','path','identity',1,?)",
                [crate::now()],
            )
            .unwrap();
        store
            .exec(
                "INSERT INTO sessions VALUES(?,'p','thread','Session','idle',?,?)",
                rusqlite::params![session, crate::now(), crate::now()],
            )
            .unwrap();
        let event = |action: &str, payload: Value| {
            store.append(action, payload, Some(&session), None).unwrap()
        };
        let item =
            json!({"type":"agentMessage","id":"item-1","questions":[{"title":"private body"}]});
        event(
            "turn.progress",
            json!({"method":"item/started","item":item}),
        );
        event(
            "turn.progress",
            json!({"method":"item/completed","item":item}),
        );
        event(
            "approval.requested",
            json!({"method":"item/tool/requestUserInput"}),
        );
        event(
            "approval.requested",
            json!({"method":"item/commandExecution/requestApproval"}),
        );
        event("turn.failed", Value::Null);
        event(
            "upstream.turn.completed",
            json!({"status":"completed","upstreamTurnId":"same-turn"}),
        );
        event(
            "turn.completed",
            json!({"turn":{"upstreamTurnId":"same-turn"}}),
        );
        let notices = notices(&store, 0, 64).unwrap();
        assert_eq!(
            notices.iter().map(|v| s(v, "kind")).collect::<Vec<_>>(),
            [
                "question",
                "question",
                "approval",
                "failed",
                "completed",
                "completed"
            ]
        );
        assert_eq!(
            notification_key("owner", &notices[4]),
            notification_key("owner", &notices[5])
        );
        assert!(!json!(notices).to_string().contains("private body"));
        let snap = store.snapshot(true).unwrap();
        assert_eq!(
            snap["recentQuestions"],
            json!([{"sessionId":session,"itemId":"item-1"}])
        );
        store
            .exec(
                "INSERT INTO session_options(sessionId,archived) VALUES(?,1)",
                [&session],
            )
            .unwrap();
        assert_eq!(store.snapshot(true).unwrap()["recentQuestions"], json!([]));
    }
}
