use crate::{ensure, now, s, store::Store, uid, Result};
use serde_json::{json, Value};
use std::{
    fs::File,
    path::{Component, Path, PathBuf},
};
// Reserved internal scope, never a caller-supplied filesystem authorization.
pub const CHAT_PROJECT: &str = "agentdeck-chat";

pub(crate) fn chat_workspace(store: &Store) -> Result<Value> {
    let path = store.state_directory.join("chat-workspace");
    if store
        .query(
            "SELECT projectId FROM projects WHERE projectId=?",
            [CHAT_PROJECT],
        )?
        .len()
        == 1
    {
        let root = root(store, CHAT_PROJECT)?;
        ensure(
            equal(&path, &root),
            "WORKSPACE_FORBIDDEN",
            "Unexpected chat directory",
        )?;
        return store.project(CHAT_PROJECT);
    }
    std::fs::create_dir_all(&path)?;
    let root = canonical(&path)?;
    ensure(
        equal(&path, &root),
        "WORKSPACE_FORBIDDEN",
        "Chat directory must not be redirected",
    )?;
    let identity = identity(&open_directory(&root)?)?;
    if let Ok(project) = store.project(CHAT_PROJECT) {
        ensure(
            s(&project, "canonicalPath") == root.to_string_lossy()
                && s(&project, "identity") == identity,
            "WORKSPACE_FORBIDDEN",
            "Chat directory changed",
        )?;
    } else {
        store.exec(
            "INSERT OR IGNORE INTO projects VALUES(?,?,?,?,1,?)",
            rusqlite::params![
                CHAT_PROJECT,
                "普通聊天",
                root.to_string_lossy(),
                identity,
                now()
            ],
        )?;
    }
    let project = store.project(CHAT_PROJECT)?;
    ensure(
        equal(&path, &self::root(store, CHAT_PROJECT)?),
        "WORKSPACE_FORBIDDEN",
        "Unexpected chat directory",
    )?;
    Ok(project)
}
pub fn valid(path: &Path) -> Result<()> {
    let t = path.to_string_lossy();
    ensure(
        path.is_absolute() && !t.contains('\0'),
        "WORKSPACE_FORBIDDEN",
        "Absolute local path required",
    )?;
    #[cfg(windows)]
    {
        let b = t.as_bytes();
        ensure(
            b.len() >= 3
                && b[0].is_ascii_alphabetic()
                && b[1] == b':'
                && b"/\\".contains(&b[2])
                && !t[2..].contains(':'),
            "WORKSPACE_FORBIDDEN",
            "UNC, device and alternate streams forbidden",
        )?;
    }
    Ok(())
}
pub fn canonical(path: &Path) -> Result<PathBuf> {
    let path = dunce::canonicalize(path)?;
    valid(&path)?;
    Ok(path)
}
pub fn equal(a: &Path, b: &Path) -> bool {
    #[cfg(windows)]
    {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}
pub fn within(root: &Path, target: &Path) -> bool {
    #[cfg(windows)]
    {
        let a = root.to_string_lossy().replace('/', "\\").to_lowercase();
        let b = target.to_string_lossy().replace('/', "\\").to_lowercase();
        b == a || b.starts_with(&(a.trim_end_matches('\\').to_owned() + "\\"))
    }
    #[cfg(not(windows))]
    {
        target.starts_with(root)
    }
}
pub fn identity(file: &File) -> Result<String> {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::*;
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        let ok = unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) };
        ensure(
            ok != 0,
            "WORKSPACE_FORBIDDEN",
            "Cannot verify folder identity",
        )?;
        let ino = ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64;
        Ok(format!("{}:{}", info.dwVolumeSerialNumber, ino))
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::MetadataExt;
        let m = file.metadata()?;
        Ok(format!("{}:{}", m.dev(), m.ino()))
    }
}
pub fn open_directory(path: &Path) -> Result<File> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x02000000);
    }
    Ok(options.open(path)?)
}
/// Verify the opened handle after path validation to close a junction-swap race.
pub fn opened_path(file: &File) -> Result<PathBuf> {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;
        let mut buffer = vec![0u16; 32768];
        let length = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle() as _,
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                0,
            )
        } as usize;
        ensure(
            length > 0 && length < buffer.len(),
            "WORKSPACE_FORBIDDEN",
            "Cannot verify opened file path",
        )?;
        let path = PathBuf::from(String::from_utf16_lossy(&buffer[..length]));
        let path = dunce::simplified(&path).to_path_buf();
        valid(&path)?;
        Ok(path)
    }
    #[cfg(target_os = "linux")]
    {
        use std::os::fd::AsRawFd;
        let path = std::fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd()))?;
        valid(&path)?;
        // A deleted/replaced inode must never authorize its former pathname.
        ensure(
            identity(file)? == identity(&File::open(&path)?)?,
            "WORKSPACE_FORBIDDEN",
            "Opened file changed",
        )?;
        Ok(path)
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = file;
        Err(crate::Error::new(
            "UNSUPPORTED_PLATFORM",
            "Opened handle validation is unavailable on this platform",
        ))
    }
}
pub fn add_local(store: &Store, path: &Path) -> Result<Value> {
    valid(path)?;
    let root = canonical(path)?;
    ensure(
        root.is_dir() && root.parent().is_some(),
        "WORKSPACE_FORBIDDEN",
        "Choose a project directory",
    )?;
    let identity = identity(&open_directory(&root)?)?;
    let name = root
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let path = root.to_string_lossy().into_owned();
    let existing = store.query(
        if cfg!(windows) {
            "SELECT projectId FROM projects WHERE canonicalPath=? COLLATE NOCASE"
        } else {
            "SELECT projectId FROM projects WHERE canonicalPath=?"
        },
        [&path],
    )?;
    let id = existing
        .first()
        .map(|v| s(v, "projectId").to_owned())
        .unwrap_or_else(|| uid("project"));
    if existing.is_empty() {
        store.exec(
            "INSERT INTO projects VALUES(?,?,?,?,1,?)",
            rusqlite::params![id, name, path, identity, now()],
        )?;
    } else {
        store.exec(
            "UPDATE projects SET identity=?,enabled=1 WHERE projectId=?",
            [identity, id.clone()],
        )?;
    }
    store.append("projects.updated", json!({}), None, None)?;
    Ok(store
        .projects()?
        .into_iter()
        .find(|v| v["projectId"] == id)
        .unwrap())
}
pub fn root(store: &Store, id: &str) -> Result<PathBuf> {
    let project = store.project(id)?;
    let path = Path::new(s(&project, "canonicalPath"));
    let current = canonical(path)?;
    ensure(
        equal(path, &current)
            && current.is_dir()
            && identity(&open_directory(&current)?)? == s(&project, "identity"),
        "WORKSPACE_FORBIDDEN",
        "Folder changed; reauthorize locally",
    )?;
    Ok(current)
}
pub fn file(store: &Store, id: &str, relative: &str) -> Result<PathBuf> {
    let root = root(store, id)?;
    checked_file(&root, relative)
}
pub fn checked_file(root: &Path, relative: &str) -> Result<PathBuf> {
    ensure(
        !relative.is_empty()
            && !relative.contains(['\0', ':'])
            && !relative.starts_with(['\\', '/']),
        "WORKSPACE_FORBIDDEN",
        "Invalid relative path",
    )?;
    let relative = relative.replace('\\', "/");
    let mut target = root.to_path_buf();
    for c in Path::new(&relative).components() {
        match c {
            Component::Normal(c) => target.push(c),
            Component::CurDir => {}
            _ => {
                return Err(crate::Error::new(
                    "WORKSPACE_FORBIDDEN",
                    "Path traversal forbidden",
                ))
            }
        }
        if target.try_exists()? {
            ensure(
                within(root, &canonical(&target)?),
                "WORKSPACE_FORBIDDEN",
                "Link leaves authorized workspace",
            )?;
        }
    }
    ensure(
        within(root, &target),
        "WORKSPACE_FORBIDDEN",
        "Path leaves authorized workspace",
    )?;
    Ok(target)
}
pub fn remove_local(store: &Store, id: &str) -> Result<()> {
    store.project(id)?;
    let active=store.query("SELECT t.turnId FROM turns t JOIN sessions s ON t.sessionId=s.sessionId WHERE s.projectId=? AND t.status IN ('queued','running','waitingApproval','unknown')",[id])?;
    ensure(
        active.is_empty(),
        "CONFLICT",
        "Interrupt or reconcile tasks first",
    )?;
    store.exec("UPDATE projects SET enabled=0 WHERE projectId=?", [id])?;
    store.append("projects.updated", json!({}), None, None)?;
    Ok(())
}

#[cfg(all(test, target_os = "linux"))]
mod linux_tests {
    use super::*;
    #[test]
    fn case_sensitive_grants_and_opened_inode_validation() {
        let directory = tempfile::tempdir().unwrap();
        let upper = directory.path().join("Project");
        let lower = directory.path().join("project");
        std::fs::create_dir(&upper).unwrap();
        std::fs::create_dir(&lower).unwrap();
        let store = Store::open(&directory.path().join("state.db")).unwrap();
        let a = add_local(&store, &upper).unwrap();
        let b = add_local(&store, &lower).unwrap();
        assert_ne!(a["projectId"], b["projectId"]);
        assert!(!equal(&upper, &lower));
        assert!(!within(&upper, &lower.join("secret")));
        std::os::unix::fs::symlink(&lower, upper.join("escape")).unwrap();
        assert!(checked_file(&upper, "escape/secret").is_err());
        let file = upper.join("data");
        std::fs::write(&file, "old").unwrap();
        let opened = File::open(&file).unwrap();
        assert_eq!(opened_path(&opened).unwrap(), file);
        std::fs::rename(&file, lower.join("moved")).unwrap();
        assert!(!within(&upper, &opened_path(&opened).unwrap()));
        std::fs::remove_file(lower.join("moved")).unwrap();
        assert!(opened_path(&opened).is_err());
    }
}
