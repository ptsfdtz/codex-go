//! Local-only selection; credentials never appear in WSS, snapshots, or diagnostics.
use crate::{ensure, rpc::ProtocolVersion, Error, Result};
use std::{io::Read, path::PathBuf};

#[derive(Clone)]
pub enum RuntimeTarget {
    Managed,
    Attached {
        endpoint: String,
        token_file: PathBuf,
        protocol: ProtocolVersion,
    },
}
impl RuntimeTarget {
    pub fn from_environment() -> Result<Self> {
        Self::from_versioned_options(
            std::env::var_os("AGENTDECK_RUNTIME_WS_URL"),
            std::env::var_os("AGENTDECK_RUNTIME_TOKEN_FILE"),
            std::env::var_os("AGENTDECK_RUNTIME_PROTOCOL_VERSION"),
        )
    }
    pub fn from_options(
        endpoint: Option<std::ffi::OsString>,
        token_file: Option<std::ffi::OsString>,
    ) -> Result<Self> {
        Self::from_versioned_options(endpoint, token_file, None)
    }
    pub fn from_versioned_options(
        endpoint: Option<std::ffi::OsString>,
        token_file: Option<std::ffi::OsString>,
        version: Option<std::ffi::OsString>,
    ) -> Result<Self> {
        let protocol = match version.as_ref().and_then(|v| v.to_str()) {
            None if version.is_none() => ProtocolVersion::Managed,
            Some("0.159.2") => ProtocolVersion::Managed,
            Some("0.163.0-alpha.10.2") => ProtocolVersion::DesktopBaseline,
            _ => {
                return Err(Error::new(
                    "UPSTREAM_VERSION_UNSUPPORTED",
                    "Runtime protocol version is not supported",
                ))
            }
        };
        match (endpoint, token_file) {
            (None, None) if version.is_none() => Ok(Self::Managed),
            (Some(endpoint), Some(token_file)) => {
                let endpoint = endpoint
                    .into_string()
                    .map_err(|_| Error::new("CONFIG_ERROR", "Invalid runtime endpoint"))?;
                let token_file = PathBuf::from(token_file);
                ensure(
                    token_file.is_absolute(),
                    "CONFIG_ERROR",
                    "Runtime credential file must be absolute",
                )?;
                // Validate the URL before attempting a connection or reading a secret.
                crate::rpc::validate_local_endpoint(&endpoint)?;
                Ok(Self::Attached {
                    endpoint,
                    token_file,
                    protocol,
                })
            }
            _ => Err(Error::new(
                "CONFIG_ERROR",
                "Runtime endpoint and credential file must be configured together",
            )),
        }
    }
    pub fn attached(&self) -> bool {
        matches!(self, Self::Attached { .. })
    }
    pub fn protocol(&self) -> ProtocolVersion {
        match self {
            Self::Managed => ProtocolVersion::Managed,
            Self::Attached { protocol, .. } => *protocol,
        }
    }
    pub fn credential(&self) -> Result<String> {
        let Self::Attached { token_file, .. } = self else {
            return Err(Error::new("CONFIG_ERROR", "No attached runtime credential"));
        };
        read_local_credential(token_file)
    }
}

/// Shared bounded reader; callers never include file contents in diagnostics.
pub(crate) fn read_local_credential(token_file: &std::path::Path) -> Result<String> {
    ensure(
        token_file.is_absolute(),
        "CONFIG_ERROR",
        "Credential file must be absolute",
    )?;
    let mut bytes = Vec::new();
    std::fs::File::open(token_file)
        .map_err(|_| Error::new("CONFIG_ERROR", "Cannot open local runtime credential"))?
        .take(4097)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::new("CONFIG_ERROR", "Cannot read local runtime credential"))?;
    ensure(
        bytes.len() <= 4096,
        "CONFIG_ERROR",
        "Invalid runtime credential length",
    )?;
    let value = String::from_utf8(bytes)
        .map_err(|_| Error::new("CONFIG_ERROR", "Invalid runtime credential encoding"))?;
    let value = value.trim_end_matches(['\r', '\n']);
    crate::rpc::validate_local_credential(value)?;
    Ok(value.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selection_is_explicit_local_and_secret_files_are_bounded() {
        assert!(!RuntimeTarget::from_options(None, None).unwrap().attached());
        assert!(RuntimeTarget::from_options(Some("ws://127.0.0.1:1234".into()), None).is_err());
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("credential");
        assert!(RuntimeTarget::from_options(
            Some("ws://remote:1234".into()),
            Some(file.clone().into_os_string())
        )
        .is_err());
        let target = RuntimeTarget::from_options(
            Some("ws://127.0.0.1:1234".into()),
            Some(file.clone().into_os_string()),
        )
        .unwrap();
        std::fs::write(&file, format!("{}\r\n", "x".repeat(43))).unwrap();
        assert_eq!(target.credential().unwrap(), "x".repeat(43));
        std::fs::write(&file, "x".repeat(4097)).unwrap();
        assert!(target.credential().is_err());
        std::fs::write(&file, "bad secret").unwrap();
        assert!(target.credential().is_err());
    }
    #[test]
    fn runtime_identity_requires_the_exact_pinned_version() {
        assert!(crate::codex::check_runtime_identity(&format!(
            "Codex Desktop/{} (Windows)",
            crate::codex::VERSION
        ))
        .is_ok());
        for value in [
            "AgentDeck fixture",
            "Codex Desktop/0.163.0-alpha.10.2 (Windows)",
            "Codex Desktop/0.159.20 (Windows)",
            "Codex Desktop/0.159.2-alpha (Windows)",
        ] {
            assert_eq!(
                crate::codex::check_runtime_identity(value)
                    .unwrap_err()
                    .code,
                "UPSTREAM_VERSION_UNSUPPORTED"
            );
        }
    }
    #[test]
    fn protocol_selection_requires_a_complete_local_attachment() {
        let dir = tempfile::tempdir().unwrap();
        let endpoint = Some("ws://127.0.0.1:1234".into());
        let token_file = Some(dir.path().join("token").into_os_string());
        let target = RuntimeTarget::from_versioned_options(
            endpoint.clone(),
            token_file.clone(),
            Some("0.163.0-alpha.10.2".into()),
        )
        .unwrap();
        assert_eq!(target.protocol(), ProtocolVersion::DesktopBaseline);
        let old = RuntimeTarget::from_options(endpoint.clone(), token_file.clone()).unwrap();
        assert_eq!(old.protocol(), ProtocolVersion::Managed);
        assert!(RuntimeTarget::from_versioned_options(
            None,
            None,
            Some("0.163.0-alpha.10.2".into())
        )
        .is_err());
        assert!(RuntimeTarget::from_versioned_options(
            endpoint,
            token_file,
            Some("0.163.0".into())
        )
        .is_err());
    }
}
