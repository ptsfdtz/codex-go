//! Cross-platform command line entry point for the native AgentDeck host.
//! The long-running implementation remains in `agentdeck-service`; this
//! wrapper keeps login and foreground service startup usable without a GUI.
use agentdeck_service::management;
use serde_json::{json, Value};
use std::{env, path::PathBuf, process::Command};

fn usage() {
    eprintln!(
        "AgentDeck CLI\n\n  agentdeck login --origin https://cloud.example --username NAME\n  agentdeck serve --runtime-ws ws://127.0.0.1:4500 --runtime-token-file PATH [--protocol VERSION] [--sandbox-verified]\n  agentdeck status | stop\n  agentdeck projects list | add PATH | remove PROJECT_ID | sync\n  agentdeck pair create [--lan ADDRESS] | pending | approve REQUEST_ID CODE | reject REQUEST_ID\n  agentdeck devices list | revoke DEVICE_ID\n  agentdeck password\n  agentdeck logout [--unbind]\n"
    );
}

fn value(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].clone())
}

fn data_dir() -> PathBuf {
    if let Some(path) = env::var_os("AGENTDECK_DATA_DIR") {
        return PathBuf::from(path);
    }
    if let Some(path) = env::var_os("XDG_STATE_HOME") {
        return PathBuf::from(path).join("agentdeck");
    }
    if let Some(path) = env::var_os("HOME") {
        return PathBuf::from(path).join(".local/state/agentdeck");
    }
    PathBuf::from(".agentdeck")
}

fn service_binary() -> PathBuf {
    if let Some(path) = env::var_os("AGENTDECK_SERVICE_BIN") {
        return PathBuf::from(path);
    }
    env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(PathBuf::from))
        .map(|path| {
            path.join(if cfg!(windows) {
                "agentdeck-service.exe"
            } else {
                "agentdeck-service"
            })
        })
        .unwrap_or_else(|| PathBuf::from("agentdeck-service"))
}

fn spawn_service(extra: &[(&str, &str)]) -> std::io::Result<std::process::ExitStatus> {
    let data = data_dir();
    std::fs::create_dir_all(&data)?;
    let mut command = Command::new(service_binary());
    command.env("AGENTDECK_DATA_DIR", &data);
    for (key, value) in extra {
        command.env(key, value);
    }
    if extra.contains(&("AGENTDECK_HEADLESS", "1")) {
        command.stdin(std::process::Stdio::null());
        // systemd must supervise and signal the daemon itself, not a wrapper.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            return Err(command.exec());
        }
    }
    command.status()
}

async fn login(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let origin = value(args, "--origin").ok_or("--origin is required")?;
    let username = value(args, "--username").ok_or("--username is required")?;
    let password = match value(args, "--password") {
        Some(password) => password,
        None => rpassword::prompt_password("Cloud password: ")?,
    };
    if data_dir().join(management::ENDPOINT_FILE).is_file() {
        let result = management::call(
            &data_dir(),
            json!({"action":"cloud.login","origin":origin,"username":username,"password":password}),
        )
        .await?;
        println!("{}", serde_json::to_string_pretty(&result)?);
        return Ok(());
    }
    let data = data_dir();
    std::fs::create_dir_all(&data)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&data, std::fs::Permissions::from_mode(0o700))?;
    }
    let mut password_file = tempfile::NamedTempFile::new_in(&data)?;
    use std::io::Write;
    password_file.write_all(password.as_bytes())?;
    password_file.flush()?;
    let password_path = password_file.path().to_string_lossy().into_owned();
    let status = spawn_service(&[
        ("AGENTDECK_LOGIN_ONLY", "1"),
        ("AGENTDECK_CLOUD_ORIGIN", &origin),
        ("AGENTDECK_CLOUD_USERNAME", &username),
        ("AGENTDECK_CLOUD_PASSWORD_FILE", &password_path),
    ]);
    drop(password_file);
    let status = status?;
    if status.success() {
        println!("Cloud login saved in {}", data_dir().display());
        Ok(())
    } else {
        Err(format!("agentdeck-service exited with {status}").into())
    }
}

fn serve(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let endpoint = value(args, "--runtime-ws").ok_or("--runtime-ws is required")?;
    let token_file =
        value(args, "--runtime-token-file").ok_or("--runtime-token-file is required")?;
    let protocol = value(args, "--protocol")
        .or_else(|| env::var("AGENTDECK_RUNTIME_PROTOCOL_VERSION").ok())
        .unwrap_or_else(|| "0.159.2".into());
    let mut envs = vec![
        ("AGENTDECK_HEADLESS", "1"),
        ("AGENTDECK_RUNTIME_WS_URL", endpoint.as_str()),
        ("AGENTDECK_RUNTIME_TOKEN_FILE", token_file.as_str()),
        ("AGENTDECK_RUNTIME_PROTOCOL_VERSION", protocol.as_str()),
    ];
    if args.iter().any(|arg| arg == "--sandbox-verified") {
        envs.push(("AGENTDECK_LINUX_SANDBOX_VERIFIED", "1"));
    }
    let status = spawn_service(&envs)?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("agentdeck-service exited with {status}").into())
    }
}

async fn manage(args: &[String], command: &str) -> Result<(), Box<dyn std::error::Error>> {
    let operand = |index: usize| args.get(index).cloned().ok_or("Missing command argument");
    let action: Value = match command {
        "status" => json!({"action":"state"}),
        "stop" => json!({"action":"stop"}),
        "password" => {
            let old = rpassword::prompt_password("Current cloud password: ")?;
            let new = rpassword::prompt_password("New cloud password: ")?;
            let confirmation = rpassword::prompt_password("Confirm new password: ")?;
            if new != confirmation {
                return Err("Passwords do not match".into());
            }
            json!({"action":"cloud.password","oldPassword":old,"newPassword":new})
        }
        "logout" => json!({"action":"cloud.logout","unbind":args.iter().any(|v|v=="--unbind")}),
        "projects" => match operand(0)?.as_str() {
            "list" => json!({"action":"state"}),
            "add" => {
                let path = std::fs::canonicalize(operand(1)?)?;
                json!({"action":"project.add","path":path})
            }
            "remove" => json!({"action":"project.remove","projectId":operand(1)?}),
            "sync" => json!({"action":"workspaces.sync"}),
            _ => return Err("Use projects list/add/remove/sync".into()),
        },
        "pair" => match operand(0)?.as_str() {
            "create" => {
                let address = value(args, "--lan");
                json!({"action":"pair.invite","address":address.as_deref().unwrap_or("127.0.0.1"),"version":if address.is_some(){2}else{3}})
            }
            "pending" => json!({"action":"state"}),
            "approve" => {
                json!({"action":"pair.approve","requestId":operand(1)?,"code":operand(2)?})
            }
            "reject" => json!({"action":"pair.confirm","requestId":operand(1)?,"approve":false}),
            _ => return Err("Use pair create/pending/approve/reject".into()),
        },
        "devices" => match operand(0)?.as_str() {
            "list" => json!({"action":"state"}),
            "revoke" => json!({"action":"device.revoke","deviceId":operand(1)?}),
            _ => return Err("Use devices list/revoke".into()),
        },
        _ => return Err("Unsupported management command".into()),
    };
    let mut result = management::call(&data_dir(), action).await?;
    if matches!(args.first().map(String::as_str), Some("list" | "pending")) {
        result = result[match command {
            "projects" => "projects",
            "devices" => "devices",
            _ => "pairings",
        }]
        .take();
    }
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1).collect::<Vec<_>>();
    let command = args.first().cloned().unwrap_or_else(|| "help".into());
    if !args.is_empty() {
        args.remove(0);
    }
    match command.as_str() {
        "login" => login(&args).await,
        "serve" => serve(&args),
        "status" | "stop" | "projects" | "pair" | "devices" | "password" | "logout" => {
            manage(&args, &command).await
        }
        "help" | "--help" | "-h" => {
            usage();
            Ok(())
        }
        _ => {
            usage();
            Err(format!("unknown command: {command}").into())
        }
    }
}
