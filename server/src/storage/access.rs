use super::*;

impl Store {
    pub async fn host_connection(
        &self,
        auth: &Auth,
        host: &str,
        fingerprint: &str,
        endpoints: &Value,
    ) -> Result<()> {
        if auth.kind != "desktop" {
            return Err(Error::forbidden());
        }
        if self
            .pool
            .get()
            .await?
            .execute(
                "UPDATE hosts SET fingerprint=$3,endpoints=$4 WHERE host_id=$1 AND device_id=$2",
                &[&host, &auth.device_id, &fingerprint, &endpoints],
            )
            .await?
            != 1
        {
            return Err(Error::forbidden());
        }
        Ok(())
    }
    pub async fn host_access(&self, auth: &Auth, host: &str) -> Result<Value> {
        auth.ready()?;
        if !["mobile", "web"].contains(&auth.kind.as_str()) {
            return Err(Error::forbidden());
        }
        let connection = self.pool.get().await?;
        connection
            .execute("DELETE FROM host_access WHERE expires_at<=now()", &[])
            .await?;
        let token = security::token();
        // Return metadata from the same locked host identity that received the
        // grant. An unbind/rebind must not mix another account's certificate in.
        let item=connection.query_opt("WITH candidate AS MATERIALIZED (SELECT h.host_id,h.device_id,h.fingerprint,h.endpoints FROM hosts h JOIN devices d ON d.id=h.device_id JOIN sessions s ON s.id=$2 WHERE h.host_id=$3 AND d.account_id=$4 AND d.revoked_at IS NULL AND h.fingerprint IS NOT NULL AND s.device_id=$5 AND s.revoked_at IS NULL AND s.access_expires_at>now() FOR SHARE OF h,d,s), issued AS (INSERT INTO host_access(hash,host_id,host_device_id,session_id) SELECT $1,host_id,device_id,$2 FROM candidate RETURNING host_id) SELECT c.fingerprint,c.endpoints FROM candidate c JOIN issued i ON i.host_id=c.host_id", &[&security::digest(&token),&auth.session_id,&host,&auth.account_id,&auth.device_id]).await?.ok_or_else(Error::forbidden)?;
        Ok(
            json!({"hostId":host,"credential":token,"fingerprint":item.get::<_,String>("fingerprint"),"endpoints":item.get::<_,Value>("endpoints")}),
        )
    }
    pub async fn validate_host_access(&self, auth: &Auth, token: &str) -> Result<Value> {
        auth.ready()?;
        if auth.kind != "desktop" || !security::valid_token(token) {
            return Err(Error::forbidden());
        }
        let row=self.pool.get().await?.query_opt("UPDATE host_access t SET expires_at=now()+interval '5 minutes' FROM hosts h,devices d,sessions s,accounts a WHERE t.hash=$1 AND t.expires_at>now() AND t.host_id=h.host_id AND t.host_device_id=h.device_id AND h.device_id=$2 AND t.session_id=s.id AND s.device_id=d.id AND d.account_id=$3 AND a.id=d.account_id AND NOT a.disabled AND NOT a.must_change_password AND d.kind IN ('mobile','web') AND d.revoked_at IS NULL AND s.revoked_at IS NULL AND s.access_expires_at>now() AND s.refresh_expires_at>now() RETURNING t.host_id,d.id,d.display_name,s.id AS session_id", &[&security::digest(token),&auth.device_id,&auth.account_id]).await?.ok_or_else(Error::unauthorized)?;
        Ok(
            json!({"hostId":row.get::<_,String>("host_id"),"accountId":auth.account_id,"deviceId":row.get::<_,String>("id"),"displayName":row.get::<_,String>("display_name"),"sessionId":row.get::<_,String>("session_id")}),
        )
    }
}
