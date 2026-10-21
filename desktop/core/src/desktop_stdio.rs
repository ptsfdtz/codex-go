//! Versioned development transport; no token URL, account token, fork or retry.
use crate::{ensure, runtime::RuntimeTarget, Error, Result};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};
use tokio_tungstenite::tungstenite::{protocol::WebSocketConfig, Message};
use tokio_util::codec::{FramedRead, LinesCodec};
const LIMIT: usize = 8 * 1024 * 1024;
const WAIT: Duration = Duration::from_secs(15);
fn failure(code: &str) -> Error {
    Error::new(
        code,
        "Desktop stdio proxy cannot satisfy the configured native runtime contract",
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    format_version: u32,
    pub native_executable: PathBuf,
    endpoint: String,
    token_file: PathBuf,
    protocol_version: String,
}
impl Manifest {
    pub fn load(path: &Path, proxy_executable: &Path) -> Result<Self> {
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .map_err(|_| failure("PROXY_CONFIG_ERROR"))?
            .take(65537)
            .read_to_end(&mut bytes)
            .map_err(|_| failure("PROXY_CONFIG_ERROR"))?;
        ensure(
            bytes.len() <= 65536,
            "PROXY_CONFIG_ERROR",
            "Proxy manifest exceeds limit",
        )?;
        let manifest: Self =
            serde_json::from_slice(&bytes).map_err(|_| failure("PROXY_CONFIG_ERROR"))?;
        ensure(
            manifest.format_version == 1 && manifest.native_executable.is_absolute(),
            "PROXY_CONFIG_ERROR",
            "Unsupported proxy manifest",
        )?;
        let native = std::fs::canonicalize(&manifest.native_executable)
            .map_err(|_| failure("PROXY_CONFIG_ERROR"))?;
        let proxy =
            std::fs::canonicalize(proxy_executable).map_err(|_| failure("PROXY_CONFIG_ERROR"))?;
        ensure(
            native != proxy,
            "PROXY_CONFIG_ERROR",
            "Proxy cannot delegate its own version check",
        )?;
        manifest.target()?;
        Ok(manifest)
    }
    pub fn target(&self) -> Result<RuntimeTarget> {
        RuntimeTarget::from_versioned_options(
            Some(self.endpoint.clone().into()),
            Some(self.token_file.clone().into_os_string()),
            Some(self.protocol_version.clone().into()),
        )
        .map_err(|_| failure("PROXY_CONFIG_ERROR"))
    }
}

#[derive(Default)]
pub struct Startup {
    overrides: Vec<(Vec<String>, Value)>,
    analytics_default: bool,
}
impl Startup {
    pub fn parse(args: &[String]) -> Result<Self> {
        ensure(
            args.len() <= 128 && args.iter().map(String::len).sum::<usize>() <= 32768,
            "PROXY_ARGUMENT_UNSUPPORTED",
            "Proxy startup arguments exceed limit",
        )?;
        let mut result = Self::default();
        let mut server = false;
        let mut index = 0;
        let mut enables = Vec::new();
        let mut disables = Vec::new();
        while index < args.len() {
            match args[index].as_str() {
                "app-server" if !server => server = true,
                "--analytics-default-enabled" if !result.analytics_default => {
                    result.analytics_default = true
                }
                "--stdio" => {}
                "--listen" => {
                    index += 1;
                    ensure(
                        args.get(index).map(String::as_str) == Some("stdio://"),
                        "PROXY_ARGUMENT_UNSUPPORTED",
                        "Proxy cannot change shared runtime transport",
                    )?;
                }
                "-c" | "--config" => {
                    index += 1;
                    result.add(
                        args.get(index)
                            .ok_or_else(|| failure("PROXY_ARGUMENT_UNSUPPORTED"))?,
                    )?;
                }
                "--enable" | "--disable" => {
                    let enabled = args[index] == "--enable";
                    index += 1;
                    let name = args
                        .get(index)
                        .ok_or_else(|| failure("PROXY_ARGUMENT_UNSUPPORTED"))?;
                    ensure(
                        !name.is_empty()
                            && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_'),
                        "PROXY_ARGUMENT_UNSUPPORTED",
                        "Unsupported feature argument",
                    )?;
                    if enabled {
                        enables.push(name.clone());
                    } else {
                        disables.push(name.clone());
                    }
                }
                other if other.starts_with("--config=") => result.add(&other[9..])?,
                _ => return Err(failure("PROXY_ARGUMENT_UNSUPPORTED")),
            }
            index += 1;
        }
        ensure(
            server,
            "PROXY_ARGUMENT_UNSUPPORTED",
            "Only app-server stdio startup is supported",
        )?;
        // Native CLI applies feature toggles after explicit config overrides,
        // enables first and disables last, irrespective of argv order.
        for name in enables {
            result.add(&format!("features.{name}=true"))?;
        }
        for name in disables {
            result.add(&format!("features.{name}=false"))?;
        }
        Ok(result)
    }
    fn add(&mut self, assignment: &str) -> Result<()> {
        let (key, raw) = assignment
            .split_once('=')
            .ok_or_else(|| failure("PROXY_ARGUMENT_UNSUPPORTED"))?;
        ensure(
            key.trim().split('.').all(|part| {
                !part.is_empty()
                    && part
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
            }),
            "PROXY_ARGUMENT_UNSUPPORTED",
            "Only plain dotted config keys are currently supported",
        )?;
        let path: Vec<String> = key.trim().split('.').map(str::to_owned).collect();
        let raw = raw.trim();
        // Native CLI falls back to a raw string for a value that is not TOML.
        let value = toml::from_str::<toml::Table>(&format!("value={raw}"))
            .ok()
            .and_then(|mut t| {
                if t.len() == 1 {
                    t.remove("value")
                } else {
                    None
                }
            })
            .unwrap_or_else(|| toml::Value::String(raw.to_owned()));
        let value =
            serde_json::to_value(value).map_err(|_| failure("PROXY_ARGUMENT_UNSUPPORTED"))?;
        ensure(
            !contains_null(&value),
            "PROXY_ARGUMENT_UNSUPPORTED",
            "Non-finite configuration unsupported",
        )?;
        // Build the final CLI overlay before comparing with the shared base.
        // Assigning a parent replaces prior CLI descendants; assigning a child
        // updates its parent, replacing a scalar ancestor with a table.
        self.overrides.retain(|(old, _)| !old.starts_with(&path));
        if let Some((parent, root)) = self
            .overrides
            .iter_mut()
            .find(|(old, _)| path.starts_with(old))
        {
            let mut cursor = root;
            let relative = &path[parent.len()..];
            for key in &relative[..relative.len() - 1] {
                if !cursor.is_object() {
                    *cursor = json!({});
                }
                cursor = cursor
                    .as_object_mut()
                    .unwrap()
                    .entry(key.clone())
                    .or_insert_with(|| json!({}));
            }
            if !cursor.is_object() {
                *cursor = json!({});
            }
            cursor
                .as_object_mut()
                .unwrap()
                .insert(relative.last().unwrap().clone(), value);
            return Ok(());
        }
        self.overrides.push((path, value));
        Ok(())
    }
    pub fn check(&self, config: &Value) -> Result<()> {
        for (path, expected) in &self.overrides {
            let mut actual = &config["config"];
            for key in path {
                actual = actual
                    .get(key)
                    .ok_or_else(|| failure("PROXY_CONFIG_MISMATCH"))?;
            }
            ensure(
                matches_override(actual, expected),
                "PROXY_CONFIG_MISMATCH",
                "Desktop startup override differs from shared configuration",
            )?;
        }
        // An explicit opt-in/out wins over a CLI default. Never turn analytics on.
        if self.analytics_default {
            ensure(
                config["config"]["analytics"]["enabled"].is_boolean(),
                "PROXY_ANALYTICS_UNVERIFIED",
                "Shared runtime requires an explicit analytics preference",
            )?;
        }
        Ok(())
    }
}
// The final CLI table is merged with file/default tables by native Codex.
// Unmentioned base fields remain authoritative; arrays/scalars replace whole values.
fn matches_override(actual: &Value, expected: &Value) -> bool {
    match expected {
        Value::Object(table) => actual.as_object().is_some_and(|object| {
            table.iter().all(|(key, value)| {
                object
                    .get(key)
                    .is_some_and(|actual| matches_override(actual, value))
            })
        }),
        _ => actual == expected,
    }
}
fn contains_null(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Array(a) => a.iter().any(contains_null),
        Value::Object(o) => o.values().any(contains_null),
        _ => false,
    }
}
fn packet(text: &str) -> Result<Value> {
    let value = serde_json::from_str(text).map_err(|_| failure("PROXY_PROTOCOL_ERROR"))?;
    crate::rpc::checked_packet(&value).map_err(|_| failure("PROXY_PROTOCOL_ERROR"))?;
    Ok(value)
}
async fn emit<W: AsyncWrite + Unpin>(output: &mut W, value: &Value) -> Result<()> {
    let mut bytes = serde_json::to_vec(value).map_err(|_| failure("PROXY_PROTOCOL_ERROR"))?;
    bytes.push(b'\n');
    tokio::time::timeout(WAIT, async {
        output.write_all(&bytes).await?;
        output.flush().await
    })
    .await
    .map_err(|_| failure("PROXY_IO_TIMEOUT"))?
    .map_err(|_| failure("PROXY_IO_ERROR"))
}

/// Configuration gate uses the desktop's own authenticated socket and initialize.
pub async fn relay<R: AsyncRead + Unpin, W: AsyncWrite + Unpin>(
    input: R,
    mut output: W,
    target: RuntimeTarget,
    startup: Startup,
) -> Result<()> {
    let RuntimeTarget::Attached { ref endpoint, .. } = target else {
        return Err(failure("PROXY_CONFIG_ERROR"));
    };
    let request = crate::rpc::local_request(endpoint, &target.credential()?)
        .map_err(|_| failure("PROXY_CONFIG_ERROR"))?;
    let config = WebSocketConfig::default()
        .max_message_size(Some(LIMIT))
        .max_frame_size(Some(LIMIT));
    let (mut socket, _) = tokio::time::timeout(
        WAIT,
        tokio_tungstenite::connect_async_with_config(request, Some(config), true),
    )
    .await
    .map_err(|_| failure("PROXY_IO_TIMEOUT"))?
    .map_err(|_| failure("PROXY_CONNECT_FAILED"))?;
    let mut lines = FramedRead::new(input, LinesCodec::new_with_max_length(LIMIT));
    let hello = tokio::time::timeout(WAIT, lines.next())
        .await
        .map_err(|_| failure("PROXY_IO_TIMEOUT"))?
        .ok_or_else(|| failure("PROXY_PROTOCOL_ERROR"))?
        .map_err(|_| failure("PROXY_PROTOCOL_ERROR"))?;
    let hello = packet(&hello)?;
    ensure(
        hello["method"] == "initialize" && hello.get("id").is_some(),
        "PROXY_PROTOCOL_ERROR",
        "Desktop must initialize before any operation",
    )?;
    tokio::time::timeout(WAIT, socket.send(Message::Text(hello.to_string().into())))
        .await
        .map_err(|_| failure("PROXY_IO_TIMEOUT"))?
        .map_err(|_| failure("PROXY_IO_ERROR"))?;
    let protocol = target.protocol();
    let gate = async {
        let mut buffered = Vec::new();
        let mut total = 0;
        let check_id = crate::uid("desktop-config-check");
        let mut initialized = false;
        loop {
            let message = socket
                .next()
                .await
                .ok_or_else(|| failure("PROXY_IO_ERROR"))?
                .map_err(|_| failure("PROXY_IO_ERROR"))?;
            let text = match message {
                Message::Text(text) => text,
                Message::Ping(_) => {
                    socket
                        .flush()
                        .await
                        .map_err(|_| failure("PROXY_IO_ERROR"))?;
                    continue;
                }
                Message::Pong(_) => continue,
                _ => return Err(failure("PROXY_PROTOCOL_ERROR")),
            };
            let value = packet(&text)?;
            if !initialized && value.get("method").is_none() && value["id"] == hello["id"] {
                crate::rpc::validate_for(protocol, "v1/InitializeResponse", &value["result"])
                    .map_err(|_| failure("PROXY_VERSION_UNVERIFIED"))?;
                ensure(
                    crate::s(&value["result"], "userAgent")
                        .starts_with(&format!("Codex Desktop/{} (", protocol.version())),
                    "PROXY_VERSION_UNVERIFIED",
                    "Shared runtime version differs from selected protocol",
                )?;
                initialized = true;
                socket.send(Message::Text(json!({"id":check_id,"method":"config/read","params":{"includeLayers":false}}).to_string().into())).await.map_err(|_|failure("PROXY_IO_ERROR"))?;
            } else if initialized && value.get("method").is_none() && value["id"] == check_id {
                crate::rpc::validate_for(protocol, "v2/ConfigReadResponse", &value["result"])
                    .map_err(|_| failure("PROXY_CONFIG_UNAVAILABLE"))?;
                startup.check(&value["result"])?;
                return Ok(buffered);
            }
            total += text.len();
            ensure(
                total <= 2 * LIMIT && buffered.len() < 256,
                "PROXY_PROTOCOL_ERROR",
                "Proxy initialization output exceeds limit",
            )?;
            buffered.push(value);
        }
    };
    let buffered = tokio::time::timeout(WAIT, gate)
        .await
        .map_err(|_| failure("PROXY_IO_TIMEOUT"))??;
    for value in buffered {
        emit(&mut output, &value).await?;
    }
    loop {
        tokio::select! {
            // LinesCodec preserves partial bytes when a native event cancels next().
            line=lines.next()=>{
                let Some(line)=line else {return Ok(())};let line=line.map_err(|_|failure("PROXY_PROTOCOL_ERROR"))?;
                let value=packet(&line)?;
                tokio::time::timeout(WAIT,socket.send(Message::Text(value.to_string().into()))).await.map_err(|_|failure("PROXY_IO_TIMEOUT"))?.map_err(|_|failure("PROXY_IO_ERROR"))?;
            }
            message=socket.next()=>{
                let message=message.ok_or_else(||failure("PROXY_IO_ERROR"))?.map_err(|_|failure("PROXY_IO_ERROR"))?;
                match message {
                    Message::Text(text)=>emit(&mut output,&packet(&text)?).await?,
                    Message::Ping(_)=>{tokio::time::timeout(WAIT,socket.flush()).await.map_err(|_|failure("PROXY_IO_TIMEOUT"))?.map_err(|_|failure("PROXY_IO_ERROR"))?;},
                    Message::Pong(_)=>{},Message::Close(_)=>return Ok(()),_=>return Err(failure("PROXY_PROTOCOL_ERROR")),
                }
            }
        }
    }
}
