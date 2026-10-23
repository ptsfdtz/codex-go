//! Read persisted upstream content, independent of the bounded Bridge journal.
use crate::{ensure, paths, rpc::Rpc, s, service::Core, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const PAGE_BYTES: usize = 384 * 1024;
const CHUNK_BYTES: usize = 48 * 1024;
impl Core {
    pub(crate) async fn history_source(
        &self,
        session_id: &str,
        cursor: Option<&str>,
        limit: usize,
        direction: &str,
    ) -> Result<(std::sync::Arc<Rpc>, Value)> {
        ensure(
            ["asc", "desc"].contains(&direction),
            "INVALID_REQUEST",
            "Invalid history direction",
        )?;
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
                json!({"threadId":thread_id,"cursor":cursor,"limit":limit,"sortDirection":direction}),
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
    pub async fn session_image(
        &self,
        session_id: &str,
        turn_id: &str,
        item_id: &str,
        content_index: usize,
        offset: usize,
        expected_hash: Option<&str>,
    ) -> Result<Value> {
        use std::{collections::HashSet, io::Read, sync::atomic::Ordering};
        let session = self.store.session(session_id)?;
        let root = paths::root(&self.store, s(&session, "projectId"))?;
        let rpc = self.upstream()?;
        let mut cursor: Option<String> = None;
        let mut seen = HashSet::new();
        let mut source = None;
        for _ in 0..100 {
            let (_, page) = self
                .history_source(session_id, cursor.as_deref(), 50, "desc")
                .await?;
            if let Some(entry) = page["data"]
                .as_array()
                .unwrap()
                .iter()
                .find(|entry| entry["turnId"] == turn_id && entry["item"]["id"] == item_id)
            {
                source = Some(entry["item"].clone());
                break;
            }
            cursor = page["nextCursor"].as_str().map(str::to_owned);
            let Some(next) = &cursor else { break };
            ensure(
                seen.insert(next.clone()),
                "UPSTREAM_PROTOCOL_ERROR",
                "Repeated image source cursor",
            )?;
        }
        let item = source.ok_or_else(|| {
            crate::Error::new(
                "CONTENT_CHANGED",
                "Image item was not found in bounded saved history",
            )
        })?;
        let path = match s(&item, "type") {
            "imageView" if content_index == 0 => s(&item, "path"),
            "imageGeneration" if content_index == 0 => s(&item, "savedPath"),
            "userMessage" => {
                let part = &item["content"][content_index];
                ensure(
                    part["type"] == "localImage",
                    "RESOURCE_UNAVAILABLE",
                    "Saved input has no local image resource",
                )?;
                s(part, "path")
            }
            _ => {
                return Err(crate::Error::new(
                    "RESOURCE_UNAVAILABLE",
                    "This item has no supported local image",
                ))
            }
        };
        ensure(
            !path.is_empty(),
            "RESOURCE_UNAVAILABLE",
            "Image source path is unavailable",
        )?;
        let target = std::path::Path::new(path);
        paths::valid(target)?;
        let target = paths::canonical(target)?;
        ensure(
            paths::within(&root, &target),
            "WORKSPACE_FORBIDDEN",
            "Image is outside the authorized project",
        )?;
        let read_root = root.clone();
        let bytes = tokio::task::spawn_blocking(move || -> Result<Vec<u8>> {
            let file = std::fs::File::open(&target)?;
            ensure(
                paths::within(&read_root, &paths::opened_path(&file)?),
                "WORKSPACE_FORBIDDEN",
                "Opened image escaped the project",
            )?;
            ensure(
                file.metadata()?.is_file() && file.metadata()?.len() <= 8 * 1024 * 1024,
                "UPSTREAM_CONTENT_TOO_LARGE",
                "Image exceeds 8 MiB",
            )?;
            let mut bytes = Vec::new();
            file.take(8 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
            ensure(
                bytes.len() <= 8 * 1024 * 1024,
                "UPSTREAM_CONTENT_TOO_LARGE",
                "Image exceeds 8 MiB",
            )?;
            Ok(bytes)
        })
        .await
        .map_err(|_| crate::Error::new("IO_ERROR", "Image reader failed"))??;
        let mime = image_mime(&bytes)
            .ok_or_else(|| crate::Error::new("RESOURCE_UNAVAILABLE", "Unsupported image format"))?;
        let hash = format!("{:x}", Sha256::digest(&bytes));
        ensure(
            expected_hash.is_none_or(|expected| expected == hash),
            "CONTENT_CHANGED",
            "Image changed during transfer",
        )?;
        ensure(
            offset < bytes.len(),
            "INVALID_REQUEST",
            "Image offset is outside content",
        )?;
        let current = self.store.session(session_id)?;
        ensure(
            current["projectId"] == session["projectId"]
                && current["upstreamThreadId"] == session["upstreamThreadId"]
                && paths::equal(&root, &paths::root(&self.store, s(&current, "projectId"))?)
                && !self.store.thread_deleted(s(&current, "upstreamThreadId"))?
                && rpc.alive.load(Ordering::SeqCst)
                && self.upstream()?.generation == rpc.generation,
            "SYNC_CONFLICT",
            "Image source authorization or runtime changed",
        )?;
        let end = (offset + CHUNK_BYTES).min(bytes.len());
        Ok(
            json!({"sessionId":session_id,"upstreamThreadId":session["upstreamThreadId"],"turnId":turn_id,"itemId":item_id,"contentIndex":content_index,"sha256":hash,"mime":mime,"totalBytes":bytes.len(),"offset":offset,"data":STANDARD.encode(&bytes[offset..end]),"nextOffset":if end<bytes.len(){Some(end)}else{None}}),
        )
    }
    pub async fn upstream_history(
        &self,
        session_id: &str,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<Value> {
        self.upstream_history_ordered(session_id, cursor, limit, "asc")
            .await
    }
    pub async fn upstream_history_ordered(
        &self,
        session_id: &str,
        cursor: Option<&str>,
        limit: usize,
        direction: &str,
    ) -> Result<Value> {
        ensure(
            (1..=50).contains(&limit),
            "INVALID_REQUEST",
            "Invalid history limit",
        )?;
        let mut limit = limit;
        loop {
            let (_, page) = self
                .history_source(session_id, cursor, limit, direction)
                .await?;
            let bytes = page.to_string().into_bytes();
            if bytes.len() <= PAGE_BYTES {
                return Ok(
                    json!({"sessionId":session_id,"source":"upstream-persisted","sortDirection":direction,"data":page["data"],"nextCursor":page["nextCursor"],"resource":null}),
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
                json!({"sessionId":session_id,"source":"upstream-persisted","sortDirection":direction,"data":[],"nextCursor":page["nextCursor"],"resource":{"cursor":cursor,"sha256":format!("{:x}",Sha256::digest(&content)),"bytes":content.len(),"itemId":data[0]["item"]["id"],"turnId":data[0]["turnId"],"chunkBytes":CHUNK_BYTES}}),
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
        self.upstream_history_content_ordered(session_id, cursor, expected_hash, offset, "asc")
            .await
    }
    pub async fn upstream_history_content_ordered(
        &self,
        session_id: &str,
        cursor: Option<&str>,
        expected_hash: &str,
        offset: usize,
        direction: &str,
    ) -> Result<Value> {
        let (_, page) = self
            .history_source(session_id, cursor, 1, direction)
            .await?;
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

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}
