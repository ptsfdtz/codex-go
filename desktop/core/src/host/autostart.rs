use super::data_dir;
#[cfg(not(windows))]
use crate::Error;
use crate::{ensure, Result};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::process::Command;

pub fn configure(action: &str) -> Result<String> {
    ensure(
        ["enable", "disable", "status"].contains(&action),
        "INVALID_ARGUMENT",
        "Use autostart enable/disable/status",
    )?;
    #[cfg(windows)]
    {
        windows(action)
    }
    #[cfg(target_os = "linux")]
    {
        let unit_dir = std::env::var_os("XDG_CONFIG_HOME")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|p| std::path::PathBuf::from(p).join(".config"))
            })
            .ok_or_else(|| {
                Error::new("CONFIG_ERROR", "Cannot locate user configuration directory")
            })?
            .join("systemd/user");
        if action == "enable" {
            std::fs::create_dir_all(&unit_dir)?;
            let quote = |p: &std::path::Path| {
                p.to_string_lossy()
                    .replace('\\', "\\\\")
                    .replace('"', "\\\"")
                    .replace('%', "%%")
            };
            let unit = include_str!("../../systemd/agentdeck.service")
                .replace(
                    "ExecStart=%h/.local/bin/agentdeck host-run",
                    &format!(
                        "ExecStart=\"{}\" host-run",
                        quote(&std::env::current_exe()?)
                    ),
                )
                .replace(
                    "Environment=AGENTDECK_DATA_DIR=%h/.local/state/agentdeck",
                    &format!("Environment=\"AGENTDECK_DATA_DIR={}\"", quote(&data_dir()?)),
                )
                .replace(
                    "ReadWritePaths=%h/.local/state/agentdeck",
                    &format!("ReadWritePaths=\"{}\"", quote(&data_dir()?)),
                );
            std::fs::write(unit_dir.join("agentdeck.service"), unit)?;
            run(&["daemon-reload"])?;
            run(&["enable", "agentdeck.service"])?;
            return Ok("enabled (user session; boot before login requires administrator-configured lingering)".into());
        }
        if action == "disable" {
            run(&["disable", "agentdeck.service"])?;
            return Ok("disabled".into());
        }
        let output = Command::new("systemctl")
            .args(["--user", "is-enabled", "agentdeck.service"])
            .output()?;
        Ok(if output.status.success() {
            "enabled"
        } else {
            "disabled"
        }
        .into())
    }
    #[cfg(target_os = "macos")]
    {
        macos(action)
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    Err(Error::new(
        "UNSUPPORTED_PLATFORM",
        "Autostart supports Windows, Linux and macOS",
    ))
}

#[cfg(target_os = "macos")]
const MACOS_LABEL: &str = "top.ptsfdtz.agentdeck";

#[cfg(target_os = "macos")]
fn macos(action: &str) -> Result<String> {
    use std::{io::Write, path::PathBuf};
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| Error::new("CONFIG_ERROR", "Cannot locate home directory"))?;
    let directory = home.join("Library/LaunchAgents");
    let plist = directory.join(format!("{MACOS_LABEL}.plist"));
    let domain = format!("gui/{}", unsafe { libc::getuid() });
    let target = format!("{domain}/{MACOS_LABEL}");
    if action == "enable" {
        let executable = std::env::current_exe()?;
        let data = data_dir()?;
        let path = std::env::var("PATH").unwrap_or_else(|_| {
            "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin".into()
        });
        std::fs::create_dir_all(&directory)?;
        let body = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
             <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
             <plist version=\"1.0\">\n\
             <dict>\n\
             <key>Label</key><string>{}</string>\n\
             <key>ProgramArguments</key><array><string>{}</string><string>host-run</string></array>\n\
             <key>EnvironmentVariables</key><dict><key>AGENTDECK_DATA_DIR</key><string>{}</string><key>PATH</key><string>{}</string></dict>\n\
             <key>RunAtLoad</key><true/>\n\
             <key>ProcessType</key><string>Background</string>\n\
             </dict>\n\
             </plist>\n",
            xml(MACOS_LABEL),
            xml(&executable.to_string_lossy()),
            xml(&data.to_string_lossy()),
            xml(&path),
        );
        let mut temporary = tempfile::NamedTempFile::new_in(&directory)?;
        temporary.write_all(body.as_bytes())?;
        {
            use std::os::unix::fs::PermissionsExt;
            temporary
                .as_file()
                .set_permissions(std::fs::Permissions::from_mode(0o644))?;
        }
        let _ = Command::new("launchctl")
            .args(["bootout", &target])
            .output();
        temporary
            .persist(&plist)
            .map_err(|_| Error::new("AUTOSTART_FAILED", "Cannot save LaunchAgent"))?;
        let _ = Command::new("launchctl").args(["enable", &target]).output();
        let output = Command::new("launchctl")
            .args(["bootstrap", &domain])
            .arg(&plist)
            .output()?;
        ensure(
            output.status.success(),
            "AUTOSTART_FAILED",
            &format!(
                "launchctl bootstrap failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        )?;
        return Ok("enabled (starts after user login)".into());
    }
    if action == "disable" {
        let _ = Command::new("launchctl")
            .args(["disable", &target])
            .output();
        let _ = std::fs::remove_file(&plist);
        return Ok("disabled".into());
    }
    let loaded = Command::new("launchctl")
        .args(["print", &target])
        .output()
        .is_ok_and(|output| output.status.success());
    Ok(if loaded && plist.is_file() {
        "enabled"
    } else {
        "disabled"
    }
    .into())
}

#[cfg(target_os = "macos")]
fn xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(windows)]
fn windows(action: &str) -> Result<String> {
    use windows_sys::Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS},
        System::Registry::*,
    };
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let key = wide("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    let name =
        wide(&std::env::var("AGENTDECK_AUTOSTART_NAME").unwrap_or_else(|_| "AgentDeck".into()));
    let exe = std::env::current_exe()?
        .parent()
        .unwrap()
        .join("agentdeck-service.exe");
    let expected = super::windows_command(exe.as_os_str(), &data_dir()?);
    if action == "enable" {
        let mut opened = std::ptr::null_mut();
        let result = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                0,
                std::ptr::null(),
                0,
                KEY_SET_VALUE,
                std::ptr::null(),
                &mut opened,
                std::ptr::null_mut(),
            )
        };
        ensure(
            result == ERROR_SUCCESS,
            "AUTOSTART_FAILED",
            "Cannot open the current user's logon startup key",
        )?;
        let result = unsafe {
            RegSetValueExW(
                opened,
                name.as_ptr(),
                0,
                REG_SZ,
                expected.as_ptr().cast(),
                (expected.len() * 2) as u32,
            )
        };
        unsafe {
            RegCloseKey(opened);
        }
        ensure(
            result == ERROR_SUCCESS,
            "AUTOSTART_FAILED",
            "Cannot save the current user's logon startup entry",
        )?;
        return Ok("enabled".into());
    }
    if action == "disable" {
        let result = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr()) };
        ensure(
            [ERROR_SUCCESS, ERROR_FILE_NOT_FOUND].contains(&result),
            "AUTOSTART_FAILED",
            "Cannot remove the logon startup entry",
        )?;
        return Ok("disabled".into());
    }
    let mut buffer = vec![0u16; 32768];
    let mut size = (buffer.len() * 2) as u32;
    let result = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut size,
        )
    };
    if result == ERROR_FILE_NOT_FOUND {
        return Ok("disabled".into());
    }
    ensure(
        result == ERROR_SUCCESS,
        "AUTOSTART_FAILED",
        "Cannot read the logon startup entry",
    )?;
    buffer.truncate(size as usize / 2);
    Ok(if buffer == expected {
        "enabled"
    } else {
        "enabled (different executable; run autostart enable to update)"
    }
    .into())
}
#[cfg(target_os = "linux")]
fn run(args: &[&str]) -> Result<()> {
    let output = Command::new("systemctl")
        .arg("--user")
        .args(args)
        .output()?;
    ensure(
        output.status.success(),
        "AUTOSTART_FAILED",
        "systemd user manager is unavailable; a user session is required",
    )
}
