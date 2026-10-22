#[cfg(windows)]
mod windows {
    use windows_sys::Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS},
        System::Registry::{
            RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ,
            RRF_RT_REG_SZ,
        },
    };

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }

    fn command() -> Result<Vec<u16>, String> {
        use std::os::windows::ffi::OsStrExt;
        let path = std::env::current_exe().map_err(|e| format!("无法读取程序路径：{e}"))?;
        let mut value = vec![b'"' as u16];
        value.extend(path.as_os_str().encode_wide());
        value.extend([b'"' as u16, 0]);
        Ok(value)
    }

    const KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";

    pub fn enabled() -> Result<bool, String> {
        let mut buffer = vec![0u16; 32768];
        let mut size = (buffer.len() * 2) as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                wide(KEY).as_ptr(),
                wide("AgentDeck").as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                buffer.as_mut_ptr().cast(),
                &mut size,
            )
        };
        if status == ERROR_FILE_NOT_FOUND {
            return Ok(false);
        }
        if status != ERROR_SUCCESS {
            return Err(format!("无法读取开机自启动设置（Windows 错误 {status}）"));
        }
        buffer.truncate(size as usize / 2);
        Ok(buffer == command()?)
    }

    pub fn set(enabled: bool) -> Result<bool, String> {
        let status = if enabled {
            let value = command()?;
            unsafe {
                RegSetKeyValueW(
                    HKEY_CURRENT_USER,
                    wide(KEY).as_ptr(),
                    wide("AgentDeck").as_ptr(),
                    REG_SZ,
                    value.as_ptr().cast(),
                    (value.len() * 2) as u32,
                )
            }
        } else {
            unsafe {
                RegDeleteKeyValueW(
                    HKEY_CURRENT_USER,
                    wide(KEY).as_ptr(),
                    wide("AgentDeck").as_ptr(),
                )
            }
        };
        if status != ERROR_SUCCESS && !(!enabled && status == ERROR_FILE_NOT_FOUND) {
            return Err(format!("无法保存开机自启动设置（Windows 错误 {status}）"));
        }
        self::enabled()
    }
}

#[tauri::command]
pub fn autostart_enabled() -> Result<bool, String> {
    #[cfg(windows)]
    {
        windows::enabled()
    }
    #[cfg(not(windows))]
    {
        Err("开机自启动仅支持 Windows".into())
    }
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        windows::set(enabled)
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("开机自启动仅支持 Windows".into())
    }
}
