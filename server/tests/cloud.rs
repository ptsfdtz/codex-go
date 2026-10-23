use agentdeck_cloud::{config::Config, security, State};
use futures_util::{SinkExt, StreamExt};
use reqwest::{Client, Response, StatusCode};
use serde_json::{json, Value};
use std::{net::SocketAddr, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt, DuplexStream},
    net::TcpStream,
    task::JoinHandle,
};
use tokio_postgres::NoTls;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
    MaybeTlsStream, WebSocketStream,
};
use uuid::Uuid;

const INITIAL: &str = "test-initial-password";
const CHANGED: &str = "test-changed-password";
type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

struct TestServer {
    state: Arc<State>,
    client: Client,
    base: String,
    task: JoinHandle<()>,
    database: String,
    admin: tokio_postgres::Client,
}
impl TestServer {
    async fn new() -> Self {
        Self::new_for_origin("https://cloud.test".into()).await
    }
    async fn new_for_origin(public_origin: String) -> Self {
        let database_url = std::env::var("AGENTDECK_TEST_DATABASE_URL")
            .expect("Set AGENTDECK_TEST_DATABASE_URL to an isolated PostgreSQL test instance");
        let config: tokio_postgres::Config = database_url.parse().unwrap();
        let (admin, connection) = config.connect(NoTls).await.unwrap();
        tokio::spawn(async move {
            let _ = connection.await;
        });
        let database = format!("agentdeck_test_{}", Uuid::new_v4().simple());
        admin
            .batch_execute(&format!("CREATE DATABASE {database}"))
            .await
            .unwrap();
        let mut test_config = config.clone();
        test_config.dbname(&database);
        // Preserve the caller's host/user/password/options without logging secrets.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let state = State::open(Config {
            database_url: database_url_for(&test_config),
            listen: address,
            public_origin,
            max_tunnels: 1024,
            proxy_token: None,
        })
        .await
        .unwrap();
        let app = agentdeck_cloud::api::router(state.clone())
            .into_make_service_with_connect_info::<SocketAddr>();
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Self {
            state,
            client: Client::new(),
            base: format!("http://{address}"),
            task,
            database,
            admin,
        }
    }
    async fn finish(self) {
        self.task.abort();
        self.state.hub.shutdown();
        self.admin
            .batch_execute(&format!("DROP DATABASE {} WITH (FORCE)", self.database))
            .await
            .unwrap();
    }
    async fn account(&self, name: &str, role: &str) -> String {
        let hash = self.state.passwords.hash(INITIAL).await.unwrap();
        self.state
            .store
            .create_account(None, name, &hash, role)
            .await
            .unwrap()
    }
    async fn login(&self, name: &str, password: &str, kind: &str, installation: &str) -> Value {
        let response = self.client.post(format!("{}/api/v1/auth/login", self.base)).json(&json!({
            "username": name,"password": password,"installationId": installation,"deviceName":"Test device","kind":kind
        })).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        response.json().await.unwrap()
    }
    async fn ready(&self, name: &str, role: &str, kind: &str) -> Value {
        self.account(name, role).await;
        let install = security::token();
        let first = self.login(name, INITIAL, kind, &install).await;
        assert_eq!(
            self.get("/hosts", &first).await.status(),
            StatusCode::FORBIDDEN
        );
        let response = self
            .client
            .post(format!("{}/api/v1/auth/password", self.base))
            .bearer_auth(access(&first))
            .json(&json!({"oldPassword":INITIAL,"newPassword":CHANGED}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            self.get("/account", &first).await.status(),
            StatusCode::UNAUTHORIZED
        );
        self.login(name, CHANGED, kind, &install).await
    }
    async fn get(&self, path: &str, tokens: &Value) -> Response {
        self.client
            .get(format!("{}/api/v1{path}", self.base))
            .bearer_auth(access(tokens))
            .send()
            .await
            .unwrap()
    }
    async fn register(&self, tokens: &Value, host: &str) -> StatusCode {
        self.client
            .put(format!("{}/api/v1/hosts/self", self.base))
            .bearer_auth(access(tokens))
            .json(&json!({"hostId":host,"displayName":"Test computer"}))
            .send()
            .await
            .unwrap()
            .status()
    }
    async fn socket(
        &self,
        path: &str,
        tokens: &Value,
        ticket: Option<&str>,
    ) -> Result<Socket, StatusCode> {
        let mut request = format!("{}{path}", self.base.replace("http:", "ws:"))
            .into_client_request()
            .unwrap();
        request.headers_mut().insert(
            "Authorization",
            format!("Bearer {}", access(tokens)).parse().unwrap(),
        );
        if let Some(ticket) = ticket {
            request
                .headers_mut()
                .insert("X-Tunnel-Ticket", ticket.parse().unwrap());
        }
        match connect_async(request).await {
            Ok((socket, _)) => Ok(socket),
            Err(tokio_tungstenite::tungstenite::Error::Http(response)) => {
                Err(StatusCode::from_u16(response.status().as_u16()).unwrap())
            }
            Err(_) => panic!("WebSocket connection failed"),
        }
    }
    async fn control(&self, desktop: &Value) -> Socket {
        let mut socket = self
            .socket("/api/v1/relay/control", desktop, None)
            .await
            .unwrap();
        assert_eq!(next_json(&mut socket).await["type"], "ready");
        socket
    }
    async fn offer(&self, mobile: &Value, host: &str) -> Response {
        self.client
            .post(format!("{}/api/v1/relay/tunnels", self.base))
            .bearer_auth(access(mobile))
            .json(&json!({"hostId":host}))
            .send()
            .await
            .unwrap()
    }
    async fn sql(&self, query: &str) {
        let url = std::env::var("AGENTDECK_TEST_DATABASE_URL").unwrap();
        let mut config: tokio_postgres::Config = url.parse().unwrap();
        config.dbname(&self.database);
        let (client, connection) = config.connect(NoTls).await.unwrap();
        let task = tokio::spawn(async move { connection.await.unwrap() });
        client.batch_execute(query).await.unwrap();
        drop(client);
        task.await.unwrap();
    }
}
impl Drop for TestServer {
    fn drop(&mut self) {
        self.task.abort();
        self.state.hub.shutdown();
    }
}
fn database_url_for(config: &tokio_postgres::Config) -> String {
    // libpq keyword strings, with proper escaping, also support non-URL passwords.
    fn quote(value: &str) -> String {
        format!("'{}'", value.replace('\\', "\\\\").replace('\'', "\\'"))
    }
    #[cfg(windows)]
    let tokio_postgres::config::Host::Tcp(host) = config.get_hosts().first().unwrap();
    #[cfg(unix)]
    let host = match config.get_hosts().first().unwrap() {
        tokio_postgres::config::Host::Tcp(host) => host,
        _ => panic!("Use a TCP PostgreSQL test endpoint"),
    };
    let mut parts = vec![
        format!("host={}", quote(host)),
        format!("port={}", config.get_ports().first().unwrap_or(&5432)),
        format!("dbname={}", quote(config.get_dbname().unwrap())),
    ];
    if let Some(user) = config.get_user() {
        parts.push(format!("user={}", quote(user)));
    }
    if let Some(password) = config.get_password() {
        parts.push(format!(
            "password={}",
            quote(std::str::from_utf8(password).unwrap())
        ));
    }
    parts.join(" ")
}
fn access(tokens: &Value) -> &str {
    tokens["accessToken"].as_str().unwrap()
}
async fn next_json(socket: &mut Socket) -> Value {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match socket.next().await.unwrap().unwrap() {
                Message::Text(value) => return serde_json::from_str(&value).unwrap(),
                Message::Ping(value) => socket.send(Message::Pong(value)).await.unwrap(),
                Message::Pong(_) => {}
                _ => panic!("Expected control JSON"),
            }
        }
    })
    .await
    .unwrap()
}
async fn closed(socket: &mut Socket) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match socket.next().await {
                None | Some(Err(_)) | Some(Ok(Message::Close(_))) => return,
                Some(Ok(Message::Ping(value))) => {
                    let _ = socket.send(Message::Pong(value)).await;
                }
                _ => {}
            }
        }
    })
    .await
    .expect("Revoked connection remained open");
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL; run the cloud integration check"]
async fn accounts_refresh_replay_ownership_and_reset() {
    let test = TestServer::new().await;
    let desktop = test.ready("alice", "user", "desktop").await;
    let mobile = test
        .login("alice", CHANGED, "mobile", &security::token())
        .await;
    let other = test.ready("bob", "user", "mobile").await;
    assert_eq!(test.register(&desktop, "host_alice").await, StatusCode::OK);
    assert_eq!(
        test.register(&desktop, "another_host").await,
        StatusCode::CONFLICT
    );
    assert_eq!(
        test.register(&other, "host_bob").await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        test.get("/hosts", &other)
            .await
            .json::<Value>()
            .await
            .unwrap()["hosts"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    assert_eq!(
        test.offer(&other, "host_alice").await.status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        test.client
            .delete(format!(
                "{}/api/v1/devices/{}",
                test.base,
                desktop["cloudDeviceId"].as_str().unwrap()
            ))
            .bearer_auth(access(&other))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let response = test
        .client
        .post(format!("{}/api/v1/auth/refresh", test.base))
        .json(&json!({"refreshToken":mobile["refreshToken"]}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let renewed: Value = response.json().await.unwrap();
    assert_eq!(
        test.get("/account", &mobile).await.status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        test.get("/account", &renewed).await.status(),
        StatusCode::OK
    );
    assert_eq!(
        test.client
            .post(format!("{}/api/v1/auth/refresh", test.base))
            .json(&json!({"refreshToken":mobile["refreshToken"]}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        test.get("/account", &renewed).await.status(),
        StatusCode::UNAUTHORIZED
    );
    // Concurrent replay must never issue two successful rotations.
    let concurrent = test
        .login("alice", CHANGED, "mobile", &security::token())
        .await;
    let rotate = || {
        test.client
            .post(format!("{}/api/v1/auth/refresh", test.base))
            .json(&json!({"refreshToken":concurrent["refreshToken"]}))
            .send()
    };
    let (a, b) = tokio::join!(rotate(), rotate());
    let statuses = [a.unwrap().status(), b.unwrap().status()];
    assert_eq!(statuses.iter().filter(|s| **s == StatusCode::OK).count(), 1);
    assert_eq!(
        statuses
            .iter()
            .filter(|s| **s == StatusCode::UNAUTHORIZED)
            .count(),
        1
    );
    let account_id = desktop["accountId"].as_str().unwrap();
    let hash = test
        .state
        .passwords
        .hash("test-reset-password")
        .await
        .unwrap();
    test.state
        .store
        .change_password(account_id, account_id, None, &hash, true)
        .await
        .unwrap();
    test.state.hub.disconnect_account(account_id);
    assert_eq!(
        test.get("/hosts", &desktop).await.status(),
        StatusCode::UNAUTHORIZED
    );
    let reset = test
        .login(
            "alice",
            "test-reset-password",
            "desktop",
            &security::token(),
        )
        .await;
    assert_eq!(
        test.get("/hosts", &reset).await.status(),
        StatusCode::FORBIDDEN
    );
    test.finish().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL; run the cloud integration check"]
async fn relay_tickets_inner_tls_selective_revocation_and_generation() {
    let test = TestServer::new().await;
    let desktop = test.ready("relay", "user", "desktop").await;
    let mobile = test
        .login("relay", CHANGED, "mobile", &security::token())
        .await;
    let wrong = test
        .login("relay", CHANGED, "mobile", &security::token())
        .await;
    assert_eq!(test.register(&desktop, "tls_host").await, StatusCode::OK);
    let mut control = test.control(&desktop).await;
    let response = test.offer(&mobile, "tls_host").await;
    assert_eq!(response.status(), StatusCode::OK);
    let offer: Value = response.json().await.unwrap();
    let notification = next_json(&mut control).await;
    let id = offer["tunnelId"].as_str().unwrap();
    let client_path = format!("/api/v1/relay/tunnels/{id}/client");
    let host_path = format!("/api/v1/relay/tunnels/{id}/host");
    let ticket = offer["clientTicket"].as_str().unwrap();
    assert_eq!(
        test.socket(&client_path, &wrong, Some(ticket)).await.err(),
        Some(StatusCode::FORBIDDEN)
    );
    assert_eq!(
        test.socket(&host_path, &mobile, Some(ticket)).await.err(),
        Some(StatusCode::FORBIDDEN)
    );
    let client = test
        .socket(&client_path, &mobile, Some(ticket))
        .await
        .unwrap();
    assert_eq!(
        test.socket(&client_path, &mobile, Some(ticket)).await.err(),
        Some(StatusCode::FORBIDDEN)
    );
    let host = test
        .socket(&host_path, &desktop, notification["hostTicket"].as_str())
        .await
        .unwrap();
    verify_inner_tls(client, host).await;
    // A second active tunnel is torn down when its specific mobile is revoked.
    let offer: Value = test.offer(&mobile, "tls_host").await.json().await.unwrap();
    let notification = next_json(&mut control).await;
    let id = offer["tunnelId"].as_str().unwrap();
    let mut client = test
        .socket(
            &format!("/api/v1/relay/tunnels/{id}/client"),
            &mobile,
            offer["clientTicket"].as_str(),
        )
        .await
        .unwrap();
    let mut host = test
        .socket(
            &format!("/api/v1/relay/tunnels/{id}/host"),
            &desktop,
            notification["hostTicket"].as_str(),
        )
        .await
        .unwrap();
    assert_eq!(
        test.client
            .delete(format!(
                "{}/api/v1/devices/{}",
                test.base,
                mobile["cloudDeviceId"].as_str().unwrap()
            ))
            .bearer_auth(access(&wrong))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    tokio::join!(closed(&mut client), closed(&mut host));
    assert_eq!(test.get("/account", &wrong).await.status(), StatusCode::OK);
    let replacement = test.control(&desktop).await;
    closed(&mut control).await;
    assert!(test.state.hub.online("tls_host"));
    drop(replacement);
    test.finish().await;
}

fn cookies(response: &Response) -> (String, String) {
    let mut jar = Vec::new();
    let mut csrf = String::new();
    for header in response.headers().get_all("set-cookie") {
        let value = header.to_str().unwrap();
        assert!(
            value.contains("Secure")
                && value.contains("SameSite=Strict")
                && value.contains("Path=/")
        );
        let pair = value.split(';').next().unwrap();
        if let Some(value) = pair.strip_prefix("__Host-agentdeck_csrf=") {
            csrf = value.into();
        } else {
            assert!(value.contains("HttpOnly"));
        }
        jar.push(pair);
    }
    assert!(!csrf.is_empty());
    (jar.join("; "), csrf)
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL, Node and installed Playwright browser"]
async fn admin_browser_uses_real_https_accounts_and_database() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = listener.local_addr().unwrap();
    let origin = format!("https://{address}");
    let test = TestServer::new_for_origin(origin.clone()).await;
    test.account("browser-admin", "admin").await;
    let certificate = rcgen::generate_simple_self_signed(vec!["127.0.0.1".into()]).unwrap();
    let tls = axum_server::tls_rustls::RustlsConfig::from_pem(
        certificate.cert.pem().into_bytes(),
        certificate.signing_key.serialize_pem().into_bytes(),
    )
    .await
    .unwrap();
    let handle = axum_server::Handle::new();
    let stop = handle.clone();
    let app = agentdeck_cloud::api::router(test.state.clone())
        .into_make_service_with_connect_info::<SocketAddr>();
    let task = tokio::spawn(async move {
        let _ = axum_server::from_tcp(listener)
            .unwrap()
            .acceptor(axum_server::tls_rustls::RustlsAcceptor::new(tls))
            .handle(stop)
            .serve(app)
            .await;
    });
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    let output = tokio::time::timeout(
        Duration::from_secs(90),
        tokio::process::Command::new("node")
            .arg("server/tests/admin-browser.mjs")
            .current_dir(root)
            .env("AGENTDECK_TEST_BROWSER_ORIGIN", origin)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .unwrap()
    .unwrap();
    handle.shutdown();
    task.abort();
    let success = output.status.success();
    let detail = String::from_utf8_lossy(&output.stderr)
        .replace(INITIAL, "[redacted]")
        .replace("browser-changed-password", "[redacted]");
    test.finish().await;
    assert!(success, "Admin browser acceptance failed: {detail}");
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL; run the cloud integration check"]
async fn admin_origin_csrf_password_lifecycle_and_native_separation() {
    let test = TestServer::new().await;
    let native = test.ready("administrator", "admin", "desktop").await;
    let login = || {
        test.client
            .post(format!("{}/api/v1/admin/session", test.base))
            .json(&json!({"username":"administrator","password":CHANGED}))
    };
    assert_eq!(
        login().send().await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        login()
            .header("Origin", "https://evil.test")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let response = login()
        .header("Origin", "https://cloud.test")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let (jar, csrf) = cookies(&response);
    let create = || {
        test.client
            .post(format!("{}/api/v1/admin/accounts", test.base))
            .header("Cookie", &jar)
            .json(&json!({"username":"created-user"}))
    };
    assert_eq!(
        create().send().await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        create()
            .header("Origin", "https://cloud.test")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        create()
            .header("Origin", "https://evil.test")
            .header("X-CSRF-Token", &csrf)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let response = create()
        .header("Origin", "https://cloud.test")
        .header("X-CSRF-Token", &csrf)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let created: Value = response.json().await.unwrap();
    let user = test
        .login(
            "created-user",
            created["temporaryPassword"].as_str().unwrap(),
            "mobile",
            &security::token(),
        )
        .await;
    assert!(user["mustChangePassword"].as_bool().unwrap());
    assert_eq!(
        test.get("/devices", &user).await.status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        test.client
            .get(format!("{}/api/v1/admin/accounts", test.base))
            .header(
                "Cookie",
                format!("__Host-agentdeck_access={}", access(&native))
            )
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        test.client
            .get(format!("{}/api/v1/account", test.base))
            .header("Origin", "https://cloud.test")
            .bearer_auth(access(&native))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let web_access = jar
        .split("; ")
        .find_map(|pair| pair.strip_prefix("__Host-agentdeck_access="))
        .unwrap();
    assert_eq!(
        test.client
            .get(format!("{}/api/v1/account", test.base))
            .bearer_auth(web_access)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let page = test
        .client
        .get(format!("{}/admin", test.base))
        .send()
        .await
        .unwrap();
    assert_eq!(page.status(), StatusCode::OK);
    assert!(page.headers()["content-security-policy"]
        .to_str()
        .unwrap()
        .contains("frame-ancestors 'none'"));
    let response = test
        .client
        .post(format!(
            "{}/api/v1/admin/accounts/{}/reset-password",
            test.base,
            user["accountId"].as_str().unwrap()
        ))
        .header("Cookie", &jar)
        .header("Origin", "https://cloud.test")
        .header("X-CSRF-Token", &csrf)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        test.get("/account", &user).await.status(),
        StatusCode::UNAUTHORIZED
    );
    let admin_id = native["accountId"].as_str().unwrap();
    let response=test.client.put(format!("{}/api/v1/admin/accounts/{admin_id}",test.base)).header("Cookie",&jar).header("Origin","https://cloud.test").header("X-CSRF-Token",&csrf).json(&json!({"disabled":true,"maxHosts":10,"maxMobileDevices":20,"maxTunnels":64,"bandwidthBytesPerSecond":5242880})).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    // Logging out must free the browser slot; stale device rows cannot exhaust the cap.
    let response = test
        .client
        .delete(format!("{}/api/v1/admin/session", test.base))
        .header("Cookie", &jar)
        .header("Origin", "https://cloud.test")
        .header("X-CSRF-Token", &csrf)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let account = test
        .state
        .store
        .find_login("administrator")
        .await
        .unwrap()
        .unwrap();
    for _ in 0..9 {
        let (tokens, _) = test
            .state
            .store
            .login(&account, &security::token(), "adminWeb", "Browser")
            .await
            .unwrap();
        let auth = test
            .state
            .store
            .authenticate(&tokens.access_token)
            .await
            .unwrap();
        test.state.store.logout(&auth).await.unwrap();
    }
    test.finish().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL; run the cloud integration check"]
async fn quota_expiry_and_disabled_account_close_pending_tunnels() {
    let test = TestServer::new().await;
    let desktop = test.ready("limits", "user", "desktop").await;
    test.sql("UPDATE accounts SET max_mobile_devices=1,max_tunnels=1")
        .await;
    let mobile = test
        .login("limits", CHANGED, "mobile", &security::token())
        .await;
    let response=test.client.post(format!("{}/api/v1/auth/login",test.base)).json(&json!({"username":"limits","password":CHANGED,"installationId":security::token(),"deviceName":"Over quota","kind":"mobile"})).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        test.register(&desktop, "limited_host").await,
        StatusCode::OK
    );
    let mut control = test.control(&desktop).await;
    let offer: Value = test
        .offer(&mobile, "limited_host")
        .await
        .json()
        .await
        .unwrap();
    let notification = next_json(&mut control).await;
    assert_eq!(
        test.offer(&mobile, "limited_host").await.status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    // Real expiry also removes the pending reservation and rejects both tickets.
    tokio::time::sleep(Duration::from_secs(31)).await;
    let id = offer["tunnelId"].as_str().unwrap();
    assert_eq!(
        test.socket(
            &format!("/api/v1/relay/tunnels/{id}/client"),
            &mobile,
            offer["clientTicket"].as_str()
        )
        .await
        .err(),
        Some(StatusCode::FORBIDDEN)
    );
    assert_eq!(
        test.socket(
            &format!("/api/v1/relay/tunnels/{id}/host"),
            &desktop,
            notification["hostTicket"].as_str()
        )
        .await
        .err(),
        Some(StatusCode::FORBIDDEN)
    );
    assert_eq!(test.state.hub.stats()["tunnels"], 0);
    let offer: Value = test
        .offer(&mobile, "limited_host")
        .await
        .json()
        .await
        .unwrap();
    let _ = next_json(&mut control).await;
    let id = offer["tunnelId"].as_str().unwrap();
    let mut client = test
        .socket(
            &format!("/api/v1/relay/tunnels/{id}/client"),
            &mobile,
            offer["clientTicket"].as_str(),
        )
        .await
        .unwrap();
    let account = desktop["accountId"].as_str().unwrap();
    test.state
        .store
        .update_account(
            account,
            account,
            &agentdeck_cloud::accounts::AccountUpdate {
                disabled: true,
                max_hosts: 10,
                max_mobile_devices: 1,
                max_tunnels: 1,
                bandwidth_bytes_per_second: 65536,
            },
        )
        .await
        .unwrap();
    test.state.hub.disconnect_account(account);
    tokio::join!(closed(&mut client), closed(&mut control));
    assert_eq!(
        test.get("/account", &mobile).await.status(),
        StatusCode::UNAUTHORIZED
    );
    test.finish().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL; 100 accounts, 200 PCs, 200 mobiles, 400 live tunnels"]
async fn relay_load_acceptance_100_accounts_400_tunnels() {
    let test = TestServer::new().await;
    let hash = test
        .state
        .passwords
        .hash("load-acceptance-password")
        .await
        .unwrap();
    let mut controls = Vec::new();
    let mut desktops = Vec::new();
    let mut mobiles = Vec::new();
    for index in 0..100 {
        let name = format!("load-{index}");
        let id = test
            .state
            .store
            .create_account(None, &name, &hash, "user")
            .await
            .unwrap();
        test.state
            .store
            .change_password(&id, &id, None, &hash, false)
            .await
            .unwrap();
        let account = test.state.store.find_login(&name).await.unwrap().unwrap();
        for device in 0..2 {
            let (desktop, _) = test
                .state
                .store
                .login(&account, &security::token(), "desktop", "Load computer")
                .await
                .unwrap();
            let desktop = serde_json::to_value(desktop).unwrap();
            let host = format!("load_host_{index}_{device}");
            assert_eq!(test.register(&desktop, &host).await, StatusCode::OK);
            controls.push(test.control(&desktop).await);
            desktops.push((desktop, host));
            let (mobile, _) = test
                .state
                .store
                .login(&account, &security::token(), "mobile", "Load mobile")
                .await
                .unwrap();
            mobiles.push(serde_json::to_value(mobile).unwrap());
        }
    }
    let mut tunnels = Vec::new();
    for index in 0..200 {
        for offset in 0..2 {
            let mobile = &mobiles[index / 2 * 2 + offset];
            let (desktop, host) = &desktops[index];
            let response = test.offer(mobile, host).await;
            assert_eq!(response.status(), StatusCode::OK);
            let offer: Value = response.json().await.unwrap();
            let notification = next_json(&mut controls[index]).await;
            let id = offer["tunnelId"].as_str().unwrap();
            let client = test
                .socket(
                    &format!("/api/v1/relay/tunnels/{id}/client"),
                    mobile,
                    offer["clientTicket"].as_str(),
                )
                .await
                .unwrap();
            let server = test
                .socket(
                    &format!("/api/v1/relay/tunnels/{id}/host"),
                    desktop,
                    notification["hostTicket"].as_str(),
                )
                .await
                .unwrap();
            tunnels.push((client, server));
        }
    }
    assert_eq!(test.state.hub.stats()["onlineHosts"], 200);
    assert_eq!(test.state.hub.stats()["tunnels"], 400);
    let start = std::time::Instant::now();
    for (index, (client, server)) in tunnels.iter_mut().enumerate() {
        let mut bytes = vec![0; 32 * 1024];
        bytes[..8].copy_from_slice(&(index as u64).to_be_bytes());
        client
            .send(Message::Binary(bytes.clone().into()))
            .await
            .unwrap();
        let incoming = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                match server.next().await.unwrap().unwrap() {
                    Message::Binary(value) => break value,
                    Message::Ping(value) => server.send(Message::Pong(value)).await.unwrap(),
                    _ => {}
                }
            }
        })
        .await
        .unwrap();
        assert_eq!(incoming.as_ref(), bytes);
    }
    assert_eq!(test.state.hub.stats()["relayedBytes"], 400 * 32 * 1024);
    eprintln!("Load acceptance: 100 accounts / 200 computers / 200 mobiles / 400 tunnels, 12.5 MiB forwarded in {:?}",start.elapsed());
    for (mut client, mut host) in tunnels {
        let _ = client.close(None).await;
        let _ = host.close(None).await;
    }
    for mut control in controls {
        let _ = control.close(None).await;
    }
    test.finish().await;
}

fn pg_command(tool: &str, config: &tokio_postgres::Config) -> tokio::process::Command {
    let executable = std::env::var_os("AGENTDECK_TEST_PG_BIN")
        .map(|directory| std::path::PathBuf::from(directory).join(tool))
        .unwrap_or_else(|| tool.into());
    let mut command = tokio::process::Command::new(executable);
    if let Some(tokio_postgres::config::Host::Tcp(host)) = config.get_hosts().first() {
        command.env("PGHOST", host);
    }
    if let Some(port) = config.get_ports().first() {
        command.env("PGPORT", port.to_string());
    }
    if let Some(user) = config.get_user() {
        command.env("PGUSER", user);
    }
    if let Some(password) = config.get_password() {
        command.env("PGPASSWORD", std::str::from_utf8(password).unwrap());
    }
    command.kill_on_drop(true);
    command
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL and matching pg_dump/pg_restore binaries"]
async fn database_backup_restore_preserves_bindings_without_resurrecting_sessions() {
    let test = TestServer::new().await;
    let desktop = test.ready("restore-user", "user", "desktop").await;
    assert_eq!(
        test.register(&desktop, "restore_host").await,
        StatusCode::OK
    );
    let directory = tempfile::tempdir().unwrap();
    let archive = directory.path().join("cloud.dump");
    let mut config: tokio_postgres::Config = std::env::var("AGENTDECK_TEST_DATABASE_URL")
        .unwrap()
        .parse()
        .unwrap();
    let output = pg_command("pg_dump", &config)
        .args(["--format=custom", "--dbname", &test.database, "--file"])
        .arg(&archive)
        .output()
        .await
        .unwrap();
    assert!(output.status.success(), "Database backup failed");
    // This session is revoked after the snapshot. Recovery must not resurrect it.
    let auth = test
        .state
        .store
        .authenticate(access(&desktop))
        .await
        .unwrap();
    test.state.store.logout(&auth).await.unwrap();
    let restored = format!("agentdeck_restore_{}", Uuid::new_v4().simple());
    test.admin
        .batch_execute(&format!("CREATE DATABASE {restored}"))
        .await
        .unwrap();
    let output = pg_command("pg_restore", &config)
        .args([
            "--dbname",
            &restored,
            "--no-owner",
            "--no-privileges",
            "--single-transaction",
            "--exit-on-error",
        ])
        .arg(&archive)
        .output()
        .await
        .unwrap();
    assert!(output.status.success(), "Database restore failed");
    config.dbname(&restored);
    let (connection, background) = config.connect(NoTls).await.unwrap();
    let task = tokio::spawn(async move {
        let _ = background.await;
    });
    connection
        .batch_execute("UPDATE sessions SET revoked_at=now() WHERE revoked_at IS NULL")
        .await
        .unwrap();
    let store = agentdeck_cloud::storage::Store::open(&database_url_for(&config))
        .await
        .unwrap();
    assert!(store.authenticate(access(&desktop)).await.is_err());
    assert!(store
        .refresh(desktop["refreshToken"].as_str().unwrap(), None, false)
        .await
        .is_err());
    let account = store.find_login("restore-user").await.unwrap().unwrap();
    assert!(test
        .state
        .passwords
        .verify(CHANGED, Some(&account.password_hash))
        .await
        .unwrap());
    assert!(!account.must_change_password);
    let hosts = store.hosts(&account.id).await.unwrap();
    assert_eq!(hosts.len(), 1);
    assert_eq!(hosts[0]["hostId"], "restore_host");
    let devices = store.devices(Some(&account.id)).await.unwrap();
    assert!(devices
        .iter()
        .any(|device| device["deviceId"] == desktop["cloudDeviceId"]));
    task.abort();
    test.admin
        .batch_execute(&format!("DROP DATABASE {restored} WITH (FORCE)"))
        .await
        .unwrap();
    test.finish().await;
}

fn byte_stream(mut socket: Socket) -> DuplexStream {
    let (stream, bridge) = tokio::io::duplex(128 * 1024);
    tokio::spawn(async move {
        let (mut read, mut write) = tokio::io::split(bridge);
        let mut buffer = vec![0; 32 * 1024];
        loop {
            tokio::select! {
                result=read.read(&mut buffer)=>match result { Ok(0)|Err(_)=>break,Ok(n)=>if socket.send(Message::Binary(buffer[..n].to_vec().into())).await.is_err(){break} },
                message=socket.next()=>match message {
                    Some(Ok(Message::Binary(value)))=>if write.write_all(&value).await.is_err(){break},
                    Some(Ok(Message::Ping(value)))=>if socket.send(Message::Pong(value)).await.is_err(){break},
                    Some(Ok(Message::Pong(_)))=>{},_=>break,
                }
            }
        }
        let _ = socket.close(None).await;
    });
    stream
}
async fn verify_inner_tls(client: Socket, host: Socket) {
    use rustls::pki_types::{PrivateKeyDer, PrivatePkcs8KeyDer, ServerName};
    let certified = rcgen::generate_simple_self_signed(vec!["127.0.0.1".into()]).unwrap();
    let certificate = certified.cert.der().clone();
    let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
        certified.signing_key.serialize_der(),
    ));
    let server = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![certificate.clone()], key)
        .unwrap();
    let mut roots = rustls::RootCertStore::empty();
    roots.add(certificate).unwrap();
    let client_config = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let client_stream = byte_stream(client);
    let host_stream = byte_stream(host);
    let connector = tokio_rustls::TlsConnector::from(Arc::new(client_config));
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(server));
    tokio::time::timeout(Duration::from_secs(10), async {
        let (client, host) = tokio::join!(
            connector.connect(ServerName::try_from("127.0.0.1").unwrap(), client_stream),
            acceptor.accept(host_stream)
        );
        let mut client = client.unwrap();
        let mut host = host.unwrap();
        let payload = b"private Codex business data through standard inner TLS";
        client.write_all(payload).await.unwrap();
        client.flush().await.unwrap();
        let mut received = vec![0; payload.len()];
        host.read_exact(&mut received).await.unwrap();
        assert_eq!(received, payload);
        host.write_all(b"ack").await.unwrap();
        host.flush().await.unwrap();
        let mut ack = [0; 3];
        client.read_exact(&mut ack).await.unwrap();
        assert_eq!(&ack, b"ack");
    })
    .await
    .unwrap();
}
