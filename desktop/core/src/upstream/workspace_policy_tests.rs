use super::*;

fn configuration() -> Value {
    json!({"config":{
        "sandbox_mode":null,"default_permissions":"agentdeck",
        "permissions":{"agentdeck":{
            "extends":":workspace",
            "filesystem":{":root":"deny",":minimal":"read",":tmpdir":"deny",":slash_tmp":"deny"},
            "network":{"enabled":false}
        }}
    }})
}

#[test]
fn legacy_sandbox_modes_keep_platform_boundaries() {
    for platform in ["windows", "linux", "macos"] {
        for mode in [
            Value::Null,
            json!("workspace-write"),
            json!("read-only"),
            json!("danger-full-access"),
            json!("unexpected"),
            json!(false),
        ] {
            let mut config = configuration();
            config["config"]["sandbox_mode"] = mode.clone();
            let expected = match platform {
                "windows" => mode.is_null() || mode == "workspace-write",
                "macos" => mode == "workspace-write",
                _ => mode.is_null(),
            };
            let result = check_policy_for_platform(&config, None, platform);
            assert_eq!(result.is_ok(), expected, "{platform}: {mode}");
            if let Err(error) = result {
                assert_eq!(error.code, "UNSAFE_UPSTREAM_CONFIG");
                assert!(error.message.contains("sandbox_mode"));
                assert!(!error.message.contains("unexpected"));
            }
        }
    }
}

#[test]
fn safe_legacy_mode_does_not_bypass_profile_guards() {
    for mode in [Value::Null, json!("workspace-write")] {
        for (pointer, value, field) in [
            (
                "/config/default_permissions",
                json!("other"),
                "default_permissions",
            ),
            (
                "/config/permissions/agentdeck/extends",
                json!(":danger-full-access"),
                "permissions.agentdeck.extends",
            ),
            (
                "/config/permissions/agentdeck/filesystem/:root",
                json!("read"),
                "Filesystem",
            ),
            (
                "/config/permissions/agentdeck/filesystem/:minimal",
                json!("write"),
                "Filesystem",
            ),
            (
                "/config/permissions/agentdeck/filesystem/:tmpdir",
                json!("write"),
                "Filesystem",
            ),
            (
                "/config/permissions/agentdeck/filesystem/:slash_tmp",
                json!("write"),
                "Filesystem",
            ),
            (
                "/config/permissions/agentdeck/network/enabled",
                json!(true),
                "Network",
            ),
        ] {
            let mut config = configuration();
            config["config"]["sandbox_mode"] = mode.clone();
            *config.pointer_mut(pointer).unwrap() = value;
            let error = check_policy_for_platform(&config, None, "windows").unwrap_err();
            assert_eq!(error.code, "UNSAFE_UPSTREAM_CONFIG");
            assert!(error.message.contains(field), "{error}");
        }
        for (field, value) in [
            ("mcp_servers", json!({"test":{"enabled":true}})),
            ("hooks", json!({"test":[{"command":"untrusted"}]})),
        ] {
            let mut config = configuration();
            config["config"]["sandbox_mode"] = mode.clone();
            config["config"][field] = value;
            assert!(check_policy_for_platform(&config, None, "windows").is_err());
        }
        let mut config = configuration();
        config["config"]["sandbox_mode"] = mode;
        config["config"]["permissions"]["agentdeck"]["workspace_roots"] = json!({"extra":{}});
        assert!(check_policy_for_platform(&config, None, "windows").is_err());
        config["config"]["permissions"]["agentdeck"]["workspace_roots"] = json!({});
        config["config"]["permissions"]["agentdeck"]["filesystem"]["extra"] = json!("write");
        assert!(check_policy_for_platform(&config, None, "windows").is_err());
    }
}

#[test]
fn startup_overrides_legacy_mode_only_on_windows_and_macos() {
    for platform in ["windows", "macos", "linux"] {
        let args = args_for_platform(platform);
        let overrides: Vec<_> = args
            .windows(2)
            .filter(|pair| pair[0] == "-c")
            .map(|pair| pair[1].as_str())
            .collect();
        assert_eq!(
            overrides.contains(&"sandbox_mode=\"workspace-write\""),
            platform != "linux"
        );
        assert_eq!(
            overrides.contains(&"windows.sandbox=\"mxc\""),
            platform == "windows"
        );
        assert!(overrides.contains(&"default_permissions=\"agentdeck\""));
        assert!(overrides.contains(&"approval_policy=\"on-request\""));
        assert!(overrides.contains(&"approvals_reviewer=\"user\""));
    }
}

#[test]
fn package_read_exception_stays_limited_to_linux_and_the_selected_package() {
    let executable = Path::new("/immutable/package/bin/codex");
    for platform in ["windows", "linux", "macos"] {
        for (root, permission) in [
            ("/immutable/package", "read"),
            ("/immutable/package", "write"),
            ("/immutable", "read"),
        ] {
            let mut config = configuration();
            if platform == "macos" {
                config["config"]["sandbox_mode"] = json!("workspace-write");
            }
            config["config"]["permissions"]["agentdeck"]["filesystem"][root] = json!(permission);
            assert_eq!(
                check_policy_for_platform(&config, Some(executable), platform).is_ok(),
                platform == "linux" && root == "/immutable/package" && permission == "read"
            );
        }
    }
}

#[test]
fn legacy_mode_does_not_relax_actual_thread_policy() {
    let directory = tempfile::tempdir().unwrap();
    let root = paths::canonical(directory.path()).unwrap();
    let response = json!({
        "cwd":root,"thread":{"cwd":root},
        "approvalPolicy":"on-request","approvalsReviewer":"user",
        "sandbox":{"type":"workspaceWrite","writableRoots":[root],
            "networkAccess":false,"excludeTmpdirEnvVar":true,"excludeSlashTmp":true}
    });
    assert!(checked_thread(&response, &root, true).is_ok());
    assert!(checked_thread(&response, &root, false).is_err());
    for (pointer, value) in [
        ("/sandbox/type", json!("dangerFullAccess")),
        ("/sandbox/networkAccess", json!(true)),
        ("/sandbox/excludeTmpdirEnvVar", json!(false)),
        ("/sandbox/excludeSlashTmp", json!(false)),
        ("/approvalPolicy", json!("never")),
    ] {
        let mut config = response.clone();
        *config.pointer_mut(pointer).unwrap() = value;
        assert!(checked_thread(&config, &root, true).is_err());
    }
}

#[tokio::test]
#[ignore = "requires AGENTDECK_TEST_OFFICIAL_CODEX pointing to a verified official runtime"]
async fn official_runtime_overrides_legacy_user_modes_without_changing_config() {
    let executable = PathBuf::from(
        std::env::var_os("AGENTDECK_TEST_OFFICIAL_CODEX").expect("official runtime path"),
    );
    for mode in [
        None,
        Some("read-only"),
        Some("workspace-write"),
        Some("danger-full-access"),
    ] {
        let directory = tempfile::tempdir().unwrap();
        let home = directory.path().join("home");
        let project = directory.path().join("project");
        for path in [&home, &project] {
            crate::security::restrict_directory(path).unwrap();
        }
        std::fs::create_dir(project.join(".git")).unwrap();
        std::fs::write(
            project.join("AGENTS.md"),
            "Isolated permission configuration test.\n",
        )
        .unwrap();
        let home = paths::canonical(&home).unwrap();
        let project = paths::canonical(&project).unwrap();
        let mut trusted = serde_json::Map::new();
        trusted.insert(
            project.to_string_lossy().into_owned(),
            json!({"trust_level":"trusted"}),
        );
        let mut user_config = json!({"cli_auth_credentials_store":"file","projects":trusted});
        if let Some(mode) = mode {
            user_config["sandbox_mode"] = json!(mode);
        }
        let contents = toml::to_string(&user_config).unwrap();
        // A trusted project's local config must not supersede the Host startup
        // policy either. Check both on-disk files remain unchanged afterwards.
        let project_contents = mode
            .map(|mode| format!("sandbox_mode = {mode:?}\n"))
            .unwrap_or_default();
        std::fs::create_dir(project.join(".codex")).unwrap();
        std::fs::write(project.join(".codex/config.toml"), &project_contents).unwrap();
        std::fs::write(home.join("config.toml"), &contents).unwrap();
        // Exercise the Windows startup overrides even on Linux. This verifies
        // native configuration precedence and thread metadata, not Windows MXC.
        let args = args_for_platform("windows");
        let (rpc, mut events) = Rpc::start_with_home(&executable, &args, Some(&home)).unwrap();
        let observer = rpc.clone();
        let mut drain = tokio::spawn(async move {
            while let Some(event) = events.recv().await {
                if event.get("id").is_some() || event["method"] == "$lost" {
                    observer.stop();
                    break;
                }
            }
        });
        let result = tokio::time::timeout(Duration::from_secs(40), async {
            initialize(&rpc).await?;
            assert!(rpc
                .codex_home
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|p| paths::equal(p, &home)));
            for cwd in [Value::Null, json!(project)] {
                let config = rpc
                    .request("config/read", json!({"includeLayers":false,"cwd":cwd}))
                    .await?;
                rpc.validate("v2/ConfigReadResponse", &config)?;
                assert_eq!(config["config"]["sandbox_mode"], "workspace-write");
                check_policy_for_platform(&config, Some(&executable), "windows")?;
            }
            let projects = rpc.request("project/list", json!({})).await?;
            rpc.validate("experimental/ProjectListResponse", &projects)?;
            let thread = rpc
                .request(
                    "thread/start",
                    json!({
                        "cwd":project,"ephemeral":true,"approvalPolicy":"on-request",
                        "approvalsReviewer":"user","config":{"default_permissions":"agentdeck"}
                    }),
                )
                .await?;
            rpc.validate("v2/ThreadStartResponse", &thread)?;
            checked_thread(&thread, &project, true)?;
            assert_eq!(
                std::fs::read_to_string(home.join("config.toml")).unwrap(),
                contents
            );
            assert_eq!(
                std::fs::read_to_string(project.join(".codex/config.toml")).unwrap(),
                project_contents
            );
            Ok::<_, Error>(())
        })
        .await;
        rpc.stop();
        if tokio::time::timeout(Duration::from_secs(5), &mut drain)
            .await
            .is_err()
        {
            drain.abort();
            let _ = drain.await;
        }
        result
            .expect("native configuration check timed out")
            .unwrap();
    }
}
