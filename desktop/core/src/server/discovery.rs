//! Discovery is only an address hint. Clients still pin TLS and host identity.
use crate::{Error, Result};
use mdns_sd::{ServiceDaemon, ServiceInfo};
pub struct Advertisement {
    daemon: ServiceDaemon,
    fullname: String,
}
impl Advertisement {
    pub fn start(host: &str, fingerprint: &str, address: &str, port: u16) -> Result<Self> {
        let name = host.replace('_', "-");
        let properties = [
            ("v", "1"),
            ("id", host),
            ("fp", fingerprint),
            ("tls", "127.0.0.1"),
        ];
        let service = ServiceInfo::new(
            "_agentdeck._tcp.local.",
            &name,
            &format!("{name}.local."),
            address,
            port,
            &properties[..],
        )
        .map_err(|_| Error::new("DISCOVERY_UNAVAILABLE", "无法发布电脑发现信息"))?;
        let fullname = service.get_fullname().to_owned();
        let daemon = ServiceDaemon::new()
            .map_err(|_| Error::new("DISCOVERY_UNAVAILABLE", "局域网自动发现暂不可用"))?;
        if daemon.register(service).is_err() {
            let _ = daemon.shutdown();
            return Err(Error::new("DISCOVERY_UNAVAILABLE", "无法发布局域网服务"));
        }
        Ok(Self { daemon, fullname })
    }
}
impl Drop for Advertisement {
    fn drop(&mut self) {
        let _ = self.daemon.unregister(&self.fullname);
        let _ = self.daemon.shutdown();
    }
}
