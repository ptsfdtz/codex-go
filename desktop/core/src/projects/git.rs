#[path = "branch_compare.rs"]
pub mod comparison;
use crate::{digest, ensure, paths, redact, s, store::Store, Error, Result};
use serde_json::{json, Value};
use std::{path::Path, process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, process::Command};
pub struct Output {
    pub data: Vec<u8>,
    pub truncated: bool,
    pub success: bool,
}
pub async fn run(root: &Path, args: &[&str], limit: usize) -> Result<Output> {
    let mut cmd = Command::new(if cfg!(windows) { "git.exe" } else { "git" });
    cmd.args([
        "--no-optional-locks",
        "-c",
        "core.pager=cat",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        "-c",
        "diff.external=",
        "-c",
        "core.hooksPath=",
        "-C",
    ])
    .arg(root)
    .args(args)
    .kill_on_drop(true)
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::null());
    for (k, _) in std::env::vars_os() {
        if k.to_string_lossy().to_uppercase().starts_with("GIT_") {
            cmd.env_remove(k);
        }
    }
    cmd.env("GIT_CONFIG_NOSYSTEM", "1")
        .env(
            "GIT_CONFIG_GLOBAL",
            if cfg!(windows) { "NUL" } else { "/dev/null" },
        )
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0");
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let mut child = cmd
        .spawn()
        .map_err(|_| Error::new("GIT_UNAVAILABLE", "Git could not start"))?;
    let out = child.stdout.take().unwrap();
    let mut data = vec![];
    let read = tokio::time::timeout(
        Duration::from_secs(10),
        out.take((limit + 1) as u64).read_to_end(&mut data),
    )
    .await;
    if !matches!(read, Ok(Ok(_))) {
        let _ = child.kill().await;
        return Err(Error::new("UPSTREAM_TIMEOUT", "Git timed out"));
    }
    let truncated = data.len() > limit;
    data.truncate(limit);
    if truncated {
        let _ = child.kill().await;
    }
    let status = tokio::time::timeout(Duration::from_secs(2), child.wait())
        .await
        .map_err(|_| Error::new("UPSTREAM_TIMEOUT", "Git did not exit"))??;
    Ok(Output {
        data,
        truncated,
        success: status.success() || truncated,
    })
}
pub fn parse(data: &[u8]) -> Vec<Value> {
    let parts: Vec<_> = data.split(|b| *b == 0).collect();
    let mut result = vec![];
    let mut i = 0;
    while i < parts.len() {
        let part = parts[i];
        i += 1;
        if part.len() < 4 {
            continue;
        }
        let index = part[0] as char;
        let worktree = part[1] as char;
        let path = String::from_utf8_lossy(&part[3..]).into_owned();
        let mut v = json!({"path":path,"index":index.to_string(),"worktree":worktree.to_string(),"untracked":index=='?'&&worktree=='?'});
        if ['R', 'C'].contains(&index) || ['R', 'C'].contains(&worktree) {
            if let Some(old) = parts.get(i) {
                v["oldPath"] = json!(String::from_utf8_lossy(old));
                i += 1;
            }
        }
        result.push(v);
    }
    result
}
pub(super) async fn authorized_root(store: &Store, id: &str) -> Result<std::path::PathBuf> {
    let root = paths::root(store, id)?;
    let top = run(&root, &["rev-parse", "--show-toplevel"], 32768).await?;
    ensure(
        top.success,
        "GIT_UNAVAILABLE",
        "No Git repository available",
    )?;
    ensure(
        paths::equal(
            &root,
            &paths::canonical(Path::new(String::from_utf8_lossy(&top.data).trim()))?,
        ),
        "WORKSPACE_FORBIDDEN",
        "Authorize Git worktree root",
    )?;
    let gd = run(&root, &["rev-parse", "--absolute-git-dir"], 32768).await?;
    ensure(
        gd.success
            && paths::within(
                &root,
                &paths::canonical(Path::new(String::from_utf8_lossy(&gd.data).trim()))?,
            ),
        "WORKSPACE_FORBIDDEN",
        "External Git metadata forbidden",
    )?;
    Ok(root)
}
pub async fn status(store: &Store, id: &str) -> Result<Value> {
    let root = paths::root(store, id)?;
    if !run(&root, &["rev-parse", "--show-toplevel"], 32768)
        .await?
        .success
    {
        return Ok(
            json!({"available":false,"files":[],"truncated":false,"attribution":"working-tree","baseline":null}),
        );
    }
    let root = authorized_root(store, id).await?;
    let output = run(
        &root,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignore-submodules=all",
        ],
        2 * 1024 * 1024,
    )
    .await?;
    ensure(output.success, "GIT_UNAVAILABLE", "Git status failed")?;
    let len = if output.truncated {
        output
            .data
            .iter()
            .rposition(|b| *b == 0)
            .map(|p| p + 1)
            .unwrap_or(0)
    } else {
        output.data.len()
    };
    let parsed = parse(&output.data[..len]);
    let mut files = vec![];
    for mut entry in parsed.iter().take(2000).cloned() {
        if let Ok(path) = paths::file(store, id, s(&entry, "path")) {
            if let Some(old) = entry["oldPath"].as_str() {
                if paths::file(store, id, old).is_err() {
                    continue;
                }
            }
            entry["link"] =
                json!(std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()));
            entry["fileId"] = json!(digest(format!("{}\0{}", id, s(&entry, "path"))));
            files.push(entry);
        }
    }
    let head = run(&root, &["rev-parse", "--verify", "HEAD"], 256).await?;
    Ok(
        json!({"available":true,"files":files,"truncated":output.truncated||parsed.len()>2000,"attribution":"working-tree; may include external changes","baseline":if head.success{Some(String::from_utf8_lossy(&head.data).trim().to_owned())}else{None}}),
    )
}
pub async fn diff(store: &Store, id: &str, file_id: &str) -> Result<Value> {
    let status = status(store, id).await?;
    let entry = status["files"]
        .as_array()
        .and_then(|a| a.iter().find(|v| v["fileId"] == file_id))
        .ok_or_else(|| Error::new("NOT_FOUND", "Refresh Git status"))?;
    let root = paths::root(store, id)?;
    let path = paths::file(store, id, s(entry, "path"))?;
    ensure(
        entry["link"] != true,
        "WORKSPACE_FORBIDDEN",
        "Symlink content forbidden",
    )?;
    if entry["untracked"] == true {
        let info = std::fs::symlink_metadata(&path)?;
        ensure(
            info.is_file() && !info.file_type().is_symlink(),
            "WORKSPACE_FORBIDDEN",
            "Regular file required",
        )?;
        let before = paths::identity(&std::fs::File::open(&path)?)?;
        let file = std::fs::File::open(&path)?;
        ensure(
            before == paths::identity(&file)? && paths::within(&root, &paths::opened_path(&file)?),
            "WORKSPACE_FORBIDDEN",
            "File changed during review",
        )?;
        let size = file.metadata()?.len();
        let mut data = vec![];
        use std::io::Read;
        file.take(256 * 1024).read_to_end(&mut data)?;
        let binary = data.contains(&0);
        return Ok(
            json!({"path":entry["path"],"untracked":true,"binary":binary,"truncated":size>data.len() as u64,"text":if binary{String::new()}else{redact(&String::from_utf8_lossy(&data))},"attribution":"working-tree"}),
        );
    }
    let mut args = vec!["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--"];
    if let Some(old) = entry["oldPath"].as_str() {
        args.push(old);
    }
    args.push(s(entry, "path"));
    let unstaged = run(&root, &args, 128 * 1024).await?;
    args.insert(1, "--cached");
    let staged = run(&root, &args, 128 * 1024).await?;
    ensure(
        staged.success && unstaged.success,
        "GIT_UNAVAILABLE",
        "Git diff failed",
    )?;
    let text = String::from_utf8_lossy(&staged.data).into_owned()
        + &String::from_utf8_lossy(&unstaged.data);
    Ok(
        json!({"path":entry["path"],"text":redact(&text),"binary":text.contains("Binary files "),"truncated":staged.truncated||unstaged.truncated,"attribution":"working-tree; may include external changes"}),
    )
}

#[cfg(test)]
mod file_workspace_tests {
    use super::*;

    #[tokio::test]
    async fn real_worktree_previews_modified_deleted_and_untracked_files() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("project");
        std::fs::create_dir(&root).unwrap();
        assert!(run(&root, &["init"], 4096).await.unwrap().success);
        for name in ["modified.txt", "deleted.txt"] {
            std::fs::write(root.join(name), "original\n").unwrap();
        }
        assert!(run(&root, &["add", "."], 4096).await.unwrap().success);
        assert!(
            run(
                &root,
                &[
                    "-c",
                    "user.name=Workspace Test",
                    "-c",
                    "user.email=test@example.invalid",
                    "-c",
                    "commit.gpgsign=false",
                    "commit",
                    "-m",
                    "Initial test files"
                ],
                4096
            )
            .await
            .unwrap()
            .success
        );
        std::fs::write(root.join("modified.txt"), "updated\n").unwrap();
        std::fs::remove_file(root.join("deleted.txt")).unwrap();
        std::fs::write(root.join("new.txt"), "new content\n").unwrap();
        let store = Store::open(&directory.path().join("state.db")).unwrap();
        let project = paths::add_local(&store, &root).unwrap();
        let id = s(&project, "projectId");
        let state = status(&store, id).await.unwrap();
        let files = state["files"].as_array().unwrap();
        assert_eq!(files.len(), 3);
        for (name, expected) in [
            ("modified.txt", "+updated"),
            ("deleted.txt", "-original"),
            ("new.txt", "new content"),
        ] {
            let entry = files.iter().find(|entry| entry["path"] == name).unwrap();
            let result = diff(&store, id, s(entry, "fileId")).await.unwrap();
            assert!(s(&result, "text").contains(expected));
        }
        assert!(diff(&store, id, "unknown-file-id").await.is_err());
        assert!(status(&store, "unauthorized-project").await.is_err());
    }
}
