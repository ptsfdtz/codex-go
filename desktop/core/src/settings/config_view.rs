//! A bounded display projection, never a raw config export.
use crate::Error;
use crate::{ensure, now, paths, service::Core, Result};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::sync::atomic::Ordering;

fn user_layer(source: &Value) -> Option<&Value> {
    let layers = source["layers"].as_array()?;
    let mut matches = layers.iter().filter(|layer| {
        layer["name"]["type"] == "user"
            && layer["name"]["profile"].is_null()
            && layer["disabledReason"].is_null()
    });
    let layer = matches.next()?;
    if matches.next().is_some()
        || layer["name"]["file"].as_str().is_none()
        || layer["version"].as_str().is_none()
    {
        return None;
    }
    Some(layer)
}
fn user_revision(layer: &Value) -> String {
    format!(
        "{:x}",
        Sha256::digest(
            json!([layer["name"]["file"], layer["version"]])
                .to_string()
                .as_bytes()
        )
    )
}
struct ConfigWriteGuard<'a>(&'a Core);
impl Drop for ConfigWriteGuard<'_> {
    fn drop(&mut self) {
        self.0
            .busy
            .lock()
            .unwrap()
            .remove("__model_defaults_write__");
    }
}
const KEYS: &[&str] = &[
    "model",
    "model_provider",
    "review_model",
    "model_reasoning_effort",
    "model_reasoning_summary",
    "model_verbosity",
    "service_tier",
    "approval_policy",
    "approvals_reviewer",
    "sandbox_mode",
    "web_search",
    "default_permissions",
    "model_context_window",
    "model_auto_compact_token_limit",
];
fn settings(source: &Value) -> Value {
    let mut fields = Map::new();
    for key in KEYS {
        if let Some(value) = source.get(key) {
            let safe = match value {
                Value::String(text) => json!(text.chars().take(256).collect::<String>()),
                Value::Number(_) | Value::Bool(_) | Value::Null => value.clone(),
                _ => Value::Null,
            };
            fields.insert((*key).into(), safe);
        }
    }
    Value::Object(fields)
}
fn layer(source: &Value) -> Value {
    // Do not forward source paths, enterprise identifiers, profile names or flags.
    json!({"sourceType":source["name"]["type"].as_str().unwrap_or("unknown"),"disabled":source["disabledReason"].is_string(),"values":settings(&source["config"])})
}
impl Core {
    pub async fn write_model_defaults(&self, p: &Value) -> Result<Value> {
        self.check_model(crate::s(p, "model"), p["effort"].as_str().unwrap_or(""))
            .await?;
        let edits = json!([{"keyPath":"model","value":p["model"],"mergeStrategy":"replace"},{"keyPath":"model_reasoning_effort","value":p["effort"].as_str().map(Value::from).unwrap_or(Value::Null),"mergeStrategy":"replace"}]);
        self.write_user_defaults(p, edits, json!({"model":p["model"],"effort":p["effort"]}))
            .await
    }
    pub async fn write_output_defaults(&self, p: &Value) -> Result<Value> {
        for (key, allowed) in [
            ("verbosity", &["default", "low", "medium", "high"][..]),
            (
                "summary",
                &["default", "auto", "concise", "detailed", "none"][..],
            ),
        ] {
            ensure(
                allowed.contains(&crate::s(p, key)),
                "INVALID_REQUEST",
                "Unsupported output setting",
            )?;
        }
        let value = |key: &str| {
            if p[key] == "default" {
                Value::Null
            } else {
                p[key].clone()
            }
        };
        let edits = json!([{"keyPath":"model_verbosity","value":value("verbosity"),"mergeStrategy":"replace"},{"keyPath":"model_reasoning_summary","value":value("summary"),"mergeStrategy":"replace"}]);
        self.write_user_defaults(
            p,
            edits,
            json!({"verbosity":p["verbosity"],"summary":p["summary"]}),
        )
        .await
    }
    async fn write_user_defaults(&self, p: &Value, edits: Value, values: Value) -> Result<Value> {
        let rpc = self.upstream()?;
        ensure(
            self.busy
                .lock()
                .unwrap()
                .insert("__model_defaults_write__".into()),
            "CONFLICT",
            "Model defaults write in progress",
        )?;
        let _guard = ConfigWriteGuard(self);
        let current = rpc
            .request("config/read", json!({"includeLayers":true}))
            .await?;
        rpc.validate("v2/ConfigReadResponse", &current)?;
        let layer = user_layer(&current).ok_or_else(|| {
            Error::new(
                "UNSUPPORTED",
                "No unambiguous base user configuration layer",
            )
        })?;
        ensure(
            p["expectedUserRevision"].as_str() == Some(user_revision(layer).as_str()),
            "SYNC_CONFLICT",
            "User configuration changed; refresh before saving",
        )?;
        let params = json!({"filePath":layer["name"]["file"],"expectedVersion":layer["version"],"edits":edits});
        rpc.validate("v2/ConfigBatchWriteParams", &params)?;
        ensure(
            self.upstream()?.generation == rpc.generation && rpc.alive.load(Ordering::SeqCst),
            "SYNC_CONFLICT",
            "Runtime changed before config write",
        )?;
        let response = rpc
            .request("config/batchWrite", params)
            .await
            .map_err(|_| {
                Error::new(
                    "OUTCOME_UNKNOWN",
                    "Configuration write not confirmed; refresh before retrying",
                )
            })?;
        let checked = (|| -> Result<Value> {
            rpc.validate("v2/ConfigWriteResponse", &response)?;
            ensure(
                self.upstream()?.generation == rpc.generation && rpc.alive.load(Ordering::SeqCst),
                "SYNC_CONFLICT",
                "Runtime changed during config write",
            )?;
            ensure(
                response["filePath"] == layer["name"]["file"],
                "UPSTREAM_PROTOCOL_ERROR",
                "Config write target changed",
            )?;
            let mut output = values;
            output["status"] = response["status"].clone();
            output["overridden"] = json!(
                response["status"] == "okOverridden" || !response["overriddenMetadata"].is_null()
            );
            Ok(output)
        })();
        checked.map_err(|_| {
            Error::new(
                "OUTCOME_UNKNOWN",
                "Configuration may have changed; refresh before retrying",
            )
        })
    }
    pub async fn execution_config(&self, project_id: Option<&str>) -> Result<Value> {
        let root = project_id
            .map(|id| paths::root(&self.store, id))
            .transpose()?;
        let rpc = self.upstream()?;
        let mut params = json!({"includeLayers":true});
        if let Some(root) = &root {
            params["cwd"] = json!(root);
        }
        let result = rpc.request("config/read", params).await?;
        rpc.validate("v2/ConfigReadResponse", &result)?;
        let source_layers = result["layers"].as_array();
        ensure(
            source_layers.is_none_or(|layers| layers.len() <= 128),
            "UPSTREAM_CONTENT_TOO_LARGE",
            "Too many configuration layers",
        )?;
        let layers = source_layers.map(|layers| layers.iter().map(layer).collect::<Vec<_>>());
        let mut origins = Map::new();
        for key in KEYS {
            if let Some(origin) = result["origins"].get(key) {
                origins.insert(
                    (*key).into(),
                    json!({"sourceType":origin["name"]["type"].as_str().unwrap_or("unknown")}),
                );
            }
        }
        if let (Some(id), Some(root)) = (project_id, &root) {
            ensure(
                paths::equal(root, &paths::root(&self.store, id)?),
                "SYNC_CONFLICT",
                "Project grant changed during configuration read",
            )?;
        }
        ensure(
            rpc.alive.load(Ordering::SeqCst) && self.upstream()?.generation == rpc.generation,
            "SYNC_CONFLICT",
            "Runtime changed while reading configuration",
        )?;
        Ok(
            json!({"projectId":project_id,"values":settings(&result["config"]),"origins":origins,"layers":layers,"userRevision":if project_id.is_none(){user_layer(&result).map(user_revision)}else{None},"workspacePolicyCompatible":crate::codex::check_policy(&result).is_ok(),"sandboxVerified":self.verified.load(Ordering::SeqCst),"readAt":now()}),
        )
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn config_projection_excludes_credentials_instructions_and_layer_paths() {
        let input = json!({"model":"model-a","approval_policy":{"reject":{"secret":"hidden"}},"api_key":"hidden","developer_instructions":"hidden","mcp_servers":{"secret":"hidden"}});
        let view = settings(&input);
        assert_eq!(view["model"], "model-a");
        assert!(view["approval_policy"].is_null());
        assert!(!view.to_string().contains("hidden"));
        let view = layer(
            &json!({"name":{"type":"user","file":"hidden","profile":"hidden"},"config":input,"disabledReason":"hidden"}),
        );
        assert_eq!(view["sourceType"], "user");
        assert_eq!(view["disabled"], true);
        assert!(!view.to_string().contains("hidden"));
    }
}
