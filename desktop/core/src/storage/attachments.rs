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

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, Store, String, PathBuf) {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(&directory.path().join("host.db")).unwrap();
        let project_path = directory.path().join("project");
        fs::create_dir(&project_path).unwrap();
        let project = paths::add_local(&store, &project_path).unwrap();
        let id = s(&project, "projectId").to_owned();
        for session in ["one", "two"] {
            store
                .exec(
                    "INSERT INTO sessions VALUES(?,?,?,?,?,?,?)",
                    params![
                        session,
                        id,
                        format!("thread-{session}"),
                        session,
                        "idle",
                        now(),
                        now()
                    ],
                )
                .unwrap();
        }
        (directory, store, id, project_path)
    }

    #[test]
    fn objects_are_deduplicated_and_session_bound_across_restart() {
        let (directory, store, _, project) = setup();
        let first = store
            .save_attachment("one", "photo.png", b"image bytes")
            .unwrap();
        assert_eq!(
            first,
            store
                .save_attachment("one", "photo.png", b"image bytes")
                .unwrap()
        );
        let same = store
            .save_attachment("one", "renamed.png", b"image bytes")
            .unwrap();
        assert_ne!(same["attachmentId"], first["attachmentId"]);
        assert_eq!(same["path"], first["path"]);
        assert_eq!(
            store
                .query("SELECT * FROM attachment_blobs", [])
                .unwrap()
                .len(),
            1
        );
        assert_eq!(fs::read_dir(project).unwrap().count(), 0);
        let path = Path::new(s(&first, "path"));
        assert_eq!(
            store.read_attachment("two", path).unwrap_err().code,
            "WORKSPACE_FORBIDDEN"
        );
        drop(store);
        let store = Store::open(&directory.path().join("host.db")).unwrap();
        assert_eq!(
            store.read_attachment("one", path).unwrap().unwrap(),
            b"image bytes"
        );
        store.inherit_attachments("one", "two").unwrap();
        store.delete_session("one").unwrap();
        assert_eq!(
            store.read_attachment("two", path).unwrap().unwrap(),
            b"image bytes"
        );
        assert!(store.attachment_permission("two", path, true).unwrap());
        assert!(store.attachment_permission("two", path, false).is_err());
        assert!(store
            .attachment_permission("two", path.parent().unwrap(), true)
            .is_err());
        fs::write(path, b"tampered").unwrap();
        assert_eq!(
            store.read_attachment("two", path).unwrap_err().code,
            "CONTENT_CHANGED"
        );
    }

    #[test]
    fn references_respect_revoked_grants_and_retention_never_removes_live_content() {
        let (_, store, project, _) = setup();
        let saved = store.save_attachment("one", "notes.txt", b"keep").unwrap();
        let path = Path::new(s(&saved, "path"));
        let old = SystemTime::now() - Duration::from_secs(172800);
        fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(old))
            .unwrap();
        store
            .exec(
                "UPDATE attachment_blobs SET createdAt=?,orphanedAt=?",
                params![future(-172800), future(-172800)],
            )
            .unwrap();
        store.retain().unwrap();
        assert!(path.exists());
        store
            .exec(
                "UPDATE projects SET enabled=0 WHERE projectId=?",
                [&project],
            )
            .unwrap();
        assert!(store.read_attachment("one", path).is_err());
        store
            .exec(
                "UPDATE projects SET enabled=1 WHERE projectId=?",
                [&project],
            )
            .unwrap();
        store.delete_session("one").unwrap();
        store.retain_attachments().unwrap();
        assert!(
            path.exists(),
            "orphan grace starts at last-reference removal, not original upload"
        );
        store
            .exec(
                "UPDATE attachment_blobs SET orphanedAt=?",
                [future(-172800)],
            )
            .unwrap();
        store.retain_attachments().unwrap();
        assert!(!path.exists());
        assert!(store
            .query("SELECT * FROM attachment_blobs", [])
            .unwrap()
            .is_empty());
    }

    #[test]
    fn library_capacity_is_bounded_and_unknown_project_files_stay_legacy() {
        let (_, store, _, project) = setup();
        let legacy = project.join("existing.png");
        fs::write(&legacy, b"legacy").unwrap();
        assert!(store.read_attachment("one", &legacy).unwrap().is_none());
        store
            .exec(
                "INSERT INTO attachment_blobs(sha256,bytes,createdAt) VALUES(?,?,?)",
                params!["a".repeat(64), MAX_LIBRARY_BYTES, now()],
            )
            .unwrap();
        assert_eq!(
            store
                .save_attachment("one", "large.bin", b"new")
                .unwrap_err()
                .code,
            "ATTACHMENT_STORAGE_FULL"
        );
    }

    #[test]
    fn upgrades_existing_host_database_without_changing_protocol_or_session_identity() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("legacy.db");
        let old = rusqlite::Connection::open(&database).unwrap();
        old.execute_batch(
            include_str!("schema.sql")
                .split("-- Host-owned")
                .next()
                .unwrap(),
        )
        .unwrap();
        old.execute("INSERT INTO meta VALUES('hostId','original-host')", [])
            .unwrap();
        drop(old);
        let store = Store::open(&database).unwrap();
        assert_eq!(
            store.meta("hostId").unwrap().as_deref(),
            Some("original-host")
        );
        assert_eq!(
            store
                .query("SELECT MAX(version) AS version FROM migrations", [])
                .unwrap()[0]["version"],
            7
        );
        assert!(store
            .query("SELECT * FROM attachment_refs", [])
            .unwrap()
            .is_empty());
        store.retain().unwrap();
        assert!(
            !directory.path().join("attachments").exists(),
            "no upload means no library directory"
        );
    }

    #[cfg(unix)]
    #[test]
    fn redirected_objects_and_library_are_rejected() {
        let (directory, store, _, _) = setup();
        let saved = store.save_attachment("one", "notes", b"data").unwrap();
        let target = Path::new(s(&saved, "path"));
        let outside = directory.path().join("outside");
        fs::rename(target, &outside).unwrap();
        std::os::unix::fs::symlink(&outside, target).unwrap();
        assert!(store.read_attachment("one", target).is_err());
        let library = target.parent().unwrap();
        let renamed = directory.path().join("previous-library");
        fs::rename(library, &renamed).unwrap();
        std::os::unix::fs::symlink(&renamed, library).unwrap();
        assert!(store.save_attachment("one", "notes", b"more").is_err());
    }
}
