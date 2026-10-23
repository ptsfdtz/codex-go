//! Versioned read-only native project pages and locally authorized projection.
use crate::{
    ensure, paths,
    rpc::{ProtocolVersion, Rpc},
    s,
    service::Core,
    Result,
};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

fn page_parameters(rpc: &Rpc, cursor: Option<&str>, limit: usize) -> Result<()> {
    ensure(
        rpc.protocol() == ProtocolVersion::DesktopBaseline,
        "UPSTREAM_VERSION_UNSUPPORTED",
        "Native projects require the desktop baseline",
    )?;
    ensure(
        (1..=100).contains(&limit),
        "INVALID_REQUEST",
        "Invalid project page limit",
    )?;
    ensure(
        cursor.is_none_or(|v| !v.is_empty() && v.len() <= 4096),
        "INVALID_REQUEST",
        "Invalid project cursor",
    )
}

impl Rpc {
    /// Returns the authoritative source page without creating Bridge projects or
    /// granting roots. Core must apply local grants before remote exposure.
    pub async fn project_page(&self, cursor: Option<&str>, limit: usize) -> Result<Value> {
        page_parameters(self, cursor, limit)?;
        let response = self
            .request("project/list", json!({"cursor":cursor,"limit":limit}))
            .await?;
        self.validate("experimental/ProjectListResponse", &response)?;
        ensure(
            response.to_string().len() <= 384 * 1024,
            "UPSTREAM_CONTENT_TOO_LARGE",
            "Native project page exceeds content limit",
        )?;
        let data = response["data"].as_array().unwrap();
        ensure(
            data.len() <= limit,
            "UPSTREAM_PROTOCOL_ERROR",
            "Native project page exceeds requested limit",
        )?;
        let mut ids = HashSet::new();
        for project in data {
            let id = project["id"].as_str().unwrap();
            ensure(
                !id.is_empty() && id.len() <= 160 && ids.insert(id),
                "UPSTREAM_PROTOCOL_ERROR",
                "Invalid or duplicate native project identity",
            )?;
        }
        if let Some(next) = response["nextCursor"].as_str() {
            ensure(
                !next.is_empty() && next.len() <= 4096 && Some(next) != cursor,
                "UPSTREAM_PROTOCOL_ERROR",
                "Invalid or repeated native project cursor",
            )?;
        }
        Ok(response)
    }
}

impl Core {
    pub(crate) fn project_grant_snapshot(&self) -> Result<Vec<Value>> {
        self.store.query("SELECT projectId,canonicalPath,identity FROM projects WHERE enabled=1 ORDER BY projectId", [])
    }

    pub(crate) fn verified_project_grants(
        &self,
        snapshot: &[Value],
    ) -> Result<Vec<(String, PathBuf)>> {
        snapshot
            .iter()
            .map(|grant| {
                let id = s(grant, "projectId");
                let root = paths::root(&self.store, id)?;
                ensure(
                    paths::equal(Path::new(s(grant, "canonicalPath")), &root),
                    "SYNC_CONFLICT",
                    "Local project authorization changed; refresh catalog",
                )?;
                Ok((id.to_owned(), root))
            })
            .collect()
    }

    pub(crate) fn authorized_project_data(
        &self,
        source: &Value,
        grants: &[(String, PathBuf)],
    ) -> Result<Vec<Value>> {
        let mut data = Vec::new();
        for project in source["data"].as_array().unwrap() {
            let roots = project["roots"].as_array().unwrap();
            if roots.is_empty() {
                continue;
            }
            let mut mappings = Vec::new();
            let mut seen = HashSet::new();
            for (index, root) in roots.iter().enumerate() {
                let path = Path::new(root["path"].as_str().unwrap());
                if paths::valid(path).is_err() {
                    break;
                }
                let Ok(canonical) = paths::canonical(path) else {
                    break;
                };
                if !paths::equal(path, &canonical) {
                    break;
                }
                let Some((id, _)) = grants
                    .iter()
                    .find(|(_, granted)| paths::equal(granted, &canonical))
                else {
                    break;
                };
                ensure(
                    seen.insert(id),
                    "UPSTREAM_PROTOCOL_ERROR",
                    "Duplicate native project root",
                )?;
                mappings.push(json!({"rootIndex":index,"projectId":id}));
            }
            if mappings.len() == roots.len() {
                data.push(json!({"project":project,"rootGrants":mappings}));
            }
        }
        Ok(data)
    }

    /// Projects are visible only when every source root exactly matches a live
    /// local grant. Native identity and Bridge root grants remain separate.
    /// This internal page still carries the upstream cursor; it is not a remote
    /// action or a replacement for a future device-bound pagination envelope.
    pub async fn native_project_page(&self, cursor: Option<&str>, limit: usize) -> Result<Value> {
        let rpc = self.upstream()?;
        page_parameters(&rpc, cursor, limit)?;
        let before = self.project_grant_snapshot()?;
        let grants = self.verified_project_grants(&before)?;
        if grants.is_empty() {
            return Ok(json!({"source":"upstream-native-projects","data":[],"nextCursor":null}));
        }
        let source = rpc.project_page(cursor, limit).await?;
        let data = self.authorized_project_data(&source, &grants)?;
        ensure(
            before == self.project_grant_snapshot()?,
            "SYNC_CONFLICT",
            "Local project authorization changed; refresh catalog",
        )?;
        self.verified_project_grants(&before)?;
        ensure(
            self.upstream()?.generation == rpc.generation,
            "UPSTREAM_UNAVAILABLE",
            "Runtime changed; refresh catalog",
        )?;
        ensure(
            before == self.project_grant_snapshot()?,
            "SYNC_CONFLICT",
            "Local project authorization changed; refresh catalog",
        )?;
        let response = json!({"source":"upstream-native-projects","data":data,"nextCursor":source["nextCursor"]});
        ensure(
            response.to_string().len() <= 384 * 1024,
            "UPSTREAM_CONTENT_TOO_LARGE",
            "Authorized project page exceeds content limit",
        )?;
        Ok(response)
    }
}
