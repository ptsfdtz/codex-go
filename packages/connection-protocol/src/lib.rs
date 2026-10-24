//! AgentDeck-owned connection protocol. Independent of generated Codex schemas.
use serde::{Deserialize, Serialize};

pub const VERSION: u8 = 1;
pub const MAX_RELAY_FRAME: usize = 64 * 1024;
pub const TICKET_LIFETIME_SECONDS: u64 = 30;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DeviceKind {
    Desktop,
    Mobile,
    Web,
    AdminWeb,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum ControlMessage {
    #[serde(rename_all = "camelCase")]
    Ready { version: u8, host_id: String },
    #[serde(rename_all = "camelCase")]
    OpenTunnel {
        tunnel_id: String,
        host_ticket: String,
        expires_at: String,
        client_device_id: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TunnelRequest {
    pub host_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TunnelOffer {
    pub version: u8,
    pub tunnel_id: String,
    pub client_ticket: String,
    pub expires_at: String,
}
