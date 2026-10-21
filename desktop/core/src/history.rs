//! Read persisted upstream content, independent of the bounded Bridge journal.
use crate::{ensure, paths, rpc::Rpc, s, service::Core, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const PAGE_BYTES: usize = 384 * 1024;
const CHUNK_BYTES: usize = 48 * 1024;
impl Core {
    async fn history_source(
        &self,
        session_id: &str,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<(std::sync::Arc<Rpc>, Value)> {
        let session = self.store.session(session_id)?;
        let root = paths::root(&self.store, s(&session, "projectId"))?;
        let rpc = self.upstream()?;
        let thread_id = &session["upstreamThreadId"];
        let read = rpc
            .request(
                "thread/read",
                json!({"threadId":thread_id,"includeTurns":false}),
            )
            .await?;
        rpc.validate("v2/ThreadReadResponse", &read)?;
        ensure(
            read["thread"]["id"] == *thread_id
                && paths::equal(
                    &root,
                    &paths::canonical(std::path::Path::new(s(&read["thread"], "cwd")))?,
                ),
            "WORKSPACE_FORBIDDEN",
            "Upstream thread identity or workspace changed",
        )?;
        let page = rpc
            .request(
                "thread/items/list",
                json!({"threadId":thread_id,"cursor":cursor,"limit":limit,"sortDirection":"asc"}),
            )
            .await?;
        rpc.validate("v2/ThreadItemsListResponse", &page)?;
        ensure(
            page["data"].as_array().unwrap().len() <= limit,
            "UPSTREAM_PROTOCOL_ERROR",
            "Upstream exceeded history page limit",
        )?;
        if let Some(next) = page["nextCursor"].as_str() {
            ensure(
                Some(next) != cursor,
                "UPSTREAM_PROTOCOL_ERROR",
                "Repeated history cursor",
            )?;
        }
        paths::root(&self.store, s(&session, "projectId"))?;
        Ok((rpc, page))
    }
    pub async fn upstream_history(
        &self,
        session_id: &str,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<Value> {
        ensure(
            (1..=50).contains(&limit),
            "INVALID_REQUEST",
            "Invalid history limit",
        )?;
        let mut limit = limit;
        loop {
            let (_, page) = self.history_source(session_id, cursor, limit).await?;
            let bytes = page.to_string().into_bytes();
            if bytes.len() <= PAGE_BYTES {
                return Ok(
                    json!({"sessionId":session_id,"source":"upstream-persisted","data":page["data"],"nextCursor":page["nextCursor"],"resource":null}),
                );
            }
            if limit > 1 {
                limit = (limit / 2).max(1);
                continue;
            }
            let data = page["data"].as_array().unwrap();
            ensure(
                data.len() == 1,
                "UPSTREAM_PROTOCOL_ERROR",
                "Invalid oversized history page",
            )?;
            let content = data[0].to_string().into_bytes();
            return Ok(
                json!({"sessionId":session_id,"source":"upstream-persisted","data":[],"nextCursor":page["nextCursor"],"resource":{"cursor":cursor,"sha256":format!("{:x}",Sha256::digest(&content)),"bytes":content.len(),"itemId":data[0]["item"]["id"],"turnId":data[0]["turnId"],"chunkBytes":CHUNK_BYTES}}),
            );
        }
    }
    pub async fn upstream_history_content(
        &self,
        session_id: &str,
        cursor: Option<&str>,
        expected_hash: &str,
        offset: usize,
    ) -> Result<Value> {
        let (_, page) = self.history_source(session_id, cursor, 1).await?;
        let data = page["data"].as_array().unwrap();
        ensure(
            data.len() == 1,
            "CONTENT_CHANGED",
            "History content changed; reload its page",
        )?;
        let bytes = data[0].to_string().into_bytes();
        let digest = format!("{:x}", Sha256::digest(&bytes));
        ensure(
            digest == expected_hash,
            "CONTENT_CHANGED",
            "History content changed; reload its page",
        )?;
        ensure(
            offset < bytes.len(),
            "INVALID_REQUEST",
            "Invalid content offset",
        )?;
        let end = offset.saturating_add(CHUNK_BYTES).min(bytes.len());
        Ok(
            json!({"sessionId":session_id,"sha256":digest,"offset":offset,"totalBytes":bytes.len(),"data":STANDARD.encode(&bytes[offset..end]),"nextOffset":if end < bytes.len(){Some(end)}else{None}}),
        )
    }
}
