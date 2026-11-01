//! Human-facing CLI text only. Protocol codes, JSON output and upstream diagnostics
//! retain their original identities and language.
use std::{collections::HashMap, sync::OnceLock};
static LANGUAGE: OnceLock<bool> = OnceLock::new();
static CHINESE: OnceLock<HashMap<String, String>> = OnceLock::new();

fn is_chinese(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    value == "zh" || value.starts_with("zh-") || value.starts_with("zh_")
}
fn system_language() -> String {
    for name in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(value) = std::env::var(name) {
            if !value.is_empty() {
                return value;
            }
        }
    }
    #[cfg(windows)]
    {
        let mut buffer = [0u16; 85];
        let len = unsafe {
            windows_sys::Win32::Globalization::GetUserDefaultLocaleName(
                buffer.as_mut_ptr(),
                buffer.len() as i32,
            )
        };
        if len > 1 {
            return String::from_utf16_lossy(&buffer[..len as usize - 1]);
        }
    }
    "en".into()
}
pub fn initialize(preference: Option<&str>) -> Result<(), &'static str> {
    let env = std::env::var("AGENTDECK_LANG").ok();
    let preference = preference.or(env.as_deref()).unwrap_or("system");
    let chinese = match preference {
        "zh-CN" | "zh" => true,
        "en" => false,
        "system" => is_chinese(&system_language()),
        _ => return Err("--lang / AGENTDECK_LANG: use system, zh-CN or en"),
    };
    let _ = LANGUAGE.set(chinese);
    Ok(())
}
pub fn text(key: &str) -> String {
    let chinese = *LANGUAGE.get_or_init(|| {
        let value = std::env::var("AGENTDECK_LANG").unwrap_or_else(|_| system_language());
        if value == "system" {
            is_chinese(&system_language())
        } else {
            is_chinese(&value)
        }
    });
    if chinese {
        CHINESE
            .get_or_init(|| {
                serde_json::from_str(include_str!("zh-CN.json")).expect("valid bundled CLI catalog")
            })
            .get(key)
            .cloned()
            .unwrap_or_else(|| key.into())
    } else {
        key.into()
    }
}
pub fn message(key: &str, values: &[(&str, String)]) -> String {
    let mut result = text(key);
    let pattern = regex::Regex::new(r"\{(\w*)\}").expect("valid interpolation pattern");
    let mut index = 0;
    result = pattern
        .replace_all(&result, |capture: &regex::Captures<'_>| {
            let name = if capture[1].is_empty() {
                let name = index.to_string();
                index += 1;
                name
            } else {
                capture[1].to_owned()
            };
            values
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| value.clone())
                .unwrap_or_else(|| capture[0].to_owned())
        })
        .into_owned();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_supported_system_languages() {
        for value in ["zh_CN.UTF-8", "zh-CN", "zh-TW", "zh"] {
            assert!(is_chinese(value));
        }
        for value in ["en_US.UTF-8", "C", "", "zhuang"] {
            assert!(!is_chinese(value));
        }
    }
    #[test]
    fn catalogs_preserve_format_parameters() {
        let catalog: HashMap<String, String> =
            serde_json::from_str(include_str!("zh-CN.json")).unwrap();
        let pattern = regex::Regex::new(r"\{\w*\}").unwrap();
        for (key, value) in catalog {
            let mut a: Vec<_> = pattern.find_iter(&key).map(|m| m.as_str()).collect();
            let mut b: Vec<_> = pattern.find_iter(&value).map(|m| m.as_str()).collect();
            a.sort();
            b.sort();
            assert_eq!(a, b, "{key}");
        }
        assert_eq!(
            message("{name}", &[("name", "a{0}b".into()), ("0", "wrong".into())]),
            "a{0}b"
        );
    }
}
