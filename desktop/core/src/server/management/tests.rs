use super::*;
use crate::{paths, store::Store};

#[tokio::test]
async fn local_control_authorizes_projects_and_code_checked_pairing() {
    let directory = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    security::restrict_directory(directory.path()).unwrap();
    let store = Arc::new(Store::open(&directory.path().join("agentdeck.db")).unwrap());
    let tls = security::Certificate::load(directory.path()).unwrap();
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let (tx, mut rx) = tokio::sync::mpsc::channel(32);
    let drain = tokio::spawn(async move { while rx.recv().await.is_some() {} });
    let core = Core::new(store, tls, "127.0.0.1".into(), port, tx);
    std::fs::write(directory.path().join(ENDPOINT_FILE), b"stale").unwrap();
    let management = Management::start(core.clone(), directory.path())
        .await
        .unwrap();
    let endpoint: Endpoint =
        serde_json::from_slice(&std::fs::read(directory.path().join(ENDPOINT_FILE)).unwrap())
            .unwrap();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let url = format!("http://{}/control", endpoint.address);
    for (name, value) in [("origin", "https://example.com"), ("host", "evil.example")] {
        let response = client
            .post(&url)
            .bearer_auth(&endpoint.token)
            .header(name, value)
            .json(&json!({"action":"state"}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    assert_eq!(
        client
            .post(&url)
            .header("authorization", "Bearer invalid")
            .json(&json!({"action":"state"}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        client
            .post(format!("{url}?token=ignored"))
            .bearer_auth(&endpoint.token)
            .json(&json!({"action":"state"}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert!(call(
        directory.path(),
        json!({"action":"arbitrary.rpc","method":"shell"})
    )
    .await
    .is_err());
    call(
        directory.path(),
        json!({"action":"project.add","path":dunce::canonicalize(project.path()).unwrap()}),
    )
    .await
    .unwrap();
    let state = call(directory.path(), json!({"action":"state"}))
        .await
        .unwrap();
    let project_id = s(&state["projects"][0], "projectId");
    assert_eq!(
        paths::root(&core.store, project_id).unwrap(),
        dunce::canonicalize(project.path()).unwrap()
    );
    assert_eq!(state["codexReady"], false);
    let invite = call(
        directory.path(),
        json!({"action":"pair.invite","address":"127.0.0.1","version":2}),
    )
    .await
    .unwrap();
    assert!(invite["image"].is_null());
    let (request, _) = core.pairing.request(&json!({"token":invite["token"],"nonce":security::token(),"displayName":"Test browser"})).unwrap();
    assert!(call(
        directory.path(),
        json!({"action":"pair.confirm","requestId":request["requestId"],"approve":true})
    )
    .await
    .is_err());
    assert!(call(
        directory.path(),
        json!({"action":"pair.approve","requestId":request["requestId"],"code":"wrong!"})
    )
    .await
    .is_err());
    let incorrect = if request["code"] == "000000" {
        "111111"
    } else {
        "000000"
    };
    assert!(call(
        directory.path(),
        json!({"action":"pair.approve","requestId":request["requestId"],"code":incorrect})
    )
    .await
    .is_err());
    call(
        directory.path(),
        json!({"action":"pair.approve","requestId":request["requestId"],"code":request["code"]}),
    )
    .await
    .unwrap();
    let grant = core
        .pairing
        .claim(
            &core.store,
            &json!({"requestId":request["requestId"],"claimToken":request["claimToken"]}),
        )
        .unwrap();
    call(
        directory.path(),
        json!({"action":"device.revoke","deviceId":grant["deviceId"]}),
    )
    .await
    .unwrap();
    let state = call(directory.path(), json!({"action":"state"}))
        .await
        .unwrap();
    assert!(state["devices"].as_array().unwrap().is_empty());
    call(
        directory.path(),
        json!({"action":"project.remove","projectId":project_id}),
    )
    .await
    .unwrap();
    assert!(paths::root(&core.store, project_id).is_err());
    drop(management);
    assert!(!directory.path().join(ENDPOINT_FILE).exists());
    assert!(call(directory.path(), json!({"action":"state"}))
        .await
        .is_err());
    core.shutdown().await;
    drain.abort();
}
