//! Runtime admission is a minimum version policy. Schema versions are adapter
//! baselines, never a claim about the executable actually connected to the Host.
use crate::{codex, rpc::ProtocolVersion, Error, Result};
use semver::Version;

pub(super) fn supported(value: &str) -> Result<Version> {
    let version = Version::parse(value).map_err(|_| unsupported())?;
    if version
        .cmp_precedence(&Version::parse(codex::MIN_SUPPORTED_VERSION).unwrap())
        .is_lt()
    {
        return Err(unsupported());
    }
    Ok(version)
}

fn unsupported() -> Error {
    Error::new(
        "UPSTREAM_VERSION_UNSUPPORTED",
        &format!(
            "Codex 版本无法识别或过旧；最低支持 {}，请指定符合要求的原生 Codex。",
            codex::MIN_SUPPORTED_VERSION
        ),
    )
}

pub(super) fn profile(value: &str) -> Result<ProtocolVersion> {
    let version = supported(value)?;
    Ok(
        if !version
            .cmp_precedence(&Version::parse(ProtocolVersion::DesktopBaseline.version()).unwrap())
            .is_lt()
        {
            ProtocolVersion::DesktopBaseline
        } else {
            ProtocolVersion::Managed
        },
    )
}

pub(super) fn cli(output: &str) -> Result<String> {
    let value = output
        .trim()
        .strip_prefix("codex-cli ")
        .ok_or_else(unsupported)?;
    supported(value)?;
    Ok(value.to_owned())
}

pub(super) fn identity(user_agent: &str) -> Result<String> {
    let (client, tail) = user_agent.split_once('/').ok_or_else(unsupported)?;
    // A shared app-server may retain the first client's product name. That
    // name identifies a client, not a Codex build or an authentication boundary.
    // Admission still requires the native version and protocol below.
    if client.is_empty() || client.trim() != client || client.chars().any(char::is_control) {
        return Err(unsupported());
    }
    identity_version(tail)
}

pub(super) fn identity_version(tail: &str) -> Result<String> {
    let (version, _) = tail.split_once(" (").ok_or_else(unsupported)?;
    supported(version)?;
    Ok(version.to_owned())
}

pub(super) fn installed_candidates(directory: &std::path::Path) -> Vec<std::path::PathBuf> {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut versions: Vec<_> = entries
        .flatten()
        .filter_map(|entry| {
            let version = supported(entry.file_name().to_str()?).ok()?;
            entry
                .file_type()
                .ok()?
                .is_dir()
                .then_some((version, entry.path()))
        })
        .collect();
    versions.sort_by(|a, b| b.0.cmp_precedence(&a.0));
    versions
        .into_iter()
        .flat_map(|(_, path)| [path.join("bin/codex.exe"), path.join("codex.exe")])
        .filter(|path| path.is_file())
        .collect()
}

pub(super) fn desktop_candidates(directory: &std::path::Path) -> Vec<std::path::PathBuf> {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut candidates: Vec<_> = entries
        .flatten()
        .filter_map(|entry| {
            entry
                .file_type()
                .ok()?
                .is_dir()
                .then(|| entry.path().join("codex.exe"))
        })
        .filter(|path| path.is_file())
        .collect();
    candidates.sort();
    candidates
}

pub(super) fn select_candidate(
    candidates: Vec<std::path::PathBuf>,
    mut probe: impl FnMut(&std::path::Path) -> Result<String>,
) -> Option<std::path::PathBuf> {
    let mut seen = std::collections::HashSet::new();
    let mut selected: Option<(Version, std::path::PathBuf)> = None;
    for path in candidates {
        let Ok(path) = std::fs::canonicalize(path) else {
            continue;
        };
        if !seen.insert(path.clone()) {
            continue;
        }
        let Ok(version) = probe(&path).and_then(|value| supported(&value)) else {
            continue;
        };
        if selected
            .as_ref()
            .is_none_or(|(current, _)| version.cmp_precedence(current).is_gt())
        {
            selected = Some((version, path));
        }
    }
    selected.map(|(_, path)| path)
}

#[cfg(test)]
mod identity_tests {
    use super::identity;

    #[test]
    fn shared_runtime_accepts_the_first_clients_product_name() {
        for product in [
            "Codex Desktop",
            "agentdeck",
            "agentdeck_gui_seed",
            "codex_cli_rs",
        ] {
            assert_eq!(
                identity(&format!("{product}/0.164.0 (Windows 10; x86_64) unknown")).unwrap(),
                "0.164.0"
            );
        }
    }

    #[test]
    fn client_name_does_not_bypass_version_or_identity_validation() {
        for value in [
            "gui_probe/0.1.0 (Windows)",
            "gui_probe/latest (Windows)",
            "/0.164.0 (Windows)",
            " gui_probe/0.164.0 (Windows)",
            "gui\nprobe/0.164.0 (Windows)",
            "gui_probe/0.164.0",
        ] {
            assert!(identity(value).is_err(), "accepted {value:?}");
        }
    }
}
