use crate::{digest, ensure, future, now, protocol, s, security, store::Store, uid, Error, Result};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex};
const PAIRING_LIMIT: usize = 16;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteIdentity {
    pub issuer: String,
    pub account_id: String,
    pub device_id: String,
}
#[derive(Default)]
pub struct Pairing {
    inner: Mutex<State>,
}
#[derive(Default)]
struct State {
    invites: HashMap<String, Invite>,
    pending: HashMap<String, Pending>,
}
struct Invite {
    expires: String,
    account: Option<(String, String)>,
}
struct Pending {
    id: String,
    claim_hash: String,
    name: String,
    code: String,
    expires: String,
    status: String,
    credential: Option<Vec<u8>>,
    device: Option<String>,
    remote: Option<RemoteIdentity>,
}
impl State {
    fn prune(&mut self) {
        let at = now();
        self.invites.retain(|_, invite| invite.expires > at);
        self.pending.retain(|_, pending| pending.expires > at);
    }
}
impl Pairing {
    pub fn create(&self, store: &Store, endpoint: &str, fingerprint: &str) -> Result<Value> {
        self.create_versioned(store, endpoint, fingerprint, 1)
    }
    pub fn create_versioned(
        &self,
        store: &Store,
        endpoint: &str,
        fingerprint: &str,
        version: u8,
    ) -> Result<Value> {
        ensure(
            matches!(version, 1 | 2),
            "INVALID_REQUEST",
            "Unsupported pairing version",
        )?;
        ensure(
            endpoint.starts_with("https://"),
            "CONFIG_ERROR",
            "TLS required",
        )?;
        let token = security::token();
        let expires = future(120);
        let mut state = self.inner.lock().unwrap();
        state.prune();
        ensure(
            state.invites.len() + state.pending.len() < PAIRING_LIMIT,
            "RATE_LIMITED",
            "Too many outstanding pairing invitations",
        )?;
        state.invites.insert(
            digest(&token),
            Invite {
                expires: expires.clone(),
                account: None,
            },
        );
        let mut qr = json!({"v":version,"endpoint":endpoint,"fingerprint":fingerprint,"token":token,"expiresAt":expires,"hostId":store.meta("hostId")?});
        if version == 2 {
            qr["tlsServerName"] = json!("127.0.0.1");
        }
        Ok(qr)
    }
    pub fn create_remote(
        &self,
        store: &Store,
        endpoint: &str,
        fingerprint: &str,
        issuer: &str,
        account: &str,
    ) -> Result<Value> {
        let mut qr = self.create_versioned(store, endpoint, fingerprint, 2)?;
        let mut state = self.inner.lock().unwrap();
        state
            .invites
            .get_mut(&digest(s(&qr, "token")))
            .ok_or_else(|| Error::new("PAIRING_EXPIRED", "Invitation expired"))?
            .account = Some((issuer.into(), account.into()));
        qr["v"] = json!(3);
        qr["cloud"] = json!({"origin":issuer,"accountId":account});
        Ok(qr)
    }
    pub fn request(&self, v: &Value) -> Result<(Value, Value)> {
        self.request_scoped(v, None)
    }
    pub fn request_scoped(
        &self,
        v: &Value,
        remote: Option<&RemoteIdentity>,
    ) -> Result<(Value, Value)> {
        protocol::fields(v, &["token", "displayName", "nonce"], &[])?;
        protocol::text(v, "displayName", 1, 80)?;
        ensure(
            security::valid_token(s(v, "token"))
                && security::valid_token(s(v, "nonce"))
                && !s(v, "displayName").trim().is_empty(),
            "INVALID_REQUEST",
            "Invalid pairing fields",
        )?;
        let mut state = self.inner.lock().unwrap();
        state.prune();
        let invite_hash = digest(s(v, "token"));
        let invite = state
            .invites
            .get(&invite_hash)
            .ok_or_else(|| Error::new("PAIRING_EXPIRED", "No invitation"))?;
        ensure(
            match (&invite.account, remote) {
                (None, None) => true,
                (Some((issuer, account)), Some(identity)) => {
                    issuer == &identity.issuer && account == &identity.account_id
                }
                _ => false,
            },
            "UNAUTHORIZED",
            "Invitation does not authorize this connection",
        )?;
        let invite = state.invites.remove(&invite_hash).unwrap();
        let id = uid("pair");
        let claim = security::token();
        let code = format!(
            "{:06}",
            u64::from_str_radix(
                &digest(format!("{}{}{}", id, s(v, "nonce"), invite_hash))[..12],
                16
            )
            .unwrap()
                % 1_000_000
        );
        let expires = invite.expires.clone();
        let name = s(v, "displayName").trim().to_owned();
        let confirmation =
            json!({"requestId":id,"displayName":name,"code":code,"expiresAt":expires});
        let response = json!({"requestId":id,"claimToken":claim,"code":code,"expiresAt":expires});
        state.pending.insert(
            id.clone(),
            Pending {
                id,
                claim_hash: digest(claim),
                name,
                code,
                expires,
                status: "pending".into(),
                credential: None,
                device: None,
                remote: remote.cloned(),
            },
        );
        Ok((response, confirmation))
    }
    pub fn confirm(&self, store: &Store, id: &str, approve: bool) -> Result<()> {
        let mut state = self.inner.lock().unwrap();
        state.prune();
        let pending = state
            .pending
            .get_mut(id)
            .ok_or_else(|| Error::new("PAIRING_EXPIRED", "Request expired"))?;
        ensure(
            pending.id == id && pending.status == "pending" && pending.expires > now(),
            "PAIRING_EXPIRED",
            "Request expired or handled",
        )?;
        if !approve {
            pending.status = "rejected".into();
            return Ok(());
        }
        let credential = security::token();
        let device = uid("device");
        let protected = security::dpapi(credential.as_bytes(), true)?;
        store.add_device(&device, &pending.name, &digest(&credential))?;
        if let Some(remote) = &pending.remote {
            if let Err(error)=store.exec("INSERT INTO device_cloud_grants(deviceId,issuer,accountId,cloudDeviceId) VALUES(?,?,?,?)",[&device,&remote.issuer,&remote.account_id,&remote.device_id]) {
                Self::revoke(store,&device)?;
                return Err(error);
            }
        }
        pending.credential = Some(protected);
        pending.device = Some(device);
        pending.status = "approved".into();
        Ok(())
    }
    pub fn claim(&self, store: &Store, v: &Value) -> Result<Value> {
        self.claim_scoped(store, v, None)
    }
    pub fn claim_scoped(
        &self,
        store: &Store,
        v: &Value,
        remote: Option<&RemoteIdentity>,
    ) -> Result<Value> {
        protocol::fields(v, &["requestId", "claimToken"], &[])?;
        protocol::text(v, "requestId", 1, 160)?;
        ensure(
            security::valid_token(s(v, "claimToken")),
            "INVALID_REQUEST",
            "Invalid claim token",
        )?;
        let mut state = self.inner.lock().unwrap();
        state.prune();
        let pending = state
            .pending
            .get_mut(s(v, "requestId"))
            .ok_or_else(|| Error::new("PAIRING_EXPIRED", "Claim expired"))?;
        ensure(
            pending.id == s(v, "requestId")
                && pending.remote.as_ref() == remote
                && pending.expires > now()
                && security::equal(&pending.claim_hash, &digest(s(v, "claimToken"))),
            "PAIRING_EXPIRED",
            "Claim invalid or expired",
        )?;
        if pending.status != "approved" {
            return Ok(json!({"status":pending.status}));
        }
        let protected = pending
            .credential
            .take()
            .ok_or_else(|| Error::new("PAIRING_EXPIRED", "Already claimed"))?;
        let credential = String::from_utf8(security::dpapi(&protected, false)?)
            .map_err(|_| Error::new("SECRET_STORE_ERROR", "Invalid credential"))?;
        let response = json!({"status":"approved","deviceId":pending.device,"credential":credential,"hostId":store.meta("hostId")?});
        state.pending.remove(s(v, "requestId"));
        Ok(response)
    }
    pub fn pending(&self) -> Option<Value> {
        self.pending_all().into_iter().next()
    }
    pub fn pending_all(&self) -> Vec<Value> {
        let mut state = self.inner.lock().unwrap();
        state.prune();
        let mut pending: Vec<_> = state
            .pending
            .values()
            .filter(|p| p.status == "pending")
            .collect();
        pending.sort_by(|a, b| a.expires.cmp(&b.expires).then(a.id.cmp(&b.id)));
        pending.into_iter().map(|p|json!({"requestId":p.id,"displayName":p.name,"code":p.code,"expiresAt":p.expires})).collect()
    }
    pub fn authenticate(store: &Store, credential: &str) -> Result<Option<String>> {
        if !security::valid_token(credential) {
            return Ok(None);
        }
        Ok(store
            .query(
                "SELECT deviceId FROM devices WHERE credentialHash=? AND revokedAt IS NULL",
                [digest(credential)],
            )?
            .first()
            .map(|v| s(v, "deviceId").to_owned()))
    }
    pub fn authenticate_scoped(
        store: &Store,
        credential: &str,
        remote: Option<&RemoteIdentity>,
    ) -> Result<Option<String>> {
        let device = Self::authenticate(store, credential)?;
        let (Some(device), Some(remote)) = (&device, remote) else {
            return Ok(device);
        };
        if store.query("SELECT deviceId FROM device_cloud_grants WHERE deviceId=? AND issuer=? AND accountId=? AND cloudDeviceId=?",[device,&remote.issuer,&remote.account_id,&remote.device_id])?.is_empty(){return Ok(None)}
        Ok(Some(device.clone()))
    }
    pub fn revoke(store: &Store, id: &str) -> Result<()> {
        store.exec(
            "UPDATE devices SET revokedAt=? WHERE deviceId=? AND revokedAt IS NULL",
            [now(), id.to_owned()],
        )?;
        Ok(())
    }
}
