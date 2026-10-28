use crate::{Error, Result};
use reqwest::{Client, Url};
use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    time::Duration,
};

pub(super) fn base_url(value: &str) -> Result<Url> {
    let url = Url::parse(value.trim_end_matches('/')).map_err(|_| Error::invalid())?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || value.len() > 2048
    {
        return Err(Error::invalid());
    }
    if url
        .host_str()
        .and_then(|host| host.trim_matches(['[', ']']).parse::<IpAddr>().ok())
        .is_some_and(|ip| !public(ip))
    {
        return Err(Error::invalid());
    }
    Ok(url)
}
fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, _, _] = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_multicast()
        || ip.is_unspecified()
        || a == 0
        || a >= 240
        || (a == 100 && (64..=127).contains(&b))
        || (a == 198 && (18..=19).contains(&b))
        || (a == 192 && b == 0))
}
fn public_v6(ip: Ipv6Addr) -> bool {
    // Only global unicast, excluding documentation and IPv4 translation/tunnels.
    let s = ip.segments();
    (s[0] & 0xe000) == 0x2000
        && !(s[0] == 0x2001 && s[1] <= 0x1ff)
        && !(s[0] == 0x2001 && s[1] == 0xdb8)
        && s[0] != 0x2002
        && !(s[0] == 0x3fff && s[1] <= 0xfff)
}
fn public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => public_v4(ip),
        IpAddr::V6(ip) => public_v6(ip),
    }
}

pub(super) async fn client(url: &Url) -> Result<Client> {
    let host = url
        .host_str()
        .ok_or_else(Error::invalid)?
        .trim_matches(['[', ']']);
    let port = url.port_or_known_default().ok_or_else(Error::invalid)?;
    let addresses = tokio::time::timeout(
        Duration::from_secs(8),
        tokio::net::lookup_host((host, port)),
    )
    .await
    .map_err(|_| Error::unavailable())?
    .map_err(|_| Error::unavailable())?
    .collect::<Vec<_>>();
    if addresses.is_empty() || addresses.iter().any(|address| !public(address.ip())) {
        return Err(Error::new(
            axum::http::StatusCode::BAD_REQUEST,
            "INVALID_API_URL",
            "接口必须使用公网 HTTPS 地址",
        ));
    }
    Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(host, &addresses)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|_| Error::unavailable())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_private_metadata_and_encoded_endpoints() {
        for value in [
            "http://api.example/v1",
            "https://key@api.example/v1",
            "https://api.example/v1?key=x",
            "https://api.example/v1#x",
        ] {
            assert!(base_url(value).is_err());
        }
        for value in [
            "127.0.0.1",
            "10.1.2.3",
            "169.254.169.254",
            "100.64.0.1",
            "192.168.1.1",
            "198.18.0.1",
            "0.0.0.0",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
            "2001:db8::1",
            "2002:7f00:1::",
        ] {
            assert!(!public(value.parse().unwrap()), "{value}");
        }
        for value in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(public(value.parse().unwrap()));
        }
    }
}
