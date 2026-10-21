use crate::{ensure, Error, Result};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::{mpsc, oneshot},
};
include!(concat!(env!("OUT_DIR"), "/schemas.rs"));
pub fn validate(name: &str, value: &Value) -> Result<()> {
    use std::sync::LazyLock;
    static CACHE: LazyLock<Mutex<HashMap<String, Arc<jsonschema::Validator>>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    let validator = {
        let mut cache = CACHE.lock().unwrap();
        if let Some(v) = cache.get(name) {
            v.clone()
        } else {
            let source = schema(name)
                .ok_or_else(|| Error::new("UPSTREAM_PROTOCOL_ERROR", "Pinned schema missing"))?;
            let value: Value = serde_json::from_str(source)
                .map_err(|_| Error::new("UPSTREAM_PROTOCOL_ERROR", "Invalid pinned schema"))?;
            let v = Arc::new(
                jsonschema::options()
                    .should_validate_formats(false)
                    .build(&value)
                    .map_err(|_| {
                        Error::new("UPSTREAM_PROTOCOL_ERROR", "Cannot compile pinned schema")
                    })?,
            );
            cache.insert(name.into(), v.clone());
            v
        }
    };
    ensure(
        validator.is_valid(value),
        "UPSTREAM_PROTOCOL_ERROR",
        &format!("Invalid upstream {name}"),
    )
}
const LIMIT: usize = 8 * 1024 * 1024;
pub async fn read_frame<R: tokio::io::AsyncBufRead + Unpin>(
    reader: &mut R,
) -> Result<Option<Value>> {
    let mut bytes = vec![];
    let n = reader
        .take((LIMIT + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .await?;
    if n == 0 {
        return Ok(None);
    }
    ensure(
        n <= LIMIT && bytes.ends_with(b"\n"),
        "UPSTREAM_PROTOCOL_ERROR",
        "Oversized or incomplete frame",
    )?;
    let v: Value = serde_json::from_slice(&bytes)
        .map_err(|_| Error::new("UPSTREAM_PROTOCOL_ERROR", "Invalid JSON frame"))?;
    ensure(v.is_object(), "UPSTREAM_PROTOCOL_ERROR", "Object required")?;
    if let Some(id) = v.get("id") {
        ensure(
            id.is_string()
                || id
                    .as_i64()
                    .is_some_and(|n| n.unsigned_abs() <= 9_007_199_254_740_991),
            "UPSTREAM_PROTOCOL_ERROR",
            "Invalid RPC id",
        )?;
    }
    if let Some(m) = v.get("method") {
        ensure(m.is_string(), "UPSTREAM_PROTOCOL_ERROR", "Invalid method")?;
    } else {
        ensure(
            v.get("id").is_some() && (v.get("result").is_some() != v.get("error").is_some()),
            "UPSTREAM_PROTOCOL_ERROR",
            "Invalid response",
        )?;
    }
    Ok(Some(v))
}
pub struct Rpc {
    output: mpsc::Sender<Value>,
    pending: Mutex<HashMap<String, oneshot::Sender<Result<Value>>>>,
    next: AtomicU64,
    pub alive: AtomicBool,
    stop: tokio::sync::Notify,
    pub generation: String,
}
impl Rpc {
    pub fn start(
        executable: &std::path::Path,
        args: &[String],
    ) -> Result<(Arc<Self>, mpsc::Receiver<Value>)> {
        let mut command = Command::new(executable);
        command
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        {
            command.creation_flags(0x08000000);
            if let Some(path) = std::env::var_os("PATH") {
                command.env("PATH", crate::codex::filtered_path(&path.to_string_lossy()));
            }
        }
        let mut child = command.spawn()?;
        #[cfg(windows)]
        let job = unsafe {
            crate::codex::Job::assign(
                child
                    .raw_handle()
                    .ok_or_else(|| Error::new("IO_ERROR", "Missing process handle"))?
                    as _,
            )?
        };
        let stdout = child.stdout.take().unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let mut stderr = child.stderr.take().unwrap();
        let (output, mut writes) = mpsc::channel::<Value>(2);
        let (events, event_rx) = mpsc::channel(128);
        let rpc = Arc::new(Self {
            output,
            pending: Mutex::new(HashMap::new()),
            next: AtomicU64::new(1),
            alive: AtomicBool::new(true),
            stop: tokio::sync::Notify::new(),
            generation: crate::uid("generation"),
        });
        let read_rpc = rpc.clone();
        let read_events = events.clone();
        let reader = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            while let Ok(Some(v)) = read_frame(&mut reader).await {
                if v.get("method").is_some() {
                    // Backpressure command-output bursts instead of killing Codex
                    // when the database consumer temporarily falls behind.
                    if read_events.send(v).await.is_err() {
                        break;
                    }
                } else if let Some(id) = v.get("id") {
                    if let Some(tx) = read_rpc.pending.lock().unwrap().remove(&id.to_string()) {
                        let result = if let Some(error) = v.get("error") {
                            Err(Error::new("UPSTREAM_ERROR", crate::s(error, "message")))
                        } else {
                            Ok(v["result"].clone())
                        };
                        let _ = tx.send(result);
                    }
                }
            }
            read_rpc.stop.notify_one();
        });
        let write_rpc = rpc.clone();
        let writer = tokio::spawn(async move {
            while let Some(v) = writes.recv().await {
                let mut line = v.to_string().into_bytes();
                line.push(b'\n');
                if stdin.write_all(&line).await.is_err() || stdin.flush().await.is_err() {
                    break;
                }
            }
            write_rpc.stop.notify_one();
        });
        let diagnostics = tokio::spawn(async move {
            let _ = tokio::io::copy(&mut stderr, &mut tokio::io::sink()).await;
        });
        let monitor = rpc.clone();
        tokio::spawn(async move {
            tokio::select! {_=child.wait()=>{},_=monitor.stop.notified()=>{let _=child.kill().await;let _=child.wait().await;}}
            monitor.alive.store(false, Ordering::SeqCst);
            reader.abort();
            writer.abort();
            diagnostics.abort();
            #[cfg(windows)]
            drop(job);
            for (_, tx) in monitor.pending.lock().unwrap().drain() {
                let _ = tx.send(Err(Error::new(
                    "UPSTREAM_UNAVAILABLE",
                    "Codex disconnected; outcome may be unknown",
                )));
            }
            let _ = events.send(json!({"method":"$lost"})).await;
        });
        Ok((rpc, event_rx))
    }
    pub async fn request(&self, method: &str, params: Value) -> Result<Value> {
        self.request_timeout(method, params, Duration::from_secs(30))
            .await
    }
    pub async fn request_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value> {
        let id = format!("ad_{}", self.next.fetch_add(1, Ordering::Relaxed));
        let packet = if params.is_null() {
            json!({"id":id,"method":method})
        } else {
            json!({"id":id,"method":method,"params":params})
        };
        validate("ClientRequest", &packet)?;
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.lock().unwrap();
            ensure(
                pending.len() < 128,
                "RATE_LIMITED",
                "Too many upstream requests",
            )?;
            pending.insert(json!(id).to_string(), tx);
        }
        if let Err(e) = self.send(packet) {
            self.pending.lock().unwrap().remove(&json!(id).to_string());
            return Err(e);
        }
        let result = tokio::time::timeout(timeout, rx).await;
        self.pending.lock().unwrap().remove(&json!(id).to_string());
        match result {
            Ok(Ok(v)) => v,
            _ => Err(Error::new(
                "UPSTREAM_TIMEOUT",
                "Upstream outcome unknown; reconcile before retry",
            )),
        }
    }
    pub fn send(&self, v: Value) -> Result<()> {
        ensure(
            self.alive.load(Ordering::SeqCst),
            "UPSTREAM_UNAVAILABLE",
            "Codex disconnected",
        )?;
        ensure(
            v.to_string().len() <= LIMIT,
            "RATE_LIMITED",
            "Upstream write limit",
        )?;
        self.output
            .try_send(v)
            .map_err(|_| Error::new("RATE_LIMITED", "Upstream write buffer full"))
    }
    pub fn reject(&self, id: Value) -> Result<()> {
        self.send(json!({"id":id,"error":{"code":-32601,"message":"Request unsupported or no longer authorized"}}))
    }
    pub fn stop(&self) {
        self.stop.notify_one();
    }
}
