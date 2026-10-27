//! Authoritative project-scoped skill metadata. Never reads SKILL.md or executes skills.
use crate::{ensure, now, paths, service::Core, Error, Result};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::atomic::Ordering;

fn skill_id(skill: &Value) -> String {
    let identity = json!([skill["name"], skill["path"]]).to_string();
    format!("{:x}", Sha256::digest(identity.as_bytes()))
}

struct SkillWriteGuard<'a>(&'a Core);
impl Drop for SkillWriteGuard<'_> {
    fn drop(&mut self) {
        self.0
            .busy
            .lock()
            .unwrap()
            .remove("__skills_config_write__");
    }
}

impl Core {
    pub async fn set_skill_enabled(&self, p: &Value) -> Result<Value> {
        let project_id = crate::s(p, "projectId");
        let root = paths::root(&self.store, project_id)?;
        let rpc = self.upstream()?;
        ensure(
            self.busy
                .lock()
                .unwrap()
                .insert("__skills_config_write__".into()),
            "CONFLICT",
            "Skill configuration write in progress",
        )?;
        let _guard = SkillWriteGuard(self);
        let entry = self.skill_catalog_source(project_id, true).await?;
        let expected = p["expectedEnabled"]
            .as_bool()
            .ok_or_else(|| Error::new("INVALID_REQUEST", "Expected skill state required"))?;
        ensure(
            p["enabled"].is_boolean(),
            "INVALID_REQUEST",
            "Enabled skill state required",
        )?;
        let skill = select_config_skill(&entry, crate::s(p, "skillId"), expected)?;
        ensure(
            paths::equal(&root, &paths::root(&self.store, project_id)?)
                && rpc.alive.load(Ordering::SeqCst)
                && self.upstream()?.generation == rpc.generation,
            "SYNC_CONFLICT",
            "Project or runtime changed before skill write",
        )?;
        let params = json!({"path":skill["path"],"enabled":p["enabled"]});
        rpc.validate("v2/SkillsConfigWriteParams", &params)?;
        let response = rpc
            .request("skills/config/write", params)
            .await
            .map_err(|_| {
                Error::new(
                    "OUTCOME_UNKNOWN",
                    "Skill configuration write was not confirmed; refresh before retrying",
                )
            })?;
        let checked = (|| -> Result<Value> {
            rpc.validate("v2/SkillsConfigWriteResponse", &response)?;
            ensure(
                paths::equal(&root, &paths::root(&self.store, project_id)?)
                    && self.upstream()?.generation == rpc.generation,
                "SYNC_CONFLICT",
                "Project or runtime changed after skill write",
            )?;
            Ok(
                json!({"projectId":project_id,"skillId":p["skillId"],"effectiveEnabled":response["effectiveEnabled"],"requestedEnabled":p["enabled"]}),
            )
        })();
        checked.map_err(|_| {
            Error::new(
                "OUTCOME_UNKNOWN",
                "Skill configuration may have changed; refresh before retrying",
            )
        })
    }
    pub async fn skill_catalog(&self, project_id: &str) -> Result<Value> {
        let entry = self.skill_catalog_source(project_id, false).await?;
        let skills = entry["skills"].as_array().unwrap();
        let skills = skills.iter().map(|skill| json!({
            "id":skill_id(skill),
            "name":skill["name"], "description":skill["description"].as_str().unwrap_or("").chars().take(16000).collect::<String>(),
            "enabled":skill["enabled"], "scope":skill["scope"],
            "displayName":skill["interface"]["displayName"],
            "shortDescription":skill["interface"]["shortDescription"].as_str().or(skill["shortDescription"].as_str()),
        })).collect::<Vec<_>>();
        Ok(
            json!({"projectId":project_id,"skills":skills,"errorCount":entry["errors"].as_array().map_or(0, Vec::len),"readAt":now()}),
        )
    }

    pub(crate) async fn resolve_skill_input(
        &self,
        project_id: &str,
        selected: &Value,
    ) -> Result<Vec<Value>> {
        let ids = selected
            .as_array()
            .ok_or_else(|| Error::new("INVALID_REQUEST", "Skills must be an array"))?;
        ensure(ids.len() <= 8, "INVALID_REQUEST", "最多选择 8 个技能")?;
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        for id in ids {
            ensure(
                id.as_str()
                    .is_some_and(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())),
                "INVALID_REQUEST",
                "Invalid skill selection",
            )?;
        }
        let entry = self.skill_catalog_source(project_id, true).await?;
        resolve_selection(&entry, ids)
    }

    pub(crate) async fn authorize_skill_parts(
        &self,
        project_id: &str,
        parts: &[Value],
    ) -> Result<()> {
        let selected = parts
            .iter()
            .filter(|part| part["type"] == "skill")
            .collect::<Vec<_>>();
        if selected.is_empty() {
            return Ok(());
        }
        for part in &selected {
            crate::protocol::fields(part, &["type", "name", "path"], &[])?;
        }
        let ids = json!(selected
            .iter()
            .map(|part| skill_id(part))
            .collect::<Vec<_>>());
        self.resolve_skill_input(project_id, &ids).await?;
        Ok(())
    }

    async fn skill_catalog_source(&self, project_id: &str, reload: bool) -> Result<Value> {
        let root = paths::root(&self.store, project_id)?;
        let rpc = self.upstream()?;
        let result = rpc
            .request("skills/list", json!({"cwds":[root],"forceReload":reload}))
            .await?;
        rpc.validate("v2/SkillsListResponse", &result)?;
        let entries = result["data"]
            .as_array()
            .ok_or_else(|| Error::new("UPSTREAM_PROTOCOL_ERROR", "Missing skill catalog"))?;
        let matching = entries
            .iter()
            .filter(|entry| {
                entry["cwd"]
                    .as_str()
                    .is_some_and(|cwd| paths::equal(&root, std::path::Path::new(cwd)))
            })
            .collect::<Vec<_>>();
        ensure(
            matching.len() == 1,
            "UPSTREAM_PROTOCOL_ERROR",
            "Ambiguous project skill catalog",
        )?;
        let entry = matching[0];
        let skills = entry["skills"]
            .as_array()
            .ok_or_else(|| Error::new("UPSTREAM_PROTOCOL_ERROR", "Missing skills"))?;
        ensure(
            skills.len() <= 1000,
            "UPSTREAM_CONTENT_TOO_LARGE",
            "Too many skills",
        )?;
        ensure(
            paths::equal(&root, &paths::root(&self.store, project_id)?),
            "SYNC_CONFLICT",
            "Project grant changed while reading skills",
        )?;
        ensure(
            rpc.alive.load(Ordering::SeqCst) && self.upstream()?.generation == rpc.generation,
            "SYNC_CONFLICT",
            "Runtime changed while reading skills",
        )?;
        Ok(entry.clone())
    }
}

fn select_config_skill<'a>(entry: &'a Value, id: &str, expected: bool) -> Result<&'a Value> {
    let matches = entry["skills"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|skill| skill_id(skill) == id)
        .collect::<Vec<_>>();
    ensure(
        matches.len() == 1,
        "SYNC_CONFLICT",
        "Skill changed; refresh before changing configuration",
    )?;
    let skill = matches[0];
    ensure(
        skill["enabled"] == expected,
        "SYNC_CONFLICT",
        "Skill enabled state changed; refresh",
    )?;
    Ok(skill)
}

fn resolve_selection(entry: &Value, ids: &[Value]) -> Result<Vec<Value>> {
    let mut seen = std::collections::HashSet::new();
    let mut input = Vec::new();
    for id in ids {
        let id = id
            .as_str()
            .ok_or_else(|| Error::new("INVALID_REQUEST", "Invalid skill ID"))?;
        ensure(
            seen.insert(id),
            "INVALID_REQUEST",
            "Duplicate skill selection",
        )?;
        let matches = entry["skills"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|skill| skill_id(skill) == id)
            .collect::<Vec<_>>();
        ensure(
            matches.len() == 1,
            "SYNC_CONFLICT",
            "技能已变化，请重新选择",
        )?;
        let skill = matches[0];
        ensure(
            skill["enabled"] == true,
            "CONFLICT",
            "所选技能已禁用，请重新选择",
        )?;
        input.push(json!({"type":"skill","name":skill["name"],"path":skill["path"]}));
    }
    Ok(input)
}
