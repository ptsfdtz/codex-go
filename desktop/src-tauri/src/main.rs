#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod autostart;
mod host;
use host::{Action, Host, View};
use std::{fs::OpenOptions, io::Write, path::PathBuf, process::Command, sync::Arc};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State,
};

/// Tray creation can be denied by the Windows shell in restricted sessions.
/// Keep the main window usable instead of aborting startup, and only hide to
/// tray when one actually exists.
struct TrayAvailable(bool);

#[tauri::command]
fn host_snapshot(host: State<'_, Arc<Host>>) -> View {
    host.snapshot()
}
#[tauri::command]
async fn host_action(
    host: State<'_, Arc<Host>>,
    action: Action,
) -> Result<serde_json::Value, String> {
    let host = Arc::clone(&host);
    tauri::async_runtime::spawn_blocking(move || host.action(action))
        .await
        .map_err(|_| "本机操作意外中断".to_owned())?
}
#[tauri::command]
async fn host_restart(app: tauri::AppHandle, host: State<'_, Arc<Host>>) -> Result<(), String> {
    let host = Arc::clone(&host);
    let runtime = runtime(&app);
    tauri::async_runtime::spawn_blocking(move || host.restart(runtime))
        .await
        .map_err(|_| "本机服务重新检测意外中断".to_owned())?
}
#[tauri::command]
async fn install_supported_codex(
    app: tauri::AppHandle,
    host: State<'_, Arc<Host>>,
) -> Result<String, String> {
    let host = Arc::clone(&host);
    let runtime = runtime(&app);
    tauri::async_runtime::spawn_blocking(move || {
        let script_path = std::env::temp_dir().join(format!(
            "agentdeck-install-codex-{}-{}.ps1",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "无法创建临时安装脚本".to_owned())?
                .as_nanos()
        ));
        let mut script = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&script_path)
            .map_err(|_| "无法准备 Codex CLI 安装脚本".to_owned())?;
        script
            .write_all(include_bytes!(
                "../../../scripts/desktop/install-supported-codex.ps1"
            ))
            .map_err(|_| "无法写入 Codex CLI 安装脚本".to_owned())?;
        drop(script);

        let powershell = std::env::var_os("SystemRoot")
            .map(|root| PathBuf::from(root).join("System32/WindowsPowerShell/v1.0/powershell.exe"))
            .unwrap_or_else(|| PathBuf::from("powershell.exe"));
        let mut command = Command::new(powershell);
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(&script_path);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let output = command
            .output()
            .map_err(|_| "无法启动 Windows PowerShell 安装 Codex CLI".to_owned());
        let _ = std::fs::remove_file(&script_path);
        let output = output?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            return Err(if detail.is_empty() {
                "Codex CLI 安装失败，请检查网络连接后重试。".into()
            } else {
                format!("Codex CLI 安装失败：{detail}")
            });
        }

        let detail = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        host.restart(runtime)?;
        Ok(detail)
    })
    .await
    .map_err(|_| "Codex CLI 安装意外中断".to_owned())?
}
#[tauri::command]
async fn pick_project(host: State<'_, Arc<Host>>) -> Result<Option<serde_json::Value>, String> {
    let host = Arc::clone(&host);
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(path) = rfd::FileDialog::new()
            .set_title("选择允许平板访问的项目目录")
            .pick_folder()
        {
            host.add_folder(path).map(Some)
        } else {
            Ok(None)
        }
    })
    .await
    .map_err(|_| "目录选择器意外关闭".to_owned())?
}
#[tauri::command]
async fn quit_app(app: tauri::AppHandle, host: State<'_, Arc<Host>>) -> Result<(), String> {
    let host = Arc::clone(&host);
    tauri::async_runtime::spawn_blocking(move || host.shutdown())
        .await
        .map_err(|_| "服务退出失败".to_owned())?;
    app.exit(0);
    Ok(())
}
fn runtime(app: &tauri::AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        std::env::var_os("AGENTDECK_RUNTIME_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/native-runtime")
            })
    } else {
        app.path()
            .resource_dir()
            .expect("resource directory")
            .join("runtime")
    }
}
fn reveal(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
fn main() {
    let builder = tauri::Builder::default();
    // The installed release must not absorb the isolated development window.
    // Dev launches are already serialized by Vite's strict port and the data lock.
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| reveal(app)));
    builder
        .invoke_handler(tauri::generate_handler![
            autostart::autostart_enabled,
            autostart::set_autostart,
            host_snapshot,
            host_action,
            host_restart,
            install_supported_codex,
            pick_project,
            quit_app
        ])
        .setup(|app| {
            let requested_webview_dir =
                std::env::var_os("AGENTDECK_WEBVIEW_DATA_DIR").map(PathBuf::from);
            let mut webview_dir = requested_webview_dir
                .clone()
                .or_else(|| {
                    std::env::var_os("LOCALAPPDATA")
                        .map(|path| PathBuf::from(path).join("AgentDeck").join("WebView2"))
                })
                .unwrap_or_else(|| std::env::temp_dir().join("AgentDeck-WebView2"));
            if std::fs::create_dir_all(&webview_dir).is_err() {
                if requested_webview_dir.is_some() {
                    return Err(std::io::Error::other(format!(
                        "无法创建 WebView2 数据目录 {}",
                        webview_dir.display()
                    ))
                    .into());
                }
                webview_dir = std::env::temp_dir().join("AgentDeck-WebView2");
                std::fs::create_dir_all(&webview_dir).map_err(|error| {
                    std::io::Error::other(format!(
                        "无法创建 WebView2 数据目录 {}: {error}",
                        webview_dir.display()
                    ))
                })?;
                eprintln!(
                    "AgentDeck: LOCALAPPDATA is not writable, using {} for WebView2",
                    webview_dir.display()
                );
            }
            let window_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .cloned()
                .ok_or_else(|| std::io::Error::other("安装配置缺少主窗口"))?;
            tauri::WebviewWindowBuilder::from_config(app.handle(), &window_config)
                .map_err(|error| std::io::Error::other(format!("无法读取主窗口配置: {error}")))?
                .data_directory(webview_dir)
                .build()
                .map_err(|error| std::io::Error::other(format!("无法创建应用窗口: {error}")))?;
            let host = Host::new(app.handle().clone());
            app.manage(Arc::clone(&host));
            let root = runtime(app.handle());
            std::thread::spawn(move || {
                if let Err(e) = host.start(root) {
                    eprintln!("AgentDeck service failed to start: {e}");
                    host.error(e);
                }
            });
            let tray = (|| -> tauri::Result<()> {
                eprintln!("AgentDeck: creating tray menu");
                let show = MenuItem::with_id(app, "show", "打开 AgentDeck", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "停止并退出", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &quit])?;
                eprintln!("AgentDeck: creating tray icon");
                TrayIconBuilder::new()
                    .icon(app.default_window_icon().expect("application icon").clone())
                    .tooltip("AgentDeck · 平板工作区")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_tray_icon_event(|tray, event| {
                        if matches!(
                            event,
                            TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Up,
                                ..
                            }
                        ) {
                            reveal(tray.app_handle());
                        }
                    })
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => reveal(app),
                        "quit" => {
                            let app = app.clone();
                            std::thread::spawn(move || {
                                app.state::<Arc<Host>>().shutdown();
                                app.exit(0);
                            });
                        }
                        _ => {}
                    })
                    .build(app)?;
                Ok(())
            })();
            if let Err(error) = &tray {
                eprintln!("AgentDeck tray unavailable, continuing without it: {error}");
            }
            app.manage(TrayAvailable(tray.is_ok()));
            eprintln!("AgentDeck: setup complete");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let has_tray = window
                    .app_handle()
                    .try_state::<TrayAvailable>()
                    .map(|state| state.0)
                    .unwrap_or(false);
                if has_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("AgentDeck initialization failed")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<Arc<Host>>().shutdown();
            }
        });
}
