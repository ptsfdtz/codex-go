mod execution;
pub use execution::{approval, composer, sessions, tasks};
pub(crate) use execution::{queue, thread_index};
mod upstream;
pub use upstream::{codex, desktop_adapter, desktop_stdio, rpc, runtime};
mod projects;
pub(crate) use projects::native_project_views;
pub use projects::{git, paths};
mod server;
mod settings;
pub use server::{capabilities, cloud, pairing, protocol, service, transport};
mod storage;
pub use storage::store;
mod authorization;
pub use authorization::security;
use serde_json::{json, Value};
use std::fmt;

pub type Result<T> = std::result::Result<T, Error>;
#[derive(Debug, Clone)]
pub struct Error {
    pub code: String,
    pub message: String,
}
impl Error {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
    pub fn packet(&self, id: Option<&str>) -> Value {
        let mut v = json!({"v":1,"type":"error","code":self.code,"message":redact(&self.message),"retryable":false});
        if let Some(id) = id {
            v["id"] = json!(id);
        }
        v
    }
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for Error {}
impl From<rusqlite::Error> for Error {
    fn from(_: rusqlite::Error) -> Self {
        Self::new("DATABASE_ERROR", "本机数据库操作失败")
    }
}
impl From<std::io::Error> for Error {
    fn from(_: std::io::Error) -> Self {
        Self::new("IO_ERROR", "本机文件或进程操作失败")
    }
}
pub fn ensure(b: bool, c: &str, m: &str) -> Result<()> {
    if b {
        Ok(())
    } else {
        Err(Error::new(c, m))
    }
}
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
pub fn future(seconds: i64) -> String {
    (chrono::Utc::now() + chrono::Duration::seconds(seconds))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
pub fn uid(prefix: &str) -> String {
    format!("{prefix}_{}", uuid::Uuid::new_v4())
}
pub fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("")
}
pub fn digest(data: impl AsRef<[u8]>) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(data))
}
pub fn redact(text: &str) -> String {
    use std::sync::LazyLock;
    static PATTERNS: LazyLock<Vec<regex::Regex>> = LazyLock::new(|| {
        [
        r"\bsk-[A-Za-z0-9_.*-]{8,}",r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+",
        r"(?i)Bearer\s+[A-Za-z0-9._~-]+",r#"(?i)(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|credential|secret)\s*["']?\s*[:=]\s*["']?[^\s,"'}]+"#
    ].iter().map(|p|regex::Regex::new(p).unwrap()).collect()
    });
    PATTERNS.iter().fold(text.to_owned(), |v, p| {
        p.replace_all(&v, "[REDACTED]").into_owned()
    })
}
pub fn redact_value(v: Value) -> Value {
    match v {
        Value::String(t) => json!(redact(&t)),
        Value::Array(a) => Value::Array(a.into_iter().map(redact_value).collect()),
        Value::Object(o) => Value::Object(
            o.into_iter()
                .map(|(k, v)| {
                    let name = k.to_lowercase().replace(['_', '-'], "");
                    let v = if [
                        "authorization",
                        "apikey",
                        "accesstoken",
                        "refreshtoken",
                        "password",
                        "credential",
                        "secret",
                    ]
                    .contains(&name.as_str())
                    {
                        json!("[REDACTED]")
                    } else {
                        redact_value(v)
                    };
                    (k, v)
                })
                .collect(),
        ),
        other => other,
    }
}
