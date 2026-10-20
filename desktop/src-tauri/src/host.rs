//! Rust desktop controller supervising the native Rust Bridge. Only typed local
//! actions cross bounded IPC; React has no subprocess or file API.
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::File,
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

const FRAME_LIMIT: usize = 2 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub revision: u64,
    pub state: Value,
    pub qr: Option<Value>,
    pub pairing: Option<Value>,
    pub error: Option<String>,
    pub running: bool,
}
impl Default for View {
    fn default() -> Self {
        Self {
            revision: 0,
            state: json!({"projects":[],"devices":[],"approvals":[],"addresses":[],"codexReady":false,"sandboxVerified":false}),
            qr: None,
            pairing: None,
            error: None,
            running: false,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "action", deny_unknown_fields)]
pub enum Action {
    #[serde(rename = "workspaces.sync")]
    Sync {},
    #[serde(rename = "pair.create")]
    Pair { address: String },
    #[serde(rename = "pair.confirm")]
    Confirm {
        #[serde(rename = "requestId")]
        request_id: String,
        approve: bool,
    },
    #[serde(rename = "device.revoke")]
    Revoke {
        #[serde(rename = "deviceId")]
        device_id: String,
    },
    #[serde(rename = "project.remove")]
    Remove {
        #[serde(rename = "projectId")]
        project_id: String,
    },
    #[serde(rename = "approval.decide")]
    Decide {
        #[serde(rename = "approvalId")]
        approval_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "turnId")]
        turn_id: String,
        decision: Decision,
    },
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    Approve,
    Reject,
    Cancel,
}

pub struct Host {
    view: Mutex<View>,
    process: Mutex<Option<Process>>,
    pending: Mutex<HashMap<String, mpsc::Sender<Result<Value, String>>>>,
    counter: AtomicU64,
    stopping: AtomicBool,
    app: AppHandle,
}
struct Process {
    child: Child,
    stdin: ChildStdin,
    _data_lock: File,
    #[cfg(windows)]
    _job: Job,
}
#[cfg(windows)]
struct Job(usize);
#[cfg(windows)]
impl Job {
    fn assign(child: &Child) -> Result<Self, String> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::*;
        // A private kernel job owns this exact child and descendants. Dropping it
        // closes the job and prevents orphaned Codex/Bridge processes on a crash.
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err("无法创建 Windows 进程作业".into());
            }
            let job = Self(handle as usize);
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            ) == 0
                || AssignProcessToJobObject(handle, child.as_raw_handle() as _) == 0
            {
                return Err("无法建立子进程退出保护".into());
            }
            Ok(job)
        }
    }
}
#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0 as _);
        }
    }
}

pub fn read_frame<R: BufRead>(reader: &mut R) -> Result<Option<Value>, String> {
    let mut bytes = Vec::new();
    let count = reader
        .take((FRAME_LIMIT + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(|_| "本机服务通道读取失败")?;
    if count == 0 {
        return Ok(None);
    }
    if count > FRAME_LIMIT || !bytes.ends_with(b"\n") {
        return Err("本机服务消息超出限制或未完整发送".into());
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "本机服务消息格式错误")?;
    if !value["type"].is_string() || !value["payload"].is_object() {
        return Err("本机服务消息缺少字段".into());
    }
    Ok(Some(value))
}

impl Host {
    pub fn new(app: AppHandle) -> Arc<Self> {
        Arc::new(Self {
            view: Mutex::new(View::default()),
            process: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            counter: AtomicU64::new(1),
            stopping: AtomicBool::new(false),
            app,
        })
    }
    pub fn snapshot(&self) -> View {
        self.view.lock().unwrap().clone()
    }
    fn change(&self, f: impl FnOnce(&mut View)) {
        let next = {
            let mut v = self.view.lock().unwrap();
            f(&mut v);
            v.revision += 1;
            v.clone()
        };
        let _ = self.app.emit("host-view", next);
    }
    pub fn error(&self, message: String) {
        self.change(|v| v.error = Some(message));
    }
    pub fn start(self: &Arc<Self>, runtime: PathBuf) -> Result<(), String> {
        // Preserve the exact resource location while normalizing Win32 spelling.
        let runtime = dunce::simplified(&runtime).to_path_buf();
        let mut process = self.process.lock().unwrap();
        if process.is_some() {
            return Err("本机服务已启动，请勿重复启动".into());
        }
        let directory = std::env::var_os("AGENTDECK_DATA_DIR")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("AgentDeck"))
            })
            .ok_or("无法定位本机数据目录")?;
        std::fs::create_dir_all(&directory).map_err(|_| "无法创建本机数据目录")?;
        let lock = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(directory.join("desktop.lock"))
            .map_err(|_| "无法打开本机服务锁")?;
        lock.try_lock_exclusive()
            .map_err(|_| "此数据目录已由另一个 AgentDeck 窗口使用")?;
        let service = runtime.join("agentdeck-service.exe");
        if !service.is_file() {
            return Err("安装包缺少 Rust 服务，请运行 pnpm desktop:prepare 或重新安装".into());
        }
        let mut command = Command::new(service);
        command
            .arg("--desktop-stdio")
            .current_dir(&runtime)
            .env("AGENTDECK_DATA_DIR", &directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .map_err(|_| "Rust 本机服务无法启动，请检查安装包")?;
        #[cfg(windows)]
        let job = match Job::assign(&child) {
            Ok(job) => job,
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e);
            }
        };
        let stdout = child.stdout.take().ok_or("无法读取服务通道")?;
        let stderr = child.stderr.take().ok_or("无法读取诊断通道")?;
        let stdin = child.stdin.take().ok_or("无法写入服务通道")?;
        *process = Some(Process {
            child,
            stdin,
            _data_lock: lock,
            #[cfg(windows)]
            _job: job,
        });
        self.stopping.store(false, Ordering::SeqCst);
        self.change(|v| {
            v.running = true;
            v.error = None;
        });
        // Never retain arbitrary stderr, which can contain user data.
        thread::spawn(move || {
            let _ = std::io::copy(&mut BufReader::new(stderr), &mut std::io::sink());
        });
        let host = Arc::clone(self);
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                match read_frame(&mut reader) {
                    Ok(Some(packet)) => host.receive(packet),
                    Ok(None) => break,
                    Err(e) => {
                        host.error(e);
                        break;
                    }
                }
            }
            host.change(|v| {
                v.running = false;
                v.qr = None;
                v.pairing = None;
                v.state["codexReady"] = json!(false);
                v.state["approvals"] = json!([]);
                if let Some(devices) = v.state["devices"].as_array_mut() {
                    for device in devices { device["connected"] = json!(false); }
                }
                if !host.stopping.load(Ordering::SeqCst) && v.error.is_none() {
                    v.error = Some("本机服务已断开。不会将进行中的任务视为完成，请退出并重新打开。若原版本仍在运行，请先从它的托盘菜单退出。".into());
                }
            });
            for (_, tx) in host.pending.lock().unwrap().drain() {
                let _ = tx.send(Err("本机服务已断开，操作结果未知".into()));
            }
        });
        Ok(())
    }
    fn receive(&self, packet: Value) {
        let payload = packet["payload"].clone();
        let kind = packet["type"].as_str().unwrap_or_default();
        if kind == "action.result" || kind == "error" {
            if let Some(id) = payload["localRequestId"].as_str() {
                if let Some(tx) = self.pending.lock().unwrap().remove(id) {
                    let result = if kind == "error" {
                        Err(payload["message"].as_str().unwrap_or("操作失败").to_owned())
                    } else {
                        Ok(payload.clone())
                    };
                    let _ = tx.send(result);
                }
            }
        }
        match kind {
            "state" => self.change(|v| v.state = payload),
            "pair.qr" => self.change(|v| {
                v.qr = Some(payload);
                v.pairing = None;
                v.error = None;
            }),
            "pair.confirm" => {
                self.change(|v| {
                    v.pairing = Some(payload);
                    v.qr = None;
                });
                if let Some(window) = tauri::Manager::get_webview_window(&self.app, "main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            "error" => self.error(
                payload["message"]
                    .as_str()
                    .unwrap_or("本机服务错误")
                    .to_owned(),
            ),
            "project.addRequest" | "project.removeRequest" => {
                let _ = self.app.emit("local-request", packet);
            }
            _ => {}
        }
    }
    pub fn action(&self, action: Action) -> Result<Value, String> {
        let view = self.snapshot();
        if !view.running {
            return Err("本机服务尚未连接".into());
        }
        validate_action(&action, &view)?;
        self.send(serde_json::to_value(action).map_err(|_| "无法编码本机操作")?)
    }
    pub fn add_folder(&self, path: PathBuf) -> Result<Value, String> {
        self.send(json!({"action":"project.add","path":path.to_str().ok_or("无法读取目录名")?}))
    }
    fn send(&self, mut value: Value) -> Result<Value, String> {
        let id = format!("local-{}", self.counter.fetch_add(1, Ordering::Relaxed));
        value["localRequestId"] = json!(id);
        let (tx, rx) = mpsc::channel();
        {
            let mut pending = self.pending.lock().unwrap();
            if !pending.is_empty() {
                return Err("请等待当前操作完成".into());
            }
            pending.insert(id.clone(), tx);
        }
        let result = (|| {
            let mut process = self.process.lock().unwrap();
            let p = process.as_mut().ok_or("本机服务尚未启动")?;
            let text = serde_json::to_vec(&value).map_err(|_| "无法编码操作")?;
            if text.len() > 65500 {
                return Err("本机操作超出大小限制".to_owned());
            }
            p.stdin
                .write_all(&text)
                .and_then(|_| p.stdin.write_all(b"\n"))
                .and_then(|_| p.stdin.flush())
                .map_err(|_| "无法发送本机操作".to_owned())
        })();
        if let Err(e) = result {
            self.pending.lock().unwrap().remove(&id);
            return Err(e);
        }
        let result = rx
            .recv_timeout(Duration::from_secs(120))
            .unwrap_or_else(|_| Err("操作等待超时；请检查当前状态，不要重复提交审批".into()));
        self.pending.lock().unwrap().remove(&id);
        if result.is_ok() {
            self.change(|v| {
                v.error = None;
                if value["action"] == "pair.confirm" {
                    v.pairing = None;
                }
            });
        }
        result
    }
    pub fn shutdown(&self) {
        if self.stopping.swap(true, Ordering::SeqCst) {
            return;
        }
        let process = self.process.lock().unwrap().take();
        if let Some(mut process) = process {
            let _ = process.stdin.write_all(b"{\"action\":\"stop\"}\n");
            let _ = process.stdin.flush();
            let until = Instant::now() + Duration::from_secs(8);
            loop {
                if matches!(process.child.try_wait(), Ok(Some(_))) {
                    break;
                }
                if Instant::now() >= until {
                    let _ = process.child.kill();
                    let _ = process.child.wait();
                    break;
                }
                thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

fn validate_action(action: &Action, view: &View) -> Result<(), String> {
    let contains = |field: &str, key: &str, id: &str| -> bool {
        view.state[field]
            .as_array()
            .is_some_and(|items| items.iter().any(|v| v[key].as_str() == Some(id)))
    };
    match action {
        Action::Sync {} if !view.state["codexReady"].as_bool().unwrap_or(false) => {
            Err("请等待 Codex 和工作区隔离检查就绪".into())
        }
        Action::Pair { address }
            if !view.state["addresses"]
                .as_array()
                .is_some_and(|items| items.iter().any(|v| v.as_str() == Some(address))) =>
        {
            Err("请选择这台电脑上的有效网络地址".into())
        }
        Action::Confirm { request_id, .. }
            if view.pairing.as_ref().and_then(|p| p["requestId"].as_str()) != Some(request_id) =>
        {
            Err("配对请求已失效".into())
        }
        Action::Revoke { device_id } if !contains("devices", "deviceId", device_id) => {
            Err("设备不存在".into())
        }
        Action::Remove { project_id } if !contains("projects", "projectId", project_id) => {
            Err("工作区不存在".into())
        }
        Action::Decide {
            approval_id,
            session_id,
            turn_id,
            ..
        } if !view.state["approvals"].as_array().is_some_and(|items| {
            items.iter().any(|v| {
                v["approvalId"].as_str() == Some(approval_id)
                    && v["sessionId"].as_str() == Some(session_id)
                    && v["turnId"].as_str() == Some(turn_id)
            })
        }) =>
        {
            Err("审批已失效或不属于此会话".into())
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    #[test]
    fn normalize_tauri_resource_paths() {
        let verbatim = PathBuf::from(r"\\?\C:\Program Files\AgentDeck\项目\runtime");
        assert_eq!(
            dunce::simplified(&verbatim),
            std::path::Path::new(r"C:\Program Files\AgentDeck\项目\runtime")
        );
    }
    #[test]
    fn bounded_framing() {
        assert!(
            read_frame(&mut &b"{\"type\":\"state\",\"payload\":{}}\n"[..])
                .unwrap()
                .is_some()
        );
        assert!(read_frame(&mut &b"{}\n"[..]).is_err());
        assert!(read_frame(&mut &b"{\"type\":\"state\",\"payload\":{}}"[..]).is_err());
        assert!(read_frame(&mut &vec![b'x'; FRAME_LIMIT + 2][..]).is_err());
        assert!(read_frame(&mut &b""[..]).unwrap().is_none());
    }
    #[test]
    fn reject_remote_execution_and_unknown_fields() {
        for value in [
            json!({"action":"shell","command":"whoami"}),
            json!({"action":"workspaces.sync","path":"C:/"}),
            json!({"action":"approval.decide","approvalId":"a","sessionId":"s","turnId":"t","decision":"acceptForSession"}),
        ] {
            assert!(serde_json::from_value::<Action>(value).is_err());
        }
    }
    #[test]
    fn reject_stale_or_mismatched_local_requests() {
        let mut v = View::default();
        assert!(validate_action(&Action::Sync {}, &v).is_err());
        assert!(validate_action(
            &Action::Pair {
                address: "0.0.0.0".into()
            },
            &v
        )
        .is_err());
        v.pairing = Some(json!({"requestId":"current"}));
        assert!(validate_action(
            &Action::Confirm {
                request_id: "old".into(),
                approve: true
            },
            &v
        )
        .is_err());
        v.state["approvals"] = json!([{"approvalId":"a","sessionId":"s","turnId":"t"}]);
        assert!(validate_action(
            &Action::Decide {
                approval_id: "a".into(),
                session_id: "other".into(),
                turn_id: "t".into(),
                decision: Decision::Approve
            },
            &v
        )
        .is_err());
        assert!(validate_action(
            &Action::Decide {
                approval_id: "a".into(),
                session_id: "s".into(),
                turn_id: "t".into(),
                decision: Decision::Reject
            },
            &v
        )
        .is_ok());
    }
}
