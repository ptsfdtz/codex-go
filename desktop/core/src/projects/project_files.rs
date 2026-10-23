//! Bounded, project-granted directory metadata and explicit text previews.
use crate::{ensure, paths, service::Core, Result};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Component, Path};

fn read_text(root: &Path, file_path: &str) -> Result<Value> {
    let target = paths::canonical(&root.join(relative(file_path)?))?;
    ensure(
        paths::within(root, &target),
        "WORKSPACE_FORBIDDEN",
        "File outside project",
    )?;
    let file = std::fs::File::open(&target)?;
    let opened = paths::opened_path(&file)?;
    let before = file.metadata()?;
    ensure(
        paths::within(root, &opened) && before.is_file(),
        "WORKSPACE_FORBIDDEN",
        "File handle outside project or not a regular file",
    )?;
    const LIMIT: u64 = 256 * 1024;
    ensure(
        before.len() <= LIMIT,
        "UPSTREAM_CONTENT_TOO_LARGE",
        "Text preview supports files up to 256 KiB",
    )?;
    let mut bytes = Vec::new();
    (&file).take(LIMIT + 1).read_to_end(&mut bytes)?;
    let after = file.metadata()?;
    ensure(
        bytes.len() as u64 <= LIMIT,
        "UPSTREAM_CONTENT_TOO_LARGE",
        "File grew beyond preview limit",
    )?;
    ensure(
        before.len() == after.len()
            && before.modified().ok() == after.modified().ok()
            && bytes.len() as u64 == after.len()
            && paths::equal(&opened, &paths::opened_path(&file)?),
        "CONTENT_CHANGED",
        "File changed during preview; refresh",
    )?;
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| crate::Error::new("UNSUPPORTED", "Only UTF-8 text previews are supported"))?;
    ensure(
        !text.contains('\0'),
        "UNSUPPORTED",
        "Binary content cannot be previewed as text",
    )?;
    Ok(
        json!({"path":file_path,"text":text,"size":bytes.len(),"sha256":format!("{:x}",Sha256::digest(&bytes)),"encoding":"utf-8"}),
    )
}

fn relative(value: &str) -> Result<&Path> {
    let path = Path::new(value);
    ensure(
        value.len() <= 4096
            && !value.contains(['\0', ':', '\\'])
            && path.components().all(|c| matches!(c, Component::Normal(_))),
        "WORKSPACE_FORBIDDEN",
        "Only project-relative directory paths are accepted",
    )?;
    Ok(path)
}

impl Core {
    pub fn project_file_reference(&self, project_id: &str, file_path: &str) -> Result<Value> {
        let root = paths::root(&self.store, project_id)?;
        let target = paths::canonical(&root.join(relative(file_path)?))?;
        ensure(
            paths::within(&root, &target),
            "WORKSPACE_FORBIDDEN",
            "Reference outside project",
        )?;
        let file = std::fs::File::open(&target)?;
        let opened = paths::opened_path(&file)?;
        ensure(
            file.metadata()?.is_file() && paths::within(&root, &opened),
            "WORKSPACE_FORBIDDEN",
            "Reference handle outside project",
        )?;
        let label = Path::new(file_path)
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| crate::Error::new("INVALID_REQUEST", "Invalid file label"))?;
        let path = opened.to_string_lossy().replace('\\', "/");
        ensure(
            !path.chars().any(char::is_control) && !label.chars().any(char::is_control),
            "UNSUPPORTED",
            "Control characters cannot be used in file references",
        )?;
        let text = markdown_file_link(label, &path);
        ensure(
            paths::equal(&root, &paths::root(&self.store, project_id)?),
            "SYNC_CONFLICT",
            "Project changed while creating reference",
        )?;
        Ok(json!({"projectId":project_id,"path":file_path,"referenceText":text}))
    }
    pub fn project_file_text(&self, project_id: &str, file_path: &str) -> Result<Value> {
        let root = paths::root(&self.store, project_id)?;
        let mut result = read_text(&root, file_path)?;
        ensure(
            paths::equal(&root, &paths::root(&self.store, project_id)?),
            "SYNC_CONFLICT",
            "Project grant changed during file preview",
        )?;
        result["projectId"] = json!(project_id);
        Ok(result)
    }
    pub fn project_files(&self, project_id: &str, directory: &str) -> Result<Value> {
        let root = paths::root(&self.store, project_id)?;
        let target = paths::canonical(&root.join(relative(directory)?))?;
        ensure(
            paths::within(&root, &target),
            "WORKSPACE_FORBIDDEN",
            "Directory outside project",
        )?;
        let handle = paths::open_directory(&target)?;
        ensure(
            handle.metadata()?.is_dir() && paths::within(&root, &paths::opened_path(&handle)?),
            "WORKSPACE_FORBIDDEN",
            "Directory handle outside project",
        )?;
        let mut rows = Vec::new();
        let mut scanned = 0;
        let mut truncated = false;
        let mut response_bytes = 0;
        for item in std::fs::read_dir(&target)? {
            scanned += 1;
            if scanned > 4000 {
                truncated = true;
                break;
            }
            let item = item?;
            let name = item.file_name();
            let Some(name) = name.to_str() else { continue };
            if name.len() > 512 || name.contains(['\0', ':', '\\', '/']) {
                continue;
            }
            let path = match paths::canonical(&item.path()) {
                Ok(path) if paths::within(&root, &path) => path,
                _ => continue,
            };
            let metadata = std::fs::metadata(&path)?;
            let kind = if metadata.is_dir() {
                "directory"
            } else if metadata.is_file() {
                "file"
            } else {
                continue;
            };
            let display = if directory.is_empty() {
                name.to_owned()
            } else {
                format!("{directory}/{name}")
            };
            let row = json!({"name":name,"path":display,"kind":kind,"size":if metadata.is_file(){Some(metadata.len())}else{None}});
            response_bytes += row.to_string().len() + 1;
            if response_bytes > 384 * 1024 {
                truncated = true;
                break;
            }
            rows.push(row);
        }
        rows.sort_by(|a, b| {
            let rank = |v: &Value| if v["kind"] == "directory" { 0 } else { 1 };
            rank(a).cmp(&rank(b)).then_with(|| {
                a["name"]
                    .as_str()
                    .unwrap()
                    .to_lowercase()
                    .cmp(&b["name"].as_str().unwrap().to_lowercase())
            })
        });
        ensure(
            paths::equal(&root, &paths::root(&self.store, project_id)?)
                && paths::equal(&target, &paths::opened_path(&handle)?),
            "SYNC_CONFLICT",
            "Project or directory changed while listing",
        )?;
        Ok(
            json!({"projectId":project_id,"directory":directory,"entries":rows,"truncated":truncated}),
        )
    }
}

fn markdown_file_link(label: &str, path: &str) -> String {
    let label = label
        .replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace("](", "]\\(")
        .replace(']', "\\]");
    let path = path.replace('\\', "\\\\").replace(')', "\\)");
    format!("[{label}]({path})")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn file_link_escapes_desktop_markdown_delimiters() {
        assert_eq!(
            markdown_file_link("a[b](c).rs", "C:/project/a[b](c).rs"),
            "[a\\[b\\]\\(c).rs](C:/project/a[b](c\\).rs)"
        );
        assert_eq!(
            markdown_file_link("main.rs", "C:/project/main.rs"),
            "[main.rs](C:/project/main.rs)"
        );
    }
    #[test]
    fn file_preview_is_bounded_utf8_and_rejects_outside_or_binary() {
        let dir = tempfile::tempdir().unwrap();
        let root = paths::canonical(dir.path()).unwrap();
        std::fs::write(root.join("hello.txt"), "中文\nhello").unwrap();
        let preview = read_text(&root, "hello.txt").unwrap();
        assert_eq!(preview["text"], "中文\nhello");
        assert_eq!(preview["sha256"].as_str().unwrap().len(), 64);
        std::fs::write(root.join("binary"), b"abc\0def").unwrap();
        assert!(read_text(&root, "binary").is_err());
        std::fs::write(root.join("invalid"), [0xff, 0xfe]).unwrap();
        assert!(read_text(&root, "invalid").is_err());
        std::fs::write(root.join("large"), vec![b'a'; 256 * 1024 + 1]).unwrap();
        assert!(read_text(&root, "large").is_err());
        assert!(read_text(&root, "../outside").is_err());
        assert!(read_text(&root, "").is_err());
    }
    #[test]
    fn directory_input_cannot_escape_grant() {
        for value in [
            "../private",
            "a/../../private",
            "C:/private",
            "/private",
            "a\\b",
            "file:stream",
        ] {
            assert!(relative(value).is_err(), "{value}");
        }
        assert!(relative("").is_ok());
        assert!(relative("src/main").is_ok());
    }
}
