use serde_json::{Value, json};
use std::time::Duration;
use synapse_core::{
    Cancellation, MAX_RESPONSE_BYTES, ModelError, ModelRequest, ModelResponse, ModelTransport,
    OUTPUT_TOKENS,
};

pub const MODEL_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const BONSAI_URL: &str = "http://127.0.0.1:18080/v1/chat/completions";
const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

/// No Debug implementation: the credential must never enter diagnostics.
/// Credentials are provided by the composition credential adapter, never notes/models.
pub struct ProviderTransport {
    agent: ureq::Agent,
    key: Option<String>,
}
impl ProviderTransport {
    pub fn new(openrouter_key: Option<String>) -> Result<Self, ModelError> {
        if let Some(key) = &openrouter_key {
            if key.is_empty() || key.len() > 512 || !key.bytes().all(|b| b.is_ascii_graphic()) {
                return Err(ModelError::Configuration);
            }
        }
        let config = ureq::Agent::config_builder()
            .proxy(None)
            .max_redirects(0)
            .http_status_as_error(false)
            .timeout_global(Some(MODEL_TIMEOUT))
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .build();
        Ok(Self {
            agent: config.into(),
            key: openrouter_key,
        })
    }
    fn build(request: &ModelRequest) -> Result<Value, ModelError> {
        let schema = json!({"type":"object","properties":{"status":{"type":"string","enum":["ok"]}},"required":["status"],"additionalProperties":false});
        let mut body = json!({"messages":[{"role":"user","content":request.prompt()}],"temperature":0,"stream":false,"max_tokens":OUTPUT_TOKENS});
        match request.provider().remote_model() {
            None => {
                body["model"] = json!("bonsai");
                body["response_format"] = json!({"type":"json_object","schema":schema});
                body["chat_template_kwargs"] = json!({"enable_thinking":false});
            }
            Some(model) => {
                body["model"] = json!(model);
                body["response_format"] = json!({"type":"json_schema","json_schema":{"name":"health","strict":true,"schema":schema}});
                body["provider"] = json!({"require_parameters":true,"allow_fallbacks":false});
            }
        }
        request.check_budget(
            serde_json::to_vec(&body)
                .map_err(|_| ModelError::Format)?
                .len(),
        )?;
        Ok(body)
    }
    fn send(
        &self,
        url: &str,
        request: &ModelRequest,
        cancel: &Cancellation,
    ) -> Result<ModelResponse, ModelError> {
        if cancel.is_cancelled() {
            return Err(ModelError::Cancelled);
        }
        let body = Self::build(request)?;
        let mut http = self
            .agent
            .post(url)
            .header("Content-Type", "application/json");
        if request.provider().remote_model().is_some() {
            let key = self.key.as_ref().ok_or(ModelError::Configuration)?;
            http = http.header("Authorization", format!("Bearer {key}"));
        }
        let encoded = serde_json::to_vec(&body).map_err(|_| ModelError::Format)?;
        let mut response = http.send(encoded.as_slice()).map_err(map_http_error)?;
        if cancel.is_cancelled() {
            return Err(ModelError::Cancelled);
        }
        if response.status().as_u16() != 200 {
            return Err(ModelError::Http);
        }
        let bytes = response
            .body_mut()
            .with_config()
            .limit(MAX_RESPONSE_BYTES as u64)
            .read_to_vec()
            .map_err(map_http_error)?;
        if cancel.is_cancelled() {
            return Err(ModelError::Cancelled);
        }
        decode(&bytes)
    }
}
impl ModelTransport for ProviderTransport {
    fn complete(
        &self,
        request: &ModelRequest,
        cancel: &Cancellation,
    ) -> Result<ModelResponse, ModelError> {
        self.send(
            if request.provider().remote_model().is_some() {
                OPENROUTER_URL
            } else {
                BONSAI_URL
            },
            request,
            cancel,
        )
    }
}
fn map_http_error(error: ureq::Error) -> ModelError {
    match error {
        ureq::Error::Timeout(_) => ModelError::Timeout,
        ureq::Error::BodyExceedsLimit(_) => ModelError::Budget,
        _ => ModelError::Offline,
    }
}
fn decode(bytes: &[u8]) -> Result<ModelResponse, ModelError> {
    let body: Value = serde_json::from_slice(bytes).map_err(|_| ModelError::Format)?;
    if body.get("error").is_some() {
        return Err(ModelError::Http);
    }
    let choices = body
        .get("choices")
        .and_then(Value::as_array)
        .filter(|a| a.len() == 1)
        .ok_or(ModelError::Format)?;
    let choice = &choices[0];
    if choice.get("finish_reason").and_then(Value::as_str) != Some("stop") {
        return Err(ModelError::Format);
    }
    let message = &choice["message"];
    if message["role"].as_str() != Some("assistant")
        || message.get("tool_calls").is_some()
        || message.get("function_call").is_some()
        || message.get("refusal").is_some_and(|v| !v.is_null())
        || message
            .get("reasoning_content")
            .is_some_and(|v| !v.is_null() && v.as_str() != Some(""))
    {
        return Err(ModelError::Format);
    }
    let content = message["content"]
        .as_str()
        .filter(|s| s.len() <= 128)
        .ok_or(ModelError::Format)?;
    let result: Value = serde_json::from_str(content).map_err(|_| ModelError::Format)?;
    if result != json!({"status":"ok"}) {
        return Err(ModelError::Format);
    }
    // Reject duplicate keys too: the simple closed health object has exactly one key.
    let compact: String = content.chars().filter(|c| !c.is_whitespace()).collect();
    if compact != "{\"status\":\"ok\"}" {
        return Err(ModelError::Format);
    }
    Ok(ModelResponse::Healthy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use synapse_core::Provider;
    fn reply(content: &str) -> Vec<u8> {
        serde_json::to_vec(&json!({"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":content}}]})).unwrap_or_else(|_| panic!("synthetic fixture failed"))
    }
    #[test]
    fn strict_health_and_provider_specific_builders() {
        assert_eq!(
            decode(&reply("{\"status\":\"ok\"}")),
            Ok(ModelResponse::Healthy)
        );
        for bad in [
            "{}",
            "{\"status\":\"ok\",\"path\":\"secret\"}",
            "```json {} ```",
            "{\"status\":\"ok\",\"status\":\"ok\"}",
        ] {
            assert_eq!(decode(&reply(bad)), Err(ModelError::Format));
        }
        let mut truncated: Value = serde_json::from_slice(&reply("{\"status\":\"ok\"}"))
            .unwrap_or_else(|_| panic!("fixture"));
        truncated["choices"][0]["finish_reason"] = json!("length");
        assert_eq!(
            decode(&serde_json::to_vec(&truncated).unwrap_or_else(|_| panic!("fixture"))),
            Err(ModelError::Format)
        );
        truncated["choices"][0]["finish_reason"] = json!("stop");
        truncated["choices"][0]["message"]["tool_calls"] = json!([]);
        assert_eq!(
            decode(&serde_json::to_vec(&truncated).unwrap_or_else(|_| panic!("fixture"))),
            Err(ModelError::Format)
        );
        let local = ProviderTransport::build(&ModelRequest::health(Provider::bonsai()))
            .unwrap_or_else(|_| panic!("synthetic fixture failed"));
        assert_eq!(local["chat_template_kwargs"]["enable_thinking"], false);
        assert_eq!(
            local["response_format"]["schema"]["additionalProperties"],
            false
        );
        let consent = synapse_core::RemoteConsent::after_local_disclosure();
        let remote = ProviderTransport::build(&ModelRequest::health(
            Provider::openrouter("test/model", &consent)
                .unwrap_or_else(|_| panic!("synthetic fixture failed")),
        ))
        .unwrap_or_else(|_| panic!("synthetic fixture failed"));
        assert_eq!(remote["response_format"]["json_schema"]["strict"], true);
        assert!(remote.get("chat_template_kwargs").is_none());
        assert_eq!(remote["provider"]["allow_fallbacks"], false);
    }
    #[test]
    fn timeout_offline_and_cancelled_are_fixed_errors() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap_or_else(|_| panic!("fixture"));
        let address = listener.local_addr().unwrap_or_else(|_| panic!("fixture"));
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap_or_else(|_| panic!("fixture"));
            let mut bytes = [0; 4096];
            let _ = socket.read(&mut bytes);
            thread::sleep(Duration::from_millis(150));
        });
        let config = ureq::Agent::config_builder()
            .proxy(None)
            .max_redirects(0)
            .timeout_global(Some(Duration::from_millis(50)))
            .build();
        let transport = ProviderTransport {
            agent: config.into(),
            key: None,
        };
        let request = ModelRequest::health(Provider::bonsai());
        let url = format!("http://{address}/v1/chat/completions");
        assert_eq!(
            transport.send(&url, &request, &Cancellation::default()),
            Err(ModelError::Timeout)
        );
        server.join().unwrap_or_else(|_| panic!("fixture"));
        assert_eq!(
            transport.send(&url, &request, &Cancellation::default()),
            Err(ModelError::Offline)
        );
        let cancel = Cancellation::default();
        cancel.cancel();
        assert_eq!(
            transport.send(&url, &request, &cancel),
            Err(ModelError::Cancelled)
        );
    }
    #[test]
    fn bounded_http_refuses_redirect_and_never_sends_local_credentials() {
        for (status, payload, expected) in [
            (
                "200 OK",
                reply("{\"status\":\"ok\"}"),
                Ok(ModelResponse::Healthy),
            ),
            ("302 Found", Vec::new(), Err(ModelError::Http)),
            (
                "500 Error",
                b"private raw error".to_vec(),
                Err(ModelError::Http),
            ),
            (
                "200 OK",
                vec![b'x'; MAX_RESPONSE_BYTES + 1],
                Err(ModelError::Budget),
            ),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0")
                .unwrap_or_else(|_| panic!("synthetic fixture failed"));
            let address = listener
                .local_addr()
                .unwrap_or_else(|_| panic!("synthetic fixture failed"));
            let server = thread::spawn(move || {
                let (mut socket, _) = listener
                    .accept()
                    .unwrap_or_else(|_| panic!("synthetic fixture failed"));
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap_or_else(|_| panic!("synthetic fixture failed"));
                let mut request = Vec::new();
                let mut chunk = [0; 1024];
                loop {
                    let n = socket
                        .read(&mut chunk)
                        .unwrap_or_else(|_| panic!("synthetic fixture failed"));
                    assert!(n > 0);
                    request.extend_from_slice(&chunk[..n]);
                    if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&request[..end]).to_lowercase();
                        let length: usize = headers
                            .lines()
                            .find_map(|line| line.strip_prefix("content-length: "))
                            .unwrap_or_else(|| panic!("missing content length"))
                            .parse()
                            .unwrap_or_else(|_| panic!("synthetic fixture failed"));
                        if request.len() >= end + 4 + length {
                            break;
                        }
                    }
                    assert!(request.len() <= 4096);
                }
                let headers = String::from_utf8_lossy(&request).to_lowercase();
                assert!(!headers.contains("authorization"));
                let header = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nLocation: http://192.0.2.1/\r\nConnection: close\r\n\r\n",
                    payload.len()
                );
                let _ = socket.write_all(header.as_bytes());
                let _ = socket.write_all(&payload);
            });
            let transport = ProviderTransport::new(Some("secret-test-key".to_owned()))
                .unwrap_or_else(|_| panic!("synthetic fixture failed"));
            assert_eq!(
                transport.send(
                    &format!("http://{address}/v1/chat/completions"),
                    &ModelRequest::health(Provider::bonsai()),
                    &Cancellation::default()
                ),
                expected
            );
            server
                .join()
                .unwrap_or_else(|_| panic!("synthetic fixture failed"));
        }
    }
}
