use crate::{Error, Result};
use std::{net::SocketAddr, str::FromStr};

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub listen: SocketAddr,
    pub public_origin: String,
    pub web_origins: Vec<String>,
    pub max_tunnels: usize,
    pub proxy_token: Option<String>,
}
impl Config {
    pub fn environment() -> Result<Self> {
        let database_url = std::env::var("AGENTDECK_DATABASE_URL").map_err(|_| Error::invalid())?;
        let public_origin =
            std::env::var("AGENTDECK_PUBLIC_ORIGIN").map_err(|_| Error::invalid())?;
        let public_origin = public_origin.trim_end_matches('/').to_owned();
        let uri = axum::http::Uri::from_str(&public_origin).map_err(|_| Error::invalid())?;
        if uri.scheme_str() != Some("https")
            || uri.authority().is_none()
            || uri.authority().is_some_and(|a| a.as_str().contains('@'))
            || uri.path() != "/"
            || uri.query().is_some()
        {
            return Err(Error::invalid());
        }
        let web_origins = std::env::var("AGENTDECK_WEB_ORIGINS")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| {
                let value = value.trim_end_matches('/').to_owned();
                let parsed = axum::http::Uri::from_str(&value).map_err(|_| Error::invalid())?;
                if parsed.scheme_str() != Some("https")
                    || parsed.authority().is_none()
                    || parsed.authority().is_some_and(|a| a.as_str().contains('@'))
                    || parsed.path() != "/"
                    || parsed.query().is_some()
                {
                    return Err(Error::invalid());
                }
                Ok(value)
            })
            .collect::<Result<Vec<_>>>()?;
        let listen = std::env::var("AGENTDECK_LISTEN")
            .unwrap_or_else(|_| "127.0.0.1:8080".into())
            .parse()
            .map_err(|_| Error::invalid())?;
        let max_tunnels = std::env::var("AGENTDECK_MAX_TUNNELS")
            .unwrap_or_else(|_| "1024".into())
            .parse()
            .map_err(|_| Error::invalid())?;
        if !(1..=16384).contains(&max_tunnels) {
            return Err(Error::invalid());
        }
        let proxy_token = std::env::var("AGENTDECK_PROXY_TOKEN")
            .ok()
            .filter(|v| !v.is_empty());
        if proxy_token.as_ref().is_some_and(|v| v.len() < 32) {
            return Err(Error::invalid());
        }
        Ok(Self {
            database_url,
            listen,
            public_origin,
            web_origins,
            max_tunnels,
            proxy_token,
        })
    }
}
