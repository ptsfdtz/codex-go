use agentdeck_cloud::{accounts::Auth, storage::Store};
use tokio_postgres::NoTls;
use uuid::Uuid;

// Uses a dedicated disposable database, never the normal cloud database URL.
#[tokio::test]
#[ignore = "requires AGENTDECK_TEST_DATABASE_URL pointing to a disposable *_test database"]
async fn names_persist_across_clients_without_overwriting_ownership_or_explicit_clears() {
    let url = std::env::var("AGENTDECK_TEST_DATABASE_URL").unwrap();
    let config: tokio_postgres::Config = url.parse().unwrap();
    assert!(config.get_dbname().unwrap_or("").ends_with("_test"));
    let (db, connection) = config.connect(NoTls).await.unwrap();
    tokio::spawn(async move { connection.await.unwrap() });
    let store = Store::open(&url).await.unwrap();
    // Exercise the existing-schema upgrade a second time as startup does.
    let second = Store::open(&url).await.unwrap();
    let account = Uuid::new_v4().to_string();
    let other = Uuid::new_v4().to_string();
    let device = Uuid::new_v4().to_string();
    let host = Uuid::new_v4().to_string();
    for id in [&account, &other] {
        db.execute("INSERT INTO accounts(id,username,password_hash,role,must_change_password) VALUES($1,$1,'test-only','user',false)", &[id]).await.unwrap();
    }
    db.execute("INSERT INTO devices(id,account_id,installation_hash,kind,display_name) VALUES($1,$2,$1,'desktop','Original device')", &[&device,&account]).await.unwrap();
    let auth = Auth {
        session_id: "test-session".into(),
        device_id: device.clone(),
        account_id: account.clone(),
        username: account.clone(),
        role: "user".into(),
        must_change_password: false,
        kind: "desktop".into(),
        csrf_hash: None,
        max_tunnels: 64,
        bandwidth_bytes_per_second: 5242880,
    };
    store
        .register_host(&auth, &host, "DESKTOP-TEST")
        .await
        .unwrap();
    let migration = store
        .rename_host(&auth, &host, "笔记本电脑", true)
        .await
        .unwrap();
    assert_eq!(migration["customName"], "笔记本电脑");
    assert_eq!(
        second.hosts(&account).await.unwrap()[0]["customName"],
        "笔记本电脑"
    );
    // Host heartbeat/registration updates the original name, never the custom name.
    store
        .register_host(&auth, &host, "NEW-MACHINE-NAME")
        .await
        .unwrap();
    assert_eq!(
        second.hosts(&account).await.unwrap()[0]["customName"],
        "笔记本电脑"
    );
    store
        .rename_host(&auth, &host, "学校服务器", false)
        .await
        .unwrap();
    assert_eq!(
        store
            .rename_host(&auth, &host, "stale browser", true)
            .await
            .unwrap()["customName"],
        "学校服务器"
    );
    let cleared = store.rename_host(&auth, &host, "", false).await.unwrap();
    assert!(cleared["customName"].is_null());
    assert_eq!(cleared["customNameConfigured"], true);
    assert!(store
        .rename_host(&auth, &host, "stale browser", true)
        .await
        .unwrap()["customName"]
        .is_null());
    let mut stranger = auth.clone();
    stranger.account_id = other.clone();
    assert!(store
        .rename_host(&stranger, &host, "forbidden", false)
        .await
        .is_err());
    assert!(store
        .rename_host(&auth, "missing-host", "forbidden", false)
        .await
        .is_err());
    assert!(store.hosts(&other).await.unwrap().is_empty());
    // Concurrent first-browser migrations choose one server value atomically.
    db.execute(
        "UPDATE hosts SET custom_name=NULL,custom_name_configured=false WHERE host_id=$1",
        &[&host],
    )
    .await
    .unwrap();
    let (a, b) = tokio::join!(
        store.rename_host(&auth, &host, "first", true),
        second.rename_host(&auth, &host, "second", true)
    );
    assert_eq!(a.unwrap()["customName"], b.unwrap()["customName"]);
    db.execute(
        "UPDATE devices SET revoked_at=now() WHERE id=$1",
        &[&device],
    )
    .await
    .unwrap();
    assert!(store
        .rename_host(&auth, &host, "forbidden", false)
        .await
        .is_err());
    db.execute("DELETE FROM hosts WHERE host_id=$1", &[&host])
        .await
        .unwrap();
    db.execute("DELETE FROM devices WHERE id=$1", &[&device])
        .await
        .unwrap();
    db.execute(
        "DELETE FROM accounts WHERE id=$1 OR id=$2",
        &[&account, &other],
    )
    .await
    .unwrap();
}
