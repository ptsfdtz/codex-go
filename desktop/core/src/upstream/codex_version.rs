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
    if !["Codex Desktop", "agentdeck"].contains(&client) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admission_uses_semver_including_prereleases_and_build_metadata() {
        for value in [
            "0.159.2",
            "0.159.20",
            "0.160.0-alpha.1",
            "0.163.0-alpha.10.2",
            "0.163.0",
            "1.0.0",
            "0.159.2+local",
        ] {
            assert!(supported(value).is_ok(), "{value}");
        }
        for value in [
            "0.159.1",
            "0.159.2-alpha.1",
            "0.99.999",
            "0.159",
            "v0.159.2",
            "0.159.02",
            "999999999999999999999.0.0",
            "0.159.2 extra",
            "",
        ] {
            assert!(supported(value).is_err(), "{value}");
        }
        assert_eq!(
            profile("0.163.0-alpha.9").unwrap(),
            ProtocolVersion::Managed
        );
        for value in [
            "0.163.0-alpha.10.2",
            "0.163.0-alpha.10.20",
            "0.163.0",
            "1.0.0",
        ] {
            assert_eq!(profile(value).unwrap(), ProtocolVersion::DesktopBaseline);
        }
        assert_eq!(cli("codex-cli 0.164.0\r\n").unwrap(), "0.164.0");
        assert!(cli("other-cli 0.164.0").is_err());
        assert!(cli("codex-cli 0.164.0\nextra").is_err());
    }

    #[test]
    fn fallback_discovers_newer_installs_and_legacy_layout_in_version_order() {
        let dir = tempfile::tempdir().unwrap();
        for (version, binary) in [
            ("0.159.2", "codex.exe"),
            ("0.170.0", "bin/codex.exe"),
            ("0.99.0", "bin/codex.exe"),
            (".staging", "bin/codex.exe"),
        ] {
            let path = dir.path().join(version).join(binary);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, []).unwrap();
        }
        assert_eq!(
            installed_candidates(dir.path()),
            vec![
                dir.path().join("0.170.0/bin/codex.exe"),
                dir.path().join("0.159.2/codex.exe")
            ]
        );
    }
}
