//! Versioned read-only native project catalog. Not a remote authorization boundary.
use crate::{
    ensure,
    rpc::{ProtocolVersion, Rpc},
    Result,
};
use serde_json::{json, Value};
use std::collections::HashSet;

impl Rpc {
    /// Returns the authoritative source page without creating Bridge projects or
    /// granting roots. Core must apply local grants before remote exposure.
    pub async fn project_page(&self, cursor: Option<&str>, limit: usize) -> Result<Value> {
        ensure(
            self.protocol() == ProtocolVersion::DesktopBaseline,
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
        )?;
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
