use super::*;
use axum::{body::Body, http::header, response::Response};
use std::sync::atomic::{AtomicUsize, Ordering};

#[tokio::test]
#[ignore = "requires dedicated AGENTDECK_TEST_DATABASE_URL ending in _test"]
async fn account_scoped_chat_streams_stops_and_deduplicates_with_real_postgres() {
    let url = std::env::var("AGENTDECK_TEST_DATABASE_URL").unwrap();
    let parsed: tokio_postgres::Config = url.parse().unwrap();
    assert!(parsed.get_dbname().unwrap().ends_with("_test"));
    let counter = Arc::new(AtomicUsize::new(0));
    let calls = counter.clone();
    let mock = Router::new().route(
        "/v1/chat/completions",
        post(move |headers: HeaderMap, Json(body): Json<Value>| {
            let calls = calls.clone();
            async move {
                assert_eq!(headers[header::AUTHORIZATION], "Bearer fake-api-test-key");
                assert_eq!(body["stream"], true);
                if body["model"] == "model-a" {
                    assert_eq!(body["reasoning_effort"], "high");
                } else {
                    assert!(body.get("reasoning_effort").is_none());
                }
                calls.fetch_add(1, Ordering::SeqCst);
                let stream = futures_util::stream::unfold(0, |n| async move {
                    if n >= 4 {
                        return None;
                    }
                    tokio::time::sleep(Duration::from_millis(if n == 0 { 100 } else { 800 })).await;
                    let data = match n {
                        0 => "data: {\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\n\n",
                        1 => "data: {\"choices\":[{\"delta\":{\"content\":\"世界\"}}]}\n\n",
                        _ => "data: [DONE]\n\n",
                    };
                    Some((Ok::<_, Infallible>(data), (n + 1)))
                });
                Response::builder()
                    .header(header::CONTENT_TYPE, "text/event-stream")
                    .body(Body::from_stream(stream))
                    .unwrap()
            }
        }),
    );
    let socket = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = socket.local_addr().unwrap();
    let mock_task = tokio::spawn(async move { axum::serve(socket, mock).await.unwrap() });
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
    let chat = &mut Arc::get_mut(&mut state).unwrap().chat;
    chat.keys = Some(crypto::Keys::testing());
    chat.test_endpoint = Some(
        format!("http://{address}/v1/chat/completions")
            .parse()
            .unwrap(),
    );
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
    let local = listener.local_addr().unwrap();
    let app = crate::api::router(state.clone());
    let app_task = tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .unwrap()
    });
    let http = reqwest::Client::new();
    assert_eq!(
        http.get(format!("http://{local}/api/v1/chat/providers"))
            .header(header::ORIGIN, "https://chat-test.invalid")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let provider = Uuid::new_v4().to_string();
    let input = || ProviderInput {
        name: "Test API".into(),
        base_url: "https://api.example.com/v1".into(),
        api_key: Some("fake-api-test-key".into()),
        models: vec!["model-a".into(), "model-b".into()],
        model_efforts: Some(std::collections::HashMap::from([(
            "model-a".into(),
            vec!["low".into(), "medium".into(), "high".into()],
        )])),
    };
    let _ = save_provider(
        AppState(state.clone()),
        headers.clone(),
        Path(provider.clone()),
        Json(input()),
    )
    .await
    .unwrap();
    let public = providers(AppState(state.clone()), headers.clone())
        .await
        .unwrap()
        .0;
    assert!(!public.to_string().contains("fake-api-test-key"));
    let stored: String = db
        .query_one(
            "SELECT api_key FROM chat_providers WHERE id=$1",
            &[&provider],
        )
        .await
        .unwrap()
        .get(0);
    assert!(!stored.contains("fake-api-test-key"));
    assert!(providers(AppState(state.clone()), stranger.clone())
        .await
        .unwrap()
        .0["data"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(save_provider(
        AppState(state.clone()),
        stranger.clone(),
        Path(provider.clone()),
        Json(input())
    )
    .await
    .is_err());
    let mut changed = input();
    changed.base_url = "https://other.example/v1".into();
    changed.api_key = None;
    assert!(save_provider(
        AppState(state.clone()),
        headers.clone(),
        Path(provider.clone()),
        Json(changed)
    )
    .await
    .is_err());
    let id = Uuid::new_v4().to_string();
    let _ = create_conversation(
        AppState(state.clone()),
        headers.clone(),
        Json(CreateInput {
            id: id.clone(),
            provider_id: provider.clone(),
            model: "model-a".into(),
        }),
    )
    .await
    .unwrap();
    let request = Uuid::new_v4().to_string();
    let send_input = || SendInput {
        effort: "high".into(),
        request_id: request.clone(),
        text: "hello".into(),
        provider_id: provider.clone(),
        model: "model-a".into(),
        expected_last_message_id: None,
    };
    let mut unsupported = send_input();
    unsupported.effort = "ultra".into();
    assert!(send(
        AppState(state.clone()),
        headers.clone(),
        Path(id.clone()),
        Json(unsupported)
    )
    .await
    .is_err());
    let (a, b) = tokio::join!(
        send(
            AppState(state.clone()),
            headers.clone(),
            Path(id.clone()),
            Json(send_input())
        ),
        send(
            AppState(state.clone()),
            headers.clone(),
            Path(id.clone()),
            Json(send_input())
        )
    );
    assert!(a.is_ok() && b.is_ok());
    let mut changed = send_input();
    changed.effort = "low".into();
    assert!(send(
        AppState(state.clone()),
        headers.clone(),
        Path(id.clone()),
        Json(changed)
    )
    .await
    .is_err());
    let response = http
        .get(format!(
            "http://{local}/api/v1/chat/conversations/{id}/events"
        ))
        .headers(headers.clone())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/event-stream"
    );
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    assert_eq!(response.headers()["X-Accel-Buffering"], "no");
    let bytes = response.bytes_stream();
    use futures_util::StreamExt;
    tokio::pin!(bytes);
    let first = bytes.next().await.unwrap().unwrap();
    assert!(String::from_utf8_lossy(&first).contains("event: snapshot"));
    assert!(
        conversation(AppState(state.clone()), stranger.clone(), Path(id.clone()))
            .await
            .is_err()
    );
    assert!(send(
        AppState(state.clone()),
        stranger.clone(),
        Path(id.clone()),
        Json(send_input())
    )
    .await
    .is_err());
    let mut blocked = headers.clone();
    blocked.remove("x-csrf-token");
    assert!(save_provider(
        AppState(state.clone()),
        blocked,
        Path(provider.clone()),
        Json(input())
    )
    .await
    .is_err());
    let mut saw_partial = false;
    for _ in 0..200 {
        let current = view(&state, &account, &id).await.unwrap();
        let message = &current["messages"][1];
        if message["status"] == "running" && message["content"] == "Hello " {
            saw_partial = true;
        }
        if message["status"] == "complete" {
            assert_eq!(message["content"], "Hello 世界");
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let current = view(&state, &account, &id).await.unwrap();
    assert_eq!(current["effort"], "high");
    assert_eq!(current["messages"][1]["status"], "complete");
    assert!(saw_partial);
    assert_eq!(counter.load(Ordering::SeqCst), 1);
    assert_eq!(current["messages"].as_array().unwrap().len(), 2);
    assert!(send(
        AppState(state.clone()),
        headers.clone(),
        Path(id.clone()),
        Json(send_input())
    )
    .await
    .is_ok());
    let next = SendInput {
        effort: String::new(),
        request_id: Uuid::new_v4().to_string(),
        text: "stop this reply".into(),
        provider_id: provider.clone(),
        model: "model-b".into(),
        expected_last_message_id: Some(current["messages"][1]["id"].as_str().unwrap().into()),
    };
    let _ = send(
        AppState(state.clone()),
        headers.clone(),
        Path(id.clone()),
        Json(next),
    )
    .await
    .unwrap();
    let current = view(&state, &account, &id).await.unwrap();
    let message = current["messages"][3]["id"].as_str().unwrap().to_owned();
    let _ = stop(
        AppState(state.clone()),
        headers.clone(),
        Path(id.clone()),
        Json(StopInput {
            message_id: message.clone(),
        }),
    )
    .await
    .unwrap();
    tokio::time::sleep(Duration::from_millis(650)).await;
    assert_eq!(
        view(&state, &account, &id).await.unwrap()["messages"][3]["status"],
        "stopped"
    );
    db.execute("UPDATE chat_messages SET status='running',updated_at=now()-interval '60 seconds' WHERE id=$1",&[&message]).await.unwrap();
    assert_eq!(
        view(&state, &account, &id).await.unwrap()["messages"][3]["status"],
        "interrupted"
    );
    let _ = delete_provider(AppState(state.clone()), headers.clone(), Path(provider))
        .await
        .unwrap();
    assert_eq!(
        view(&state, &account, &id).await.unwrap()["messages"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
    let _ = delete_conversation(AppState(state.clone()), headers, Path(id))
        .await
        .unwrap();
    for owner in [&account, &other] {
        db.execute(
            "DELETE FROM sessions WHERE device_id IN (SELECT id FROM devices WHERE account_id=$1)",
            &[owner],
        )
        .await
        .unwrap();
        db.execute("DELETE FROM devices WHERE account_id=$1", &[owner])
            .await
            .unwrap();
        db.execute("DELETE FROM accounts WHERE id=$1", &[owner])
            .await
            .unwrap();
    }
    app_task.abort();
    mock_task.abort();
}
