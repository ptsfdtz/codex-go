use crate::{Error, Result};
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::RngCore;

pub(super) struct Keys(Aes256Gcm);
impl Keys {
    pub fn environment() -> Result<Option<Self>> {
        let Some(value) = std::env::var("AGENTDECK_CHAT_ENCRYPTION_KEY")
            .ok()
            .filter(|v| !v.is_empty())
        else {
            return Ok(None);
        };
        let bytes = STANDARD.decode(value).map_err(|_| Error::invalid())?;
        Ok(Some(Self(
            Aes256Gcm::new_from_slice(&bytes).map_err(|_| Error::invalid())?,
        )))
    }
    #[cfg(test)]
    pub fn testing() -> Self {
        Self(Aes256Gcm::new_from_slice(&[42; 32]).unwrap())
    }
    pub fn encrypt(&self, scope: &str, key: &str) -> Result<String> {
        let mut nonce = [0u8; 12];
        rand::rng().fill_bytes(&mut nonce);
        let encrypted = self
            .0
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: key.as_bytes(),
                    aad: scope.as_bytes(),
                },
            )
            .map_err(|_| Error::unavailable())?;
        Ok(STANDARD.encode([nonce.to_vec(), encrypted].concat()))
    }
    pub fn decrypt(&self, scope: &str, value: &str) -> Result<String> {
        let bytes = STANDARD.decode(value).map_err(|_| Error::unavailable())?;
        if bytes.len() < 28 {
            return Err(Error::unavailable());
        }
        let clear = self
            .0
            .decrypt(
                Nonce::from_slice(&bytes[..12]),
                Payload {
                    msg: &bytes[12..],
                    aad: scope.as_bytes(),
                },
            )
            .map_err(|_| Error::unavailable())?;
        String::from_utf8(clear).map_err(|_| Error::unavailable())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encrypted_keys_are_bound_to_account_and_provider() {
        let keys = Keys(Aes256Gcm::new_from_slice(&[42; 32]).unwrap());
        let a = keys.encrypt("account:provider", "secret-key").unwrap();
        let b = keys.encrypt("account:provider", "secret-key").unwrap();
        assert_ne!(a, b);
        assert!(!a.contains("secret-key"));
        assert_eq!(keys.decrypt("account:provider", &a).unwrap(), "secret-key");
        assert!(keys.decrypt("other:provider", &a).is_err());
        assert!(keys.decrypt("account:other", &a).is_err());
    }
}
