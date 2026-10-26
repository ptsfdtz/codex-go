//! Host-local attachment objects. Paths are never caller-authorized resources:
//! an enabled project and a durable reference for the original thread are required.
use super::store::Store;
use crate::{digest, ensure, future, now, paths, s, uid, Error, Result};
use rusqlite::params;
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

const MAX_LIBRARY_BYTES: u64 = 512 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 8 * 1024 * 1024;

impl Store {
    fn attachment_scope(&self, session_id: &str) -> Result<String> {
        let session = self.session(session_id)?;
        let project = self.project(s(&session, "projectId"))?;
        let root = paths::root(self, s(&session, "projectId"))?;
        ensure(
            !self.thread_deleted(s(&session, "upstreamThreadId"))?,
            "WORKSPACE_FORBIDDEN",
            "Attachment thread was deleted",
        )?;
        Ok(digest(
            json!([
                session["projectId"],
                session["upstreamThreadId"],
                root,
                project["identity"]
            ])
            .to_string(),
        ))
    }

    fn attachment_directory(&self) -> Result<PathBuf> {
        let directory = self.state_directory.join("attachments");
        match fs::create_dir(&directory) {
            Ok(()) => {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
        ensure(
            !fs::symlink_metadata(&directory)?.file_type().is_symlink()
                && paths::equal(&directory, &paths::canonical(&directory)?)
                && paths::equal(
                    &directory,
                    &paths::opened_path(&paths::open_directory(&directory)?)?,
                ),
            "WORKSPACE_FORBIDDEN",
            "Attachment directory must not be redirected",
        )?;
        Ok(directory)
    }

    /// Keep the old base64 upload contract; only Host storage and native input
    /// adaptation change. No attachment bytes are persisted on the relay.
    pub(crate) fn save_attachment(
        &self,
        session_id: &str,
        name: &str,
        bytes: &[u8],
    ) -> Result<Value> {
        let _guard = self.attachment_lock.lock().unwrap();
        let scope = self.attachment_scope(session_id)?;
        let directory = self.attachment_directory()?;
        let hash = digest(bytes);
        let target = directory.join(&hash);
        if !target.exists() {
            let rows = self.query(
                "SELECT COALESCE(SUM(bytes),0) AS bytes FROM attachment_blobs",
                [],
            )?;
            ensure(
                rows[0]["bytes"].as_u64().unwrap_or(0) + bytes.len() as u64 <= MAX_LIBRARY_BYTES,
                "ATTACHMENT_STORAGE_FULL",
                "电脑附件库已满（512 MiB）；保留的会话附件不会自动删除",
            )?;
            let mut temporary = tempfile::Builder::new()
                .prefix(".upload-")
                .tempfile_in(&directory)?;
            ensure(
                paths::within(&directory, &paths::opened_path(temporary.as_file())?),
                "WORKSPACE_FORBIDDEN",
                "Attachment upload escaped its directory",
            )?;
            temporary.write_all(bytes)?;
            temporary.as_file().sync_all()?;
            temporary
                .persist_noclobber(&target)
                .map_err(|_| Error::new("IO_ERROR", "Cannot publish attachment"))?;
        }
        // Also verify pre-existing objects; a hash-shaped filename is not trust.
        let stored = read_blob(&directory, &target, &hash)?;
        ensure(
            stored == bytes,
            "CONTENT_CHANGED",
            "Attachment object changed",
        )?;
        self.exec(
            "INSERT OR IGNORE INTO attachment_blobs(sha256,bytes,createdAt) VALUES(?,?,?)",
            params![hash, bytes.len() as i64, now()],
        )?;
        self.exec(
            "INSERT OR IGNORE INTO attachment_refs VALUES(?,?,?,?,?,?)",
            params![uid("attachment"), session_id, scope, hash, name, now()],
        )?;
        self.exec(
            "UPDATE attachment_blobs SET orphanedAt=NULL WHERE sha256=?",
            [&hash],
        )?;
        let row = self.one("SELECT attachmentId,name,sha256 FROM attachment_refs WHERE sessionId=? AND scopeKey=? AND sha256=? AND name=?",
            params![session_id, scope, hash, name])?;
        ensure(
            self.attachment_scope(session_id)? == scope,
            "SYNC_CONFLICT",
            "Attachment scope changed while saving",
        )?;
        Ok(json!({"attachmentId":row["attachmentId"],"name":name,"sha256":hash,"path":target}))
    }

    /// None means a legacy project resource. A library path without a matching
    /// reference is an error, never a fallback to a broader project grant.
    pub(crate) fn read_attachment(
        &self,
        session_id: &str,
        target: &Path,
    ) -> Result<Option<Vec<u8>>> {
        let _guard = self.attachment_lock.lock().unwrap();
        let expected_directory = self.state_directory.join("attachments");
        let canonical = paths::canonical(target)?;
        if !paths::within(&expected_directory, target)
            && !paths::within(&expected_directory, &canonical)
        {
            return Ok(None);
        }
        let directory = self.attachment_directory()?;
        ensure(
            paths::equal(target, &canonical)
                && canonical
                    .parent()
                    .is_some_and(|parent| paths::equal(parent, &directory)),
            "WORKSPACE_FORBIDDEN",
            "Attachment path must name an original object",
        )?;
        let hash = canonical
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        ensure(
            valid_hash(hash),
            "WORKSPACE_FORBIDDEN",
            "Invalid attachment object",
        )?;
        let scope = self.attachment_scope(session_id)?;
        ensure(!self.query("SELECT attachmentId FROM attachment_refs WHERE sessionId=? AND scopeKey=? AND sha256=?",
            params![session_id, scope, hash])?.is_empty(), "WORKSPACE_FORBIDDEN", "Attachment is not referenced by this conversation")?;
        let bytes = read_blob(&directory, &canonical, hash)?;
        ensure(
            self.attachment_scope(session_id)? == scope,
            "SYNC_CONFLICT",
            "Attachment authorization changed",
        )?;
        Ok(Some(bytes))
    }

    pub(crate) fn attachment_permission(
        &self,
        session_id: &str,
        path: &Path,
        read_only: bool,
    ) -> Result<bool> {
        let directory = self.state_directory.join("attachments");
        let in_library = paths::within(&directory, path)
            || paths::canonical(path).is_ok_and(|target| paths::within(&directory, &target));
        if !in_library {
            return Ok(false);
        }
        ensure(
            read_only,
            "WORKSPACE_FORBIDDEN",
            "Attachment library grants are read-only",
        )?;
        ensure(
            self.read_attachment(session_id, path)?.is_some(),
            "WORKSPACE_FORBIDDEN",
            "Attachment grant has no authorized resource",
        )?;
        Ok(true)
    }

    pub(crate) fn inherit_attachments(&self, source: &str, target: &str) -> Result<()> {
        let _guard = self.attachment_lock.lock().unwrap();
        let from = self.session(source)?;
        let to = self.session(target)?;
        ensure(
            from["projectId"] == to["projectId"],
            "WORKSPACE_FORBIDDEN",
            "Fork attachment project changed",
        )?;
        let source_scope = self.attachment_scope(source)?;
        let target_scope = self.attachment_scope(target)?;
        for row in self.query(
            "SELECT sha256,name FROM attachment_refs WHERE sessionId=? AND scopeKey=?",
            params![source, source_scope],
        )? {
            self.exec(
                "INSERT OR IGNORE INTO attachment_refs VALUES(?,?,?,?,?,?)",
                params![
                    uid("attachment"),
                    target,
                    target_scope,
                    row["sha256"].as_str(),
                    row["name"].as_str(),
                    now()
                ],
            )?;
        }
        Ok(())
    }

    /// References are independent of event retention. Only unreferenced objects
    /// and abandoned upload files older than a day can be reclaimed.
    pub(crate) fn retain_attachments(&self) -> Result<()> {
        let _guard = self.attachment_lock.lock().unwrap();
        let directory = self.state_directory.join("attachments");
        if !directory.exists() {
            return Ok(());
        }
        let directory = self.attachment_directory()?;
        let cutoff = future(-86400);
        self.exec("UPDATE attachment_blobs SET orphanedAt=NULL WHERE EXISTS(SELECT 1 FROM attachment_refs WHERE attachment_refs.sha256=attachment_blobs.sha256)", [])?;
        self.exec("UPDATE attachment_blobs SET orphanedAt=? WHERE orphanedAt IS NULL AND NOT EXISTS(SELECT 1 FROM attachment_refs WHERE attachment_refs.sha256=attachment_blobs.sha256)", [now()])?;
        let old = SystemTime::now()
            .checked_sub(Duration::from_secs(86400))
            .unwrap();
        for entry in fs::read_dir(&directory)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if !entry.file_type()?.is_file() || entry.metadata()?.modified()? >= old {
                continue;
            }
            if valid_hash(&name) {
                if !self
                    .query(
                        "SELECT attachmentId FROM attachment_refs WHERE sha256=?",
                        [&name],
                    )?
                    .is_empty()
                {
                    continue;
                }
                // Protect objects currently being published, including after a crash.
                if !self
                    .query(
                        "SELECT sha256 FROM attachment_blobs WHERE sha256=? AND (orphanedAt IS NULL OR orphanedAt>=?)",
                        params![name, cutoff],
                    )?
                    .is_empty()
                {
                    continue;
                }
                fs::remove_file(entry.path())?;
                self.exec("DELETE FROM attachment_blobs WHERE sha256=? AND NOT EXISTS(SELECT 1 FROM attachment_refs WHERE sha256=?)", params![name, name])?;
            } else if name.starts_with(".upload-") {
                fs::remove_file(entry.path())?;
            }
        }
        Ok(())
    }
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn read_blob(directory: &Path, target: &Path, hash: &str) -> Result<Vec<u8>> {
    ensure(
        !fs::symlink_metadata(target)?.file_type().is_symlink(),
        "WORKSPACE_FORBIDDEN",
        "Attachment object must not be redirected",
    )?;
    let file = fs::File::open(target)?;
    ensure(
        paths::equal(target, &paths::opened_path(&file)?) && paths::within(directory, target),
        "WORKSPACE_FORBIDDEN",
        "Attachment handle escaped its directory",
    )?;
    ensure(
        file.metadata()?.is_file() && file.metadata()?.len() <= MAX_IMAGE_BYTES,
        "UPSTREAM_CONTENT_TOO_LARGE",
        "Attachment object exceeds read limit",
    )?;
    let mut bytes = Vec::new();
    file.take(MAX_IMAGE_BYTES + 1).read_to_end(&mut bytes)?;
    ensure(
        bytes.len() as u64 <= MAX_IMAGE_BYTES && digest(&bytes) == hash,
        "CONTENT_CHANGED",
        "Attachment object failed integrity verification",
    )?;
    Ok(bytes)
}
