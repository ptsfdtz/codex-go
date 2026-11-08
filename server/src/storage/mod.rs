use crate::{
    accounts::{Auth, LoginAccount, SessionTokens},
    security, Error, Result,
};
use deadpool_postgres::{Manager, Pool};
use serde_json::{json, Value};
use tokio_postgres::{NoTls, Row};
use uuid::Uuid;
mod access;

pub struct Store {
    pub(crate) pool: Pool,
}
pub enum Refreshed {
    Issued(SessionTokens),
    Reused(String),
}

impl Store {
    pub async fn open(database_url: &str) -> Result<Self> {
        let config = database_url.parse().map_err(|_| Error::invalid())?;
        let pool = Pool::builder(Manager::new(config, NoTls))
            .max_size(16)
            .runtime(deadpool_postgres::Runtime::Tokio1)
            .wait_timeout(Some(std::time::Duration::from_secs(5)))
            .create_timeout(Some(std::time::Duration::from_secs(5)))
            .recycle_timeout(Some(std::time::Duration::from_secs(5)))
            .build()
            .map_err(|_| Error::unavailable())?;
        let store = Self { pool };
        let mut connection = store.pool.get().await?;
        let transaction = connection.transaction().await?;
        transaction
            .query_one("SELECT pg_advisory_xact_lock(708140532)", &[])
            .await?;
        transaction
            .batch_execute(include_str!("schema.sql"))
            .await?;
        transaction.commit().await?;
        Ok(store)
    }
    pub async fn healthy(&self) -> Result<()> {
        self.pool.get().await?.simple_query("SELECT 1").await?;
        Ok(())
    }
    pub async fn find_login(&self, username: &str) -> Result<Option<LoginAccount>> {
        Ok(self.pool.get().await?.query_opt("SELECT id,username,password_hash,role,disabled,must_change_password FROM accounts WHERE username=$1",&[&username]).await?.map(|row|LoginAccount{
            id:row.get("id"),username:row.get("username"),password_hash:row.get("password_hash"),role:row.get("role"),disabled:row.get("disabled"),must_change_password:row.get("must_change_password"),
        }))
    }
    pub async fn create_account(
        &self,
        actor: Option<&str>,
        username: &str,
        password_hash: &str,
        role: &str,
    ) -> Result<String> {
        let mut connection = self.pool.get().await?;
        let tx = connection.transaction().await?;
        let id = Uuid::new_v4().to_string();
        let inserted=tx.execute("INSERT INTO accounts(id,username,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT(username) DO NOTHING",&[&id,&username,&password_hash,&role]).await?;
        if inserted == 0 {
            return Err(Error::new(
                axum::http::StatusCode::CONFLICT,
                "USERNAME_EXISTS",
                "该用户名已存在",
            ));
        }
        tx.execute(
            "INSERT INTO audit(actor_id,action,subject_id) VALUES($1,'account.created',$2)",
            &[&actor, &id],
        )
        .await?;
        tx.commit().await?;
        Ok(id)
    }
    pub async fn login(
        &self,
        account: &LoginAccount,
        installation: &str,
        kind: &str,
        name: &str,
    ) -> Result<(SessionTokens, Vec<String>)> {
        let mut connection = self.pool.get().await?;
        let tx = connection.transaction().await?;
        let row=tx.query_one("SELECT password_hash,disabled,max_hosts,max_mobile_devices FROM accounts WHERE id=$1 FOR UPDATE",&[&account.id]).await?;
        if row.get::<_, bool>("disabled")
            || row.get::<_, String>("password_hash") != account.password_hash
        {
            return Err(Error::unauthorized());
        }
        let install_hash = security::digest(installation);
        if kind == "adminWeb" {
            tx.execute("UPDATE devices d SET revoked_at=now() WHERE account_id=$1 AND kind='adminWeb' AND revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM sessions s WHERE s.device_id=d.id AND s.revoked_at IS NULL AND s.refresh_expires_at>now())", &[&account.id]).await?;
        }
        let existing=tx.query_opt("SELECT id,kind,revoked_at IS NULL AS active FROM devices WHERE account_id=$1 AND installation_hash=$2",&[&account.id,&install_hash]).await?;
        let device = existing
            .as_ref()
            .map(|r| r.get::<_, String>("id"))
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        if existing
            .as_ref()
            .is_some_and(|r| r.get::<_, String>("kind") != kind)
        {
            return Err(Error::forbidden());
        }
        let cap = match kind {
            "desktop" => Some(row.get::<_, i32>("max_hosts")),
            "mobile" => Some(row.get("max_mobile_devices")),
            "web" => None,
            "adminWeb" => Some(8),
            _ => return Err(Error::invalid()),
        };
        if let Some(cap) = cap.filter(|_| {
            existing
                .as_ref()
                .is_none_or(|r| !r.get::<_, bool>("active"))
        }) {
            let count:i64=tx.query_one("SELECT count(*) FROM devices WHERE account_id=$1 AND kind=$2 AND revoked_at IS NULL",&[&account.id,&kind]).await?.get(0);
            if count >= i64::from(cap) {
                return Err(Error::limit());
            }
        }
        tx.execute("INSERT INTO devices(id,account_id,installation_hash,kind,display_name) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,installation_hash) DO UPDATE SET display_name=EXCLUDED.display_name,revoked_at=NULL",&[&device,&account.id,&install_hash,&kind,&name]).await?;
        let old=tx.query("UPDATE sessions SET revoked_at=now() WHERE device_id=$1 AND revoked_at IS NULL RETURNING id",&[&device]).await?.into_iter().map(|r|r.get(0)).collect();
        let tokens = SessionTokens::new(account, &device, kind == "adminWeb" || kind == "web");
        tx.execute(
            "INSERT INTO sessions(id,device_id,access_hash,csrf_hash) VALUES($1,$2,$3,$4)",
            &[
                &tokens.session_id,
                &device,
                &security::digest(&tokens.access_token),
                &tokens.csrf_token.as_ref().map(security::digest),
            ],
        )
        .await?;
        tx.execute(
            "INSERT INTO refresh_tokens(hash,session_id) VALUES($1,$2)",
            &[&security::digest(&tokens.refresh_token), &tokens.session_id],
        )
        .await?;
        tx.execute(
            "INSERT INTO audit(actor_id,action,subject_id) VALUES($1,'session.created',$2)",
            &[&account.id, &device],
        )
        .await?;
        tx.commit().await?;
        Ok((tokens, old))
    }
    pub async fn authenticate(&self, access: &str) -> Result<Auth> {
        if !security::valid_token(access) {
            return Err(Error::unauthorized());
        }
        let row=self.pool.get().await?.query_opt(
            "SELECT s.id AS session_id,d.id AS device_id,a.id AS account_id,a.username,a.role,a.must_change_password,d.kind,s.csrf_hash,a.max_tunnels,a.bandwidth_bytes_per_second FROM sessions s JOIN devices d ON d.id=s.device_id JOIN accounts a ON a.id=d.account_id WHERE s.access_hash=$1 AND s.revoked_at IS NULL AND s.access_expires_at>now() AND s.refresh_expires_at>now() AND d.revoked_at IS NULL AND NOT a.disabled",&[&security::digest(access)]).await?.ok_or_else(Error::unauthorized)?;
        Ok(auth(&row))
    }
    pub async fn session_active(&self, session_id: &str) -> Result<bool> {
        Ok(self.pool.get().await?.query_opt("SELECT 1 FROM sessions s JOIN devices d ON d.id=s.device_id JOIN accounts a ON a.id=d.account_id WHERE s.id=$1 AND s.revoked_at IS NULL AND s.refresh_expires_at>now() AND s.access_expires_at>now() AND d.revoked_at IS NULL AND NOT a.disabled",&[&session_id]).await?.is_some())
    }
    pub async fn refresh(
        &self,
        refresh: &str,
        csrf: Option<&str>,
        admin: bool,
    ) -> Result<Refreshed> {
        if !security::valid_token(refresh) {
            return Err(Error::unauthorized());
        }
        let mut connection = self.pool.get().await?;
        let tx = connection.transaction().await?;
        let row=tx.query_opt("SELECT r.consumed_at IS NOT NULL AS used,s.id AS session_id,s.csrf_hash,d.id AS device_id,d.kind,a.id,a.username,a.password_hash,a.role,a.must_change_password FROM refresh_tokens r JOIN sessions s ON s.id=r.session_id JOIN devices d ON d.id=s.device_id JOIN accounts a ON a.id=d.account_id WHERE r.hash=$1 AND s.revoked_at IS NULL AND s.refresh_expires_at>now() AND d.revoked_at IS NULL AND NOT a.disabled FOR UPDATE OF s,r",&[&security::digest(refresh)]).await?.ok_or_else(Error::unauthorized)?;
        let session: String = row.get("session_id");
        let kind: String = row.get("kind");
        if (kind == "adminWeb") != admin {
            return Err(Error::forbidden());
        }
        if (admin || kind == "web")
            && !row
                .get::<_, Option<String>>("csrf_hash")
                .zip(csrf)
                .is_some_and(|(expected, value)| {
                    security::equal(&expected, &security::digest(value))
                })
        {
            return Err(Error::forbidden());
        }
        if row.get::<_, bool>("used") {
            tx.execute(
                "UPDATE sessions SET revoked_at=now() WHERE id=$1",
                &[&session],
            )
            .await?;
            tx.execute("INSERT INTO audit(actor_id,action,subject_id) VALUES($1,'session.refresh_reused',$2)",&[&row.get::<_,String>("id"),&session]).await?;
            tx.commit().await?;
            return Ok(Refreshed::Reused(session));
        }
        let account = LoginAccount {
            id: row.get("id"),
            username: row.get("username"),
            password_hash: row.get("password_hash"),
            role: row.get("role"),
            disabled: false,
            must_change_password: row.get("must_change_password"),
        };
        let mut tokens = SessionTokens::new(
            &account,
            &row.get::<_, String>("device_id"),
            admin || kind == "web",
        );
        tokens.session_id = session;
        tx.execute(
            "UPDATE refresh_tokens SET consumed_at=now() WHERE hash=$1",
            &[&security::digest(refresh)],
        )
        .await?;
        tx.execute(
            "INSERT INTO refresh_tokens(hash,session_id) VALUES($1,$2)",
            &[&security::digest(&tokens.refresh_token), &tokens.session_id],
        )
        .await?;
        // Refresh rotates access and refresh secrets without extending the absolute session lifetime.
        tx.execute("UPDATE sessions SET access_hash=$1,csrf_hash=$2,access_expires_at=LEAST(now()+interval '10 minutes',refresh_expires_at) WHERE id=$3",&[&security::digest(&tokens.access_token),&tokens.csrf_token.as_ref().map(security::digest),&tokens.session_id]).await?;
        tx.commit().await?;
        Ok(Refreshed::Issued(tokens))
    }
    pub async fn logout(&self, auth: &Auth) -> Result<()> {
        self.pool
            .get()
            .await?
            .execute(
                "UPDATE sessions SET revoked_at=now() WHERE id=$1 AND device_id=$2",
                &[&auth.session_id, &auth.device_id],
            )
            .await?;
        Ok(())
    }
    pub async fn password_hash(&self, account: &str) -> Result<String> {
        Ok(self
            .pool
            .get()
            .await?
            .query_one(
                "SELECT password_hash FROM accounts WHERE id=$1",
                &[&account],
            )
            .await?
            .get(0))
    }
    pub async fn change_password(
        &self,
        actor: &str,
        account: &str,
        expected: Option<&str>,
        hash: &str,
        temporary: bool,
    ) -> Result<()> {
        let mut connection = self.pool.get().await?;
        let tx = connection.transaction().await?;
        let row = tx
            .query_one(
                "SELECT password_hash FROM accounts WHERE id=$1 FOR UPDATE",
                &[&account],
            )
            .await?;
        if expected.is_some_and(|v| row.get::<_, String>(0) != v) {
            return Err(Error::unauthorized());
        }
        tx.execute(
            "UPDATE accounts SET password_hash=$1,must_change_password=$2 WHERE id=$3",
            &[&hash, &temporary, &account],
        )
        .await?;
        tx.execute("UPDATE sessions SET revoked_at=now() WHERE device_id IN(SELECT id FROM devices WHERE account_id=$1) AND revoked_at IS NULL",&[&account]).await?;
        tx.execute("INSERT INTO audit(actor_id,action,subject_id) VALUES($1,'account.password_changed',$2)",&[&actor,&account]).await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn devices(&self, account: Option<&str>) -> Result<Vec<Value>> {
        Ok(self.pool.get().await?.query("SELECT json_build_object('deviceId',d.id,'accountId',d.account_id,'username',a.username,'kind',d.kind,'displayName',d.display_name,'revoked',d.revoked_at IS NOT NULL,'createdAt',d.created_at) FROM devices d JOIN accounts a ON a.id=d.account_id WHERE ($1::text IS NULL OR d.account_id=$1) ORDER BY d.created_at DESC LIMIT 5000",&[&account]).await?.into_iter().map(|r|r.get(0)).collect())
    }
    pub async fn revoke_device(
        &self,
        actor: &str,
        account: Option<&str>,
        device: &str,
    ) -> Result<()> {
        let mut connection = self.pool.get().await?;
        let tx = connection.transaction().await?;
        if tx.execute("UPDATE devices SET revoked_at=now() WHERE id=$1 AND ($2::text IS NULL OR account_id=$2)",&[&device,&account]).await?==0{return Err(Error::forbidden())}
        tx.execute(
            "UPDATE sessions SET revoked_at=now() WHERE device_id=$1 AND revoked_at IS NULL",
            &[&device],
        )
        .await?;
        tx.execute(
            "INSERT INTO audit(actor_id,action,subject_id) VALUES($1,'device.revoked',$2)",
            &[&actor, &device],
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
    async fn remove_device(tx: &tokio_postgres::Transaction<'_>, device: &str) -> Result<()> {
        tx.execute("DELETE FROM host_access WHERE host_device_id=$1 OR session_id IN(SELECT id FROM sessions WHERE device_id=$1)", &[&device]).await?;
        tx.execute("DELETE FROM refresh_tokens WHERE session_id IN(SELECT id FROM sessions WHERE device_id=$1)", &[&device]).await?;
        tx.execute("DELETE FROM sessions WHERE device_id=$1", &[&device])
            .await?;
        tx.execute("DELETE FROM hosts WHERE device_id=$1", &[&device])
            .await?;
        tx.execute("DELETE FROM devices WHERE id=$1", &[&device])
            .await?;
        Ok(())
    }
    pub async fn delete_device(
        &self,
        actor: &str,
        account: Option<&str>,
        device: &str,
    ) -> Result<()> {
        let mut connection = self.pool.get().await?;
        let tx = connection.transaction().await?;
        let owner: String = tx.query_opt("SELECT a.id FROM accounts a JOIN devices d ON d.account_id=a.id WHERE d.id=$1 AND ($2::text IS NULL OR a.id=$2) FOR UPDATE OF a", &[&device, &account]).await?.ok_or_else(Error::forbidden)?.get(0);
        tx.query_opt(
            "SELECT id FROM devices WHERE id=$1 AND account_id=$2 FOR UPDATE",
            &[&device, &owner],
        )
        .await?
        .ok_or_else(Error::forbidden)?;
        Self::remove_device(&tx, device).await?;
        tx.execute(
            "INSERT INTO audit(actor_id,action,subject_id) VALUES($1,'device.deleted',$2)",
            &[&actor, &device],
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn delete_account(&self, actor: &str, account: &str) -> Result<()> {
        let mut connection = self.pool.get().await?;
        let tx = connection.transaction().await?;
        let admins = tx.query("SELECT id FROM accounts WHERE role='admin' AND NOT disabled ORDER BY id FOR UPDATE", &[]).await?;
        if admins.len() <= 1 && admins.iter().any(|r| r.get::<_, String>(0) == account) {
            return Err(Error::new(
                axum::http::StatusCode::CONFLICT,
                "LAST_ADMIN",
                "必须保留一个可用管理员",
            ));
        }
        tx.query_opt(
            "SELECT id FROM accounts WHERE id=$1 FOR UPDATE",
            &[&account],
        )
        .await?
        .ok_or_else(Error::forbidden)?;
        for device in tx
            .query(
                "SELECT id FROM devices WHERE account_id=$1 ORDER BY id FOR UPDATE",
                &[&account],
            )
            .await?
        {
            Self::remove_device(&tx, &device.get::<_, String>(0)).await?;
        }
        tx.execute(
            "INSERT INTO audit(actor_id,action,subject_id) VALUES($1,'account.deleted',$2)",
            &[&actor, &account],
        )
        .await?;
        // Preserve audit entries after deleting their actor.
        tx.execute(
            "UPDATE audit SET actor_id=NULL WHERE actor_id=$1",
            &[&account],
        )
        .await?;
        tx.execute("DELETE FROM accounts WHERE id=$1", &[&account])
            .await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn register_host(&self, auth: &Auth, host_id: &str, name: &str) -> Result<()> {
        if auth.kind != "desktop" {
            return Err(Error::forbidden());
        }
        let mut connection = self.pool.get().await?;
        let tx = connection.transaction().await?;
        tx.query_one(
            "SELECT id FROM accounts WHERE id=$1 FOR UPDATE",
            &[&auth.account_id],
        )
        .await?;
        if tx
            .query_opt(
                "SELECT host_id FROM hosts WHERE device_id=$1 AND host_id<>$2",
                &[&auth.device_id, &host_id],
            )
            .await?
            .is_some()
        {
            return Err(Error::new(
                axum::http::StatusCode::CONFLICT,
                "HOST_BOUND",
                "此设备身份已绑定另一台电脑，请先解绑",
            ));
        }
        if tx.execute("INSERT INTO hosts(host_id,device_id,display_name) VALUES($1,$2,$3) ON CONFLICT(host_id) DO UPDATE SET display_name=EXCLUDED.display_name WHERE hosts.device_id=EXCLUDED.device_id",&[&host_id,&auth.device_id,&name]).await?==0 {
            return Err(Error::new(axum::http::StatusCode::CONFLICT,"HOST_BOUND","这台电脑已绑定其他设备身份，请先解绑"))
        }
        tx.commit().await?;
        Ok(())
    }
    pub async fn host_for_device(&self, device: &str) -> Result<Option<String>> {
        Ok(self
            .pool
            .get()
            .await?
            .query_opt("SELECT host_id FROM hosts WHERE device_id=$1", &[&device])
            .await?
            .map(|r| r.get(0)))
    }
    pub async fn host_owner(&self, host: &str, account: &str) -> Result<String> {
        Ok(self.pool.get().await?.query_opt("SELECT d.id FROM hosts h JOIN devices d ON d.id=h.device_id JOIN accounts a ON a.id=d.account_id WHERE h.host_id=$1 AND d.account_id=$2 AND d.revoked_at IS NULL AND NOT a.disabled",&[&host,&account]).await?.ok_or_else(Error::forbidden)?.get(0))
    }
    pub async fn hosts(&self, account: &str) -> Result<Vec<Value>> {
        Ok(self.pool.get().await?.query("SELECT json_build_object('hostId',h.host_id,'cloudDeviceId',d.id,'displayName',h.display_name,'customName',h.custom_name,'customNameConfigured',h.custom_name_configured,'fingerprint',h.fingerprint,'endpoints',h.endpoints) FROM hosts h JOIN devices d ON d.id=h.device_id WHERE d.account_id=$1 AND d.revoked_at IS NULL ORDER BY h.created_at",&[&account]).await?.into_iter().map(|r|r.get(0)).collect())
    }
    pub async fn rename_host(
        &self,
        auth: &Auth,
        host: &str,
        name: &str,
        only_if_unset: bool,
    ) -> Result<Value> {
        let row = self.pool.get().await?.query_opt(
            "UPDATE hosts h SET custom_name=CASE WHEN $4 AND h.custom_name_configured THEN h.custom_name ELSE NULLIF($3,'') END,custom_name_configured=true FROM devices d,accounts a WHERE h.host_id=$1 AND h.device_id=d.id AND d.account_id=$2 AND d.revoked_at IS NULL AND a.id=d.account_id AND NOT a.disabled RETURNING h.custom_name,h.custom_name_configured",
            &[&host,&auth.account_id,&name,&only_if_unset],
        ).await?.ok_or_else(Error::forbidden)?;
        Ok(
            json!({"hostId":host,"customName":row.get::<_,Option<String>>("custom_name"),"customNameConfigured":row.get::<_,bool>("custom_name_configured")}),
        )
    }
    pub async fn unbind_host(&self, auth: &Auth, host: &str) -> Result<String> {
        let device = self.host_owner(host, &auth.account_id).await?;
        let mut connection = self.pool.get().await?;
        let tx = connection.transaction().await?;
        tx.query_one(
            "SELECT id FROM accounts WHERE id=$1 FOR UPDATE",
            &[&auth.account_id],
        )
        .await?;
        // Recheck ownership inside the mutation; a concurrent rebind cannot be removed.
        if tx
            .execute(
                "DELETE FROM hosts WHERE host_id=$1 AND device_id=$2",
                &[&host, &device],
            )
            .await?
            == 0
        {
            return Err(Error::forbidden());
        }
        tx.execute(
            "UPDATE devices SET revoked_at=now() WHERE id=$1",
            &[&device],
        )
        .await?;
        tx.execute(
            "UPDATE sessions SET revoked_at=now() WHERE device_id=$1 AND revoked_at IS NULL",
            &[&device],
        )
        .await?;
        tx.execute(
            "INSERT INTO audit(actor_id,action,subject_id) VALUES($1,'host.unbound',$2)",
            &[&auth.account_id, &host],
        )
        .await?;
        tx.commit().await?;
        Ok(device)
    }
    pub async fn accounts(&self) -> Result<Vec<Value>> {
        Ok(self.pool.get().await?.query("SELECT json_build_object('accountId',id,'username',username,'role',role,'disabled',disabled,'mustChangePassword',must_change_password,'maxHosts',max_hosts,'maxMobileDevices',max_mobile_devices,'maxTunnels',max_tunnels,'bandwidthBytesPerSecond',bandwidth_bytes_per_second,'createdAt',created_at) FROM accounts ORDER BY created_at LIMIT 5000",&[]).await?.into_iter().map(|r|r.get(0)).collect())
    }
    pub async fn update_account(
        &self,
        actor: &str,
        id: &str,
        change: &crate::accounts::AccountUpdate,
    ) -> Result<()> {
        let mut connection = self.pool.get().await?;
        let tx = connection.transaction().await?;
        let admins=tx.query("SELECT id FROM accounts WHERE role='admin' AND NOT disabled ORDER BY id FOR UPDATE",&[]).await?;
        if change.disabled
            && admins.len() <= 1
            && admins.iter().any(|r| r.get::<_, String>(0) == id)
        {
            return Err(Error::new(
                axum::http::StatusCode::CONFLICT,
                "LAST_ADMIN",
                "必须保留一个可用管理员",
            ));
        }
        if tx.execute("UPDATE accounts SET disabled=$1,max_hosts=$2,max_mobile_devices=$3,max_tunnels=$4,bandwidth_bytes_per_second=$5 WHERE id=$6",&[&change.disabled,&change.max_hosts,&change.max_mobile_devices,&change.max_tunnels,&change.bandwidth_bytes_per_second,&id]).await?==0{return Err(Error::forbidden())}
        if change.disabled {
            tx.execute("UPDATE sessions SET revoked_at=now() WHERE device_id IN(SELECT id FROM devices WHERE account_id=$1) AND revoked_at IS NULL",&[&id]).await?;
        }
        tx.execute(
            "INSERT INTO audit(actor_id,action,subject_id) VALUES($1,'account.updated',$2)",
            &[&actor, &id],
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn audit(&self) -> Result<Vec<Value>> {
        Ok(self.pool.get().await?.query("SELECT json_build_object('id',l.id,'actor',a.username,'action',l.action,'subjectId',l.subject_id,'createdAt',l.created_at) FROM audit l LEFT JOIN accounts a ON a.id=l.actor_id ORDER BY l.id DESC LIMIT 100",&[]).await?.into_iter().map(|r|r.get(0)).collect())
    }
    pub async fn cleanup(&self) -> Result<()> {
        // Keep consumed refresh tokens through the session lifetime to detect reuse.
        let mut connection = self.pool.get().await?;
        let tx = connection.transaction().await?;
        tx.execute("DELETE FROM refresh_tokens WHERE session_id IN(SELECT id FROM sessions WHERE refresh_expires_at<now()-interval '7 days')",&[]).await?;
        tx.execute(
            "DELETE FROM sessions WHERE refresh_expires_at<now()-interval '7 days'",
            &[],
        )
        .await?;
        tx.execute(
            "DELETE FROM audit WHERE created_at<now()-interval '90 days'",
            &[],
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
}

fn auth(row: &Row) -> Auth {
    Auth {
        session_id: row.get("session_id"),
        device_id: row.get("device_id"),
        account_id: row.get("account_id"),
        username: row.get("username"),
        role: row.get("role"),
        must_change_password: row.get("must_change_password"),
        kind: row.get("kind"),
        csrf_hash: row.get("csrf_hash"),
        max_tunnels: row.get("max_tunnels"),
        bandwidth_bytes_per_second: row.get("bandwidth_bytes_per_second"),
    }
}

pub fn public_account(auth: &Auth) -> Value {
    json!({"accountId":auth.account_id,"username":auth.username,"role":auth.role,"mustChangePassword":auth.must_change_password,"cloudDeviceId":auth.device_id})
}
