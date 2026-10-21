use agentdeck_service::{
    desktop_stdio::{relay, Manifest, Startup},
    rpc::ProtocolVersion,
    runtime::RuntimeTarget,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
use tokio_tungstenite::{accept_async, tungstenite::Message};
fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| v.to_string()).collect()
}

#[test]
fn manifest_rejects_inline_secrets_remote_endpoints_and_self_delegation() {
    let dir = tempfile::tempdir().unwrap();
    let native = dir.path().join("native.exe");
    let proxy = dir.path().join("proxy.exe");
    std::fs::write(&native, []).unwrap();
    std::fs::write(&proxy, []).unwrap();
    let path = dir.path().join("proxy.json");
    let valid = json!({"formatVersion":1,"nativeExecutable":native,"endpoint":"ws://127.0.0.1:12345/","tokenFile":dir.path().join("token"),"protocolVersion":"0.163.0-alpha.10.2"});
    std::fs::write(&path, valid.to_string()).unwrap();
    assert!(Manifest::load(&path, &proxy).is_ok());
    for (key, value) in [
        ("token", json!("never-inline")),
        ("nativeExecutable", json!(proxy)),
        ("endpoint", json!("ws://secret@127.0.0.1:12345/")),
        ("endpoint", json!("ws://192.168.1.1:12345/")),
        ("tokenFile", json!("relative")),
        ("formatVersion", json!(2)),
        ("protocolVersion", json!("unknown")),
    ] {
        let mut invalid = valid.clone();
        invalid[key] = value;
        std::fs::write(&path, invalid.to_string()).unwrap();
        let Err(error) = Manifest::load(&path, &proxy) else {
            panic!("invalid manifest accepted")
        };
        assert_eq!(error.code, "PROXY_CONFIG_ERROR");
        assert!(!error.message.contains("secret"));
    }
    std::fs::write(&path, vec![b' '; 65537]).unwrap();
    assert!(Manifest::load(&path, &proxy).is_err());
}

#[tokio::test]
async fn configuration_gate_never_forwards_a_queued_task_or_its_snapshot() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("ws://{}", listener.local_addr().unwrap());
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("token");
    std::fs::write(&file, "a".repeat(43)).unwrap();
    let target = RuntimeTarget::Attached {
        endpoint,
        token_file: file,
        protocol: ProtocolVersion::DesktopBaseline,
    };
    let native = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = accept_async(stream).await.unwrap();
        let hello: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(hello["method"], "initialize");
        ws.send(Message::Text(json!({"id":hello["id"],"result":{"codexHome":"C:/fixture","platformFamily":"windows","platformOs":"windows","userAgent":"Codex Desktop/0.163.0-alpha.10.2 (fixture)"}}).to_string().into())).await.unwrap();
        let check: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(check["method"], "config/read");
        ws.send(Message::Text(json!({"id":check["id"],"result":{"config":{"features":{"code_mode_host":false},"private_fixture":"not-forwarded"},"origins":{}}}).to_string().into())).await.unwrap();
        assert!(!matches!(ws.next().await, Some(Ok(Message::Text(_)))));
    });
    let input = format!(
        "{}\n{}\n",
        json!({"id":1,"method":"initialize","params":{}}),
        json!({"id":2,"method":"thread/start","params":{"cwd":"C:/fixture"}})
    );
    let mut output = Vec::new();
    let error = tokio::time::timeout(
        Duration::from_secs(3),
        relay(
            input.as_bytes(),
            &mut output,
            target,
            Startup::parse(&args(&["-c", "features.code_mode_host=true", "app-server"])).unwrap(),
        ),
    )
    .await
    .unwrap()
    .unwrap_err();
    assert_eq!(error.code, "PROXY_CONFIG_MISMATCH");
    assert!(output.is_empty());
    tokio::time::timeout(Duration::from_secs(3), native)
        .await
        .unwrap()
        .unwrap();
}

#[test]
fn startup_checks_toml_types_whole_tables_and_never_ignores_flags() {
    let startup = Startup::parse(&args(&[
        "-c",
        "features.code_mode_host=true",
        "app-server",
        "--analytics-default-enabled",
        "-c",
        "model='test'",
        "--config=experimental={a=1,b=[2,3]}",
    ]))
    .unwrap();
    let mut config = json!({"config":{"features":{"code_mode_host":true},"model":"test","experimental":{"a":1,"b":[2,3]},"analytics":{"enabled":false}}});
    startup.check(&config).unwrap();
    config["config"]["experimental"]["extra"] = json!(true);
    assert_eq!(
        startup.check(&config).unwrap_err().code,
        "PROXY_CONFIG_MISMATCH"
    );
    config["config"]["experimental"]
        .as_object_mut()
        .unwrap()
        .remove("extra");
    config["config"]["analytics"] = Value::Null;
    assert_eq!(
        startup.check(&config).unwrap_err().code,
        "PROXY_ANALYTICS_UNVERIFIED"
    );
    for input in [
        vec!["app-server", "daemon"],
        vec!["app-server", "--listen", "ws://127.0.0.1:1"],
        vec!["app-server", "--strict-config"],
        vec!["app-server", "-c", "x=1", "-c", "x.y=2"],
        vec!["app-server", "-c", "x=nan"],
        vec!["app-server", "-c"],
        vec!["exec"],
    ] {
        assert!(Startup::parse(&args(&input)).is_err());
    }
    Startup::parse(&args(&["app-server","--enable","feature_a","--disable","feature_b","-c","model=unquoted-model"])).unwrap().check(&json!({"config":{"features":{"feature_a":true,"feature_b":false},"model":"unquoted-model"}})).unwrap();
}

#[tokio::test]
async fn same_socket_gate_and_partial_stdin_survive_interleaved_native_event() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("ws://{}", listener.local_addr().unwrap());
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("token");
    std::fs::write(&file, "a".repeat(43)).unwrap();
    let target = RuntimeTarget::Attached {
        endpoint,
        token_file: file,
        protocol: ProtocolVersion::DesktopBaseline,
    };
    let (signal, ready) = tokio::sync::oneshot::channel();
    let native = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = accept_async(stream).await.unwrap();
        let hello: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(hello["id"], "original-init");
        ws.send(Message::Text(json!({"id":hello["id"],"result":{"codexHome":"C:/fixture","platformFamily":"windows","platformOs":"windows","userAgent":"Codex Desktop/0.163.0-alpha.10.2 (fixture)"}}).to_string().into())).await.unwrap();
        let check: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(check["method"], "config/read");
        ws.send(Message::Text(json!({"id":check["id"],"result":{"config":{"features":{"code_mode_host":true}},"origins":{}}}).to_string().into())).await.unwrap();
        ready.await.unwrap();
        ws.send(Message::Text(
            json!({"method":"fixture/progress","params":{"text":"during partial line"}})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
        let message: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(message, json!({"id":8,"result":{"text":"中文 😀"}}));
        ws.send(Message::Text(
            json!({"id":8,"result":{"same":true}}).to_string().into(),
        ))
        .await
        .unwrap();
        while ws.next().await.is_some_and(|r| r.is_ok()) {}
    });
    let (mut input, reader) = tokio::io::duplex(65536);
    let (writer, out) = tokio::io::duplex(65536);
    let task = tokio::spawn(relay(
        reader,
        writer,
        target,
        Startup::parse(&args(&["-c", "features.code_mode_host=true", "app-server"])).unwrap(),
    ));
    let mut out = tokio::io::BufReader::new(out);
    input
        .write_all(
            format!(
                "{}\n",
                json!({"id":"original-init","method":"initialize","params":{}})
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    let mut line = String::new();
    tokio::time::timeout(Duration::from_secs(3), out.read_line(&mut line))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&line).unwrap()["id"],
        "original-init"
    );
    let bytes = format!("{}\n", json!({"id":8,"result":{"text":"中文 😀"}})).into_bytes();
    let split = bytes.iter().position(|b| *b >= 128).unwrap() + 1;
    input.write_all(&bytes[..split]).await.unwrap();
    signal.send(()).unwrap();
    line.clear();
    tokio::time::timeout(Duration::from_secs(3), out.read_line(&mut line))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&line).unwrap()["method"],
        "fixture/progress"
    );
    input.write_all(&bytes[split..]).await.unwrap();
    line.clear();
    tokio::time::timeout(Duration::from_secs(3), out.read_line(&mut line))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&line).unwrap()["result"]["same"],
        true
    );
    drop(input);
    assert!(tokio::time::timeout(Duration::from_secs(3), task)
        .await
        .unwrap()
        .unwrap()
        .is_ok());
    tokio::time::timeout(Duration::from_secs(3), native)
        .await
        .unwrap()
        .unwrap();
}
