use super::*;
use axum::http::header;

#[tokio::test]
#[ignore = "requires dedicated AGENTDECK_TEST_DATABASE_URL ending in _test"]
async fn encrypted_key_vault_has_no_chat_or_proxy_routes() {
    let url = std::env::var("AGENTDECK_TEST_DATABASE_URL").unwrap();
    let config: tokio_postgres::Config = url.parse().unwrap();
    assert!(config.get_dbname().unwrap().ends_with("_test"));
    let mut state = State::open(crate::config::Config {
        database_url: url,
        listen: "127.0.0.1:0".parse().unwrap(),
        public_origin: "https://chat-test.invalid".into(),
        web_origins: vec!["https://chat-test.invalid".into()],
        max_tunnels: 16,
        proxy_token: None,
    })
    .await
    .unwrap();
    Arc::get_mut(&mut state).unwrap().chat.keys = Some(crypto::Keys::testing());
    let db = state.store.pool.get().await.unwrap();
    let account = Uuid::new_v4().to_string();
    let other = Uuid::new_v4().to_string();
    let csrf = crate::security::token();
    let mut headers = HeaderMap::new();
    headers.insert(header::ORIGIN, "https://chat-test.invalid".parse().unwrap());
    headers.insert("x-csrf-token", csrf.parse().unwrap());
    let mut stranger = headers.clone();
    for (owner, suffix, target) in [
        (&account, "first", &mut headers),
        (&other, "other", &mut stranger),
    ] {
        let device = Uuid::new_v4().to_string();
        let session = Uuid::new_v4().to_string();
        let token = crate::security::token();
        db.execute("INSERT INTO accounts(id,username,password_hash,role,must_change_password) VALUES($1,$1,'not-a-real-password','user',false)",&[owner]).await.unwrap();
        db.execute("INSERT INTO devices(id,account_id,installation_hash,kind,display_name) VALUES($1,$2,$1,'web',$3)",&[&device,owner,&suffix]).await.unwrap();
        db.execute(
            "INSERT INTO sessions(id,device_id,access_hash,csrf_hash) VALUES($1,$2,$3,$4)",
            &[
                &session,
                &device,
                &crate::security::digest(&token),
                &crate::security::digest(&csrf),
            ],
        )
        .await
        .unwrap();
        target.insert(
            header::COOKIE,
            format!("__Host-agentdeck_web_access={token}")
                .parse()
                .unwrap(),
        );
    }

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = crate::api::router(state.clone());
    let task = tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .unwrap()
    });
    let http = reqwest::Client::new();
    let id = Uuid::new_v4().to_string();
    let endpoint = format!("http://{address}/api/v1/chat/keys/{id}");
    let saved = http
        .put(&endpoint)
        .headers(headers.clone())
        .json(&json!({"apiKey":"fake-test-key"}))
        .send()
        .await
        .unwrap();
    assert_eq!(saved.status(), StatusCode::OK);
    let stored: String = db
        .query_one("SELECT api_key FROM chat_keys WHERE id=$1", &[&id])
        .await
        .unwrap()
        .get(0);
    assert!(!stored.contains("fake-test-key"));
    let revealed = http
        .post(format!("{endpoint}/reveal"))
        .headers(headers.clone())
        .send()
        .await
        .unwrap();
    assert_eq!(revealed.headers()[header::CACHE_CONTROL], "no-store");
    assert_eq!(
        revealed.json::<Value>().await.unwrap()["apiKey"],
        "fake-test-key"
    );
    let reveal_other = http
        .post(format!("{endpoint}/reveal"))
        .headers(stranger.clone())
        .send()
        .await
        .unwrap();
    assert_eq!(reveal_other.status(), StatusCode::FORBIDDEN);
    let overwrite = http
        .put(&endpoint)
        .headers(stranger.clone())
        .json(&json!({"apiKey":"stolen"}))
        .send()
        .await
        .unwrap();
    assert_eq!(overwrite.status(), StatusCode::FORBIDDEN);
    let extra = http
        .put(&endpoint)
        .headers(headers.clone())
        .json(&json!({"apiKey":"x","messages":[{"content":"never store this"}]}))
        .send()
        .await
        .unwrap();
    assert!(!extra.status().is_success());
    let mut no_csrf = headers.clone();
    no_csrf.remove("x-csrf-token");
    assert_eq!(
        http.post(format!("{endpoint}/reveal"))
            .headers(no_csrf)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        http.post(format!("{endpoint}/reveal"))
            .header(header::ORIGIN, "https://chat-test.invalid")
            .header("x-csrf-token", csrf.clone())
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    for route in [
        "conversations",
        "providers",
        "models",
        "conversations/example/messages",
        "conversations/example/events",
    ] {
        let url = format!("http://{address}/api/v1/chat/{route}");
        for response in [
            http.get(&url)
                .headers(headers.clone())
                .send()
                .await
                .unwrap(),
            http.post(&url)
                .headers(headers.clone())
                .json(&json!({"text":"not stored"}))
                .send()
                .await
                .unwrap(),
        ] {
            assert!(!response.status().is_success());
        }
    }
    let columns=db.query("SELECT column_name FROM information_schema.columns WHERE table_name='chat_keys' ORDER BY column_name", &[]).await.unwrap();
    assert_eq!(
        columns
            .iter()
            .map(|row| row.get::<_, String>(0))
            .collect::<Vec<_>>(),
        vec!["account_id", "api_key", "id"]
    );
    let _ = http
        .delete(&endpoint)
        .headers(headers.clone())
        .send()
        .await
        .unwrap();
    assert_eq!(
        http.post(format!("{endpoint}/reveal"))
            .headers(headers.clone())
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    db.execute("DELETE FROM sessions WHERE device_id IN (SELECT id FROM devices WHERE account_id=$1 OR account_id=$2)",&[&account,&other]).await.unwrap();
    db.execute(
        "DELETE FROM devices WHERE account_id=$1 OR account_id=$2",
        &[&account, &other],
    )
    .await
    .unwrap();
    db.execute(
        "DELETE FROM accounts WHERE id=$1 OR id=$2",
        &[&account, &other],
    )
    .await
    .unwrap();
    task.abort();
}
