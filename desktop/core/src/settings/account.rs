//! Read-only, explicitly projected account metadata. Never forward auth material.
use crate::{ensure, now, s, service::Core, Result};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;

fn label(v: &Value, key: &str) -> Value {
    v[key]
        .as_str()
        .map(|text| json!(text.chars().take(256).collect::<String>()))
        .unwrap_or(Value::Null)
}
fn bucket(v: &Value) -> Value {
    let window = |key: &str| -> Value {
        let part = &v[key];
        if part.is_null() {
            return Value::Null;
        }
        json!({"usedPercent":part["usedPercent"].as_i64(),"windowDurationMins":part["windowDurationMins"].as_i64(),"resetsAt":part["resetsAt"].as_i64()})
    };
    json!({"limitId":label(v,"limitId"),"limitName":label(v,"limitName"),"planType":label(v,"planType"),"primary":window("primary"),"secondary":window("secondary"),
        "credits":if v["credits"].is_object(){json!({"hasCredits":v["credits"]["hasCredits"].as_bool(),"unlimited":v["credits"]["unlimited"].as_bool(),"balance":label(&v["credits"],"balance")})}else{Value::Null},
        "spendControlReached":v["spendControlReached"].as_bool()})
}
impl Core {
    pub async fn account_status(&self) -> Result<Value> {
        let rpc = self.upstream()?;
        let account = rpc
            .request("account/read", json!({"refreshToken":false}))
            .await?;
        rpc.validate("v2/GetAccountResponse", &account)?;
        let mut usage = Value::Null;
        let mut usage_error = Value::Null;
        if !account["account"].is_null() {
            match rpc.request("account/rateLimits/read", json!({})).await {
                Ok(result) => {
                    rpc.validate("v2/GetAccountRateLimitsResponse", &result)?;
                    let buckets = if let Some(map) = result["rateLimitsByLimitId"].as_object() {
                        ensure(
                            map.len() <= 64,
                            "UPSTREAM_CONTENT_TOO_LARGE",
                            "Too many usage buckets",
                        )?;
                        map.values().map(bucket).collect::<Vec<_>>()
                    } else {
                        vec![bucket(&result["rateLimits"])]
                    };
                    usage = json!({"ordinaryUsageAllowed":result["ordinaryUsageAllowed"].as_bool(),"buckets":buckets});
                }
                Err(error) => {
                    usage_error = json!(error.code);
                }
            }
        }
        // Refuse to combine usage from one account with a later account switch.
        let current = rpc
            .request("account/read", json!({"refreshToken":false}))
            .await?;
        rpc.validate("v2/GetAccountResponse", &current)?;
        ensure(
            account["account"] == current["account"]
                && account["requiresOpenaiAuth"] == current["requiresOpenaiAuth"]
                && rpc.alive.load(Ordering::SeqCst)
                && self.upstream()?.generation == rpc.generation,
            "SYNC_CONFLICT",
            "Account or runtime changed while reading usage",
        )?;
        let source = &account["account"];
        let summary = if source.is_null() {
            Value::Null
        } else {
            let kind = s(source, "type");
            ensure(
                ["apiKey", "chatgpt", "amazonBedrock"].contains(&kind),
                "UPSTREAM_PROTOCOL_ERROR",
                "Unsupported account kind",
            )?;
            json!({"type":kind,"email":if kind=="chatgpt"{label(source,"email")}else{Value::Null},"planType":label(source,"planType"),"usesCodexManagedCredentials":source["usesCodexManagedCredentials"].as_bool()})
        };
        Ok(
            json!({"account":summary,"requiresOpenaiAuth":account["requiresOpenaiAuth"].as_bool(),"usage":usage,"usageErrorCode":usage_error,"readAt":now()}),
        )
    }
}
