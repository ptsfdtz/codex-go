//! Bound work before JSON extraction, password hashing and database lookups.
use crate::{config::Config, security, Error};
use axum::{
    body::{to_bytes, Body},
    extract::{ConnectInfo, Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::{net::SocketAddr, sync::Arc, time::Duration};
use tokio::sync::Semaphore;

pub(crate) struct Guard {
    slots: Semaphore,
    limits: security::Limits,
    proxy_token: Option<String>,
    body_timeout: Duration,
}
impl Guard {
    pub(crate) fn new(config: &Config) -> Self {
        Self {
            slots: Semaphore::new(128),
            limits: security::Limits::default(),
            proxy_token: config.proxy_token.clone(),
            body_timeout: Duration::from_secs(10),
        }
    }
}

pub(crate) async fn guard(
    State(guard): State<Arc<Guard>>,
    request: Request,
    next: Next,
) -> Response {
    let Ok(_permit) = guard.slots.try_acquire() else {
        return Error::limit().into_response();
    };
    let Some(ConnectInfo(peer)) = request.extensions().get::<ConnectInfo<SocketAddr>>() else {
        return Error::unavailable().into_response();
    };
    let source = security::client_ip(request.headers(), *peer, guard.proxy_token.as_deref());
    if request.uri().path().starts_with("/api/") {
        if !guard.limits.take(format!("http:{source}"), 240., 60., 1.) {
            return Error::limit().into_response();
        }
        // Refresh and reconnect are otherwise unauthenticated database work.
        if matches!(
            request.uri().path(),
            "/api/v1/auth/refresh" | "/api/v1/web/refresh" | "/api/v1/admin/refresh"
        ) && !guard.limits.take(format!("refresh:{source}"), 30., 0.5, 1.)
        {
            return Error::limit().into_response();
        }
    }
    let (parts, body) = request.into_parts();
    // Also bound bodies on GET/unknown routes: no unbounded buffering and no
    // slow upload holding the slot forever. WebSocket upgrades have empty bodies.
    let body = match tokio::time::timeout(guard.body_timeout, to_bytes(body, 16 * 1024)).await {
        Ok(Ok(bytes)) => Body::from(bytes),
        Ok(Err(_)) => {
            return Error::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "INVALID_REQUEST",
                "请求内容无效或过大",
            )
            .into_response()
        }
        Err(_) => {
            return Error::new(
                StatusCode::REQUEST_TIMEOUT,
                "REQUEST_TIMEOUT",
                "读取请求超时",
            )
            .into_response()
        }
    };
    // Do not time out/cancel mutations once the handler has started: their
    // transaction may have committed and clients must retain unknown outcomes.
    next.run(Request::from_parts(parts, body)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{middleware, routing::any, Router};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn test_guard() -> Guard {
        Guard::new(&Config {
            database_url: String::new(),
            listen: "127.0.0.1:0".parse().unwrap(),
            public_origin: "https://test.invalid".into(),
            web_origins: vec![],
            max_tunnels: 16,
            proxy_token: Some("test-edge-token".into()),
        })
    }
    async fn serve(guard: Arc<Guard>) -> (SocketAddr, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new()
            .fallback(any(|| async { StatusCode::NO_CONTENT }))
            .layer(middleware::from_fn_with_state(guard, super::guard));
        let task = tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            .unwrap();
        });
        (address, task)
    }
    #[tokio::test]
    async fn limits_large_and_slow_bodies_without_echoing_credentials() {
        let mut guard = test_guard();
        guard.body_timeout = Duration::from_millis(100);
        let (address, task) = serve(Arc::new(guard)).await;
        let client = reqwest::Client::new();
        let response = client
            .post(format!("http://{address}/api/v1/auth/login"))
            .body("private-test-password".repeat(2000))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        assert!(!response
            .text()
            .await
            .unwrap()
            .contains("private-test-password"));
        let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
        stream.write_all(b"POST /api/v1/auth/login HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{").await.unwrap();
        let mut response = Vec::new();
        tokio::time::timeout(Duration::from_secs(3), stream.read_to_end(&mut response))
            .await
            .unwrap()
            .unwrap();
        assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 408"));
        task.abort();
    }
    #[tokio::test]
    async fn spoofed_forwarded_ips_cannot_evade_refresh_limits() {
        let (address, task) = serve(Arc::new(test_guard())).await;
        let client = reqwest::Client::new();
        for n in 0..31 {
            let response = client
                .post(format!("http://{address}/api/v1/auth/refresh"))
                .header("x-forwarded-for", format!("192.0.2.{}", n + 1))
                .header("x-agentdeck-proxy-token", "wrong-token")
                .send()
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                if n < 30 {
                    StatusCode::NO_CONTENT
                } else {
                    StatusCode::TOO_MANY_REQUESTS
                }
            );
        }
        // The authenticated edge may separate distinct clients behind the proxy.
        assert_eq!(
            client
                .post(format!("http://{address}/api/v1/web/refresh"))
                .header("x-forwarded-for", "192.0.2.99")
                .header("x-agentdeck-proxy-token", "test-edge-token")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NO_CONTENT
        );
        task.abort();
    }
    #[tokio::test]
    async fn concurrency_limit_rejects_without_queueing_and_recovers() {
        let guard = Arc::new(test_guard());
        let (address, task) = serve(guard.clone()).await;
        let permit = guard.slots.acquire_many(128).await.unwrap();
        let client = reqwest::Client::new();
        let url = format!("http://{address}/health/live");
        assert_eq!(
            client.get(&url).send().await.unwrap().status(),
            StatusCode::TOO_MANY_REQUESTS
        );
        drop(permit);
        assert_eq!(
            client.get(&url).send().await.unwrap().status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(guard.slots.available_permits(), 128);
        task.abort();
    }
    #[test]
    fn only_authenticated_single_forwarded_ip_is_trusted() {
        let mut headers = axum::http::HeaderMap::new();
        let peer = "127.0.0.1:8000".parse().unwrap();
        headers.insert("x-forwarded-for", "192.0.2.1".parse().unwrap());
        assert_eq!(security::client_ip(&headers, peer, Some("edge")), peer.ip());
        headers.insert("x-agentdeck-proxy-token", "edge".parse().unwrap());
        assert_eq!(
            security::client_ip(&headers, peer, Some("edge")).to_string(),
            "192.0.2.1"
        );
        headers.insert("x-forwarded-for", "192.0.2.1, 192.0.2.2".parse().unwrap());
        assert_eq!(security::client_ip(&headers, peer, Some("edge")), peer.ip());
        assert_eq!(security::client_ip(&headers, peer, None), peer.ip());
    }
}
