//! Bounded reads of authoritative Codex history. The cursor contains positions,
//! not cached messages, and never grants access to a session or project.
use crate::{digest, ensure, s, service::Core, Error, Result};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Position {
    scope: String,
    session: String,
    page: Option<String>,
}

impl Position {
    fn parse(cursor: &str, scope: &str) -> Result<Self> {
        let position: Self = serde_json::from_str(cursor)
            .map_err(|_| Error::new("INVALID_REQUEST", "Invalid history search cursor"))?;
        ensure(
            position.scope == scope
                && !position.session.is_empty()
                && position.session.len() <= 160
                && position
                    .page
                    .as_ref()
                    .is_none_or(|p| !p.is_empty() && p.chars().count() <= 32768),
            "INVALID_REQUEST",
            "Invalid or expired history search cursor",
        )?;
        Ok(position)
    }
}

/// Preserve the original case and Unicode boundaries of the match.
fn excerpt(text: &str, literal: &Regex) -> Option<String> {
    let found = literal.find(text)?;
    let start = text[..found.start()]
        .char_indices()
        .rev()
        .nth(39)
        .map_or(0, |(i, _)| i);
    let end = text[found.end()..]
        .char_indices()
        .nth(80)
        .map_or(text.len(), |(i, _)| found.end() + i);
    Some(text[start..end].to_owned())
}

fn message_match(item: &Value, literal: &Regex) -> Option<String> {
    match s(item, "type") {
        "agentMessage" | "assistantMessage" => excerpt(item["text"].as_str()?, literal),
        "userMessage" => item["content"]
            .as_array()?
            .iter()
            .filter(|part| {
                matches!(s(part, "type"), "text" | "inputText")
                    && crate::composer::file_reference_path(part).is_none()
            })
            .find_map(|part| excerpt(part["text"].as_str()?, literal)),
        _ => None,
    }
}

impl Core {
    fn search_sources(&self, project: Option<&str>, from: &str) -> Result<Vec<Value>> {
        if let Some(id) = project {
            self.store.project(id)?;
        }
        // Four scan steps and one lookahead. Select only identities from the
        // Host-owned catalog, using the same visibility rules as the sidebar.
        self.store.query(
            "SELECT s.sessionId, s.upstreamThreadId, s.projectId
             FROM sessions s JOIN projects p USING(projectId)
             WHERE p.enabled=1 AND (?1 IS NULL OR s.projectId=?1) AND s.sessionId>=?2
               AND NOT EXISTS (SELECT 1 FROM thread_deletions d WHERE d.threadId=s.upstreamThreadId)
               AND s.upstreamThreadId NOT IN (
                   SELECT value FROM json_each((SELECT value FROM meta WHERE key='codexCatalog'), '$.hiddenThreads') WHERE type='text'
               )
             ORDER BY s.sessionId LIMIT 5",
            rusqlite::params![project, from],
        )
    }

    pub(crate) async fn search_history(
        &self,
        query: &str,
        project: Option<&str>,
        cursor: Option<&str>,
    ) -> Result<Value> {
        let query = query.trim();
        ensure(
            !query.is_empty() && query.chars().count() <= 128,
            "INVALID_REQUEST",
            "Invalid search text",
        )?;
        let literal = RegexBuilder::new(&regex::escape(query))
            .case_insensitive(true)
            .build()
            .map_err(|_| Error::new("INVALID_REQUEST", "Invalid search text"))?;
        let runtime = self.upstream()?;
        let scope = digest(json!([runtime.generation, query, project]).to_string());
        let position = cursor.map(|c| Position::parse(c, &scope)).transpose()?;
        // Server-side keyset ordering is stable even when a turn changes updatedAt.
        let sessions =
            self.search_sources(project, position.as_ref().map_or("", |p| &p.session))?;
        let mut index = 0;
        let mut page_cursor = position.and_then(|p| {
            (sessions
                .get(index)
                .is_some_and(|row| row["sessionId"] == p.session))
            .then_some(p.page)
            .flatten()
        });
        let mut matches = Vec::new();
        let mut skipped = 0;
        let started = Instant::now();
        for _ in 0..4 {
            let Some(session) = sessions.get(index) else {
                break;
            };
            let id = s(session, "sessionId");
            // The page cursor occurs in each result. Bound the response even when
            // the upstream supplies a long opaque cursor. These sizes are the same
            // halving sequence used by sessions.history when opened with limit=50.
            let cursor_bytes = serde_json::to_string(&page_cursor).unwrap().len();
            let limit = [50, 25, 12, 6, 3, 1]
                .into_iter()
                .find(|count| count * (cursor_bytes + 2048) <= 512 * 1024)
                .unwrap_or(1);
            let page = match self
                .bounded_history_page(id, page_cursor.as_deref(), limit, "desc")
                .await
            {
                Ok((page, _)) => page,
                Err(error)
                    if matches!(
                        error.code.as_str(),
                        "WORKSPACE_FORBIDDEN" | "NOT_FOUND" | "UPSTREAM_ERROR" | "IO_ERROR"
                    ) =>
                {
                    skipped += 1;
                    index += 1;
                    page_cursor = None;
                    if started.elapsed() >= Duration::from_secs(2) {
                        break;
                    }
                    continue;
                }
                Err(error) => return Err(error),
            };
            for entry in page["data"].as_array().unwrap() {
                if let Some(snippet) = message_match(&entry["item"], &literal) {
                    matches.push(json!({
                        "sessionId":id,"projectId":session["projectId"],"turnId":entry["turnId"],
                        "itemId":entry["item"]["id"],"snippet":snippet,"pageCursor":page_cursor,
                    }));
                }
            }
            page_cursor = page["nextCursor"].as_str().map(str::to_owned);
            if page_cursor.is_none() {
                index += 1;
            }
            if !matches.is_empty() {
                // All results returned together come from this one verified page.
                // Check the original catalog identity again after the upstream await.
                ensure(
                    self.search_sources(Some(s(session, "projectId")), id)?
                        .first()
                        .is_some_and(|current| {
                            current["sessionId"] == session["sessionId"]
                                && current["upstreamThreadId"] == session["upstreamThreadId"]
                        }),
                    "SYNC_CONFLICT",
                    "History search session is no longer available",
                )?;
                break;
            }
            if started.elapsed() >= Duration::from_secs(2) {
                break;
            }
        }
        ensure(
            self.upstream()?.generation == runtime.generation,
            "SYNC_CONFLICT",
            "History search runtime changed",
        )?;
        let next = sessions.get(index).map(|session| {
            serde_json::to_string(&Position {
                scope,
                session: s(session, "sessionId").to_owned(),
                page: page_cursor,
            })
            .unwrap()
        });
        Ok(json!({"matches":matches,"nextCursor":next,"skippedSessions":skipped}))
    }
}

#[cfg(test)]
mod history_search_tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    #[tokio::test]
    async fn hits_use_authorized_history_pages_and_revocation_blocks_results_and_location() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = directory.path().join("project");
        std::fs::create_dir(&workspace).unwrap();
        let store = Arc::new(crate::store::Store::open(&directory.path().join("test.db")).unwrap());
        let project = crate::paths::add_local(&store, &workspace).unwrap();
        let project_id = s(&project, "projectId").to_owned();
        for id in ["aaa-hidden", "bbb-deleted", "visible"] {
            store
                .exec(
                    "INSERT INTO sessions VALUES(?1,?2,?1,'title','idle','now','now')",
                    rusqlite::params![id, project_id],
                )
                .unwrap();
        }
        store
            .set_meta("codexCatalog", r#"{"hiddenThreads":["aaa-hidden"]}"#)
            .unwrap();
        store.record_thread_deletion("bbb-deleted").unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("ws://{}/", listener.local_addr().unwrap());
        let revoke = Arc::new(AtomicBool::new(false));
        let server_revoke = revoke.clone();
        let server_store = store.clone();
        let server_project = project_id.clone();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            while let Some(Ok(frame)) = socket.next().await {
                if !frame.is_text() {
                    break;
                }
                let request: Value = serde_json::from_str(frame.to_text().unwrap()).unwrap();
                let params = &request["params"];
                assert_eq!(params["threadId"], "visible");
                let response = match s(&request, "method") {
                    "thread/read" => json!({"thread":{
                        "cliVersion":"test","createdAt":0,"cwd":workspace,"ephemeral":false,"id":"visible",
                        "modelProvider":"test","preview":"","projectId":null,"sessionId":"visible",
                        "source":"cli","status":{"type":"idle"},"turns":[],"updatedAt":0
                    }}),
                    "thread/items/list" => {
                        assert_eq!(params["sortDirection"], "desc");
                        if server_revoke.load(Ordering::SeqCst) {
                            server_store
                                .exec(
                                    "UPDATE projects SET enabled=0 WHERE projectId=?",
                                    [&server_project],
                                )
                                .unwrap();
                        }
                        let start = params["cursor"]
                            .as_str()
                            .map_or(0, |s| s.parse::<usize>().unwrap());
                        let end = (start + params["limit"].as_u64().unwrap() as usize).min(80);
                        let data = (start..end).map(|i| {
                            let extra = if i < 50 { String::new() } else { "x".repeat(20_000) };
                            json!({"turnId":"turn","item":{"type":"agentMessage","id":i.to_string(),"text":format!("Needle {i} {extra}")}})
                        }).collect::<Vec<_>>();
                        json!({"data":data,"nextCursor":(end<80).then(||end.to_string()),"backwardsCursor":null})
                    }
                    method => panic!("Unexpected upstream method {method}"),
                };
                let reply = json!({"id":request["id"],"result":response}).to_string();
                socket
                    .send(tokio_tungstenite::tungstenite::Message::Text(reply.into()))
                    .await
                    .unwrap();
            }
        });
        let (rpc, _events) = crate::rpc::Rpc::connect_local_websocket(&endpoint, &"x".repeat(43))
            .await
            .unwrap();
        let (local, _local_events) = tokio::sync::mpsc::channel(8);
        let core = Core::new(
            store,
            crate::security::Certificate {
                cert: String::new(),
                key: String::new(),
                fingerprint: String::new(),
                ips: Vec::new(),
            },
            "127.0.0.1".to_owned(),
            0,
            local,
        );
        *core.rpc.write().unwrap() = Some(rpc.clone());
        core.ready.store(true, Ordering::SeqCst);
        let first = core.search_history("needle", None, None).await.unwrap();
        assert_eq!(first["matches"].as_array().unwrap().len(), 50);
        assert_eq!(first["matches"][49]["itemId"], "49");
        assert!(first["matches"][0]["pageCursor"].is_null());
        let newest = core
            .upstream_history_ordered("visible", None, 50, "desc")
            .await
            .unwrap();
        assert_eq!(
            newest["data"][49]["item"]["id"],
            first["matches"][49]["itemId"]
        );
        assert!(core
            .search_history("changed", None, first["nextCursor"].as_str())
            .await
            .is_err());
        let older = core
            .search_history("needle", None, Some(first["nextCursor"].as_str().unwrap()))
            .await
            .unwrap();
        // Large entries shrink this page from 50 to 12 items. The last match
        // must open on exactly the same page even when the UI asks for 50.
        assert_eq!(older["matches"].as_array().unwrap().len(), 12);
        let hit = &older["matches"][11];
        assert_eq!(hit["pageCursor"], "50");
        assert_eq!(hit["itemId"], "61");
        let locate = core
            .upstream_history_ordered("visible", hit["pageCursor"].as_str(), 50, "desc")
            .await
            .unwrap();
        assert_eq!(locate["data"][11]["item"]["id"], hit["itemId"]);
        let last = core
            .search_history("needle", None, older["nextCursor"].as_str())
            .await
            .unwrap();
        assert_eq!(last["matches"][0]["itemId"], "62");
        assert!(last["nextCursor"].is_null());
        revoke.store(true, Ordering::SeqCst);
        let revoked = core.search_history("needle", None, None).await.unwrap();
        assert_eq!(revoked["matches"], json!([]));
        assert_eq!(revoked["skippedSessions"], 1);
        assert!(core
            .upstream_history_ordered("visible", Some("50"), 50, "desc")
            .await
            .is_err());
        assert!(core
            .search_history("needle", Some(&project_id), None)
            .await
            .is_err());
        rpc.stop();
        server.await.unwrap();
    }

    #[test]
    fn unicode_literal_search_returns_only_message_content_and_bounds_context() {
        let literal = RegexBuilder::new(&regex::escape("错误.[A]"))
            .case_insensitive(true)
            .build()
            .unwrap();
        let text = format!("{}错误.[a]{}", "中".repeat(120), "🌱".repeat(100));
        let expected = format!("{}错误.[a]{}", "中".repeat(40), "🌱".repeat(80));
        assert_eq!(
            message_match(&json!({"type":"agentMessage","text":text}), &literal),
            Some(expected.clone())
        );
        assert_eq!(
            message_match(
                &json!({"type":"userMessage","content":[{"type":"image","url":text},{"type":"text","text":text}]}),
                &literal
            ),
            Some(expected)
        );
        assert!(message_match(
            &json!({"type":"commandExecution","aggregatedOutput":text}),
            &literal
        )
        .is_none());
        assert!(message_match(
            &json!({"type":"userMessage","content":[{"type":"localImage","path":text}]}),
            &literal
        )
        .is_none());
    }

    #[test]
    fn cursor_and_wire_request_are_bounded_and_bound_to_the_search_scope() {
        let cursor = r#"{"scope":"a","session":"s","page":"opaque"}"#;
        assert!(Position::parse(cursor, "a").is_ok());
        assert!(Position::parse(cursor, "b").is_err());
        assert!(Position::parse(r#"{"scope":"a","session":"","page":null}"#, "a").is_err());
        let wire = |payload| {
            crate::protocol::parse(
                json!({"v":1,"type":"request","id":"1","action":"sessions.historySearch","payload":payload}),
            )
        };
        assert!(wire(json!({"query":"中文","projectId":"p"})).is_ok());
        for payload in [
            json!({"query":" "}),
            json!({"query":"长".repeat(129)}),
            json!({"query":"x","path":"arbitrary"}),
        ] {
            assert!(wire(payload).is_err());
        }
    }
}
