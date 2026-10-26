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
        // Legacy --protocol values remain readable as an initial schema hint.
        // The authenticated initialize response selects the actual adapter.
        let protocol = match version.as_ref() {
            None => ProtocolVersion::Managed,
            Some(value) if value == "auto" => ProtocolVersion::Managed,
            Some(value) => {
                crate::codex::protocol_for_version(value.to_str().ok_or_else(|| {
                    Error::new("UPSTREAM_VERSION_UNSUPPORTED", "Invalid runtime version")
                })?)?
            }
        };
        match (endpoint, token_file) {
            (None, None) if version.as_ref().is_none_or(|v| v == "auto") => Ok(Self::Managed),
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
    let metadata = std::fs::metadata(token_file)
        .map_err(|_| Error::new("CONFIG_ERROR", "Cannot open local runtime credential"))?;
    ensure(
        metadata.is_file(),
        "CONFIG_ERROR",
        "Runtime credential must be a regular file",
    )?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        ensure(
            metadata.permissions().mode() & 0o077 == 0,
            "CONFIG_ERROR",
            "Runtime credential file must be private (0600)",
        )?;
    }
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
