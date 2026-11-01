use agentdeck_service::i18n::{message, text};
// User-facing CLI for the persistent, headless AgentDeck host.
use agentdeck_service::{
    host::{self, Config},
    management,
};
use serde_json::{json, Value};
use std::io::Write;
type AnyResult<T> = Result<T, Box<dyn std::error::Error>>;

fn usage() {
    println!("{}", message("AgentDeck Host {}\n\n  --lang system | zh-CN | en (any command)\n\n  agentdeck login [--origin https://agent.ptsfdtz.top] --username NAME\n  agentdeck start | stop | restart | status [--json]\n  agentdeck serve [--runtime-ws URL --runtime-token-file PATH --protocol VERSION] [--sandbox-verified]\n  agentdeck configure [--runtime-ws URL --runtime-token-file PATH --protocol VERSION] [--codex-exe PATH|auto] [--sandbox-verified]\n  agentdeck update [--check] [--origin HTTPS_ORIGIN]\n  agentdeck update-channel stable | candidate X.Y.Z\n  agentdeck autostart enable | disable | status\n  agentdeck projects list | add PATH | remove PROJECT_ID | sync\n  agentdeck devices list | revoke DEVICE_ID\n  agentdeck approvals list | approve ID | reject ID | cancel ID\n  agentdeck password | logout [--unbind]\n  agentdeck codex-login [--device-auth]\n  agentdeck codex [THREAD_ID]\n  agentdeck desktop [ABSOLUTE_DESKTOP_EXE] [THREAD_ID]\n  agentdeck runtime-check [--codex-exe PATH]\n  agentdeck runtime-start | runtime-serve\n  agentdeck logs [--follow] | doctor\n\nCodex authentication is separate from the AgentDeck account.\n", &[("0", env!("CARGO_PKG_VERSION").to_string())]));
}
fn value(args: &[String], name: &str) -> AnyResult<Option<String>> {
    if let Some(index) = args.iter().position(|v| v == name) {
        return Ok(Some(
            args.get(index + 1)
                .filter(|v| !v.starts_with("--"))
                .ok_or_else(|| message("{name} requires a value", &[("name", name.to_string())]))?
                .clone(),
        ));
    }
    Ok(None)
}
fn flag(args: &[String], name: &str) -> bool {
    args.iter().any(|v| v == name)
}
fn print(value: &Value) -> AnyResult<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}
async fn state() -> AnyResult<Value> {
    management::call(&host::data_dir()?, json!({"action":"state"})).await
}
async fn ensure_host() -> AnyResult<()> {
    if state().await.is_ok() {
        return Ok(());
    }
    host::background()?;
    for _ in 0..100 {
        if state().await.is_ok() {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    Err(text("Host control is unavailable; run agentdeck logs / doctor. An existing GUI may need to be stopped first.").into())
}
fn configure(args: &[String]) -> AnyResult<()> {
    let _configuration = host::shared_runtime::configuration_guard()?;
    if host::running()? || host::shared_runtime::running()? {
        return Err(text("Stop the host and shared runtime owner before changing persistent runtime configuration").into());
    }
    let mut config = Config::load()?;
    if let Some(ws) = value(args, "--runtime-ws")? {
        config.runtime_ws = Some(ws);
    }
    if let Some(file) = value(args, "--runtime-token-file")? {
        config.runtime_token_file = Some(dunce::canonicalize(file)?);
    }
    if let Some(protocol) = value(args, "--protocol")? {
        config.protocol = Some(protocol);
    }
    if let Some(file) = value(args, "--codex-exe")? {
        config.codex_exe = if file == "auto" {
            None
        } else {
            Some(dunce::canonicalize(file)?)
        };
    }
    if flag(args, "--sandbox-verified") {
        config.sandbox_verified = true;
    }
    config.save()?;
    println!(
        "{}",
        message(
            "Host settings saved in {}",
            &[(
                "0",
                format!("{}", host::data_dir()?.join("host.json").display())
            )]
        )
    );
    Ok(())
}
async fn password(old: Option<String>) -> AnyResult<String> {
    let old = match old {
        Some(v) => v,
        None => rpassword::prompt_password(text("Current AgentDeck password: "))?,
    };
    let new = rpassword::prompt_password(text("New AgentDeck password: "))?;
    let confirmation = rpassword::prompt_password(text("Confirm new password: "))?;
    if new != confirmation {
        return Err(text("Passwords do not match").into());
    }
    management::call(
        &host::data_dir()?,
        json!({"action":"cloud.password","oldPassword":old,"newPassword":new}),
    )
    .await?;
    println!(
        "{}",
        message("Password changed. Login again with the new password.", &[])
    );
    Ok(new)
}
async fn login(args: &[String]) -> AnyResult<()> {
    if flag(args, "--password") {
        return Err(text("Passwords must be entered at the hidden terminal prompt").into());
    }
    let origin = value(args, "--origin")?.unwrap_or_else(|| "https://agent.ptsfdtz.top".into());
    agentdeck_service::cloud::validate_origin(&origin)?;
    let username = value(args, "--username")?.ok_or(text("--username is required"))?;
    ensure_host().await?;
    let secret = rpassword::prompt_password(text("AgentDeck password: "))?;
    management::call(
        &host::data_dir()?,
        json!({"action":"cloud.login","origin":origin,"username":username,"password":secret}),
    )
    .await?;
    if state().await?["cloud"]["mustChangePassword"] == true {
        println!(
            "{}",
            message("The temporary password must be changed.", &[])
        );
        let changed = password(Some(secret)).await?;
        management::call(
            &host::data_dir()?,
            json!({"action":"cloud.login","origin":origin,"username":username,"password":changed}),
        )
        .await?;
    }
    println!("{}", message("Signed in. Credentials and computer identity are saved.\nExisting Codex workspaces appear automatically in Web. Add another directory with agentdeck projects add PATH. Enable logon startup with agentdeck autostart enable.", &[]));
    Ok(())
}
async fn manage(command: &str, args: &[String]) -> AnyResult<()> {
    let operand = |index: usize| {
        args.get(index)
            .cloned()
            .ok_or(text("Missing command argument"))
    };
    let action = match command {
        "logout" => json!({"action":"cloud.logout","unbind":flag(args,"--unbind")}),
        "projects" => match operand(0)?.as_str() {
            "list" => json!({"action":"state"}),
            "add" => json!({"action":"project.add","path":dunce::canonicalize(operand(1)?)?}),
            "remove" => json!({"action":"project.remove","projectId":operand(1)?}),
            "sync" => json!({"action":"workspaces.sync"}),
            _ => return Err(text("Use projects list/add/remove/sync").into()),
        },
        "devices" => match operand(0)?.as_str() {
            "list" => json!({"action":"state"}),
            "revoke" => json!({"action":"device.revoke","deviceId":operand(1)?}),
            _ => return Err(text("Use devices list/revoke").into()),
        },
        "approvals" => {
            let decision = operand(0)?;
            if decision == "list" {
                json!({"action":"state"})
            } else {
                if !["approve", "reject", "cancel"].contains(&decision.as_str()) {
                    return Err(text("Use approvals list/approve/reject/cancel").into());
                }
                let id = operand(1)?;
                let snapshot = state().await?;
                let row = snapshot["approvals"]
                    .as_array()
                    .and_then(|rows| rows.iter().find(|row| row["approvalId"] == id))
                    .ok_or(text("Approval not found; inspect approvals list"))?;
                json!({"action":"approval.decide","approvalId":id,"sessionId":row["sessionId"],"turnId":row["turnId"],"decision":decision})
            }
        }
        // Legacy commands remain compatible but are omitted from account-login help.
        "pair" => match operand(0)?.as_str() {
            "pending" => json!({"action":"state"}),
            "create" => {
                let address = value(args, "--lan")?;
                json!({"action":"pair.invite","address":address.as_deref().unwrap_or("127.0.0.1"),"version":if address.is_some(){2}else{3}})
            }
            "approve" => {
                json!({"action":"pair.approve","requestId":operand(1)?,"code":operand(2)?})
            }
            "reject" => json!({"action":"pair.confirm","requestId":operand(1)?,"approve":false}),
            _ => return Err(text("Use pair create/pending/approve/reject").into()),
        },
        _ => return Err(text("Unsupported command").into()),
    };
    let mut result = management::call(&host::data_dir()?, action).await?;
    if matches!(args.first().map(String::as_str), Some("list" | "pending")) {
        result = result[match command {
            "projects" => "projects",
            "devices" => "devices",
            "approvals" => "approvals",
            _ => "pairings",
        }]
        .take();
    }
    print(&result)
}
async fn status(args: &[String]) -> AnyResult<()> {
    let snapshot = state().await;
    if flag(args, "--json") {
        return print(&match snapshot {
            Ok(mut s) => {
                s["running"] = json!(true);
                s["dataDir"] = json!(host::data_dir()?);
                s
            }
            Err(_) => {
                json!({"running":false,"supervisorRunning":host::running()?,"dataDir":host::data_dir()?})
            }
        });
    }
    match snapshot {
        Ok(s) => {
            println!(
                "{}",
                message(
                    "Host: running\nData: {}\nAccount: {}\nCloud: {}\nCodex: {}\nProjects: {}",
                    &[
                        ("0", format!("{}", host::data_dir()?.display())),
                        (
                            "1",
                            s["cloud"]["username"]
                                .as_str()
                                .filter(|v| !v.is_empty())
                                .map(str::to_owned)
                                .unwrap_or_else(|| text("not signed in"))
                                .to_string()
                        ),
                        (
                            "2",
                            (if s["cloud"]["online"] == true {
                                text("online")
                            } else {
                                text("offline")
                            })
                            .to_string()
                        ),
                        (
                            "3",
                            (if s["codexReady"] == true {
                                text("ready")
                            } else {
                                text("not ready")
                            })
                            .to_string()
                        ),
                        (
                            "4",
                            format!("{}", s["projects"].as_array().map_or(0, Vec::len))
                        )
                    ]
                )
            );
            if !s["runtimeError"].is_null() {
                print(&s["runtimeError"])?;
            }
        }
        Err(_) => println!(
            "{}",
            message(
                "Host: {}\nData: {}",
                &[
                    (
                        "0",
                        (if host::running()? {
                            text("starting or unavailable; inspect logs")
                        } else {
                            text("stopped")
                        })
                        .to_string()
                    ),
                    ("1", format!("{}", host::data_dir()?.display()))
                ]
            )
        ),
    }
    Ok(())
}
async fn logs(args: &[String]) -> AnyResult<()> {
    use std::io::{Read, Seek, SeekFrom};
    let path = host::data_dir()?.join("host.log");
    let mut offset = 0;
    loop {
        if let Ok(mut file) = std::fs::File::open(&path) {
            let len = file.metadata()?.len();
            if len < offset {
                offset = 0;
            }
            file.seek(SeekFrom::Start(offset))?;
            let mut content = String::new();
            file.read_to_string(&mut content)?;
            print!("{content}");
            std::io::stdout().flush()?;
            offset = len;
        } else if !flag(args, "--follow") {
            println!("{}", message("No host log yet.", &[]));
        }
        if !flag(args, "--follow") {
            break;
        }
        tokio::select! {_=tokio::signal::ctrl_c()=>break,_=tokio::time::sleep(std::time::Duration::from_secs(1))=>{}}
    }
    Ok(())
}
async fn run() -> AnyResult<()> {
    let mut args: Vec<_> = std::env::args().skip(1).collect();
    let language = value(&args, "--lang")?;
    agentdeck_service::i18n::initialize(language.as_deref())?;
    if let Some(index) = args.iter().position(|arg| arg == "--lang") {
        args.drain(index..=index + 1);
    }
    let (command, args) = match args.split_first() {
        Some((c, a)) => (c.as_str(), a),
        None => ("help", &[][..]),
    };
    match command {
        "--version" | "version" => {
            let release = std::env::current_exe()
                .ok()
                .and_then(|p| std::fs::read_to_string(p.parent()?.join("release.txt")).ok());
            if let Some(release) = release.filter(|v| host::updates::valid_version(v.trim())) {
                println!(
                    "{}",
                    message(
                        "AgentDeck Host {} (core {})",
                        &[
                            ("0", release.trim().to_string()),
                            ("1", env!("CARGO_PKG_VERSION").to_string())
                        ]
                    )
                );
            } else {
                println!(
                    "{}",
                    message(
                        "AgentDeck Host {} (development)",
                        &[("0", env!("CARGO_PKG_VERSION").to_string())]
                    )
                );
            }
            Ok(())
        }
        "help" | "--help" | "-h" => {
            usage();
            Ok(())
        }
        "login" => login(args).await,
        "update" => host::updates::run(flag(args, "--check"), value(args, "--origin")?).await,
        "update-channel" => host::updates::configure_channel(
            args.first().map(String::as_str).unwrap_or(""),
            args.get(1).map(String::as_str),
        ),
        "update-install-worker" | "update-activate-worker" => {
            let id = args.first().ok_or(text("Update job ID required"))?;
            host::update_job::worker(id, command == "update-activate-worker").await?;
            Ok(())
        }
        "start" => {
            ensure_host().await?;
            status(&[]).await
        }
        "stop" => {
            host::stop().await?;
            println!(
                "{}",
                message("Host stopped. Autostart setting retained.", &[])
            );
            Ok(())
        }
        "restart" => {
            host::stop().await?;
            ensure_host().await?;
            status(&[]).await
        }
        "status" => status(args).await,
        "configure" => configure(args),
        "desktop" => {
            if args.len() > 2 {
                return Err(
                    text("Use agentdeck desktop [ABSOLUTE_DESKTOP_EXE] [THREAD_ID]").into(),
                );
            }
            let executable = match args.first() {
                Some(path) => std::path::PathBuf::from(path),
                None => host::desktop_client::discover()?,
            };
            host::desktop_client::launch(&executable, args.get(1).map(String::as_str)).await?;
            println!("{}", message("Requested original Codex desktop startup against the official shared runtime; confirm the desktop opens successfully.", &[]));
            println!("{}", message("If startup reports PROXY_CONFIG_MISMATCH, redacted diagnostics are saved to {}", &[("0", format!("{}", host::data_dir()?
                    .join("desktop-startup-diagnostic.json")
                    .display()))]));
            Ok(())
        }
        "codex-login" => {
            if args.iter().any(|arg| arg != "--device-auth") {
                return Err(text("Use agentdeck codex-login [--device-auth]").into());
            }
            let config = Config::load()?;
            let executable =
                host::runtime_compatibility::official(config.codex_executable()).await?;
            let mut command = std::process::Command::new(executable);
            command.arg("login");
            if flag(args, "--device-auth") {
                command.arg("--device-auth");
            }
            if command.status()?.success() {
                Ok(())
            } else {
                Err(
                    text("Official Codex login did not complete; retry agentdeck codex-login")
                        .into(),
                )
            }
        }
        "codex" => {
            if args.len() > 1 {
                return Err(text("Use agentdeck codex [THREAD_ID]").into());
            }
            host::shared_runtime::background().await?;
            let config = Config::load()?;
            let target = config.runtime_target()?;
            let executable = config.codex_executable()?;
            let mut client =
                host::codex_client::command(&executable, target, args.first().map(String::as_str))
                    .await?;
            let status = client.status()?;
            if status.success() {
                Ok(())
            } else {
                Err(text(
                    "Codex terminal exited unsuccessfully; no independent runtime was started",
                )
                .into())
            }
        }
        "serve" => {
            if !args.is_empty() {
                configure(args)?;
            }
            let mut command = host::service_command()?;
            command
                .env("AGENTDECK_HEADLESS", "1")
                .stdin(std::process::Stdio::null());
            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                Err(command.exec().into())
            }
            #[cfg(not(unix))]
            {
                if command.status()?.success() {
                    Ok(())
                } else {
                    Err(text("Service failed; inspect logs").into())
                }
            }
        }
        "runtime-start" if args.is_empty() => {
            host::shared_runtime::background().await?;
            println!(
                "{}",
                message(
                    "Shared native runtime ready. Host and client exits do not stop it.",
                    &[]
                )
            );
            Ok(())
        }
        "runtime-serve" if args.is_empty() => {
            host::shared_runtime::supervise().await?;
            Ok(())
        }
        "host-run" => {
            host::supervise().await?;
            Ok(())
        }
        "autostart" => {
            println!(
                "{}",
                host::autostart::configure(args.first().map(String::as_str).unwrap_or("status"))?
            );
            Ok(())
        }
        "password" => {
            ensure_host().await?;
            password(None).await.map(|_| ())
        }
        "logout" | "projects" | "devices" | "approvals" | "pair" => {
            ensure_host().await?;
            manage(command, args).await
        }
        "logs" => logs(args).await,
        "runtime-check" => {
            let executable = value(args, "--codex-exe")?
                .map(std::path::PathBuf::from)
                .map(Ok)
                .unwrap_or_else(|| Config::load()?.codex_executable());
            let service = host::service_command()?.get_program().to_owned();
            let (selected, report) =
                host::runtime_compatibility::resolve(executable, std::path::Path::new(&service))
                    .await?;
            print(
                &json!({"executable":selected,"version":agentdeck_service::codex::executable_version(&selected)?,"officialPrecompiled":true,"origin":host::runtime_compatibility::origin(&selected)?,"verification":report}),
            )?;
            if report["passed"] == true {
                Ok(())
            } else {
                Err(text("Native runtime compatibility check failed").into())
            }
        }
        "doctor" => {
            println!(
                "{}",
                message(
                    "Platform: {} / {}\nData: {}\nService: {}",
                    &[
                        ("0", std::env::consts::OS.to_string()),
                        ("1", std::env::consts::ARCH.to_string()),
                        ("2", format!("{}", host::data_dir()?.display())),
                        (
                            "3",
                            format!(
                                "{}",
                                std::env::current_exe()?
                                    .parent()
                                    .unwrap()
                                    .join(if cfg!(windows) {
                                        "agentdeck-service.exe"
                                    } else {
                                        "agentdeck-service"
                                    })
                                    .display()
                            )
                        )
                    ]
                )
            );
            let config = Config::load()?;
            println!(
                "{}",
                message(
                    "Runtime: {}",
                    &[(
                        "0",
                        (if config.runtime_target()?.attached() {
                            text("attached (configured)")
                        } else {
                            text("managed Codex")
                        })
                        .to_string()
                    )]
                )
            );
            if let Ok(exe) = config.codex_executable() {
                println!(
                    "{}",
                    message("Codex: {}", &[("0", format!("{}", exe.display()))])
                );
            } else {
                println!("{}", message("Codex not found. Install the supported CLI or use configure --codex-exe PATH.", &[]));
            }
            status(&[]).await
        }
        _ => Err(message(
            "Unknown command: {command}; use agentdeck help",
            &[("command", command.to_string())],
        )
        .into()),
    }
}
#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("{}", agentdeck_service::redact(&text(&e.to_string())));
        std::process::exit(1);
    }
}
