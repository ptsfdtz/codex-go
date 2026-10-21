//! Bounded read views for future device-facing project pagination.
//! Not an atomic upstream snapshot or a remotely exposed action.
use crate::{ensure, rpc::ProtocolVersion, security, service::Core, Error, Result};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    time::{Duration, Instant},
};

const TTL: Duration = Duration::from_secs(120);
const MAX_BYTES: usize = 2 * 1024 * 1024;
const PAGE_BYTES: usize = 384 * 1024;

pub(crate) struct ProjectView {
    device: String,
    generation: String,
    grants: Vec<Value>,
    created: Instant,
    limit: usize,
    tokens: Vec<String>,
    pages: Vec<Value>,
}

impl Core {
    fn project_view_device(&self, device: &str) -> Result<()> {
        ensure(
            !self
                .store
                .query(
                    "SELECT deviceId FROM devices WHERE deviceId=? AND revokedAt IS NULL",
                    [device],
                )?
                .is_empty(),
            "UNAUTHORIZED",
            "Device is not authorized",
        )
    }

    fn verify_project_view(&self, device: &str, generation: &str, grants: &[Value]) -> Result<()> {
        self.project_view_device(device)?;
        ensure(
            self.upstream()?.generation == generation,
            "UPSTREAM_UNAVAILABLE",
            "Runtime changed; restart project listing",
        )?;
        ensure(
            self.project_grant_snapshot()? == grants,
            "SYNC_CONFLICT",
            "Authorization changed; restart project listing",
        )?;
        self.verified_project_grants(grants)?;
        Ok(())
    }

    /// Internal preparation for a future versioned remote contract. Continuations
    /// are opaque, device-bound, replayable and expire after 120 seconds. This
    /// bounded read view does not promise atomicity across upstream source pages.
    pub async fn native_project_device_page(
        &self,
        device: &str,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<Value> {
        self.project_view_device(device)?;
        ensure(
            (1..=100).contains(&limit),
            "INVALID_REQUEST",
            "Invalid project page limit",
        )?;
        if let Some(cursor) = cursor {
            ensure(
                security::valid_token(cursor),
                "INVALID_CURSOR",
                "Restart project listing",
            )?;
            let mut views = self.project_views.lock().unwrap();
            views.retain(|view| view.created.elapsed() < TTL);
            let (view, index) = views
                .iter()
                .filter(|view| view.device == device)
                .find_map(|view| {
                    view.tokens
                        .iter()
                        .position(|token| security::equal(token, cursor))
                        .map(|index| (view, index))
                })
                .ok_or_else(|| Error::new("INVALID_CURSOR", "Restart project listing"))?;
            ensure(
                view.limit == limit,
                "INVALID_CURSOR",
                "Project page limit changed; restart listing",
            )?;
            self.verify_project_view(device, &view.generation, &view.grants)?;
            return Ok(view.pages[index].clone());
        }
        let _building = self
            .project_view_build
            .try_lock()
            .map_err(|_| Error::new("BUSY", "Project listing is already being prepared"))?;
        let view = tokio::time::timeout(
            Duration::from_secs(30),
            self.build_project_view(device, limit),
        )
        .await
        .map_err(|_| {
            Error::new(
                "UPSTREAM_UNAVAILABLE",
                "Project listing timed out; restart listing",
            )
        })??;
        self.verify_project_view(device, &view.generation, &view.grants)?;
        let first = view.pages[0].clone();
        let mut views = self.project_views.lock().unwrap();
        views.retain(|old| old.created.elapsed() < TTL && old.device != device);
        ensure(
            views.len() < 8,
            "BUSY",
            "Project listing cache is full; retry later",
        )?;
        views.push(view);
        Ok(first)
    }

    async fn build_project_view(&self, device: &str, limit: usize) -> Result<ProjectView> {
        let rpc = self.upstream()?;
        ensure(
            rpc.protocol() == ProtocolVersion::DesktopBaseline,
            "UPSTREAM_VERSION_UNSUPPORTED",
            "Native projects require the desktop baseline",
        )?;
        let grants = self.project_grant_snapshot()?;
        let verified = self.verified_project_grants(&grants)?;
        let mut cursor: Option<String> = None;
        let mut cursors = HashSet::new();
        let mut ids = HashSet::new();
        let mut data = Vec::new();
        let mut bytes = 0;
        if !verified.is_empty() {
            for page_index in 0..32 {
                let page = rpc.project_page(cursor.as_deref(), 100).await?;
                bytes += page.to_string().len();
                ensure(
                    bytes <= MAX_BYTES,
                    "UPSTREAM_CONTENT_TOO_LARGE",
                    "Project listing exceeds read-view limit",
                )?;
                for project in page["data"].as_array().unwrap() {
                    ensure(
                        ids.insert(project["id"].as_str().unwrap().to_owned()),
                        "SYNC_CONFLICT",
                        "Project repeated across source pages; restart listing",
                    )?;
                }
                data.extend(self.authorized_project_data(&page, &verified)?);
                self.verify_project_view(device, &rpc.generation, &grants)?;
                cursor = page["nextCursor"].as_str().map(str::to_owned);
                let Some(next) = &cursor else { break };
                ensure(
                    cursors.insert(next.clone()),
                    "UPSTREAM_PROTOCOL_ERROR",
                    "Project cursor cycle; restart listing",
                )?;
                ensure(
                    page_index < 31,
                    "UPSTREAM_CONTENT_TOO_LARGE",
                    "Project listing exceeds page limit",
                )?;
            }
        }
        ensure(
            data.iter()
                .map(|entry| entry.to_string().len() + 1)
                .sum::<usize>()
                + 2
                <= MAX_BYTES,
            "UPSTREAM_CONTENT_TOO_LARGE",
            "Authorized project view exceeds content limit",
        )?;
        let mut groups: Vec<Vec<Value>> = vec![Vec::new()];
        let mut group_bytes = 1024;
        for entry in data {
            let size = entry.to_string().len() + 1;
            ensure(
                size + 1024 <= PAGE_BYTES,
                "UPSTREAM_CONTENT_TOO_LARGE",
                "Project exceeds device page limit",
            )?;
            if groups.last().unwrap().len() == limit || group_bytes + size > PAGE_BYTES {
                groups.push(Vec::new());
                group_bytes = 1024;
            }
            groups.last_mut().unwrap().push(entry);
            group_bytes += size;
        }
        let tokens: Vec<_> = groups.iter().map(|_| security::token()).collect();
        let view_id = crate::uid("project_view");
        let pages = groups
            .into_iter()
            .enumerate()
            .map(|(index, data)| {
                json!({
                    "source":"upstream-native-projects", "consistency":"bounded-read-view",
                    "viewId":view_id, "data":data, "nextCursor":tokens.get(index + 1)
                })
            })
            .collect();
        Ok(ProjectView {
            device: device.into(),
            generation: rpc.generation.clone(),
            grants,
            created: Instant::now(),
            limit,
            tokens,
            pages,
        })
    }
}
