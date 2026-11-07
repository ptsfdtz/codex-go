use agentdeck_cloud::{config::Config, security, State};
use axum::http::{header, HeaderMap, StatusCode};
use serde_json::{json, Value};
use std::net::SocketAddr;
use uuid::Uuid;

// Run only against a disposable database; no normal cloud credentials are read.
#[tokio::test]
#[ignore = "requires dedicated AGENTDECK_TEST_DATABASE_URL ending in _test"]
async fn cloud_authentication_and_secret_boundaries() {
    let url = std::env::var("AGENTDECK_TEST_DATABASE_URL").unwrap();
    let parsed: tokio_postgres::Config = url.parse().unwrap();
    assert!(parsed.get_dbname().unwrap().ends_with("_test"));
    let state = State::open(Config {
        database_url: url,
        listen: "127.0.0.1:0".parse().unwrap(),
        public_origin: "https://security-test.invalid".into(),
        web_origins: vec!["https://security-test.invalid".into()],
        max_tunnels: 16,
        proxy_token: None,
    })
    .await
    .unwrap();
    let password = security::token();
    let hash = state.passwords.hash(&password).await.unwrap();
    let first = Uuid::new_v4().to_string();
    let second = Uuid::new_v4().to_string();
    let account = state
        .store
        .create_account(None, &first, &hash, "user")
        .await
        .unwrap();
    let other = state
        .store
        .create_account(None, &second, &hash, "user")
        .await
        .unwrap();
    state
        .store
        .change_password(&account, &account, None, &hash, false)
        .await
        .unwrap();
    state
        .store
        .change_password(&other, &other, None, &hash, false)
        .await
        .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = agentdeck_cloud::api::router(state.clone());
    let task = tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    let http = reqwest::Client::new();
    let base = format!("http://{address}");
    let too_large = http
        .post(format!("{base}/api/v1/auth/login"))
        .header(header::ORIGIN, "https://security-test.invalid")
        .body("do-not-reflect-this-password".repeat(1000))
        .send()
        .await
        .unwrap();
    assert_eq!(too_large.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(
        too_large
            .headers()
            .get("access-control-allow-origin")
            .unwrap(),
        "https://security-test.invalid"
    );
    assert_eq!(
        too_large.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );
    assert!(!too_large
        .text()
        .await
        .unwrap()
        .contains("do-not-reflect-this-password"));
    // Fill the former quota without tripping the password attempt rate limit.
    let web_account = state.store.find_login(&first).await.unwrap().unwrap();
    let mut prior_web_sessions = Vec::new();
    for _ in 0..16 {
        let (tokens, revoked) = state
            .store
            .login(&web_account, &security::token(), "web", "prior browser")
            .await
            .unwrap();
        assert!(revoked.is_empty());
        prior_web_sessions.push(tokens.access_token);
    }
    let web = http.post(format!("{base}/api/v1/web/login"))
        .header(header::ORIGIN, "https://security-test.invalid")
        .json(&json!({"username":first,"password":password,"installationId":security::token(),"deviceName":"security test web","kind":"desktop"}))
        .send().await.unwrap();
    assert_eq!(web.status(), StatusCode::OK);
    for token in prior_web_sessions {
        assert!(state.store.authenticate(&token).await.is_ok());
    }
    let cookies = web
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|v| {
            let v = v.to_str().unwrap();
            assert!(v.contains("Secure") && v.contains("Path=/"));
            if v.starts_with("__Host-agentdeck_web_access=")
                || v.starts_with("__Host-agentdeck_web_refresh=")
            {
                assert!(v.contains("HttpOnly"));
            }
            v.split(';').next().unwrap().to_owned()
        })
        .collect::<Vec<_>>()
        .join("; ");
    let identity: Value = web.json().await.unwrap();
    assert!(identity.get("accessToken").is_none() && identity.get("refreshToken").is_none());
    let mut headers = HeaderMap::new();
    headers.insert(
        header::ORIGIN,
        "https://security-test.invalid".parse().unwrap(),
    );
    headers.insert(header::COOKIE, cookies.parse().unwrap());
    headers.insert(
        "x-csrf-token",
        identity["csrfToken"].as_str().unwrap().parse().unwrap(),
    );
    assert_eq!(
        http.get(format!("{base}/api/v1/account"))
            .headers(headers.clone())
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );

    // A browser session cannot be promoted to an administrator or native bearer.
    let access = cookies
        .split("; ")
        .find_map(|c| c.strip_prefix("__Host-agentdeck_web_access="))
        .unwrap();
    assert_eq!(
        http.get(format!("{base}/api/v1/account"))
            .bearer_auth(access)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        http.get(format!("{base}/api/v1/admin/accounts"))
            .header(header::COOKIE, format!("__Host-agentdeck_access={access}"))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    for path in [
        "/api/v1/admin/accounts",
        "/api/v1/admin/audit",
        "/api/v1/admin/status",
        "/api/v1/devices",
    ] {
        let r = http.get(format!("{base}{path}")).send().await.unwrap();
        assert!(r.status().is_client_error());
        let text = r.text().await.unwrap();
        assert!(!text.contains(&hash) && !text.contains(&password));
    }
    for path in [
        "/.env",
        "/cloud.env",
        "/.git/config",
        "/server/deploy/.env",
        "/backup.dump",
    ] {
        assert_eq!(
            http.get(format!("{base}{path}"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
    }
    let mut evil = headers.clone();
    evil.insert(header::ORIGIN, "https://evil.invalid".parse().unwrap());
    assert_eq!(
        http.get(format!("{base}/api/v1/account"))
            .headers(evil.clone())
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let preflight = http
        .request(reqwest::Method::OPTIONS, format!("{base}/api/v1/account"))
        .headers(evil)
        .send()
        .await
        .unwrap();
    assert!(!preflight
        .headers()
        .contains_key("access-control-allow-origin"));

    let native = http.post(format!("{base}/api/v1/auth/login"))
        .json(&json!({"username":second,"password":password,"installationId":security::token(),"deviceName":"other desktop","kind":"desktop"}))
        .send().await.unwrap();
    assert_eq!(native.status(), StatusCode::OK);
    let native: Value = native.json().await.unwrap();
    let other_device = native["cloudDeviceId"].as_str().unwrap();
    // Missing/mismatched CSRF cannot revoke even the current account's device.
    for csrf in [None, Some("wrong-token")] {
        let mut bad = headers.clone();
        bad.remove("x-csrf-token");
        if let Some(csrf) = csrf {
            bad.insert("x-csrf-token", csrf.parse().unwrap());
        }
        assert_eq!(
            http.delete(format!(
                "{base}/api/v1/devices/{}",
                identity["cloudDeviceId"].as_str().unwrap()
            ))
            .headers(bad)
            .send()
            .await
            .unwrap()
            .status(),
            StatusCode::FORBIDDEN
        );
    }
    assert_eq!(
        http.delete(format!("{base}/api/v1/devices/{other_device}"))
            .headers(headers.clone())
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    // Wrong ownership must be rejected without invalidating the other session.
    assert_eq!(
        http.get(format!("{base}/api/v1/account"))
            .bearer_auth(native["accessToken"].as_str().unwrap())
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );

    let refresh = native["refreshToken"].as_str().unwrap();
    let first_refresh = http
        .post(format!("{base}/api/v1/auth/refresh"))
        .json(&json!({"refreshToken":refresh}))
        .send()
        .await
        .unwrap();
    assert_eq!(first_refresh.status(), StatusCode::OK);
    let rotated: Value = first_refresh.json().await.unwrap();
    assert_ne!(rotated["accessToken"], native["accessToken"]);
    assert_eq!(
        http.post(format!("{base}/api/v1/auth/refresh"))
            .json(&json!({"refreshToken":refresh}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        http.get(format!("{base}/api/v1/account"))
            .bearer_auth(rotated["accessToken"].as_str().unwrap())
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );

    // Password reset invalidates both browser access and refresh credentials.
    state
        .store
        .change_password(&account, &account, None, &hash, true)
        .await
        .unwrap();
    let r = http
        .get(format!("{base}/api/v1/account"))
        .headers(headers.clone())
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(r.headers().get(header::CACHE_CONTROL).unwrap(), "no-store");
    assert_eq!(
        http.post(format!("{base}/api/v1/web/refresh"))
            .headers(headers)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    task.abort();
}
