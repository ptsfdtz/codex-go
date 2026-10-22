use crate::{digest, ensure, Error, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use std::{
    net::{IpAddr, Ipv4Addr},
    path::Path,
};
pub fn token() -> String {
    use rand::RngCore;
    let mut b = [0u8; 32];
    rand::rng().fill_bytes(&mut b);
    URL_SAFE_NO_PAD.encode(b)
}
pub fn valid_token(s: &str) -> bool {
    s.len() == 43
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
pub fn equal(a: &str, b: &str) -> bool {
    use subtle::ConstantTimeEq;
    a.len() == b.len() && bool::from(a.as_bytes().ct_eq(b.as_bytes()))
}
pub fn dpapi(value: &[u8], protect: bool) -> Result<Vec<u8>> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::{Foundation::LocalFree, Security::Cryptography::*};
        let input = CRYPT_INTEGER_BLOB {
            cbData: value
                .len()
                .try_into()
                .map_err(|_| Error::new("SECRET_STORE_ERROR", "Secret too large"))?,
            pbData: value.as_ptr() as _,
        };
        let mut out: CRYPT_INTEGER_BLOB = unsafe { std::mem::zeroed() };
        // Compatibility identifier used by the original CurrentUser DPAPI store.
        // This is public domain separation, not encryption key material.
        let entropy_bytes = b"AgentDeck/v1/CurrentUser";
        let entropy = CRYPT_INTEGER_BLOB {
            cbData: entropy_bytes.len() as u32,
            pbData: entropy_bytes.as_ptr() as _,
        };
        let ok = unsafe {
            if protect {
                CryptProtectData(
                    &input,
                    std::ptr::null(),
                    &entropy,
                    std::ptr::null(),
                    std::ptr::null(),
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut out,
                )
            } else {
                CryptUnprotectData(
                    &input,
                    std::ptr::null_mut(),
                    &entropy,
                    std::ptr::null(),
                    std::ptr::null(),
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut out,
                )
            }
        };
        ensure(
            ok != 0,
            "SECRET_STORE_ERROR",
            "Windows CurrentUser DPAPI failed",
        )?;
        let bytes = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
        unsafe {
            std::ptr::write_bytes(out.pbData, 0, out.cbData as usize);
            LocalFree(out.pbData as _);
        }
        Ok(bytes)
    }
    #[cfg(not(windows))]
    {
        let _ = (value, protect);
        Err(Error::new(
            "UNSUPPORTED_PLATFORM",
            "Production secrets require Windows DPAPI",
        ))
    }
}
pub fn addresses() -> Vec<String> {
    let mut a: Vec<String> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .iter()
        .filter_map(|i| match i.ip() {
            IpAddr::V4(ip) if ip.is_private() && !ip.is_loopback() => Some(ip.to_string()),
            _ => None,
        })
        .collect();
    a.sort();
    a.dedup();
    a
}
pub fn restrict_directory(path: &Path) -> Result<()> {
    std::fs::create_dir_all(path)?;
    #[cfg(windows)]
    {
        let who = crate::codex::sync_command("whoami.exe", &["/user", "/fo", "csv", "/nh"], None)?;
        let re = regex::Regex::new(r"S-1-5-[0-9-]+").unwrap();
        let sid = re
            .find(&who)
            .ok_or_else(|| Error::new("SECRET_STORE_ERROR", "Cannot identify Windows user"))?
            .as_str();
        let path = path
            .to_str()
            .ok_or_else(|| Error::new("CONFIG_ERROR", "Invalid data path"))?;
        crate::codex::sync_command(
            "icacls.exe",
            &[
                path,
                "/inheritance:r",
                "/grant:r",
                &format!("*{sid}:(OI)(CI)F"),
                "*S-1-5-18:(OI)(CI)F",
            ],
            None,
        )?;
    }
    Ok(())
}
pub struct Certificate {
    pub cert: String,
    pub key: String,
    pub fingerprint: String,
    pub ips: Vec<IpAddr>,
}
impl Certificate {
    pub fn load(directory: &Path) -> Result<Self> {
        let path = directory.join("tls.dpapi");
        let stored: Value = if path.exists() {
            serde_json::from_slice(&dpapi(&std::fs::read(path)?, false)?)
                .map_err(|_| Error::new("SECRET_STORE_ERROR", "Invalid protected certificate"))?
        } else {
            let ips = std::iter::once("127.0.0.1".into())
                .chain(addresses())
                .collect::<Vec<_>>();
            let key = rcgen::KeyPair::generate()
                .map_err(|_| Error::new("TLS_ERROR", "Cannot generate TLS key"))?;
            let mut params = rcgen::CertificateParams::new(ips)
                .map_err(|_| Error::new("TLS_ERROR", "Invalid TLS addresses"))?;
            params
                .distinguished_name
                .push(rcgen::DnType::CommonName, "AgentDeck");
            let cert = params
                .self_signed(&key)
                .map_err(|_| Error::new("TLS_ERROR", "Cannot generate TLS certificate"))?;
            let v = json!({"cert":cert.pem(),"key":key.serialize_pem()});
            use std::io::Write;
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)?
                .write_all(&dpapi(v.to_string().as_bytes(), true)?)?;
            v
        };
        let cert = stored["cert"]
            .as_str()
            .ok_or_else(|| Error::new("TLS_ERROR", "Missing certificate"))?
            .to_owned();
        let key = stored["key"]
            .as_str()
            .ok_or_else(|| Error::new("TLS_ERROR", "Missing private key"))?
            .to_owned();
        let (_, pem) = x509_parser::pem::parse_x509_pem(cert.as_bytes())
            .map_err(|_| Error::new("TLS_ERROR", "Invalid certificate PEM"))?;
        let parsed = pem
            .parse_x509()
            .map_err(|_| Error::new("TLS_ERROR", "Invalid certificate"))?;
        ensure(
            parsed.validity().not_after.timestamp() > chrono::Utc::now().timestamp() + 86400,
            "CERTIFICATE_EXPIRED",
            "Certificate is expiring; renew locally and pair again",
        )?;
        let mut ips = vec![];
        if let Ok(Some(san)) = parsed.subject_alternative_name() {
            for n in &san.value.general_names {
                if let x509_parser::extensions::GeneralName::IPAddress([a, b, c, d]) = n {
                    ips.push(IpAddr::V4(Ipv4Addr::new(*a, *b, *c, *d)));
                }
            }
        }
        Ok(Self {
            cert,
            key,
            fingerprint: digest(&pem.contents),
            ips,
        })
    }
    pub fn supports(&self, address: &str) -> bool {
        address
            .parse::<IpAddr>()
            .ok()
            .is_some_and(|a| self.ips.contains(&a))
    }
    pub fn restore(&self, saved: Option<String>) -> String {
        saved
            .filter(|a| addresses().contains(a) && self.supports(a))
            .unwrap_or_else(|| "127.0.0.1".into())
    }
}
