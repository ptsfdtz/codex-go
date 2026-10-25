//! Real CLI/daemon processes, isolated persistent state, no model calls.
use serde_json::Value;
use std::{
    path::Path,
    process::Command,
    time::{Duration, Instant},
};

fn cli(directory: &Path, port: u16, args: &[&str]) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_agentdeck"))
        .args(args)
        .env("AGENTDECK_DATA_DIR", directory)
        .env("AGENTDECK_PORT", port.to_string())
        // Exercise management availability even with a missing runtime.
        .env("AGENTDECK_CODEX_EXE", directory.join("missing-codex"))
        .env_remove("AGENTDECK_RUNTIME_WS_URL")
        .env_remove("AGENTDECK_RUNTIME_TOKEN_FILE")
        .env_remove("AGENTDECK_RUNTIME_PROTOCOL_VERSION")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{args:?}: {} / {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap_or(Value::Null)
}
struct Cleanup(std::path::PathBuf, u16);
impl Drop for Cleanup {
    fn drop(&mut self) {
        let _ = Command::new(env!("CARGO_BIN_EXE_agentdeck"))
            .arg("stop")
            .env("AGENTDECK_DATA_DIR", &self.0)
            .env("AGENTDECK_PORT", self.1.to_string())
            .output();
    }
}

#[test]
fn background_survives_cli_exit_preserves_identity_and_recovers_a_crashed_worker() {
    let directory = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let _cleanup = Cleanup(directory.path().to_path_buf(), port);
    cli(directory.path(), port, &["start"]);
    let first = cli(directory.path(), port, &["status", "--json"]);
    assert_eq!(first["running"], true);
    assert!(!first["hostId"].as_str().unwrap().is_empty());
    assert_eq!(first["codexReady"], false);
    let certificate = std::fs::read(directory.path().join("tls.dpapi")).unwrap();
    cli(directory.path(), port, &["start"]);
    let duplicate = cli(directory.path(), port, &["status", "--json"]);
    assert_eq!(first["servicePid"], duplicate["servicePid"]);
    cli(
        directory.path(),
        port,
        &["projects", "add", project.path().to_str().unwrap()],
    );
    let projects = cli(directory.path(), port, &["projects", "list"]);
    assert_eq!(projects.as_array().unwrap().len(), 1);
    let pid = first["servicePid"].as_u64().unwrap().to_string();
    #[cfg(windows)]
    let killed = Command::new("taskkill.exe")
        .args(["/PID", &pid, "/F"])
        .output()
        .unwrap();
    #[cfg(unix)]
    let killed = Command::new("kill").args(["-KILL", &pid]).output().unwrap();
    assert!(killed.status.success());
    let until = Instant::now() + Duration::from_secs(25);
    let recovered = loop {
        let state = cli(directory.path(), port, &["status", "--json"]);
        if state["running"] == true && state["servicePid"] != first["servicePid"] {
            break state;
        }
        assert!(Instant::now() < until, "Supervisor did not recover worker");
        std::thread::sleep(Duration::from_millis(200));
    };
    assert_eq!(first["hostId"], recovered["hostId"]);
    assert_eq!(recovered["projects"].as_array().unwrap().len(), 1);
    cli(directory.path(), port, &["stop"]);
    assert_eq!(
        cli(directory.path(), port, &["status", "--json"])["running"],
        false
    );
    assert!(!directory.path().join("management.json").exists());
    cli(directory.path(), port, &["start"]);
    let restarted = cli(directory.path(), port, &["status", "--json"]);
    assert_eq!(first["hostId"], restarted["hostId"]);
    assert_eq!(
        certificate,
        std::fs::read(directory.path().join("tls.dpapi")).unwrap()
    );
    cli(
        directory.path(),
        port,
        &[
            "projects",
            "remove",
            projects[0]["projectId"].as_str().unwrap(),
        ],
    );
    assert!(cli(directory.path(), port, &["projects", "list"])
        .as_array()
        .unwrap()
        .is_empty());
    let logs = std::fs::read_to_string(directory.path().join("host.log")).unwrap();
    assert!(
        !logs.contains("cloudSessionProtectedV1")
            && !logs.contains("contextJson")
            && !logs.contains("credentialHash")
    );
}
