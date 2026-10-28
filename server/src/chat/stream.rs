// Text delta extraction and empty/terminal-event handling adapted from NextChat (MIT).
// See third_party/nextchat/README.md and LICENSE for source and attribution.
use super::*;
use futures_util::StreamExt;

pub(super) struct Generation {
    pub state: Arc<State>,
    pub auth: Auth,
    pub message: String,
    pub provider: String,
    pub model: String,
    pub effort: String,
    pub base: String,
    pub encrypted: String,
    pub messages: Vec<Value>,
    pub _permit: tokio::sync::OwnedSemaphorePermit,
}
impl Generation {
    async fn flush(&self, text: &str) -> Result<bool> {
        let db = self.state.store.pool.get().await?;
        // Revocation and explicit stop take effect before any further persisted output.
        let valid=db.query_opt("SELECT s.id FROM sessions s JOIN devices d ON d.id=s.device_id JOIN accounts a ON a.id=d.account_id WHERE s.id=$1 AND s.revoked_at IS NULL AND s.refresh_expires_at>now() AND d.revoked_at IS NULL AND NOT a.disabled",&[&self.auth.session_id]).await?.is_some();
        if !valid {
            return Ok(false);
        }
        Ok(db.execute("UPDATE chat_messages SET content=$2,updated_at=now() WHERE id=$1 AND status='running'",&[&self.message,&text]).await?>0)
    }
    async fn run(&self, text: &mut String) -> Result<&'static str> {
        let url = network::base_url(&format!(
            "{}/chat/completions",
            self.base.trim_end_matches('/')
        ))?;
        #[cfg(test)]
        let url = self.state.chat.test_endpoint.clone().unwrap_or(url);
        #[cfg(test)]
        let client = if self.state.chat.test_endpoint.is_some() {
            reqwest::Client::new()
        } else {
            network::client(&url).await?
        };
        #[cfg(not(test))]
        let client = network::client(&url).await?;
        let key = self.state.chat.keys()?.decrypt(
            &format!("{}:{}", self.auth.account_id, self.provider),
            &self.encrypted,
        )?;
        if !self.flush(text).await? {
            return Ok("stopped");
        }
        let mut body = json!({"model":self.model,"messages":self.messages,"stream":true});
        if !self.effort.is_empty() {
            body["reasoning_effort"] = json!(self.effort);
        }
        let connect = client.post(url).bearer_auth(key).json(&body).send();
        tokio::pin!(connect);
        let mut waiting = tokio::time::interval(Duration::from_millis(500));
        let response = loop {
            tokio::select! {
                response=&mut connect=>break response.map_err(|_|Error::unavailable())?,
                _=waiting.tick()=>{if !self.flush(text).await? {return Ok("stopped");}}
            }
        };
        if !response.status().is_success() {
            return Err(Error::new(
                StatusCode::BAD_GATEWAY,
                "API_ERROR",
                match response.status().as_u16() {
                    401 | 403 => "API 鉴权失败，请检查密钥和模型权限",
                    429 => "API 请求额度或速率受限",
                    _ => "API 服务返回错误，请检查接口配置",
                },
            ));
        }
        let mut stream = response.bytes_stream();
        let mut parser = Parser::default();
        let mut heartbeat = tokio::time::interval(Duration::from_millis(500));
        loop {
            tokio::select! {
                _=heartbeat.tick()=>{if !self.flush(text).await? {return Ok("stopped");}},
                part=stream.next()=>{
                    let Some(part)=part else {return if parser.done {Ok("complete")} else {Err(Error::new(StatusCode::BAD_GATEWAY,"STREAM_INTERRUPTED","回复连接中断，已有内容已保留"))};};
                    parser.push(&part.map_err(|_|Error::unavailable())?,text)?;
                    if parser.done {return Ok("complete");}
                }
            }
        }
    }
}
pub(super) async fn generate(job: Generation) {
    let mut text = String::new();
    let outcome = tokio::time::timeout(Duration::from_secs(300), job.run(&mut text)).await;
    let (status, error) = match outcome {
        Ok(Ok(status)) => (status, None),
        Ok(Err(error)) => ("failed", Some(error.message)),
        Err(_) => ("interrupted", Some("生成超时，已有内容已保留")),
    };
    if let Ok(db) = job.state.store.pool.get().await {
        // Preserve persisted partial text and never resurrect a stopped or interrupted job.
        let _=db.execute("UPDATE chat_messages SET content=$2,status=$3,error=$4,updated_at=now() WHERE id=$1 AND status='running'",&[&job.message,&text,&status,&error]).await;
        let _=db.execute("UPDATE chat_conversations SET updated_at=now() WHERE id=(SELECT conversation_id FROM chat_messages WHERE id=$1)",&[&job.message]).await;
    }
}
#[derive(Default)]
struct Parser {
    buffer: Vec<u8>,
    done: bool,
}
impl Parser {
    fn push(&mut self, bytes: &[u8], text: &mut String) -> Result<()> {
        self.buffer.extend_from_slice(bytes);
        if self.buffer.len() > 256 * 1024 {
            return Err(Error::limit());
        }
        while let Some(end) = self.buffer.iter().position(|b| *b == b'\n') {
            let line = self.buffer.drain(..=end).collect::<Vec<_>>();
            let line = std::str::from_utf8(&line)
                .map_err(|_| Error::unavailable())?
                .trim_end();
            let Some(data) = line.strip_prefix("data:").map(str::trim_start) else {
                continue;
            };
            if data == "[DONE]" {
                self.done = true;
                break;
            }
            if data.is_empty() {
                continue;
            }
            let value: Value = serde_json::from_str(data).map_err(|_| {
                Error::new(
                    StatusCode::BAD_GATEWAY,
                    "INVALID_STREAM",
                    "接口未返回兼容的流式回复",
                )
            })?;
            if value.get("error").is_some() {
                return Err(Error::new(
                    StatusCode::BAD_GATEWAY,
                    "API_ERROR",
                    "API 生成失败，已有内容已保留",
                ));
            }
            let delta = &value["choices"][0]["delta"];
            if delta.get("tool_calls").is_some() || delta.get("function_call").is_some() {
                return Err(Error::new(
                    StatusCode::BAD_GATEWAY,
                    "UNSUPPORTED",
                    "当前模式仅支持文字对话",
                ));
            }
            if let Some(part) = delta["content"].as_str() {
                text.push_str(part);
            }
            if text.len() > 512 * 1024 {
                let mut end = 512 * 1024;
                while !text.is_char_boundary(end) {
                    end -= 1;
                }
                text.truncate(end);
                return Err(Error::limit());
            }
            // A stop finish reason is authoritative even if the provider omits [DONE].
            if value["choices"][0]["finish_reason"].as_str().is_some() {
                self.done = true;
                break;
            }
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fragmented_unicode_stream_and_terminal_markers() {
        let bytes =
            "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\r\n\r\ndata: [DONE]\n\n"
                .as_bytes();
        let mut parser = Parser::default();
        let mut text = String::new();
        for byte in bytes {
            parser.push(&[*byte], &mut text).unwrap();
        }
        assert_eq!(text, "你好");
        assert!(parser.done);
    }
    #[test]
    fn errors_do_not_turn_into_successful_answers() {
        for value in [
            json!({"error":{"message":"secret detail"}}),
            json!({"choices":[{"delta":{"tool_calls":[]}}]}),
        ] {
            let mut parser = Parser::default();
            let mut text = String::new();
            assert!(parser
                .push(format!("data: {value}\n\n").as_bytes(), &mut text)
                .is_err());
        }
    }
}
