//! Explicit browser acceptance fixture: real PostgreSQL, relay, native Core and
//! an authenticated local Codex runtime. No fake RPC/model responses.
use super::*;

#[tokio::test]
#[ignore = "Explicit production domain acceptance with a dedicated temporary account"]
async fn production_browser_fixture() {
    assert_eq!(
        std::env::var("AGENTDECK_LINUX_SANDBOX_VERIFIED").as_deref(),
        Ok("1")
    );
    let _ = rustls::crypto::ring::default_provider().install_default();
    let directory = std::path::PathBuf::from(std::env::var("AGENTDECK_BROWSER_STATE").unwrap());
    crate::security::restrict_directory(&directory).unwrap();
    let credentials: Value =
        serde_json::from_slice(&std::fs::read(directory.join("browser-fixture.json")).unwrap())
            .unwrap();
    assert_eq!(credentials["origin"], "https://agent.ptsfdtz.top");
    let workspace = std::env::var("AGENTDECK_BROWSER_WORKSPACE").unwrap();
    let store = Arc::new(crate::store::Store::open(&directory.join("native.db")).unwrap());
    let certificate = crate::security::Certificate::load(&directory).unwrap();
    let (output, mut events) = tokio::sync::mpsc::channel(256);
    let drain = tokio::spawn(async move { while events.recv().await.is_some() {} });
    let core = Core::new(store, certificate, "127.0.0.1".into(), 49324, output);
    core.verified
        .store(true, std::sync::atomic::Ordering::SeqCst);
    core.local_action(json!({"action":"project.add","path":workspace}))
        .await
        .unwrap();
    let runtime = crate::runtime::RuntimeTarget::from_environment().unwrap();
    assert!(runtime.attached());
    let owner = core.clone();
    let runtime_task = tokio::spawn(async move {
        owner
            .supervise_runtime("/usr/local/bin/codex".into(), runtime)
            .await
    });
    Cloud::start(&core).await.unwrap();
    core.cloud_login(
        crate::s(&credentials, "origin"),
        crate::s(&credentials, "username"),
        crate::s(&credentials, "password"),
    )
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(30), async {
        while !core.cloud.status().online || !core.ready.load(std::sync::atomic::Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .unwrap();
    let management = crate::management::Management::start(core.clone(), &directory)
        .await
        .unwrap();
    println!("Production account host ready; credentials remain in private fixture file");
    tokio::select! {_=core.stop.notified()=>{},_=tokio::time::sleep(Duration::from_secs(1800))=>panic!("Production fixture timed out")};
    core.cloud_logout(true).await.unwrap();
    core.shutdown().await;
    drop(management);
    runtime_task.abort();
    drain.abort();
}

#[tokio::test]
#[ignore = "Requires isolated PostgreSQL, verified Linux sandbox and live Codex; see README"]
async fn live_browser_fixture() {
    assert_eq!(
        std::env::var("AGENTDECK_LINUX_SANDBOX_VERIFIED").as_deref(),
        Ok("1")
    );
    let _ = rustls::crypto::ring::default_provider().install_default();
    let directory = std::path::PathBuf::from(std::env::var("AGENTDECK_BROWSER_STATE").unwrap());
    let workspace = std::path::PathBuf::from(std::env::var("AGENTDECK_BROWSER_WORKSPACE").unwrap());
    crate::security::restrict_directory(&directory).unwrap();
    let url = std::env::var("AGENTDECK_TEST_DATABASE_URL").unwrap();
    let mut database_config: tokio_postgres::Config = url.parse().unwrap();
    let (admin, connection) = database_config
        .connect(tokio_postgres::NoTls)
        .await
        .unwrap();
    tokio::spawn(async move {
        let _ = connection.await;
    });
    let database = format!("agentdeck_browser_{}", uuid::Uuid::new_v4().simple());
    admin
        .batch_execute(&format!("CREATE DATABASE {database}"))
        .await
        .unwrap();
    database_config.dbname(&database);
    let database_url = if url.starts_with("postgres:") || url.starts_with("postgresql:") {
        let mut parsed = reqwest::Url::parse(&url).unwrap();
        parsed.set_path(&database);
        parsed.to_string()
    } else {
        format!("{url} dbname={database}")
    };
    let address = "127.0.0.1:18444".parse().unwrap();
    let origin = format!("https://{address}");
    let outer = rcgen::generate_simple_self_signed(vec!["127.0.0.1".into()]).unwrap();
    let tls = axum_server::tls_rustls::RustlsConfig::from_pem(
        outer.cert.pem().into_bytes(),
        outer.signing_key.serialize_pem().into_bytes(),
    )
    .await
    .unwrap();
    let cloud = agentdeck_cloud::State::open(agentdeck_cloud::config::Config {
        database_url,
        listen: address,
        public_origin: origin.clone(),
        web_origins: vec!["http://127.0.0.1:5174".into()],
        max_tunnels: 32,
        proxy_token: None,
    })
    .await
    .unwrap();
    let username = format!("browser-{}", uuid::Uuid::new_v4().simple());
    let password = format!("Browser-{}", security::token());
    let hash = cloud.passwords.hash(&password).await.unwrap();
    let account = cloud
        .store
        .create_account(None, &username, &hash, "user")
        .await
        .unwrap();
    let handle = axum_server::Handle::new();
    let control = handle.clone();
    let app = agentdeck_cloud::api::router(cloud.clone());
    let cloud_task = tokio::spawn(async move {
        axum_server::bind_rustls(address, tls)
            .handle(control)
            .serve(app.into_make_service_with_connect_info::<std::net::SocketAddr>())
            .await
            .unwrap();
    });
    let store = Arc::new(crate::store::Store::open(&directory.join("native.db")).unwrap());
    let certificate = crate::security::Certificate::load(&directory).unwrap();
    let client = reqwest::Client::builder()
        .add_root_certificate(reqwest::Certificate::from_der(outer.cert.der()).unwrap())
        .build()
        .unwrap();
    let (output, mut events) = tokio::sync::mpsc::channel(256);
    let drain = tokio::spawn(async move { while events.recv().await.is_some() {} });
    let mut core = Core::new(store, certificate, "127.0.0.1".into(), 49322, output);
    Arc::get_mut(&mut core).unwrap().cloud.client = client;
    Arc::get_mut(&mut core).unwrap().cloud.connector = Some(trust(outer.cert.der().clone()));
    core.verified
        .store(true, std::sync::atomic::Ordering::SeqCst);
    core.local_action(json!({"action":"project.add","path":workspace}))
        .await
        .unwrap();
    let runtime = crate::runtime::RuntimeTarget::from_environment().unwrap();
    assert!(runtime.attached());
    let owner = core.clone();
    let runtime_task = tokio::spawn(async move {
        owner
            .supervise_runtime("/usr/local/bin/codex".into(), runtime)
            .await
    });
    tokio::time::timeout(Duration::from_secs(30), async {
        while !core.ready.load(std::sync::atomic::Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .unwrap();
    Cloud::start(&core).await.unwrap();
    core.cloud_login(&origin, &username, &password)
        .await
        .unwrap();
    // Exercise the host password path before browser login. All credentials
    // stay in this fixture's private directory, outside test logs.
    let new_password = format!("Browser-new-{}", security::token());
    core.cloud_password(&password, &new_password).await.unwrap();
    core.cloud_login(&origin, &username, &new_password)
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(20), async {
        while !core.cloud.status().online {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .unwrap();
    let management = crate::management::Management::start(core.clone(), &directory)
        .await
        .unwrap();
    let fixture =
        json!({"origin":origin,"username":username,"password":new_password,"accountId":account});
    std::fs::write(directory.join("browser-fixture.json"), fixture.to_string()).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            directory.join("browser-fixture.json"),
            std::fs::Permissions::from_mode(0o600),
        )
        .unwrap();
    }
    println!("Live browser fixture ready; credentials written only to private fixture file");
    tokio::select! {
        _ = core.stop.notified() => {},
        _ = tokio::time::sleep(Duration::from_secs(3600)) => panic!("Browser acceptance fixture timed out"),
    }
    core.shutdown().await;
    drop(management);
    runtime_task.abort();
    drain.abort();
    core.cloud.stop();
    handle.graceful_shutdown(Some(Duration::from_secs(2)));
    let _ = cloud_task.await;
    admin
        .batch_execute(&format!("DROP DATABASE {database} WITH (FORCE)"))
        .await
        .unwrap();
}
