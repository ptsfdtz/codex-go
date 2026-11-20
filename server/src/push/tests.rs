use super::*;
use crate::accounts::SessionTokens;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn random_secret() -> SecretKey {
    SecretKey::random(&mut web_push_native::p256::elliptic_curve::rand_core::OsRng)
}
fn subscription(endpoint: &str, key: &SecretKey) -> Subscription {
    Subscription {
        endpoint: endpoint.into(),
        p256dh: B64.encode(key.public_key().to_encoded_point(false).as_bytes()),
        auth: B64.encode([12u8; 16]),
    }
}
fn sender() -> Push {
    Push::new(
        &B64.encode(random_secret().to_bytes()),
        "mailto:push@example.com".into(),
    )
    .unwrap()
}

#[test]
fn allowed_destinations_and_sealed_subscription_are_bound_to_the_recipient() {
    let key = random_secret();
    let push = sender();
    for url in [
        "http://fcm.googleapis.com/test",
        "https://127.0.0.1/push",
        "https://fcm.googleapis.com.evil.example/send",
        "https://user@fcm.googleapis.com/send",
        "https://fcm.googleapis.com:8443/send",
        "https://fcm.googleapis.com/send#fragment",
    ] {
        assert!(subscription(url, &key).builder().is_err());
    }
    let sub = subscription("https://web.push.apple.com/fixture", &key);
    assert!(sub.builder().is_ok());
    let sealed = push.seal("one", &sub).unwrap();
    assert!(!sealed.windows(7).any(|b| b == b"fixture"));
    assert!(push.open("two", &sealed).is_err());
    assert_eq!(push.open("one", &sealed).unwrap().endpoint, sub.endpoint);
}

fn browser(tokens: &SessionTokens) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert("origin", "https://app.example".parse().unwrap());
    headers.insert(
        "cookie",
        format!("__Host-agentdeck_web_access={}", tokens.access_token)
            .parse()
            .unwrap(),
    );
    headers.insert(
        "x-csrf-token",
        tokens.csrf_token.as_ref().unwrap().parse().unwrap(),
    );
    headers
}

/// One real TLS request goes only to the provider emulator on loopback.
async fn provider(
    push: &mut Push,
    status: &'static str,
) -> tokio::task::JoinHandle<(String, Vec<u8>)> {
    use tokio_rustls::rustls::{pki_types::PrivatePkcs8KeyDer, ServerConfig};
    let cert = rcgen::generate_simple_self_signed(vec!["fcm.googleapis.com".into()]).unwrap();
    let server = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            vec![cert.cert.der().clone()],
            PrivatePkcs8KeyDer::from(cert.signing_key.serialize_der()).into(),
        )
        .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    push.client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .tls_built_in_root_certs(false)
        .add_root_certificate(reqwest::Certificate::from_der(cert.cert.der()).unwrap())
        .resolve("fcm.googleapis.com", listener.local_addr().unwrap())
        .timeout(Duration::from_secs(4))
        .build()
        .unwrap();
    tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        let mut tls = tokio_rustls::TlsAcceptor::from(Arc::new(server))
            .accept(socket)
            .await
            .unwrap();
        let mut bytes = Vec::new();
        let header = loop {
            let mut b = [0; 1];
            tls.read_exact(&mut b).await.unwrap();
            bytes.push(b[0]);
            if bytes.ends_with(b"\r\n\r\n") {
                break String::from_utf8(bytes).unwrap();
            }
            assert!(bytes.len() < 8192);
        };
        let len = header
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length: ")
                    .and_then(|n| n.parse::<usize>().ok())
            })
            .unwrap();
        let mut body = vec![0; len];
        tls.read_exact(&mut body).await.unwrap();
        tls.write_all(
            format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .await
        .unwrap();
        tls.shutdown().await.unwrap();
        (header, body)
    })
}

#[tokio::test]
#[ignore = "requires a disposable *_test PostgreSQL database"]
async fn subscription_delivery_preferences_and_revocation() {
    let url = std::env::var("AGENTDECK_TEST_DATABASE_URL").unwrap();
    let config: tokio_postgres::Config = url.parse().unwrap();
    assert!(config.get_dbname().unwrap_or_default().ends_with("_test"));
    let mut state = State::open(crate::config::Config {
        database_url: url,
        listen: "127.0.0.1:0".parse().unwrap(),
        public_origin: "https://app.example".into(),
        web_origins: vec!["https://app.example".into()],
        max_tunnels: 4,
        proxy_token: None,
    })
    .await
    .unwrap();
    let mut push = sender();
    let delivery = provider(&mut push, "201 Created").await;
    Arc::get_mut(&mut state).unwrap().push = Some(push);
    let account = uuid::Uuid::new_v4().to_string();
    let db = state.store.pool.get().await.unwrap();
    db.execute("INSERT INTO accounts(id,username,password_hash,role,must_change_password) VALUES($1,$1,'fixture','user',false)",&[&account]).await.unwrap();
    let user = state.store.find_login(&account).await.unwrap().unwrap();
    let (web, _) = state
        .store
        .login(&user, &security::token(), "web", "Test browser")
        .await
        .unwrap();
    let (desktop, _) = state
        .store
        .login(&user, &security::token(), "desktop", "Test Host")
        .await
        .unwrap();
    let auth = state
        .store
        .authenticate(&desktop.access_token)
        .await
        .unwrap();
    let host = format!("host_{}", uuid::Uuid::new_v4());
    state
        .store
        .register_host(&auth, &host, "Test Host")
        .await
        .unwrap();
    let mut native = HeaderMap::new();
    native.insert(
        "authorization",
        format!("Bearer {}", desktop.access_token).parse().unwrap(),
    );
    let key = random_secret();
    let endpoint = format!(
        "https://fcm.googleapis.com/fcm/send/{}",
        uuid::Uuid::new_v4()
    );
    let input = |include_completion| Registration {
        account_id: account.clone(),
        device_id: web.cloud_device_id.clone(),
        include_completion,
        subscription: subscription(&endpoint, &key),
    };
    let mut wrong = input(false);
    wrong.account_id = uuid::Uuid::new_v4().to_string();
    assert!(
        subscribe(AppState(state.clone()), browser(&web), Json(wrong))
            .await
            .is_err()
    );
    let mut no_csrf = browser(&web);
    no_csrf.remove("x-csrf-token");
    assert!(
        subscribe(AppState(state.clone()), no_csrf, Json(input(false)))
            .await
            .is_err()
    );
    let _ = subscribe(AppState(state.clone()), browser(&web), Json(input(false)))
        .await
        .unwrap();
    let window = window(&state, &account).await.unwrap();
    assert!(window["since"].is_i64());
    assert_eq!(window["completionSince"], Value::Null);
    let session = format!("session_{}", uuid::Uuid::new_v4());
    let event = |kind| Wake {
        session_id: session.clone(),
        event_key: security::digest("event"),
        kind,
        approval_id: None,
        occurred_at: chrono::Utc::now().timestamp_millis(),
    };
    let _ = wake(
        AppState(state.clone()),
        native.clone(),
        Json(event(Kind::Completed)),
    )
    .await
    .unwrap();
    assert!(!delivery.is_finished());
    let approval = format!("approval_{}", uuid::Uuid::new_v4());
    let mut question = event(Kind::Question);
    question.approval_id = Some(approval.clone());
    let _ = wake(AppState(state.clone()), native.clone(), Json(question))
        .await
        .unwrap();
    let (headers, ciphertext) = tokio::time::timeout(Duration::from_secs(5), delivery)
        .await
        .unwrap()
        .unwrap();
    assert!(headers
        .to_ascii_lowercase()
        .contains("authorization: vapid t="));
    assert!(headers
        .to_ascii_lowercase()
        .contains("content-encoding: aes128gcm"));
    let plain = web_push_native::decrypt(ciphertext, &key, &[12u8; 16].into()).unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&plain).unwrap(),
        json!({"hostId":host,"accountId":account,"sessionId":session,"eventKey":security::digest("event"),"approvalId":approval})
    );
    let _ = subscribe(AppState(state.clone()), browser(&web), Json(input(true)))
        .await
        .unwrap();
    let Json(settings) = status(AppState(state.clone()), browser(&web))
        .await
        .unwrap();
    assert_eq!(settings["includeCompletion"], true);
    let removed = provider(
        Arc::get_mut(&mut state).unwrap().push.as_mut().unwrap(),
        "410 Gone",
    )
    .await;
    let _ = wake(
        AppState(state.clone()),
        native.clone(),
        Json(event(Kind::Question)),
    )
    .await
    .unwrap();
    assert!(
        !removed.is_finished(),
        "Replayed event must not reach the provider twice"
    );
    let mut completion = event(Kind::Completed);
    completion.event_key = security::digest("next-event");
    let _ = wake(AppState(state.clone()), native, Json(completion))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), removed)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        status(AppState(state.clone()), browser(&web))
            .await
            .unwrap()
            .0["endpointHash"],
        Value::Null
    );
    let _ = subscribe(AppState(state.clone()), browser(&web), Json(input(false)))
        .await
        .unwrap();
    let _ = unsubscribe(
        AppState(state.clone()),
        browser(&web),
        Json(Owner {
            account_id: account.clone(),
            device_id: web.cloud_device_id.clone(),
        }),
    )
    .await
    .unwrap();
    assert_eq!(
        status(AppState(state.clone()), browser(&web))
            .await
            .unwrap()
            .0["endpointHash"],
        Value::Null
    );
    let _ = subscribe(AppState(state.clone()), browser(&web), Json(input(false)))
        .await
        .unwrap();
    state
        .store
        .logout(&state.store.authenticate(&web.access_token).await.unwrap())
        .await
        .unwrap();
    let count: i64 = db
        .query_one(
            "SELECT count(*) FROM web_push_subscriptions WHERE session_id=$1",
            &[&web.session_id],
        )
        .await
        .unwrap()
        .get(0);
    assert_eq!(count, 0);
    state
        .store
        .delete_account(&account, &account)
        .await
        .unwrap();
}
