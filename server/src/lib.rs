pub mod accounts;
pub mod api;
pub mod chat;
pub mod config;
mod http_security;
pub mod relay;
pub mod security;
pub mod storage;

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::sync::Arc;

pub type Result<T> = std::result::Result<T, Error>;
pub struct Error {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: &'static str,
}
impl Error {
    pub fn new(status: StatusCode, code: &'static str, message: &'static str) -> Self {
        Self {
            status,
            code,
            message,
        }
    }
    pub fn invalid() -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            "INVALID_REQUEST",
            "请求格式或参数无效",
        )
    }
    pub fn unauthorized() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "UNAUTHORIZED",
            "登录已失效或凭据无效",
        )
    }
    pub fn forbidden() -> Self {
        Self::new(StatusCode::FORBIDDEN, "FORBIDDEN", "无权执行此操作")
    }
    pub fn unavailable() -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "SERVICE_UNAVAILABLE",
            "服务暂时不可用",
        )
    }
    pub fn limit() -> Self {
        Self::new(
            StatusCode::TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "已达到请求或资源限制，请稍后重试",
        )
    }
}
impl std::fmt::Debug for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CloudError")
            .field("code", &self.code)
            .finish()
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code)
    }
}
impl std::error::Error for Error {}
impl From<tokio_postgres::Error> for Error {
    fn from(_: tokio_postgres::Error) -> Self {
        Self::unavailable()
    }
}
impl From<deadpool_postgres::PoolError> for Error {
    fn from(_: deadpool_postgres::PoolError) -> Self {
        Self::unavailable()
    }
}
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (self.status, [("Cache-Control","no-store")], Json(json!({"code":self.code,"message":self.message,"retryable":self.status==StatusCode::SERVICE_UNAVAILABLE}))).into_response()
    }
}

pub struct State {
    pub chat: chat::Chat,
    pub config: config::Config,
    pub store: storage::Store,
    pub hub: relay::Hub,
    pub passwords: security::Passwords,
    pub limits: security::Limits,
}
impl State {
    pub async fn open(config: config::Config) -> Result<Arc<Self>> {
        let store = storage::Store::open(&config.database_url).await?;
        let passwords = security::Passwords::new().await?;
        Ok(Arc::new(Self {
            chat: chat::Chat::environment()?,
            hub: relay::Hub::new(config.max_tunnels),
            config,
            store,
            passwords,
            limits: security::Limits::default(),
        }))
    }
}
