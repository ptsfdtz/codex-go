//! Full control-plane + native PC transport acceptance against real PostgreSQL.
#[cfg(target_os = "linux")]
#[path = "cloud_browser_test.rs"]
mod browser;
use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};
use tokio_tungstenite::{
    tungstenite::client::IntoClientRequest, Connector, MaybeTlsStream, WebSocketStream,
};
type OuterSocket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

struct Mobile {
    origin: String,
    client: reqwest::Client,
    token: String,
    outer: Arc<rustls::ClientConfig>,
    inner: Arc<rustls::ClientConfig>,
    host: String,
}
impl Mobile {
    async fn stream(&self) -> tokio_rustls::client::TlsStream<DuplexStream> {
        let response = self
            .client
            .post(format!("{}/api/v1/relay/tunnels", self.origin))
            .bearer_auth(&self.token)
            .json(&json!({"hostId":self.host}))
            .send()
            .await
            .unwrap();
        assert!(response.status().is_success());
        let offer: Value = response.json().await.unwrap();
        let mut request = format!(
            "{}/api/v1/relay/tunnels/{}/client",
            self.origin.replace("https:", "wss:"),
            offer["tunnelId"].as_str().unwrap()
        )
        .into_client_request()
        .unwrap();
        request.headers_mut().insert(
            "Authorization",
            format!("Bearer {}", self.token).parse().unwrap(),
        );
        request.headers_mut().insert(
            "X-Tunnel-Ticket",
            offer["clientTicket"].as_str().unwrap().parse().unwrap(),
        );
        let (socket, _) = tokio_tungstenite::connect_async_tls_with_config(
            request,
            None,
            false,
            Some(Connector::Rustls(self.outer.clone())),
        )
        .await
        .unwrap();
        let stream = byte_stream(socket);
        tokio_rustls::TlsConnector::from(self.inner.clone())
            .connect(
                rustls::pki_types::ServerName::try_from("127.0.0.1").unwrap(),
                stream,
            )
            .await
            .unwrap()
    }
    async fn post(&self, path: &str, value: Value) -> Value {
        let stream = self.stream().await;
        let (mut sender, connection) =
            hyper::client::conn::http1::handshake(hyper_util::rt::TokioIo::new(stream))
                .await
                .unwrap();
        tokio::spawn(async move {
            let _ = connection.await;
        });
        let request = hyper::Request::post(path)
            .header("Host", "127.0.0.1")
            .header("Content-Type", "application/json")
            .body(axum::body::Body::from(value.to_string()))
            .unwrap();
        let response = sender.send_request(request).await.unwrap();
        assert!(response.status().is_success());
        let bytes = axum::body::to_bytes(axum::body::Body::new(response.into_body()), 8192)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }
}
fn byte_stream(mut socket: OuterSocket) -> DuplexStream {
    let (stream, bridge) = tokio::io::duplex(128 * 1024);
    tokio::spawn(async move {
        let (mut read, mut write) = tokio::io::split(bridge);
        let mut bytes = vec![0; 32 * 1024];
        loop {
            tokio::select! {
                result=read.read(&mut bytes)=>match result{Ok(0)|Err(_)=>break,Ok(n)=>if socket.send(Message::Binary(bytes[..n].to_vec().into())).await.is_err(){break}},
                message=socket.next()=>match message{
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
fn trust(certificate: rustls::pki_types::CertificateDer<'static>) -> Arc<rustls::ClientConfig> {
    let mut roots = rustls::RootCertStore::empty();
    roots.add(certificate).unwrap();
    Arc::new(
        rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth(),
    )
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL; run native cloud acceptance"]
async fn actual_cloud_and_pc_login_pair_rpc_revoke_and_unbind() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let url =
        std::env::var("AGENTDECK_TEST_DATABASE_URL").expect("Set isolated PostgreSQL test URL");
    let mut database_config: tokio_postgres::Config = url.parse().unwrap();
    let (admin, connection) = database_config
        .connect(tokio_postgres::NoTls)
        .await
        .unwrap();
    tokio::spawn(async move {
        let _ = connection.await;
    });
    let database = format!("agentdeck_native_{}", uuid::Uuid::new_v4().simple());
    admin
        .batch_execute(&format!("CREATE DATABASE {database}"))
        .await
        .unwrap();
    database_config.dbname(&database);
    // The local acceptance cluster uses a keyword connection string.
    let database_url = if url.starts_with("postgres:") || url.starts_with("postgresql:") {
        let mut parsed = reqwest::Url::parse(&url).unwrap();
        parsed.set_path(&database);
        parsed.to_string()
    } else {
        format!("{url} dbname={database}")
    };
    let outer = rcgen::generate_simple_self_signed(vec!["127.0.0.1".into()]).unwrap();
    let tls = axum_server::tls_rustls::RustlsConfig::from_pem(
        outer.cert.pem().into_bytes(),
        outer.signing_key.serialize_pem().into_bytes(),
    )
    .await
    .unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = listener.local_addr().unwrap();
    let origin = format!("https://{address}");
    let cloud = agentdeck_cloud::State::open(agentdeck_cloud::config::Config {
        database_url,
        listen: address,
        public_origin: origin.clone(),
        web_origins: vec![],
        max_tunnels: 16,
        proxy_token: None,
    })
    .await
    .unwrap();
    let password = "native-cloud-test-password";
    let hash = cloud.passwords.hash(password).await.unwrap();
    let account = cloud
        .store
        .create_account(None, "native-test", &hash, "user")
        .await
        .unwrap();
    cloud
        .store
        .change_password(&account, &account, None, &hash, false)
        .await
        .unwrap();
    let handle = axum_server::Handle::new();
    let control = handle.clone();
    let app = agentdeck_cloud::api::router(cloud.clone());
    let cloud_task = tokio::spawn(async move {
        let _ = axum_server::from_tcp(listener)
            .unwrap()
            .acceptor(axum_server::tls_rustls::RustlsAcceptor::new(tls))
            .handle(control)
            .serve(app.into_make_service_with_connect_info::<std::net::SocketAddr>())
            .await;
    });
    let directory = tempfile::tempdir().unwrap();
    let store = Arc::new(crate::store::Store::open(&directory.path().join("native.db")).unwrap());
    let certificate = crate::security::Certificate::load(directory.path()).unwrap();
    let inner_der = rustls_pemfile::certs(&mut certificate.cert.as_bytes())
        .next()
        .unwrap()
        .unwrap();
    let outer_root = trust(outer.cert.der().clone());
    let inner_root = trust(inner_der);
    let client = reqwest::Client::builder()
        .add_root_certificate(reqwest::Certificate::from_der(outer.cert.der()).unwrap())
        .build()
        .unwrap();
    let (output, mut events) = tokio::sync::mpsc::channel(256);
    let drain = tokio::spawn(async move { while events.recv().await.is_some() {} });
    let free = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = free.local_addr().unwrap().port();
    drop(free);
    let mut core = Core::new(store, certificate, "127.0.0.1".into(), port, output);
    Arc::get_mut(&mut core).unwrap().cloud.client = client.clone();
    Arc::get_mut(&mut core).unwrap().cloud.connector = Some(outer_root.clone());
    Cloud::start(&core).await.unwrap();
    core.cloud_login(&origin, "native-test", password)
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        while !core.cloud.status().online {
            tokio::time::sleep(Duration::from_millis(20)).await
        }
    })
    .await
    .unwrap();
    let response=client.post(format!("{origin}/api/v1/auth/login")).json(&json!({"username":"native-test","password":password,"kind":"mobile","installationId":security::token(),"deviceName":"Native acceptance mobile"})).send().await.unwrap();
    assert!(response.status().is_success());
    let tokens: Value = response.json().await.unwrap();
    let host = core.store.meta("hostId").unwrap().unwrap();
    let mobile = Mobile {
        origin: origin.clone(),
        client: client.clone(),
        token: tokens["accessToken"].as_str().unwrap().into(),
        outer: outer_root,
        inner: inner_root,
        host,
    };
    // New account clients do not call either pairing endpoint. Exercise the
    // real cloud validation, LAN byte gateway, native TLS and RPC together.
    let installation = security::token();
    let account_login = || {
        client.post(format!("{origin}/api/v1/auth/login")).json(&json!({"username":"native-test","password":password,"kind":"mobile","installationId":installation,"deviceName":"Account acceptance"})).send()
    };
    let account_tokens: Value = account_login().await.unwrap().json().await.unwrap();
    let issue = |tokens: &Value| {
        client
            .post(format!("{origin}/api/v1/hosts/{}/access", mobile.host))
            .bearer_auth(crate::s(tokens, "accessToken"))
            .send()
    };
    let access: Value = issue(&account_tokens).await.unwrap().json().await.unwrap();
    let account_credential = crate::s(&access, "credential");
    let account_device = crate::s(&account_tokens, "cloudDeviceId");
    assert_eq!(
        core.account_device(account_credential, None).await.unwrap(),
        account_device
    );
    let wrong = RemoteIdentity {
        issuer: origin.clone(),
        account_id: account.clone(),
        device_id: uuid::Uuid::new_v4().to_string(),
    };
    assert!(core
        .account_device(account_credential, Some(&wrong))
        .await
        .is_err());
    let address = core.address.read().unwrap().clone();
    if address != "127.0.0.1" {
        let mut request = format!("ws://{address}:{}/api/v1/lan", port + 1)
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert("Origin", origin.parse().unwrap());
        request.headers_mut().insert(
            "Sec-WebSocket-Protocol",
            "agentdeck-lan-v1".parse().unwrap(),
        );
        let (outer_socket, _) = tokio_tungstenite::connect_async(request).await.unwrap();
        let stream = tokio_rustls::TlsConnector::from(mobile.inner.clone())
            .connect(
                rustls::pki_types::ServerName::try_from("127.0.0.1").unwrap(),
                byte_stream(outer_socket),
            )
            .await
            .unwrap();
        let mut request = "wss://127.0.0.1/api/v1/ws".into_client_request().unwrap();
        request.headers_mut().insert(
            "Authorization",
            format!("Bearer {account_credential}").parse().unwrap(),
        );
        let (mut socket, _) = tokio_tungstenite::client_async(request, stream)
            .await
            .unwrap();
        socket.send(Message::Text(json!({"v":1,"type":"request","id":"account-hello","action":"system.hello","payload":{"client":"Account acceptance","version":1}}).to_string().into())).await.unwrap();
        let packet = socket.next().await.unwrap().unwrap();
        let value: Value = serde_json::from_str(packet.to_text().unwrap()).unwrap();
        assert_eq!(value["type"], "response");
        assert_eq!(value["payload"]["hostId"], mobile.host);
        socket.close(None).await.unwrap();
    }
    core.revoke_device(account_device).unwrap();
    assert!(core.account_device(account_credential, None).await.is_err());
    let same_session: Value = issue(&account_tokens).await.unwrap().json().await.unwrap();
    assert!(core
        .account_device(crate::s(&same_session, "credential"), None)
        .await
        .is_err());
    let renewed: Value = account_login().await.unwrap().json().await.unwrap();
    let new_session: Value = issue(&renewed).await.unwrap().json().await.unwrap();
    assert_eq!(
        core.account_device(crate::s(&new_session, "credential"), None)
            .await
            .unwrap(),
        account_device
    );
    let qr = core
        .pairing
        .create_remote(
            &core.store,
            &core.endpoint(),
            &core.tls.fingerprint,
            &origin,
            &account,
        )
        .unwrap();
    let request = mobile
        .post(
            "/api/v1/pair/request",
            json!({"token":qr["token"],"displayName":"Mobile","nonce":security::token()}),
        )
        .await;
    core.pairing
        .confirm(&core.store, crate::s(&request, "requestId"), true)
        .unwrap();
    let grant = mobile
        .post(
            "/api/v1/pair/claim",
            json!({"requestId":request["requestId"],"claimToken":request["claimToken"]}),
        )
        .await;
    assert_eq!(grant["hostId"], qr["hostId"]);
    let stream = mobile.stream().await;
    let mut request = "wss://127.0.0.1/api/v1/ws".into_client_request().unwrap();
    request.headers_mut().insert(
        "Authorization",
        format!("Bearer {}", crate::s(&grant, "credential"))
            .parse()
            .unwrap(),
    );
    let (mut socket, _) = tokio_tungstenite::client_async(request, stream)
        .await
        .unwrap();
    socket
        .send(Message::Text(
            json!({"v":1,"type":"request","id":"hello","action":"system.hello","payload":{"client":"AgentDeck native acceptance","version":1}})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    let packet = socket.next().await.unwrap().unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(packet.to_text().unwrap()).unwrap()["type"],
        "response"
    );
    socket
        .send(Message::Text(
            json!({"v":1,"type":"request","id":"snapshot","action":"snapshot.get","payload":{}})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    let packet = socket.next().await.unwrap().unwrap();
    let snapshot: Value = serde_json::from_str(packet.to_text().unwrap()).unwrap();
    assert_eq!(snapshot["payload"]["host"]["hostId"], qr["hostId"]);
    let response = client
        .delete(format!(
            "{origin}/api/v1/devices/{}",
            tokens["cloudDeviceId"].as_str().unwrap()
        ))
        .bearer_auth(&mobile.token)
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match socket.next().await {
                None | Some(Err(_)) | Some(Ok(Message::Close(_))) => break,
                _ => {}
            }
        }
    })
    .await
    .expect("Revoked mobile remained connected");
    assert!(core.cloud.status().online);
    core.cloud_logout(true).await.unwrap();
    assert!(!core.cloud.status().signed_in);
    assert!(cloud.store.hosts(&account).await.unwrap().is_empty());
    core.shutdown().await;
    cloud.hub.shutdown();
    handle.shutdown();
    cloud_task.abort();
    drain.abort();
    admin
        .batch_execute(&format!("DROP DATABASE {database} WITH (FORCE)"))
        .await
        .unwrap();
}
