use std::{ffi::OsStr, os::windows::ffi::OsStrExt, path::Path};

/// Windows command-line quoting shared by detached launch and the HKCU Run entry.
pub(super) fn command(exe: &OsStr, directory: &Path) -> Vec<u16> {
    let mut line = quote(exe);
    line.extend(" --host-supervisor --data-dir ".encode_utf16());
    line.extend(quote(directory.as_os_str()));
    line.push(0);
    line
}

fn quote(value: &OsStr) -> Vec<u16> {
    let mut out = vec![b'"' as u16];
    let mut slashes = 0;
    for unit in value.encode_wide() {
        if unit == b'\\' as u16 {
            slashes += 1;
            continue;
        }
        out.extend(std::iter::repeat_n(
            b'\\' as u16,
            if unit == b'"' as u16 {
                slashes * 2 + 1
            } else {
                slashes
            },
        ));
        out.push(unit);
        slashes = 0;
    }
    out.extend(std::iter::repeat_n(b'\\' as u16, slashes * 2));
    out.push(b'"' as u16);
    out
}

fn command_line(exe: &OsStr, arguments: &[&OsStr]) -> Vec<u16> {
    let mut line = quote(exe);
    for argument in arguments {
        line.push(b' ' as u16);
        line.extend(quote(argument));
    }
    line.push(0);
    line
}

/// A PID alone can be stale or reused. Check a live process and its Windows
/// creation time before accepting a persisted runtime-owner readiness record.
pub(super) fn process_birth(pid: u32) -> Option<u64> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, FILETIME, WAIT_TIMEOUT},
        System::Threading::*,
    };
    unsafe {
        let handle = OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
            0,
            pid,
        );
        if handle.is_null() {
            return None;
        }
        let mut created: FILETIME = std::mem::zeroed();
        let mut exited: FILETIME = std::mem::zeroed();
        let mut kernel: FILETIME = std::mem::zeroed();
        let mut user: FILETIME = std::mem::zeroed();
        let live = WaitForSingleObject(handle, 0) == WAIT_TIMEOUT;
        let read = GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user) != 0;
        CloseHandle(handle);
        (live && read)
            .then_some((u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime))
    }
}

/// Do not inherit CLI capture pipes. Preserve Command's configured environment,
/// including removals and Windows' case-insensitive variable identities.
pub(super) fn spawn_detached(
    command: &std::process::Command,
    arguments: &[&OsStr],
) -> crate::Result<u32> {
    use windows_sys::Win32::{Foundation::CloseHandle, System::Threading::*};
    let mut values = std::collections::BTreeMap::new();
    for (key, value) in std::env::vars_os() {
        values.insert(key.to_string_lossy().to_uppercase(), (key, value));
    }
    for (key, value) in command.get_envs() {
        let identity = key.to_string_lossy().to_uppercase();
        match value {
            Some(value) => {
                values.insert(identity, (key.to_owned(), value.to_owned()));
            }
            None => {
                values.remove(&identity);
            }
        }
    }
    let mut environment: Vec<u16> = Vec::new();
    for (key, value) in values.values() {
        environment.extend(key.encode_wide());
        environment.push(b'=' as u16);
        environment.extend(value.encode_wide());
        environment.push(0);
    }
    environment.push(0);
    if environment.len() == 1 {
        environment.push(0);
    }
    let mut line = command_line(command.get_program(), arguments);
    let application: Vec<_> = command.get_program().encode_wide().chain(Some(0)).collect();
    let cwd: Option<Vec<_>> = command
        .get_current_dir()
        .map(|path| path.as_os_str().encode_wide().chain(Some(0)).collect());
    unsafe {
        let mut startup: STARTUPINFOW = std::mem::zeroed();
        startup.cb = std::mem::size_of_val(&startup) as u32;
        let mut process: PROCESS_INFORMATION = std::mem::zeroed();
        crate::ensure(
            CreateProcessW(
                application.as_ptr(),
                line.as_mut_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_UNICODE_ENVIRONMENT,
                environment.as_ptr().cast(),
                cwd.as_ref().map_or(std::ptr::null(), |v| v.as_ptr()),
                &startup,
                &mut process,
            ) != 0,
            "HOST_START_FAILED",
            "Cannot launch independent background supervisor",
        )?;
        let pid = process.dwProcessId;
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
        Ok(pid)
    }
}
