use crate::{security, Error, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub struct LoginAccount {
    pub id: String,
    pub username: String,
    pub password_hash: String,
    pub role: String,
    pub disabled: bool,
    pub must_change_password: bool,
}
#[derive(Clone)]
pub struct Auth {
    pub session_id: String,
    pub device_id: String,
    pub account_id: String,
    pub username: String,
    pub role: String,
    pub must_change_password: bool,
    pub kind: String,
    pub csrf_hash: Option<String>,
    pub max_tunnels: i32,
    pub bandwidth_bytes_per_second: i64,
}
impl Auth {
    pub fn ready(&self) -> Result<()> {
        if self.must_change_password {
            return Err(Error::new(
                axum::http::StatusCode::FORBIDDEN,
                "PASSWORD_CHANGE_REQUIRED",
                "请先修改初始密码",
            ));
        }
        Ok(())
    }
    pub fn administrator(&self) -> Result<()> {
        if self.role != "admin" {
            return Err(Error::forbidden());
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub access_expires_in: u64,
    pub account_id: String,
    pub username: String,
    pub role: String,
    pub cloud_device_id: String,
    pub must_change_password: bool,
    #[serde(skip)]
    pub session_id: String,
    #[serde(skip)]
    pub csrf_token: Option<String>,
}
impl SessionTokens {
    pub fn new(account: &LoginAccount, device: &str, admin: bool) -> Self {
        Self {
            access_token: security::token(),
            refresh_token: security::token(),
            access_expires_in: 600,
            account_id: account.id.clone(),
            username: account.username.clone(),
            role: account.role.clone(),
            cloud_device_id: device.into(),
            must_change_password: account.must_change_password,
            session_id: Uuid::new_v4().to_string(),
            csrf_token: admin.then(security::token),
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Login {
    pub username: String,
    pub password: String,
    pub installation_id: String,
    pub device_name: String,
    pub kind: agentdeck_connection_protocol::DeviceKind,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Refresh {
    pub refresh_token: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasswordChange {
    pub old_password: String,
    pub new_password: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountCreate {
    pub username: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountUpdate {
    pub disabled: bool,
    pub max_hosts: i32,
    pub max_mobile_devices: i32,
    pub max_tunnels: i32,
    pub bandwidth_bytes_per_second: i64,
}
impl AccountUpdate {
    pub fn validate(&self) -> Result<()> {
        if !(1..=1000).contains(&self.max_hosts)
            || !(1..=1000).contains(&self.max_mobile_devices)
            || !(1..=1024).contains(&self.max_tunnels)
            || !(65536..=1073741824).contains(&self.bandwidth_bytes_per_second)
        {
            return Err(Error::invalid());
        }
        Ok(())
    }
}
