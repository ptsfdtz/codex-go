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
        // Linux hosts use a private 0600 state directory. The file-level
        // protection is intentionally kept separate from Windows DPAPI so the
        // same service state format can be used by the CLI daemon.
        let _ = protect;
        Ok(value.to_vec())
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
/// Inspect the host token without relabeling files or elevating the process.
pub fn verify_host_integrity() -> Result<()> {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            Security::{
                GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation,
                TokenIntegrityLevel, TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
            },
            System::Threading::{GetCurrentProcess, OpenProcessToken},
        };
        let failure = || Error::new("CONFIG_ERROR", "无法检查服务进程的 Windows 完整性级别");
        let mut token = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(failure());
        }
        let mut needed = 0;
        GetTokenInformation(
            token,
            TokenIntegrityLevel,
            std::ptr::null_mut(),
            0,
            &mut needed,
        );
        let mut buffer = vec![0usize; (needed as usize).div_ceil(std::mem::size_of::<usize>())];
        let ok = GetTokenInformation(
            token,
            TokenIntegrityLevel,
            buffer.as_mut_ptr().cast(),
            needed,
            &mut needed,
        );
        CloseHandle(token);
        if ok == 0 || buffer.is_empty() {
            return Err(failure());
        }
        let label = &*buffer.as_ptr().cast::<TOKEN_MANDATORY_LABEL>();
        let count = *GetSidSubAuthorityCount(label.Label.Sid);
        if count == 0 {
            return Err(failure());
        }
        let level = *GetSidSubAuthority(label.Label.Sid, u32::from(count - 1));
        ensure(level >= 0x2000, "LOW_INTEGRITY_HOST",
            "AgentDeck 以低完整性运行，无法保护凭据或启动 MXC；请将便携 ZIP 解压到普通用户目录后启动，勿直接运行受限工作区中的 EXE")?;
    }
    Ok(())
}
pub fn restrict_directory(path: &Path) -> Result<()> {
    std::fs::create_dir_all(path).map_err(|e| {
        Error::new(
            "DATA_DIRECTORY_ERROR",
            &format!("无法创建服务数据目录（系统错误 {:?}）", e.raw_os_error()),
        )
    })?;
    #[cfg(windows)]
    {
        let who = crate::codex::sync_command("whoami.exe", &["/user", "/fo", "csv", "/nh"], None)
            .map_err(|_| {
            Error::new(
                "DATA_DIRECTORY_ERROR",
                "无法运行 whoami.exe 确认数据目录所有者",
            )
        })?;
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
        )
        .map_err(|_| {
            Error::new(
                "DATA_DIRECTORY_ERROR",
                "无法运行 icacls.exe 设置服务数据目录权限",
            )
        })?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).map_err(|_| {
            Error::new(
                "DATA_DIRECTORY_ERROR",
                "Cannot restrict Linux state directory",
            )
        })?;
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
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
            }
            file.write_all(&dpapi(v.to_string().as_bytes(), true)?)?;
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
