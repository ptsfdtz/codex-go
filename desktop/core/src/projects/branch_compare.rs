//! Bounded, read-only comparisons of committed trees. No fetch or checkout.
use super::{authorized_root, run};
use crate::{digest, ensure, paths, redact, s, store::Store, Error, Result};
use serde_json::{json, Value};
use std::path::Path;

async fn resolve(root: &Path, reference: &str) -> Result<String> {
    ensure(
        reference == "HEAD"
            || reference.starts_with("refs/heads/")
            || reference.starts_with("refs/remotes/")
            || ((reference.len() == 40 || reference.len() == 64)
                && reference.bytes().all(|c| c.is_ascii_hexdigit())),
        "INVALID_REQUEST",
        "Select a branch or full commit hash",
    )?;
    ensure(
        reference.len() <= 512 && !reference.contains(['\0', '\n', '\r']),
        "INVALID_REQUEST",
        "Invalid reference",
    )?;
    let revision = format!("{reference}^{{commit}}");
    let output = run(
        root,
        &["rev-parse", "--verify", "--end-of-options", &revision],
        256,
    )
    .await?;
    ensure(
        output.success && !output.truncated,
        "NOT_FOUND",
        "Branch or commit is unavailable; refresh branches",
    )?;
    let hash = String::from_utf8_lossy(&output.data).trim().to_owned();
    ensure(
        (hash.len() == 40 || hash.len() == 64) && hash.bytes().all(|c| c.is_ascii_hexdigit()),
        "GIT_UNAVAILABLE",
        "Invalid commit result",
    )?;
    Ok(hash)
}

pub async fn branches(store: &Store, id: &str) -> Result<Value> {
    let root = authorized_root(store, id).await?;
    let output = run(
        &root,
        &[
            "for-each-ref",
            "--sort=refname",
            "--format=%(refname)%00%(objectname)%00%(symref)",
            "refs/heads/",
            "refs/remotes/",
        ],
        256 * 1024,
    )
    .await?;
    ensure(output.success, "GIT_UNAVAILABLE", "Could not list branches")?;
    let mut branches = vec![];
    for line in output.data.split(|b| *b == b'\n').filter(|l| !l.is_empty()) {
        let fields: Vec<_> = line.split(|b| *b == 0).collect();
        if fields.len() != 3 || !fields[2].is_empty() {
            continue;
        }
        let Ok(name) = std::str::from_utf8(fields[0]) else {
            continue;
        };
        branches.push(json!({"name":name,"commit":String::from_utf8_lossy(fields[1])}));
        if branches.len() == 1000 {
            break;
        }
    }
    let current = run(&root, &["symbolic-ref", "--quiet", "HEAD"], 1024).await?;
    Ok(
        json!({"truncated":output.truncated || branches.len() == 1000,"branches":branches,"current":if current.success { Some(String::from_utf8_lossy(&current.data).trim().to_owned()) } else { None }}),
    )
}

async fn files(root: &Path, id: &str, base: &str, head: &str) -> Result<Value> {
    let output = run(
        root,
        &[
            "diff",
            "--raw",
            "-z",
            "--no-renames",
            "--no-ext-diff",
            "--no-textconv",
            "--ignore-submodules=all",
            base,
            head,
            "--",
        ],
        512 * 1024,
    )
    .await?;
    ensure(
        output.success,
        "GIT_UNAVAILABLE",
        "Could not compare commits",
    )?;
    let mut files = vec![];
    let complete = output
        .data
        .iter()
        .rposition(|b| *b == 0)
        .map(|n| n + 1)
        .unwrap_or(0);
    let mut records = output.data[..complete].split(|b| *b == 0);
    while let (Some(meta), Some(path)) = (records.next(), records.next()) {
        if files.len() == 1000 {
            break;
        }
        let Ok(path) = std::str::from_utf8(path) else {
            continue;
        };
        let Ok(meta) = std::str::from_utf8(meta) else {
            continue;
        };
        let fields: Vec<_> = meta.split(' ').collect();
        if fields.len() != 5 || !meta.starts_with(':') || paths::checked_file(root, path).is_err() {
            continue;
        }
        let previewable = ["000000", "100644", "100755"]
            .contains(&fields[0].trim_start_matches(':'))
            && ["000000", "100644", "100755"].contains(&fields[1]);
        files.push(json!({"path":path,"status":fields[4],"previewable":previewable,"fileId":digest(format!("{id}\0{base}\0{head}\0{path}"))}));
    }
    Ok(
        json!({"base":base,"head":head,"files":files,"truncated":output.truncated || files.len() == 1000}),
    )
}

pub async fn compare(store: &Store, id: &str, base: &str, head: &str, mode: &str) -> Result<Value> {
    ensure(
        ["direct", "merge-base"].contains(&mode),
        "INVALID_REQUEST",
        "Invalid comparison mode",
    )?;
    let root = authorized_root(store, id).await?;
    let mut base = resolve(&root, base).await?;
    let head = resolve(&root, head).await?;
    if mode == "merge-base" {
        let output = run(&root, &["merge-base", &base, &head], 256).await?;
        ensure(
            output.success && !output.truncated,
            "NOT_FOUND",
            "Branches have no common ancestor",
        )?;
        base = resolve(&root, String::from_utf8_lossy(&output.data).trim()).await?;
    }
    files(&root, id, &base, &head).await
}

pub async fn diff(store: &Store, id: &str, base: &str, head: &str, file_id: &str) -> Result<Value> {
    // Diffs must refer to immutable snapshots returned by compare, never moving branch names.
    ensure(
        [base, head]
            .iter()
            .all(|v| (v.len() == 40 || v.len() == 64) && v.bytes().all(|c| c.is_ascii_hexdigit())),
        "INVALID_REQUEST",
        "Comparison commit hashes required",
    )?;
    let root = authorized_root(store, id).await?;
    let base = resolve(&root, base).await?;
    let head = resolve(&root, head).await?;
    let state = files(&root, id, &base, &head).await?;
    let entry = state["files"]
        .as_array()
        .and_then(|a| a.iter().find(|e| e["fileId"] == file_id))
        .ok_or_else(|| Error::new("NOT_FOUND", "Refresh comparison"))?;
    if entry["previewable"] != true {
        return Ok(json!({"text":"","binary":true,"truncated":false}));
    }
    let path = format!(":(literal){}", s(entry, "path"));
    let output = run(
        &root,
        &[
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--no-renames",
            "--ignore-submodules=all",
            "--unified=3",
            &base,
            &head,
            "--",
            &path,
        ],
        128 * 1024,
    )
    .await?;
    ensure(
        output.success,
        "GIT_UNAVAILABLE",
        "Could not read comparison diff",
    )?;
    let text = String::from_utf8_lossy(&output.data);
    Ok(
        json!({"text":redact(&text),"binary":text.contains("Binary files "),"truncated":output.truncated}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn commit(root: &Path) {
        assert!(run(root, &["add", "."], 4096).await.unwrap().success);
        assert!(
            run(
                root,
                &[
                    "-c",
                    "user.name=Test",
                    "-c",
                    "user.email=test@example.invalid",
                    "-c",
                    "commit.gpgsign=false",
                    "commit",
                    "-m",
                    "test"
                ],
                4096
            )
            .await
            .unwrap()
            .success
        );
    }

    #[tokio::test]
    async fn branch_comparison_uses_immutable_commits_and_distinguishes_merge_base() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("repo");
        std::fs::create_dir(&root).unwrap();
        assert!(
            run(&root, &["init", "-b", "main"], 4096)
                .await
                .unwrap()
                .success
        );
        std::fs::write(root.join("code.txt"), "original\n").unwrap();
        std::fs::write(root.join("deleted.txt"), "delete me\n").unwrap();
        commit(&root).await;
        assert!(
            run(&root, &["checkout", "-b", "topic"], 4096)
                .await
                .unwrap()
                .success
        );
        std::fs::write(root.join("code.txt"), "topic\n").unwrap();
        std::fs::write(root.join("literal[1].txt"), "literal\n").unwrap();
        std::fs::write(root.join("binary.dat"), b"\0binary").unwrap();
        std::fs::remove_file(root.join("deleted.txt")).unwrap();
        commit(&root).await;
        assert!(
            run(&root, &["checkout", "main"], 4096)
                .await
                .unwrap()
                .success
        );
        std::fs::write(root.join("base-only.txt"), "base only\n").unwrap();
        commit(&root).await;
        let store = Store::open(&dir.path().join("state.db")).unwrap();
        let project = paths::add_local(&store, &root).unwrap();
        let id = s(&project, "projectId");
        let refs = branches(&store, id).await.unwrap();
        assert_eq!(refs["branches"].as_array().unwrap().len(), 2);
        let direct = compare(&store, id, "refs/heads/main", "refs/heads/topic", "direct")
            .await
            .unwrap();
        assert!(direct["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f["path"] == "base-only.txt"));
        let compared = compare(
            &store,
            id,
            "refs/heads/main",
            "refs/heads/topic",
            "merge-base",
        )
        .await
        .unwrap();
        let files = compared["files"].as_array().unwrap();
        assert_eq!(files.len(), 4);
        for (name, expected) in [
            ("code.txt", "+topic"),
            ("deleted.txt", "-delete me"),
            ("literal[1].txt", "+literal"),
        ] {
            let file = files.iter().find(|f| f["path"] == name).unwrap();
            let preview = diff(
                &store,
                id,
                s(&compared, "base"),
                s(&compared, "head"),
                s(file, "fileId"),
            )
            .await
            .unwrap();
            assert!(s(&preview, "text").contains(expected));
        }
        let binary = files.iter().find(|f| f["path"] == "binary.dat").unwrap();
        assert_eq!(
            diff(
                &store,
                id,
                s(&compared, "base"),
                s(&compared, "head"),
                s(binary, "fileId")
            )
            .await
            .unwrap()["binary"],
            true
        );
        assert!(
            run(
                &root,
                &["update-ref", "refs/heads/topic", "refs/heads/main"],
                4096
            )
            .await
            .unwrap()
            .success
        );
        // Uncommitted edits must not affect either the list or the committed diff.
        std::fs::write(root.join("code.txt"), "uncommitted secret\n").unwrap();
        let file = files.iter().find(|f| f["path"] == "code.txt").unwrap();
        assert!(!s(
            &diff(
                &store,
                id,
                s(&compared, "base"),
                s(&compared, "head"),
                s(file, "fileId")
            )
            .await
            .unwrap(),
            "text"
        )
        .contains("uncommitted"));
        assert!(
            compare(&store, id, "--output=/tmp/invalid", "HEAD", "direct")
                .await
                .is_err()
        );
        assert!(compare(&store, id, "HEAD:code.txt", "HEAD", "direct")
            .await
            .is_err());
        assert!(compare(&store, id, "refs/heads/missing", "HEAD", "direct")
            .await
            .is_err());
        assert!(compare(&store, "unauthorized", "HEAD", "HEAD", "direct")
            .await
            .is_err());
        assert!(diff(&store, id, "HEAD", "HEAD", s(file, "fileId"))
            .await
            .is_err());
        assert!(diff(
            &store,
            id,
            s(&compared, "base"),
            s(&compared, "head"),
            "forged"
        )
        .await
        .is_err());
    }
}

#[cfg(test)]
mod limit_tests {
    use super::*;

    #[tokio::test]
    async fn branch_comparison_bounds_lists_and_diff_payloads() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("repo");
        std::fs::create_dir(&root).unwrap();
        assert!(
            run(&root, &["init", "-b", "main"], 4096)
                .await
                .unwrap()
                .success
        );
        for args in [
            vec!["config", "user.name", "Test"],
            vec!["config", "user.email", "test@example.invalid"],
            vec!["config", "commit.gpgsign", "false"],
            vec!["commit", "--allow-empty", "-m", "base"],
        ] {
            assert!(run(&root, &args, 4096).await.unwrap().success);
        }
        let base = resolve(&root, "HEAD").await.unwrap();
        std::fs::write(
            root.join("000-large.txt"),
            "a long diff line\n".repeat(20000),
        )
        .unwrap();
        for i in 0..1005 {
            std::fs::write(root.join(format!("file-{i:04}.txt")), "new\n").unwrap();
        }
        assert!(run(&root, &["add", "."], 4096).await.unwrap().success);
        assert!(
            run(&root, &["commit", "-m", "many changes"], 4096)
                .await
                .unwrap()
                .success
        );
        let store = Store::open(&dir.path().join("state.db")).unwrap();
        let project = paths::add_local(&store, &root).unwrap();
        let id = s(&project, "projectId");
        let compared = compare(&store, id, &base, "HEAD", "direct").await.unwrap();
        assert_eq!(compared["truncated"], true);
        assert_eq!(compared["files"].as_array().unwrap().len(), 1000);
        let file = &compared["files"][0];
        assert_eq!(file["path"], "000-large.txt");
        let preview = diff(
            &store,
            id,
            s(&compared, "base"),
            s(&compared, "head"),
            s(file, "fileId"),
        )
        .await
        .unwrap();
        assert_eq!(preview["truncated"], true);
        assert!(s(&preview, "text").len() <= 128 * 1024);
    }

    #[test]
    fn branch_comparison_protocol_preserves_conversation_modes() {
        for (action, payload) in [
            ("git.branches", json!({"projectId":"p"})),
            (
                "git.compare",
                json!({"projectId":"p","base":"HEAD","head":"HEAD","mode":"direct"}),
            ),
            (
                "git.compare",
                json!({"projectId":"p","base":"HEAD","head":"HEAD","mode":"merge-base"}),
            ),
            (
                "git.compareDiff",
                json!({"projectId":"p","base":"a".repeat(40),"head":"b".repeat(40),"fileId":"file"}),
            ),
        ] {
            assert!(crate::protocol::parse(
                json!({"v":1,"type":"request","id":"test","action":action,"payload":payload})
            )
            .is_ok());
        }
        for mode in ["plan", "goal", "invalid"] {
            assert!(crate::protocol::parse(json!({"v":1,"type":"request","id":"test","action":"git.compare","payload":{"projectId":"p","base":"HEAD","head":"HEAD","mode":mode}})).is_err());
        }
    }
}
