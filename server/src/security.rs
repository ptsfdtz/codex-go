use crate::{Error, Result};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Instant,
};
use subtle::ConstantTimeEq;
use tokio::sync::Semaphore;

// Only the configured edge may supply a single, parsed client IP. Never use
// arbitrary forwarded headers as rate-limit identities.
pub(crate) fn client_ip(
    headers: &axum::http::HeaderMap,
    peer: std::net::SocketAddr,
    proxy_token: Option<&str>,
) -> std::net::IpAddr {
    if proxy_token.is_some_and(|expected| {
        headers
            .get("x-agentdeck-proxy-token")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|value| equal(expected, value))
    }) {
        headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok())
            .unwrap_or(peer.ip())
    } else {
        peer.ip()
    }
}

pub fn token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}
pub fn digest(value: impl AsRef<[u8]>) -> String {
    format!("{:x}", Sha256::digest(value))
}
pub fn equal(a: &str, b: &str) -> bool {
    a.len() == b.len() && bool::from(a.as_bytes().ct_eq(b.as_bytes()))
}
pub fn valid_token(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
pub fn username(value: &str) -> Result<String> {
    let value = value.trim().to_ascii_lowercase();
    if value.is_empty()
        || value.len() > 80
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    {
        return Err(Error::invalid());
    }
    Ok(value)
}
pub fn password(value: &str) -> Result<()> {
    if value.len() < 12 || value.len() > 1024 {
        return Err(Error::invalid());
    }
    Ok(())
}
pub fn label(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.chars().count() > 80 || value.chars().any(char::is_control)
    {
        return Err(Error::invalid());
    }
    Ok(())
}

pub struct Passwords {
    slots: Arc<Semaphore>,
    dummy: String,
}
impl Passwords {
    pub async fn new() -> Result<Self> {
        let service = Self {
            slots: Arc::new(Semaphore::new(4)),
            dummy: String::new(),
        };
        let dummy = service.hash(&token()).await?;
        Ok(Self { dummy, ..service })
    }
    pub async fn hash(&self, value: &str) -> Result<String> {
        password(value)?;
        let permit = self
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| Error::limit())?;
        let value = value.to_owned();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let mut salt = [0u8; 16];
            rand::rng().fill_bytes(&mut salt);
            let salt = SaltString::encode_b64(&salt).map_err(|_| Error::unavailable())?;
            Argon2::default()
                .hash_password(value.as_bytes(), &salt)
                .map(|v| v.to_string())
                .map_err(|_| Error::unavailable())
        })
        .await
        .map_err(|_| Error::unavailable())?
    }
    pub async fn verify(&self, value: &str, hash: Option<&str>) -> Result<bool> {
        if value.len() > 1024 {
            return Err(Error::invalid());
        }
        let permit = self
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| Error::limit())?;
        let exists = hash.is_some();
        let hash = hash.unwrap_or(&self.dummy).to_owned();
        let value = value.to_owned();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let valid = PasswordHash::new(&hash).ok().is_some_and(|hash| {
                Argon2::default()
                    .verify_password(value.as_bytes(), &hash)
                    .is_ok()
            });
            valid && exists
        })
        .await
        .map_err(|_| Error::unavailable())
    }
}

#[derive(Default)]
pub struct Limits {
    entries: Mutex<HashMap<String, Bucket>>,
}
struct Bucket {
    tokens: f64,
    at: Instant,
}
impl Limits {
    pub fn take(&self, key: String, capacity: f64, per_second: f64, amount: f64) -> bool {
        let now = Instant::now();
        let mut entries = self.entries.lock().unwrap();
        if entries.len() >= 16384 && !entries.contains_key(&key) {
            entries.retain(|_, bucket| now.duration_since(bucket.at).as_secs() < 300);
            if entries.len() >= 16384 {
                return false;
            }
        }
        let bucket = entries.entry(key).or_insert(Bucket {
            tokens: capacity,
            at: now,
        });
        bucket.tokens = (bucket.tokens + now.duration_since(bucket.at).as_secs_f64() * per_second)
            .min(capacity);
        bucket.at = now;
        if bucket.tokens < amount {
            return false;
        }
        bucket.tokens -= amount;
        true
    }
}
