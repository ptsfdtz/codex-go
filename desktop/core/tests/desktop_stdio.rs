use agentdeck_service::{
    desktop_stdio::{relay, Manifest, Startup},
    rpc::ProtocolVersion,
    runtime::RuntimeTarget,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
use tokio_tungstenite::{accept_async, tungstenite::Message};
fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| v.to_string()).collect()
}

#[tokio::test]
#[ignore = "explicit installed native CLI; isolated HOME, configuration reads only"]
async fn real_desktop_baseline_startup_override_semantics() {
    let executable =
        std::env::var_os("AGENTDECK_DESKTOP_PROBE_EXE").expect("set installed native executable");
    agentdeck_service::codex::verify_for(
        std::path::Path::new(&executable),
        ProtocolVersion::DesktopBaseline,
    )
    .unwrap();
    let cases = [
        (
            "duplicate",
            args(&[
                "-c",
                "desktop.agentdeck_probe.x=1",
                "-c",
                "desktop.agentdeck_probe.x=2",
            ]),
        ),
        (
            "parent_then_child",
            args(&[
                "-c",
                "desktop.agentdeck_probe.scope={a=1,b=2}",
                "-c",
                "desktop.agentdeck_probe.scope.a=3",
            ]),
        ),
        (
            "child_then_parent",
            args(&[
                "-c",
                "desktop.agentdeck_probe.scope.a=1",
                "-c",
                "desktop.agentdeck_probe.scope={b=2}",
            ]),
        ),
        (
            "empty_parent",
            args(&["-c", "desktop.agentdeck_probe.scope={}"]),
        ),
        (
            "scalar_then_child",
            args(&[
                "-c",
                "desktop.agentdeck_probe.scope=1",
                "-c",
                "desktop.agentdeck_probe.scope.a=2",
            ]),
        ),
        (
            "table_then_scalar",
            args(&[
                "-c",
                "desktop.agentdeck_probe.scope={a=1}",
                "-c",
                "desktop.agentdeck_probe.scope=2",
            ]),
        ),
        (
            "enable_before_config",
            args(&[
                "--enable",
                "code_mode_host",
                "-c",
                "features.code_mode_host=false",
            ]),
        ),
        (
            "config_before_enable",
            args(&[
                "-c",
                "features.code_mode_host=false",
                "--enable",
                "code_mode_host",
            ]),
        ),
        (
            "enable_then_disable",
            args(&["--enable", "code_mode_host", "--disable", "code_mode_host"]),
        ),
        (
            "disable_then_enable",
            args(&["--disable", "code_mode_host", "--enable", "code_mode_host"]),
        ),
        (
            "root_then_subcommand",
            args(&[
                "-c",
                "desktop.agentdeck_probe.x=1",
                "app-server",
                "-c",
                "desktop.agentdeck_probe.x=2",
            ]),
        ),
        (
            "raw_whitespace",
            args(&["-c", "desktop.agentdeck_probe.word=  unknown label  "]),
        ),
        (
            "plugin_style_key",
            args(&["-c", "desktop.agentdeck_probe.tool@vendor=1"]),
        ),
        (
            "quoted_key",
            args(&["-c", "desktop.agentdeck_probe.\"quoted\"=1"]),
        ),
        (
            "unicode_key",
            args(&["-c", "desktop.agentdeck_probe.测试=1"]),
        ),
        (
            "quoted_dot_key",
            args(&["-c", "desktop.agentdeck_probe.\"a.b\"=1"]),
        ),
        (
            "desktop_dynamic_endpoints",
            args(&[
                "app-server",
                "-c",
                "features.code_mode_host=true",
                "-c",
                "chatgpt_base_url=\"https://chatgpt.invalid/a\"",
                "-c",
                "openai_base_url=\"https://openai.invalid/b\"",
                "--analytics-default-enabled",
            ]),
        ),
        (
            "plugin_override_visibility",
            args(&[
                "-c",
                "plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=true",
            ]),
        ),
        (
            "root_enable_subcommand_disable",
            args(&[
                "--enable",
                "code_mode_host",
                "app-server",
                "--disable",
                "code_mode_host",
            ]),
        ),
        (
            "root_disable_subcommand_enable",
            args(&[
                "--disable",
                "code_mode_host",
                "app-server",
                "--enable",
                "code_mode_host",
            ]),
        ),
    ];
    for (name, overrides) in cases {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir(&home).unwrap();
        std::fs::write(home.join("config.toml"),"[analytics]\nenabled=false\n[desktop.agentdeck_probe.scope]\nkeep=\"file\"\nnested={a=1,b=2}\n").unwrap();
        let mut child = tokio::process::Command::new(&executable)
            .args(&overrides)
            .args(if overrides.iter().any(|arg| arg == "app-server") {
                vec![]
            } else {
                vec!["app-server"]
            })
            .args(["--listen", "stdio://"])
            .env("CODEX_HOME", &home)
            .env_remove("OPENAI_API_KEY")
            .env_remove("CODEX_API_KEY")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let mut input = child.stdin.take().unwrap();
        let mut output = tokio::io::BufReader::new(child.stdout.take().unwrap());
        input.write_all(format!("{}\n",json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"startup_audit","version":"0.1"}}})).as_bytes()).await.unwrap();
        async fn response(
            reader: &mut tokio::io::BufReader<tokio::process::ChildStdout>,
            id: i64,
        ) -> Value {
            tokio::time::timeout(Duration::from_secs(10), async {
                loop {
                    let packet = agentdeck_service::rpc::read_frame(reader)
                        .await
                        .unwrap()
                        .expect("native config probe exited");
                    if packet["id"] == id {
                        return packet;
                    }
                }
            })
            .await
            .unwrap()
        }
        let initialized = response(&mut output, 1).await;
        assert!(
            initialized.get("result").is_some(),
            "native initialization failed for {name}"
        );
        input
            .write_all(
                format!(
                    "{}\n{}\n",
                    json!({"method":"initialized"}),
                    json!({"id":2,"method":"config/read","params":{"includeLayers":name == "plugin_override_visibility"}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        let config = response(&mut output, 2).await;
        assert!(config.get("result").is_some());
        let mut expected = json!({"scope":{"keep":"file","nested":{"a":1,"b":2}}});
        match name {
            "duplicate" | "root_then_subcommand" => expected["x"] = json!(2),
            "parent_then_child" => {
                expected["scope"]["a"] = json!(3);
                expected["scope"]["b"] = json!(2);
            }
            "child_then_parent" => expected["scope"]["b"] = json!(2),
            "scalar_then_child" => expected["scope"]["a"] = json!(2),
            "table_then_scalar" => expected["scope"]["$serde_json::private::Number"] = json!("2"),
            "raw_whitespace" => expected["word"] = json!("unknown label"),
            "plugin_style_key" => expected["tool@vendor"] = json!(1),
            "quoted_key" => expected["\"quoted\""] = json!(1),
            "unicode_key" => expected["测试"] = json!(1),
            "quoted_dot_key" => expected["\"a"] = json!({"b\"":1}),
            _ => {}
        }
        assert_eq!(
            config["result"]["config"]["desktop"]["agentdeck_probe"], expected,
            "{name}"
        );
        if name.contains("enable") {
            assert_eq!(
                config["result"]["config"]["features"]["code_mode_host"],
                json!(!name.contains("disable")),
                "{name}"
            );
        }
        let mut proxy_args = overrides.clone();
        if !proxy_args.iter().any(|arg| arg == "app-server") {
            proxy_args.push("app-server".into());
        }
        let checked = Startup::parse(&proxy_args)
            .unwrap()
            .check(&config["result"]);
        if name == "plugin_override_visibility" {
            let path = |value: &Value| {
                value["plugins"]["codex-app-tools@openai-bundled"]["mcp_servers"]["codex_app"]
                    ["enabled"]
                    .clone()
            };
            let layers = config["result"]["layers"].as_array().unwrap();
            let session_flag = layers
                .iter()
                .find(|layer| layer["name"]["type"] == "sessionFlags")
                .unwrap();
            assert_eq!(path(&session_flag["config"]), json!(true));
            assert_eq!(path(&config["result"]["config"]), json!(true));
            checked.unwrap();
        } else if name == "table_then_scalar" {
            assert_eq!(checked.unwrap_err().code, "PROXY_CONFIG_MISMATCH");
        } else {
            checked.unwrap();
        }
        if name == "desktop_dynamic_endpoints" {
            assert_eq!(
                config["result"]["config"]["chatgpt_base_url"],
                "https://chatgpt.invalid/a"
            );
            assert_eq!(
                config["result"]["config"]["openai_base_url"],
                "https://openai.invalid/b"
            );
            let mut changed = config["result"].clone();
            changed["config"]["openai_base_url"] = json!("https://different.invalid/");
            assert_eq!(
                Startup::parse(&proxy_args)
                    .unwrap()
                    .check(&changed)
                    .unwrap_err()
                    .code,
                "PROXY_CONFIG_MISMATCH"
            );
        }
        drop(input);
        child.kill().await.unwrap();
    }
}

#[test]
fn manifest_rejects_inline_secrets_remote_endpoints_and_self_delegation() {
    let dir = tempfile::tempdir().unwrap();
    let native = dir.path().join("native.exe");
    let proxy = dir.path().join("proxy.exe");
    std::fs::write(&native, []).unwrap();
    std::fs::write(&proxy, []).unwrap();
    let path = dir.path().join("proxy.json");
    let valid = json!({"formatVersion":1,"nativeExecutable":native,"endpoint":"ws://127.0.0.1:12345/","tokenFile":dir.path().join("token"),"protocolVersion":"0.163.0-alpha.10.2"});
    std::fs::write(&path, valid.to_string()).unwrap();
    assert!(Manifest::load(&path, &proxy).is_ok());
    for (key, value) in [
        ("token", json!("never-inline")),
        ("nativeExecutable", json!(proxy)),
        ("endpoint", json!("ws://secret@127.0.0.1:12345/")),
        ("endpoint", json!("ws://192.168.1.1:12345/")),
        ("tokenFile", json!("relative")),
        ("formatVersion", json!(2)),
        ("protocolVersion", json!("unknown")),
    ] {
        let mut invalid = valid.clone();
        invalid[key] = value;
        std::fs::write(&path, invalid.to_string()).unwrap();
        let Err(error) = Manifest::load(&path, &proxy) else {
            panic!("invalid manifest accepted")
        };
        assert_eq!(error.code, "PROXY_CONFIG_ERROR");
        assert!(!error.message.contains("secret"));
    }
    std::fs::write(&path, vec![b' '; 65537]).unwrap();
    assert!(Manifest::load(&path, &proxy).is_err());
}

#[tokio::test]
async fn configuration_gate_never_forwards_a_queued_task_or_its_snapshot() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("ws://{}", listener.local_addr().unwrap());
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("token");
    std::fs::write(&file, "a".repeat(43)).unwrap();
    let target = RuntimeTarget::Attached {
        endpoint,
        token_file: file,
        protocol: ProtocolVersion::DesktopBaseline,
    };
    let native = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = accept_async(stream).await.unwrap();
        let hello: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(hello["method"], "initialize");
        ws.send(Message::Text(json!({"id":hello["id"],"result":{"codexHome":"C:/fixture","platformFamily":"windows","platformOs":"windows","userAgent":"codex_desktop/0.163.0-alpha.10.2 (fixture)"}}).to_string().into())).await.unwrap();
        let check: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(check["method"], "config/read");
        ws.send(Message::Text(json!({"id":check["id"],"result":{"config":{"features":{"code_mode_host":false},"private_fixture":"not-forwarded"},"origins":{}}}).to_string().into())).await.unwrap();
        assert!(!matches!(ws.next().await, Some(Ok(Message::Text(_)))));
    });
    let input = format!(
        "{}\n{}\n",
        json!({"id":1,"method":"initialize","params":{}}),
        json!({"id":2,"method":"thread/start","params":{"cwd":"C:/fixture"}})
    );
    let mut output = Vec::new();
    let error = tokio::time::timeout(
        Duration::from_secs(3),
        relay(
            input.as_bytes(),
            &mut output,
            target,
            Startup::parse(&args(&["-c", "features.code_mode_host=true", "app-server"])).unwrap(),
        ),
    )
    .await
    .unwrap()
    .unwrap_err();
    assert_eq!(error.code, "PROXY_CONFIG_MISMATCH");
    assert!(output.is_empty());
    tokio::time::timeout(Duration::from_secs(3), native)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn native_version_mismatch_never_releases_initialization_or_queued_task() {
    for user_agent in [
        "codex_desktop/0.159.2 (fixture)",
        "codex_desktop/0.163.0-alpha.10.20 (fixture)",
        "/0.163.0-alpha.10.2 (fixture)",
        "0.163.0-alpha.10.2 (fixture)",
    ] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        let token_file = dir.path().join("token");
        std::fs::write(&token_file, "a".repeat(43)).unwrap();
        let target = RuntimeTarget::Attached {
            endpoint: format!("ws://{}", listener.local_addr().unwrap()),
            token_file,
            protocol: ProtocolVersion::DesktopBaseline,
        };
        let native = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = accept_async(stream).await.unwrap();
            let hello: Value =
                serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
            ws.send(Message::Text(json!({"id":hello["id"],"result":{"codexHome":"C:/fixture","platformFamily":"windows","platformOs":"windows","userAgent":user_agent}}).to_string().into())).await.unwrap();
            assert!(!matches!(ws.next().await, Some(Ok(Message::Text(_)))));
        });
        let input = format!(
            "{}\n{}\n",
            json!({"id":1,"method":"initialize","params":{}}),
            json!({"id":2,"method":"thread/start","params":{}})
        );
        let mut output = Vec::new();
        let error = tokio::time::timeout(
            Duration::from_secs(3),
            relay(
                input.as_bytes(),
                &mut output,
                target,
                Startup::parse(&args(&["app-server"])).unwrap(),
            ),
        )
        .await
        .unwrap()
        .unwrap_err();
        assert_eq!(error.code, "PROXY_VERSION_UNVERIFIED");
        assert!(output.is_empty());
        tokio::time::timeout(Duration::from_secs(3), native)
            .await
            .unwrap()
            .unwrap();
    }
}

#[test]
fn startup_checks_merged_tables_exact_values_and_never_ignores_flags() {
    let startup = Startup::parse(&args(&[
        "-c",
        "features.code_mode_host=true",
        "app-server",
        "--analytics-default-enabled",
        "-c",
        "model='test'",
        "--config=experimental={a=1,b=[2,3]}",
    ]))
    .unwrap();
    let mut config = json!({"config":{"features":{"code_mode_host":true},"model":"test","experimental":{"a":1,"b":[2,3]},"analytics":{"enabled":false}}});
    startup.check(&config).unwrap();
    config["config"]["experimental"]["extra"] = json!(true);
    startup.check(&config).unwrap();
    config["config"]["experimental"]["b"] = json!([2, 3, 4]);
    assert_eq!(
        startup.check(&config).unwrap_err().code,
        "PROXY_CONFIG_MISMATCH"
    );
    config["config"]["experimental"]["b"] = json!([2, 3]);
    config["config"]["analytics"] = Value::Null;
    assert_eq!(
        startup.check(&config).unwrap_err().code,
        "PROXY_ANALYTICS_UNVERIFIED"
    );
    for input in [
        vec!["app-server", "daemon"],
        vec!["app-server", "--listen", "ws://127.0.0.1:1"],
        vec!["app-server", "--strict-config"],
        vec!["app-server", "-c", "x=nan"],
        vec!["app-server", "-c"],
        vec!["exec"],
    ] {
        assert!(Startup::parse(&args(&input)).is_err());
    }
    Startup::parse(&args(&["app-server","--enable","feature_a","--disable","feature_b","-c","model=unquoted-model"])).unwrap().check(&json!({"config":{"features":{"feature_a":true,"feature_b":false},"model":"unquoted-model"}})).unwrap();
}

#[test]
fn startup_overlay_preserves_siblings_and_checks_nested_types() {
    let startup = Startup::parse(&args(&[
        "app-server",
        "-c",
        "x={a={old=1},b=2}",
        "-c",
        "x.a=3",
        "-c",
        "x.a.new=4",
        "-c",
        "x.a.new=5",
        "--disable",
        "host",
        "--enable",
        "host",
    ]))
    .unwrap();
    let mut config =
        json!({"config":{"x":{"a":{"new":5,"base":true},"b":2},"features":{"host":false}}});
    startup.check(&config).unwrap();
    for wrong in [json!(3), json!({"new":"5"}), json!({})] {
        config["config"]["x"]["a"] = wrong;
        assert_eq!(
            startup.check(&config).unwrap_err().code,
            "PROXY_CONFIG_MISMATCH"
        );
    }
    config["config"]["x"]["a"] = json!({"new":5});
    config["config"]["x"]["b"] = json!(3);
    assert_eq!(
        startup.check(&config).unwrap_err().code,
        "PROXY_CONFIG_MISMATCH"
    );
    Startup::parse(&args(&["app-server", "-c", "x.a=1", "-c", "x={}"]))
        .unwrap()
        .check(&json!({"config":{"x":{"base":true}}}))
        .unwrap();
}

#[test]
fn startup_diagnostics_classify_failures_without_disclosing_keys_or_values() {
    use agentdeck_service::desktop_stdio::startup_diagnostic;
    for (key, domain) in [
        ("mcp_servers", "MCP"),
        ("plugins", "PLUGINS"),
        ("features", "FEATURES"),
        ("private-secret-key", "OTHER"),
    ] {
        let assignment = format!("{key}={{private-secret-field='private-secret-value'}}");
        let startup = Startup::parse(&args(&["app-server", "-c", &assignment])).unwrap();
        for (actual, kind) in [
            (None, "MISSING"),
            (Some(json!(1)), "TYPE"),
            (
                Some(json!({"private-secret-field":"different-secret"})),
                "VALUE",
            ),
        ] {
            let mut config = json!({"config":{}});
            if let Some(actual) = actual {
                config["config"][key] = actual;
            }
            let error = startup.check(&config).unwrap_err();
            assert_eq!(error.code, "PROXY_CONFIG_MISMATCH");
            assert_eq!(
                startup_diagnostic(&error),
                Some(format!("PROXY_STARTUP_{domain}_{kind}").as_str())
            );
            assert!(!error.message.contains("secret"));
        }
    }
    assert!(startup_diagnostic(&agentdeck_service::Error::new(
        "PROXY_CONFIG_MISMATCH",
        "private-secret-value"
    ))
    .is_none());
    assert!(startup_diagnostic(&agentdeck_service::Error::new(
        "OTHER",
        "PROXY_STARTUP_MCP_MISSING"
    ))
    .is_none());
    let startup = Startup::parse(&args(&[
        "app-server",
        "-c",
        "features.private-secret-key=true",
    ]))
    .unwrap();
    let error = startup
        .check(&json!({"config":{"features":1}}))
        .unwrap_err();
    assert_eq!(
        startup_diagnostic(&error),
        Some("PROXY_STARTUP_FEATURES_TYPE")
    );
}

#[test]
fn startup_config_segments_are_literal_and_never_unquoted() {
    let startup = Startup::parse(&args(&[
        "app-server",
        "-c",
        "x.tool@vendor.enabled=true",
        "-c",
        "x.\"quoted\"=2",
        "-c",
        "x.测试=3",
    ]))
    .unwrap();
    let mut config =
        json!({"config":{"x":{"tool@vendor":{"enabled":true},"\"quoted\"":2,"测试":3}}});
    startup.check(&config).unwrap();
    config["config"]["x"]
        .as_object_mut()
        .unwrap()
        .remove("\"quoted\"");
    config["config"]["x"]["quoted"] = json!(2);
    assert_eq!(
        startup.check(&config).unwrap_err().code,
        "PROXY_CONFIG_MISMATCH"
    );
    for key in ["x..y=1", "x.\ny=1"] {
        assert_eq!(
            Startup::parse(&args(&["app-server", "-c", key]))
                .err()
                .unwrap()
                .code,
            "PROXY_CONFIG_KEY_UNSUPPORTED"
        );
    }
}

#[tokio::test]
async fn same_socket_gate_and_partial_stdin_survive_interleaved_native_event() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("ws://{}", listener.local_addr().unwrap());
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("token");
    std::fs::write(&file, "a".repeat(43)).unwrap();
    let target = RuntimeTarget::Attached {
        endpoint,
        token_file: file,
        protocol: ProtocolVersion::DesktopBaseline,
    };
    let (signal, ready) = tokio::sync::oneshot::channel();
    let native = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = accept_async(stream).await.unwrap();
        let hello: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(hello["id"], "original-init");
        ws.send(Message::Text(json!({"id":hello["id"],"result":{"codexHome":"C:/fixture","platformFamily":"windows","platformOs":"windows","userAgent":"Codex Desktop/0.163.0-alpha.10.2 (fixture)"}}).to_string().into())).await.unwrap();
        let check: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(check["method"], "config/read");
        ws.send(Message::Text(json!({"id":check["id"],"result":{"config":{"features":{"code_mode_host":true}},"origins":{}}}).to_string().into())).await.unwrap();
        ready.await.unwrap();
        ws.send(Message::Text(
            json!({"method":"fixture/progress","params":{"text":"during partial line"}})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
        let message: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(message, json!({"id":8,"result":{"text":"中文 😀"}}));
        ws.send(Message::Text(
            json!({"id":8,"result":{"same":true}}).to_string().into(),
        ))
        .await
        .unwrap();
        while ws.next().await.is_some_and(|r| r.is_ok()) {}
    });
    let (mut input, reader) = tokio::io::duplex(65536);
    let (writer, out) = tokio::io::duplex(65536);
    let task = tokio::spawn(relay(
        reader,
        writer,
        target,
        Startup::parse(&args(&["-c", "features.code_mode_host=true", "app-server"])).unwrap(),
    ));
    let mut out = tokio::io::BufReader::new(out);
    input
        .write_all(
            format!(
                "{}\n",
                json!({"id":"original-init","method":"initialize","params":{}})
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    let mut line = String::new();
    tokio::time::timeout(Duration::from_secs(3), out.read_line(&mut line))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&line).unwrap()["id"],
        "original-init"
    );
    let bytes = format!("{}\n", json!({"id":8,"result":{"text":"中文 😀"}})).into_bytes();
    let split = bytes.iter().position(|b| *b >= 128).unwrap() + 1;
    input.write_all(&bytes[..split]).await.unwrap();
    signal.send(()).unwrap();
    line.clear();
    tokio::time::timeout(Duration::from_secs(3), out.read_line(&mut line))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&line).unwrap()["method"],
        "fixture/progress"
    );
    input.write_all(&bytes[split..]).await.unwrap();
    line.clear();
    tokio::time::timeout(Duration::from_secs(3), out.read_line(&mut line))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&line).unwrap()["result"]["same"],
        true
    );
    drop(input);
    assert!(tokio::time::timeout(Duration::from_secs(3), task)
        .await
        .unwrap()
        .unwrap()
        .is_ok());
    tokio::time::timeout(Duration::from_secs(3), native)
        .await
        .unwrap()
        .unwrap();
}
