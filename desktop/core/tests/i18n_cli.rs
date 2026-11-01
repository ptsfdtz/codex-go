use std::process::{Command, Output};
fn run(directory: &std::path::Path, language: &str, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_agentdeck"))
        .env("AGENTDECK_DATA_DIR", directory)
        .env("AGENTDECK_LANG", language)
        .env("LC_ALL", "zh_CN.UTF-8")
        .args(args)
        .output()
        .unwrap()
}
fn stdout(output: Output) -> String {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}
#[test]
fn cli_language_precedence_and_safe_formatting() {
    let directory = tempfile::tempdir().unwrap();
    assert!(stdout(run(directory.path(), "system", &["help"])).contains("Codex 认证"));
    assert!(stdout(run(directory.path(), "en", &["help"])).contains("Codex authentication"));
    assert!(
        stdout(run(directory.path(), "zh-CN", &["--lang", "en", "help"]))
            .contains("Codex authentication")
    );
    let output = run(
        directory.path(),
        "en",
        &["--lang", "zh-CN", "unknown-{command}"],
    );
    assert!(!output.status.success());
    assert!(String::from_utf8(output.stderr)
        .unwrap()
        .contains("未知命令：unknown-{command}"));
}
#[test]
fn json_status_is_independent_of_language() {
    let directory = tempfile::tempdir().unwrap();
    let en: serde_json::Value =
        serde_json::from_str(&stdout(run(directory.path(), "en", &["status", "--json"]))).unwrap();
    let zh: serde_json::Value = serde_json::from_str(&stdout(run(
        directory.path(),
        "zh-CN",
        &["status", "--json"],
    )))
    .unwrap();
    assert_eq!(en, zh);
    assert_eq!(en["running"], false);
    assert!(en.get("dataDir").is_some());
    assert!(stdout(run(directory.path(), "en", &["status"])).contains("stopped"));
    assert!(stdout(run(directory.path(), "zh-CN", &["status"])).contains("已停止"));
}
