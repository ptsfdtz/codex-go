//! Bounded client attachments. Production uploads use the Host-owned library;
//! the original project-local helper remains for public Rust API compatibility.
use crate::{ensure, protocol, uid, Error, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{io::Write, path::Path};

pub const MAX_ATTACHMENT_BYTES: usize = 512 * 1024;
pub fn validate_turn(params: &Value) -> Result<()> {
    validate_turn_for(crate::rpc::ProtocolVersion::Managed, params)
}
pub fn validate_turn_for(version: crate::rpc::ProtocolVersion, params: &Value) -> Result<()> {
    if version == crate::rpc::ProtocolVersion::DesktopBaseline {
        return crate::rpc::validate_for(version, "experimental/TurnStartParams", params);
    }
    static SCHEMA: std::sync::LazyLock<jsonschema::Validator> = std::sync::LazyLock::new(|| {
        let schema: Value = serde_json::from_str(include_str!(
            "../../../../packages/codex-protocol/experimental/TurnStartParams.json"
        ))
        .unwrap();
        jsonschema::options()
            .should_validate_formats(false)
            .build(&schema)
            .unwrap()
    });
    ensure(
        SCHEMA.is_valid(params),
        "UPSTREAM_PROTOCOL_ERROR",
        "Invalid composer turn parameters",
    )
}
#[derive(Clone, Copy)]
pub enum GoalOrigin {
    User,
    Automatic,
}
pub fn goal_params(
    version: crate::rpc::ProtocolVersion,
    mut params: Value,
    origin: GoalOrigin,
) -> Value {
    if version == crate::rpc::ProtocolVersion::DesktopBaseline {
        params["origin"] = json!(match origin {
            GoalOrigin::User => "user",
            GoalOrigin::Automatic => "automatic",
        });
    }
    params
}
pub fn decode_attachments(files: &Value) -> Result<Vec<(String, Vec<u8>)>> {
    let files = files
        .as_array()
        .ok_or_else(|| Error::new("INVALID_REQUEST", "Attachments must be an array"))?;
    ensure(files.len() <= 4, "INVALID_REQUEST", "最多添加 4 个附件")?;
    let mut result = Vec::new();
    let mut total = 0;
    for file in files {
        protocol::fields(file, &["name", "data"], &[])?;
        protocol::text(file, "name", 1, 120)?;
        let name = file["name"].as_str().unwrap();
        ensure(
            !name
                .chars()
                .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
                && !name.ends_with(['.', ' ']),
            "INVALID_REQUEST",
            "Invalid attachment filename",
        )?;
        let encoded = file["data"]
            .as_str()
            .ok_or_else(|| Error::new("INVALID_REQUEST", "Base64 data required"))?;
        ensure(
            encoded.len() <= MAX_ATTACHMENT_BYTES.div_ceil(3) * 4,
            "INVALID_REQUEST",
            "附件总大小不能超过 512 KB",
        )?;
        let bytes = STANDARD
            .decode(encoded)
            .map_err(|_| Error::new("INVALID_REQUEST", "Invalid attachment data"))?;
        total += bytes.len();
        ensure(
            total <= MAX_ATTACHMENT_BYTES,
            "INVALID_REQUEST",
            "附件总大小不能超过 512 KB",
        )?;
        result.push((name.to_owned(), bytes));
    }
    Ok(result)
}

pub fn prepare_input(
    root: &Path,
    text: &str,
    files: Option<&Value>,
) -> Result<(Vec<Value>, Vec<String>)> {
    let decoded = files
        .map(decode_attachments)
        .transpose()?
        .unwrap_or_default();
    let mut input = vec![json!({"type":"text","text":text,"text_elements":[]})];
    let mut names = Vec::new();
    if decoded.is_empty() {
        return Ok((input, names));
    }
    // A unique directory created directly under the verified root avoids existing symlinks.
    let directory = root.join(format!(".agentdeck-{}", uid("attachments")));
    std::fs::create_dir(&directory)?;
    for (index, (name, bytes)) in decoded.into_iter().enumerate() {
        // Prefix also avoids Windows reserved names and duplicate filenames.
        let path = directory.join(format!("{index}-{name}"));
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        #[cfg(windows)]
        ensure(
            crate::paths::within(root, &crate::paths::opened_path(&file)?),
            "WORKSPACE_FORBIDDEN",
            "Attachment handle is outside granted workspace",
        )?;
        file.write_all(&bytes)?;
        let image = bytes.starts_with(b"\x89PNG\r\n\x1a\n")
            || bytes.starts_with(b"\xff\xd8\xff")
            || bytes.starts_with(b"GIF8")
            || (bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"));
        input.push(if image { json!({"type":"localImage","path":path}) } else {
            json!({"type":"text","text":format!("用户上传的附件：{name}\n文件路径：{}", path.display()),"text_elements":[]})
        });
        names.push(name);
    }
    Ok((input, names))
}

pub(crate) fn prepare_stored_input(
    store: &crate::store::Store,
    session_id: &str,
    text: &str,
    files: Option<&Value>,
) -> Result<(Vec<Value>, Vec<String>)> {
    let decoded = files
        .map(decode_attachments)
        .transpose()?
        .unwrap_or_default();
    let mut input = vec![json!({"type":"text","text":text,"text_elements":[]})];
    let mut names = Vec::new();
    for (name, bytes) in decoded {
        let saved = store.save_attachment(session_id, &name, &bytes)?;
        let image = bytes.starts_with(b"\x89PNG\r\n\x1a\n")
            || bytes.starts_with(b"\xff\xd8\xff")
            || bytes.starts_with(b"GIF8")
            || (bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"));
        input.push(if image {
            json!({"type":"localImage","path":saved["path"]})
        } else {
            // Ordinary files keep the runtime's normal on-request sandbox
            // approval. Never grant access to the whole Host state directory.
            json!({"type":"text","text":format!("用户上传的附件：{name}\n附件 ID：{}\n文件路径：{}", saved["attachmentId"].as_str().unwrap(), saved["path"].as_str().unwrap()),"text_elements":[]})
        });
        names.push(name);
    }
    Ok((input, names))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_and_path_traversal_are_rejected() {
        assert!(decode_attachments(&json!([{"name":"../escape","data":"YQ=="}])).is_err());
        assert!(decode_attachments(&json!([{"name":"ok","data":"!"}])).is_err());
        assert!(decode_attachments(
            &json!([{"name":"ok","data":STANDARD.encode(vec![0;MAX_ATTACHMENT_BYTES+1])}])
        )
        .is_err());
    }
    #[test]
    fn files_and_images_reach_the_granted_workspace() {
        let root = tempfile::tempdir().unwrap();
        // Windows runner TEMP may use an 8.3 alias; grants use canonical paths.
        let granted = crate::paths::canonical(root.path()).unwrap();
        let files = json!([{"name":"notes.txt","data":STANDARD.encode(b"hello")},{"name":"photo.png","data":STANDARD.encode(b"\x89PNG\r\n\x1a\nimage")}]);
        let (input, names) = prepare_input(&granted, "inspect", Some(&files)).unwrap();
        assert_eq!(names, ["notes.txt", "photo.png"]);
        assert_eq!(input[2]["type"], "localImage");
        let path = Path::new(input[2]["path"].as_str().unwrap());
        assert!(path.starts_with(&granted));
        assert_eq!(std::fs::read(path).unwrap(), b"\x89PNG\r\n\x1a\nimage");
    }
}
