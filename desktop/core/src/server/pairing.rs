use crate::{digest, ensure, future, now, protocol, s, security, store::Store, uid, Error, Result};
use serde_json::{json, Value};
use std::sync::Mutex;
#[derive(Default)]
pub struct Pairing {
    inner: Mutex<State>,
}
#[derive(Default)]
struct State {
    invite: Option<Invite>,
    pending: Option<Pending>,
}
struct Invite {
    hash: String,
    expires: String,
    used: bool,
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
}
impl Pairing {
    pub fn create(&self, store: &Store, endpoint: &str, fingerprint: &str) -> Result<Value> {
        ensure(
            endpoint.starts_with("https://"),
            "CONFIG_ERROR",
            "TLS required",
        )?;
        let token = security::token();
        let expires = future(120);
        let mut state = self.inner.lock().unwrap();
        state.pending = None;
        state.invite = Some(Invite {
            hash: digest(&token),
            expires: expires.clone(),
            used: false,
        });
        Ok(
            json!({"v":1,"endpoint":endpoint,"fingerprint":fingerprint,"token":token,"expiresAt":expires,"hostId":store.meta("hostId")?}),
        )
    }
    pub fn request(&self, v: &Value) -> Result<(Value, Value)> {
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
        let invite = state
            .invite
            .as_mut()
            .ok_or_else(|| Error::new("PAIRING_EXPIRED", "No invitation"))?;
        ensure(
            !invite.used
                && invite.expires > now()
                && security::equal(&invite.hash, &digest(s(v, "token"))),
            "PAIRING_EXPIRED",
            "Invitation invalid, used or expired",
        )?;
        invite.used = true;
        let id = uid("pair");
        let claim = security::token();
        let code = format!(
            "{:06}",
            u64::from_str_radix(
                &digest(format!("{}{}{}", id, s(v, "nonce"), invite.hash))[..12],
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
        state.pending = Some(Pending {
            id,
            claim_hash: digest(claim),
            name,
            code,
            expires,
            status: "pending".into(),
            credential: None,
            device: None,
        });
        Ok((response, confirmation))
    }
    pub fn confirm(&self, store: &Store, id: &str, approve: bool) -> Result<()> {
        let mut state = self.inner.lock().unwrap();
        let pending = state
            .pending
            .as_mut()
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
        store.replace_device(&device, &pending.name, &digest(&credential))?;
        pending.credential = Some(protected);
        pending.device = Some(device);
        pending.status = "approved".into();
        Ok(())
    }
    pub fn claim(&self, store: &Store, v: &Value) -> Result<Value> {
        protocol::fields(v, &["requestId", "claimToken"], &[])?;
        protocol::text(v, "requestId", 1, 160)?;
        ensure(
            security::valid_token(s(v, "claimToken")),
            "INVALID_REQUEST",
            "Invalid claim token",
        )?;
        let mut state = self.inner.lock().unwrap();
        let pending = state
            .pending
            .as_mut()
            .ok_or_else(|| Error::new("PAIRING_EXPIRED", "Claim expired"))?;
        ensure(
            pending.id == s(v, "requestId")
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
        state.pending = None;
        Ok(response)
    }
    pub fn pending(&self) -> Option<Value> {
        self.inner.lock().unwrap().pending.as_ref().filter(|p|p.status=="pending"&&p.expires>now()).map(|p|json!({"requestId":p.id,"displayName":p.name,"code":p.code,"expiresAt":p.expires}))
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
    pub fn revoke(store: &Store, id: &str) -> Result<()> {
        store.exec(
            "UPDATE devices SET revokedAt=? WHERE deviceId=? AND revokedAt IS NULL",
            [now(), id.to_owned()],
        )?;
        Ok(())
    }
}
