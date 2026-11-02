//! Ephemeral, connection-owned project shell and legacy OpenSSH PTYs. Input/output never enter the event
//! store, request receipts, diagnostics or the Codex runtime.
use crate::{ensure, protocol, s, Error, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

const BUFFER_BYTES: usize = 512 * 1024;
const CHUNK_BYTES: usize = 32 * 1024;
const INPUT_BYTES: usize = 4096;

fn failure() -> Error {
    Error::new(
        "SSH_ERROR",
        "无法启动或操作终端；请确认 Host 上的 shell 或 SSH 客户端可用",
    )
}
fn size(p: &Value) -> PtySize {
    PtySize {
        cols: p["cols"].as_u64().unwrap() as u16,
        rows: p["rows"].as_u64().unwrap() as u16,
        pixel_width: 0,
        pixel_height: 0,
    }
}
pub(crate) fn validate(action: &str, p: &Value) -> Result<()> {
    protocol::text(p, "terminalId", 36, 36)?;
    ensure(
        uuid::Uuid::parse_str(s(p, "terminalId")).is_ok(),
        "INVALID_REQUEST",
        "Invalid terminal id",
    )?;
    if action == "ssh.open" {
        protocol::text(p, "host", 1, 253)?;
        let host = s(p, "host");
        ensure(
            !host.starts_with('-')
                && host
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-:[]".contains(&b)),
            "INVALID_REQUEST",
            "请输入主机名、IP 地址或 SSH 配置别名",
        )?;
        if p.get("user").is_some() {
            protocol::text(p, "user", 1, 128)?;
            ensure(
                !s(p, "user").starts_with('-')
                    && s(p, "user")
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b)),
                "INVALID_REQUEST",
                "Invalid SSH user",
            )?;
        }
        if p.get("port").is_some() {
            protocol::integer(p, "port", 1, 65535)?;
        }
        if p.get("identity").is_some() {
            protocol::text(p, "identity", 1, 4096)?;
            ensure(
                !s(p, "identity").contains(['\0', '\r', '\n'])
                    && std::path::Path::new(s(p, "identity")).is_absolute(),
                "INVALID_REQUEST",
                "私钥路径必须是 Host 上的绝对路径",
            )?;
        }
    }
    if action == "terminal.open" {
        protocol::text(p, "projectId", 1, 160)?;
    }
    if matches!(
        action,
        "ssh.open" | "ssh.resize" | "terminal.open" | "terminal.resize"
    ) {
        protocol::integer(p, "cols", 2, 500)?;
        protocol::integer(p, "rows", 1, 200)?;
    }
    if matches!(action, "ssh.read" | "terminal.read") {
        protocol::integer(p, "offset", 0, 9_007_199_254_740_991)?;
    }
    if matches!(action, "ssh.write" | "terminal.write") {
        protocol::integer(p, "sequence", 0, 9_007_199_254_740_991)?;
        protocol::text(p, "data", 1, INPUT_BYTES)?;
        ensure(
            s(p, "data").len() <= INPUT_BYTES,
            "INVALID_REQUEST",
            "Terminal input too large",
        )?;
    }
    Ok(())
}
fn command(p: &Value) -> CommandBuilder {
    let mut cmd = CommandBuilder::new("ssh");
    // No local escape shell, command, forwards or agent forwarding. Keep the
    // user's trusted config for aliases, ProxyJump, keys and known_hosts.
    for arg in [
        "-tt",
        "-o",
        "EscapeChar=none",
        "-o",
        "PermitLocalCommand=no",
        "-o",
        "ClearAllForwardings=yes",
        "-o",
        "ForwardAgent=no",
        "-o",
        "ForwardX11=no",
        "-o",
        "StrictHostKeyChecking=ask",
        "-o",
        "ConnectTimeout=20",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=3",
        "-o",
        "ControlMaster=no",
        "-o",
        "ControlPath=none",
        "-o",
        "RemoteCommand=none",
    ] {
        cmd.arg(arg);
    }
    if let Some(port) = p["port"].as_u64() {
        cmd.arg("-p");
        cmd.arg(port.to_string());
    }
    if let Some(user) = p["user"].as_str() {
        cmd.arg("-l");
        cmd.arg(user);
    }
    if let Some(identity) = p["identity"].as_str() {
        cmd.arg("-i");
        cmd.arg(identity);
    }
    cmd.arg("--");
    cmd.arg(s(p, "host"));
    cmd.env("TERM", "xterm-256color");
    cmd.env_remove("SSH_ASKPASS");
    cmd.env("SSH_ASKPASS_REQUIRE", "never");
    cmd
}
fn shell_command(root: &std::path::Path) -> CommandBuilder {
    #[cfg(windows)]
    let mut cmd = {
        let pwsh = std::env::var_os("ProgramFiles")
            .map(std::path::PathBuf::from)
            .map(|p| p.join("PowerShell/7/pwsh.exe"))
            .filter(|p| p.is_file());
        let fallback = std::path::PathBuf::from(
            std::env::var_os("SystemRoot").unwrap_or_else(|| "C:/Windows".into()),
        )
        .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let mut cmd = CommandBuilder::new(pwsh.unwrap_or(fallback));
        cmd.arg("-NoLogo");
        cmd
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let shell = std::env::var_os("SHELL")
            .filter(|s| std::path::Path::new(s).is_absolute())
            .unwrap_or_else(|| "/bin/sh".into());
        let mut cmd = CommandBuilder::new(shell);
        cmd.arg("-i");
        cmd
    };
    cmd.cwd(root);
    cmd.env("TERM", "xterm-256color");
    cmd
}
#[derive(Default)]
struct Output {
    bytes: VecDeque<u8>,
    end: u64,
    eof: bool,
}
impl Output {
    fn push(&mut self, data: &[u8]) {
        self.end += data.len() as u64;
        self.bytes.extend(data);
        if self.bytes.len() > BUFFER_BYTES {
            self.bytes.drain(..self.bytes.len() - BUFFER_BYTES);
        }
    }
    fn read(&self, offset: u64) -> Result<Value> {
        ensure(
            offset <= self.end,
            "INVALID_REQUEST",
            "Terminal cursor is ahead of output",
        )?;
        let start = self.end - self.bytes.len() as u64;
        let actual = offset.max(start);
        let bytes: Vec<u8> = self
            .bytes
            .iter()
            .skip((actual - start) as usize)
            .take(CHUNK_BYTES)
            .copied()
            .collect();
        let next = actual + bytes.len() as u64;
        Ok(
            json!({"data":STANDARD.encode(bytes),"offset":next,"truncated":offset < start,"eof":self.eof && next == self.end}),
        )
    }
}
struct Terminal {
    owner: String,
    device: String,
    master: Box<dyn MasterPty + Send>,
    writer: std::sync::mpsc::SyncSender<Vec<u8>>,
    child: Box<dyn Child + Send + Sync>,
    output: Arc<Mutex<Output>>,
    sequence: u64,
    // Retain a hash, never plaintext input, to detect a conflicting duplicate.
    previous: Option<String>,
}
impl Terminal {
    fn start(owner: &str, device: &str, p: &Value) -> Result<Self> {
        Self::spawn(owner, device, p, command(p))
    }
    fn spawn(owner: &str, device: &str, p: &Value, cmd: CommandBuilder) -> Result<Self> {
        let pair = native_pty_system()
            .openpty(size(p))
            .map_err(|_| failure())?;
        let mut reader = pair.master.try_clone_reader().map_err(|_| failure())?;
        let mut writer = pair.master.take_writer().map_err(|_| failure())?;
        let child = pair.slave.spawn_command(cmd).map_err(|_| failure())?;
        drop(pair.slave);
        let output = Arc::new(Mutex::new(Output::default()));
        let (input, input_rx) = std::sync::mpsc::sync_channel::<Vec<u8>>(8);
        let mut killer = child.clone_killer();
        std::thread::spawn(move || {
            while let Ok(data) = input_rx.recv() {
                if writer
                    .write_all(&data)
                    .and_then(|()| writer.flush())
                    .is_err()
                {
                    let _ = killer.kill();
                    break;
                }
            }
        });
        let sink = output.clone();
        std::thread::spawn(move || {
            let mut bytes = [0u8; 8192];
            loop {
                match reader.read(&mut bytes) {
                    Ok(0) => break,
                    Ok(n) => sink.lock().unwrap().push(&bytes[..n]),
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
            sink.lock().unwrap().eof = true;
        });
        Ok(Self {
            owner: owner.into(),
            device: device.into(),
            master: pair.master,
            writer: input,
            child,
            output,
            sequence: 0,
            previous: None,
        })
    }
    fn write(&mut self, p: &Value) -> Result<Value> {
        let sequence = p["sequence"].as_u64().unwrap();
        let data = s(p, "data");
        let hash = crate::digest(data);
        if sequence.checked_add(1) == Some(self.sequence) && self.previous.as_ref() == Some(&hash) {
            return Ok(json!({"sequence":self.sequence}));
        }
        ensure(
            sequence == self.sequence,
            "SSH_INPUT_UNKNOWN",
            "终端输入顺序不确定，请关闭并重新连接；不要重复发送命令",
        )?;
        // Consume the sequence before writing: even a partial failure must never
        // replay a password or command. A failed writer closes this PTY.
        self.sequence += 1;
        self.previous = None;
        if self.writer.try_send(data.as_bytes().to_vec()).is_err() {
            let _ = self.child.kill();
            return Err(Error::new(
                "SSH_INPUT_UNKNOWN",
                "输入发送结果未知，请重新连接；不要重复发送命令",
            ));
        }
        self.previous = Some(hash);
        Ok(json!({"sequence":self.sequence}))
    }
}
impl Drop for Terminal {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
#[derive(Default)]
pub(crate) struct Terminals {
    sessions: Mutex<HashMap<String, Terminal>>,
    closed: AtomicBool,
}
impl Terminals {
    pub(crate) fn is_active(&self) -> bool {
        !self.sessions.lock().unwrap().is_empty()
    }
    pub(crate) fn close_all(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.sessions.lock().unwrap().clear();
    }
    pub(crate) fn close_owner(&self, owner: &str) {
        self.sessions
            .lock()
            .unwrap()
            .retain(|_, t| t.owner != owner);
    }
    pub(crate) fn close_device(&self, device: &str) {
        self.sessions
            .lock()
            .unwrap()
            .retain(|_, t| t.device != device);
    }
    pub(crate) fn handle(
        &self,
        action: &str,
        p: &Value,
        owner: &str,
        device: &str,
        alive: &AtomicBool,
    ) -> Result<Value> {
        validate(action, p)?;
        self.handle_inner(action, p, owner, device, alive, None)
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn handle_project(
        &self,
        action: &str,
        p: &Value,
        owner: &str,
        device: &str,
        alive: &AtomicBool,
        store: &crate::store::Store,
    ) -> Result<Value> {
        validate(action, p)?;
        let cmd = if action == "terminal.open" {
            Some(shell_command(&crate::paths::root(
                store,
                s(p, "projectId"),
            )?))
        } else {
            None
        };
        let legacy = action.replacen("terminal.", "ssh.", 1);
        self.handle_inner(&legacy, p, owner, device, alive, cmd)
    }
    #[allow(clippy::too_many_arguments)]
    fn handle_inner(
        &self,
        action: &str,
        p: &Value,
        owner: &str,
        device: &str,
        alive: &AtomicBool,
        cmd: Option<CommandBuilder>,
    ) -> Result<Value> {
        let mut sessions = self.sessions.lock().unwrap();
        ensure(
            alive.load(Ordering::SeqCst) && !self.closed.load(Ordering::SeqCst),
            "SSH_CLOSED",
            "网页连接已关闭",
        )?;
        let id = s(p, "terminalId");
        if let Some(t) = sessions.get(id) {
            ensure(
                t.owner == owner && t.device == device,
                "SSH_NOT_FOUND",
                "此连接无权访问该终端",
            )?;
        } else if action == "ssh.open" {
            ensure(
                sessions.len() < 4 && sessions.values().filter(|t| t.owner == owner).count() < 2,
                "SSH_LIMIT",
                "终端数量已达上限，请先关闭其他终端",
            )?;
            sessions.insert(
                id.into(),
                match cmd {
                    Some(cmd) => Terminal::spawn(owner, device, p, cmd)?,
                    None => Terminal::start(owner, device, p)?,
                },
            );
        } else if action != "ssh.close" {
            return Err(Error::new("SSH_NOT_FOUND", "终端已关闭，请重新连接"));
        }
        if action == "ssh.close" {
            sessions.remove(id);
            return Ok(json!({"closed":true}));
        }
        let t = sessions.get_mut(id).unwrap();
        match action {
            "ssh.open" => Ok(json!({"terminalId":id})),
            "ssh.read" => t.output.lock().unwrap().read(p["offset"].as_u64().unwrap()),
            "ssh.write" => t.write(p),
            "ssh.resize" => {
                t.master.resize(size(p)).map_err(|_| failure())?;
                Ok(json!({"resized":true}))
            }
            _ => Err(Error::new("INVALID_REQUEST", "Unsupported SSH action")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn open() -> Value {
        json!({"terminalId":uuid::Uuid::new_v4().to_string(),"host":"example.org","cols":80,"rows":24})
    }
    #[test]
    fn project_protocol_accepts_only_project_identity_and_terminal_size() {
        let p = json!({"terminalId":uuid::Uuid::new_v4().to_string(),"projectId":"project","cols":80,"rows":24});
        let packet = |payload| json!({"v":1,"type":"request","id":"project-shell","action":"terminal.open","payload":payload});
        assert!(protocol::parse(packet(p.clone())).is_ok());
        for key in ["cwd", "command", "shell", "host"] {
            let mut extra = p.clone();
            extra[key] = json!("untrusted");
            assert!(protocol::parse(packet(extra)).is_err());
        }
        let temp = tempfile::tempdir().unwrap();
        let store = crate::store::Store::open(&temp.path().join("test.db")).unwrap();
        let terminals = Terminals::default();
        assert!(terminals
            .handle_project(
                "terminal.open",
                &p,
                "tab",
                "device",
                &AtomicBool::new(true),
                &store
            )
            .is_err());
        assert!(!terminals.is_active());
    }
    #[test]
    fn real_project_shell_starts_in_authorized_directory() {
        use std::time::{Duration, Instant};
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("project with spaces");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("terminal-marker.txt"), "PROJECT_SHELL_MARKER").unwrap();
        let store = crate::store::Store::open(&temp.path().join("test.db")).unwrap();
        let project = crate::paths::add_local(&store, &root).unwrap();
        let root = crate::paths::root(&store, s(&project, "projectId")).unwrap();
        let mut cmd = shell_command(&root);
        #[cfg(windows)]
        cmd.arg("-NoProfile");
        let mut p = open();
        p["projectId"] = project["projectId"].clone();
        let mut terminal = Terminal::spawn("tab", "device", &p, cmd).unwrap();
        #[cfg(windows)]
        let input = "Get-Content ./terminal-marker.txt\r";
        #[cfg(not(windows))]
        let input = "cat ./terminal-marker.txt\r";
        let mut sent = false;
        let start = Instant::now();
        loop {
            let bytes: Vec<u8> = terminal
                .output
                .lock()
                .unwrap()
                .bytes
                .iter()
                .copied()
                .collect();
            if !sent {
                #[cfg(windows)]
                let ready = bytes.windows(4).any(|w| w == b"\x1b[6n");
                #[cfg(not(windows))]
                let ready = true;
                if ready {
                    #[cfg(windows)]
                    let data = format!("\x1b[1;1R{input}");
                    #[cfg(not(windows))]
                    let data = input.to_owned();
                    terminal.write(&json!({"sequence":0,"data":data})).unwrap();
                    sent = true;
                }
            }
            if String::from_utf8_lossy(&bytes).contains("PROJECT_SHELL_MARKER") {
                break;
            }
            assert!(
                start.elapsed() < Duration::from_secs(20),
                "shell did not read project-relative file: {}",
                String::from_utf8_lossy(&bytes)
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    #[test]
    fn rejects_options_commands_and_invalid_sizes() {
        for host in [
            "-oProxyCommand=sh",
            "host;whoami",
            "user@host",
            "host\nsh",
            "$(id)",
            "host name",
        ] {
            let mut p = open();
            p["host"] = json!(host);
            assert!(validate("ssh.open", &p).is_err(), "{host}");
        }
        for host in ["example.org", "my-server", "::1", "[2001:db8::1]"] {
            let mut p = open();
            p["host"] = json!(host);
            assert!(validate("ssh.open", &p).is_ok());
        }
        let mut p = open();
        p["cols"] = json!(501);
        assert!(validate("ssh.open", &p).is_err());
        p = open();
        p["identity"] = json!("-oProxyCommand=sh");
        assert!(validate("ssh.open", &p).is_err());
    }
    #[test]
    fn bounded_output_is_replayable_and_reports_gaps() {
        let mut out = Output::default();
        out.push(&vec![b'x'; BUFFER_BYTES + 20]);
        let first = out.read(0).unwrap();
        assert_eq!(first["truncated"], true);
        assert_eq!(first, out.read(0).unwrap());
        assert_eq!(first["offset"], 20 + CHUNK_BYTES);
        assert!(out.read(out.end + 1).is_err());
        out.eof = true;
        assert_eq!(out.read(out.end).unwrap()["eof"], true);
        assert_eq!(out.bytes.len(), BUFFER_BYTES);
    }
    #[test]
    fn disconnected_or_stopped_host_rejects_late_terminal_creation() {
        let terminals = Terminals::default();
        let alive = AtomicBool::new(false);
        let p = open();
        assert_eq!(
            terminals
                .handle("ssh.open", &p, "tab", "device", &alive)
                .unwrap_err()
                .code,
            "SSH_CLOSED"
        );
        alive.store(true, Ordering::SeqCst);
        terminals.close_all();
        assert_eq!(
            terminals
                .handle("ssh.open", &p, "tab", "device", &alive)
                .unwrap_err()
                .code,
            "SSH_CLOSED"
        );
        assert!(!terminals.is_active());
    }
    #[test]
    fn protocol_rejects_extra_fields_and_large_input() {
        let p = open();
        let packet = |action: &str, payload: Value| json!({"v":1,"type":"request","id":"test","action":action,"payload":payload});
        assert!(protocol::parse(packet("ssh.open", p.clone())).is_ok());
        let mut extra = p.clone();
        extra["command"] = json!("id");
        assert!(protocol::parse(packet("ssh.open", extra)).is_err());
        assert!(protocol::parse(packet(
            "ssh.write",
            json!({"terminalId":p["terminalId"],"sequence":0,"data":"密".repeat(2000)})
        ))
        .is_err());
    }
    #[test]
    #[cfg(unix)]
    #[ignore = "Requires sshd and ssh-keygen; starts an isolated loopback SSH server"]
    fn real_ssh_pty_identity_resize_dedup_and_ownership() {
        use std::{
            net::{TcpListener, TcpStream},
            process::{Command, Stdio},
            time::{Duration, Instant},
        };
        struct Server(std::process::Child);
        impl Drop for Server {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let temp = tempfile::tempdir().unwrap();
        let host_key = temp.path().join("host_key");
        let key = temp.path().join("identity");
        for path in [&host_key, &key] {
            assert!(Command::new("ssh-keygen")
                .args(["-q", "-t", "ed25519", "-N", "", "-f"])
                .arg(path)
                .status()
                .unwrap()
                .success());
        }
        let authorized = temp.path().join("authorized_keys");
        std::fs::copy(key.with_extension("pub"), &authorized).unwrap();
        let user = String::from_utf8(Command::new("id").arg("-un").output().unwrap().stdout)
            .unwrap()
            .trim()
            .to_owned();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let config = temp.path().join("sshd_config");
        std::fs::write(&config, format!("Port {port}\nListenAddress 127.0.0.1\nHostKey {}\nPidFile {}\nAuthorizedKeysFile {}\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nPermitRootLogin yes\nAllowUsers {user}\nForceCommand /bin/sh -i\n",host_key.display(),temp.path().join("pid").display(),authorized.display())).unwrap();
        let mut server = Server(
            Command::new("/usr/sbin/sshd")
                .args(["-D", "-e", "-f"])
                .arg(&config)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        );
        let start = Instant::now();
        while TcpStream::connect(("127.0.0.1", port)).is_err() {
            assert!(
                server.0.try_wait().unwrap().is_none(),
                "isolated sshd failed to start"
            );
            assert!(start.elapsed() < Duration::from_secs(10));
            std::thread::sleep(Duration::from_millis(20));
        }
        let mut p = open();
        p["host"] = json!("127.0.0.1");
        p["port"] = json!(port);
        p["user"] = json!(user);
        p["identity"] = json!(key);
        let id = s(&p, "terminalId").to_owned();
        let mut cmd = command(&p);
        cmd.get_argv_mut().splice(
            1..1,
            [
                "-F".into(),
                "/dev/null".into(),
                "-o".into(),
                format!(
                    "UserKnownHostsFile={}",
                    temp.path().join("known_hosts").display()
                )
                .into(),
                "-o".into(),
                "GlobalKnownHostsFile=/dev/null".into(),
            ],
        );
        let terminals = Terminals::default();
        terminals.sessions.lock().unwrap().insert(
            id.clone(),
            Terminal::spawn("tab1", "device1", &p, cmd).unwrap(),
        );
        let alive = AtomicBool::new(true);
        let invoke = |action: &str, mut payload: Value| {
            payload["terminalId"] = json!(id);
            terminals.handle(action, &payload, "tab1", "device1", &alive)
        };
        let wait_output = |needle: &str| {
            let start = Instant::now();
            let mut output = String::new();
            let mut offset = 0;
            loop {
                let chunk = invoke("ssh.read", json!({"offset":offset})).unwrap();
                offset = chunk["offset"].as_u64().unwrap();
                output.push_str(&String::from_utf8_lossy(
                    &STANDARD.decode(s(&chunk, "data")).unwrap(),
                ));
                if output.contains(needle) {
                    return output;
                }
                assert!(
                    start.elapsed() < Duration::from_secs(10),
                    "Missing {needle}; output: {output}"
                );
                std::thread::sleep(Duration::from_millis(20));
            }
        };
        let prompt = wait_output("Are you sure you want to continue connecting");
        let fingerprint = String::from_utf8(
            Command::new("ssh-keygen")
                .args(["-lf"])
                .arg(host_key.with_extension("pub"))
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap();
        assert!(prompt.contains(fingerprint.split_whitespace().nth(1).unwrap()));
        invoke("ssh.write", json!({"sequence":0,"data":"yes\r"})).unwrap();
        wait_output("#");
        let access = terminals.handle(
            "ssh.read",
            &json!({"terminalId":id,"offset":0}),
            "tab2",
            "device1",
            &alive,
        );
        assert_eq!(access.unwrap_err().code, "SSH_NOT_FOUND");
        invoke("ssh.resize", json!({"cols":111,"rows":33})).unwrap();
        let once = temp.path().join("once.txt");
        let data = format!(
            "printf 'SSH-中文\\n'; printf 'ONCE\\n' >> '{}'; stty size\r",
            once.display()
        );
        let first = invoke("ssh.write", json!({"sequence":1,"data":data})).unwrap();
        assert_eq!(
            first,
            invoke("ssh.write", json!({"sequence":1,"data":data})).unwrap()
        );
        assert_eq!(
            invoke("ssh.write", json!({"sequence":1,"data":"different"}))
                .unwrap_err()
                .code,
            "SSH_INPUT_UNKNOWN"
        );
        let output = wait_output("33 111");
        assert!(output.contains("SSH-中文"));
        assert_eq!(std::fs::read_to_string(&once).unwrap(), "ONCE\n");
        terminals.close_owner("tab2");
        assert!(terminals.is_active());
        terminals.close_device("device1");
        assert!(!terminals.is_active());
        alive.store(false, Ordering::SeqCst);
        assert!(terminals
            .handle("ssh.open", &p, "tab1", "device1", &alive)
            .is_err());
    }
}
