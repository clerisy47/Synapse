//! Explicit authenticated numeric-loopback listener. Header authentication occurs
//! before reading JSON bytes; no general network primitive leaves this adapter.
use crate::{CanonicalWorkspace, DiskStateStore, mcp_handler::Handler};
use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::Arc,
    time::{Duration, Instant},
};
use synapse_core::{Cancellation, ModelService, PublicError};
const MAX_HEADER: usize = 8192;
const MAX_BODY: usize = 65536;
const IO_TIME: Duration = Duration::from_secs(5);
const REQUEST_TIME: Duration = Duration::from_secs(60);
const RATE_PER_MINUTE: f64 = 20.0;
const RATE_BURST: f64 = 5.0;
/// Current transport intentionally handles one semantic request at a time. This
/// is below the four-global/one-per-client ceilings and matches the local slot.
pub struct McpListener {
    listener: TcpListener,
}
impl McpListener {
    pub fn bind() -> Result<Self, PublicError> {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| PublicError::ProviderUnavailable)?;
        listener
            .set_nonblocking(true)
            .map_err(|_| PublicError::ProviderUnavailable)?;
        Ok(Self { listener })
    }
    pub fn port(&self) -> Result<u16, PublicError> {
        self.listener
            .local_addr()
            .map(|a| a.port())
            .map_err(|_| PublicError::ProviderUnavailable)
    }
    pub fn serve(
        self,
        reader: Arc<CanonicalWorkspace>,
        store: Arc<DiskStateStore>,
        model: Arc<dyn ModelService>,
        cancel: Cancellation,
    ) -> Result<(), PublicError> {
        store.assert_workspace(reader.as_ref())?;
        let host = format!("127.0.0.1:{}", self.port()?);
        let mut rates: HashMap<String, (f64, Instant)> = HashMap::new();
        while !cancel.is_cancelled() {
            let (mut stream, peer) = match self.listener.accept() {
                Ok(pair) => pair,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(25));
                    continue;
                }
                Err(_) => return Err(PublicError::ProviderUnavailable),
            };
            if !peer.ip().is_loopback() {
                continue;
            }
            let start = Instant::now();
            let delivery = Arc::new(std::sync::Mutex::new(Vec::new()));
            let response = (|| -> Result<(u16, Vec<u8>, crate::ClientGrant), PublicError> {
                stream
                    .set_read_timeout(Some(IO_TIME))
                    .map_err(|_| PublicError::Usage)?;
                stream
                    .set_write_timeout(Some(IO_TIME))
                    .map_err(|_| PublicError::Usage)?;
                let mut bytes = Vec::new();
                while !bytes.ends_with(b"\r\n\r\n") {
                    if bytes.len() >= MAX_HEADER || start.elapsed() >= IO_TIME {
                        return Err(PublicError::Usage);
                    }
                    stream
                        .set_read_timeout(Some(IO_TIME.saturating_sub(start.elapsed())))
                        .map_err(|_| PublicError::Usage)?;
                    let mut byte = [0];
                    stream
                        .read_exact(&mut byte)
                        .map_err(|_| PublicError::Usage)?;
                    bytes.push(byte[0]);
                }
                let raw = std::str::from_utf8(&bytes).map_err(|_| PublicError::Usage)?;
                let mut lines = raw.split("\r\n");
                let line = lines.next().ok_or(PublicError::Usage)?;
                let method = match line {
                    "POST /mcp HTTP/1.1" => "POST",
                    "GET /mcp HTTP/1.1" => "GET",
                    "DELETE /mcp HTTP/1.1" => "DELETE",
                    _ => return Err(PublicError::Usage),
                };
                let mut headers = HashMap::new();
                for line in lines.filter(|line| !line.is_empty()) {
                    let (name, value) = line.split_once(':').ok_or(PublicError::Usage)?;
                    if name.is_empty()
                        || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                        || value.bytes().any(|b| b < 32 && b != b'\t')
                    {
                        return Err(PublicError::Usage);
                    }
                    if headers
                        .insert(name.to_ascii_lowercase(), value.trim().to_owned())
                        .is_some()
                    {
                        return Err(PublicError::Usage);
                    }
                }
                if headers.get("host").map(String::as_str) != Some(host.as_str())
                    || headers.contains_key("origin")
                    || headers.keys().any(|k| {
                        k == "forwarded"
                            || k.starts_with("x-forwarded-")
                            || k == "transfer-encoding"
                    })
                {
                    return Err(PublicError::AccessRefused);
                }
                let token = headers
                    .get("authorization")
                    .and_then(|s| s.strip_prefix("Bearer "))
                    .filter(|s| s.len() == 64)
                    .ok_or(PublicError::AccessRefused)?;
                let grant = store.authenticate(token)?;
                // Bind credentials to this explicit access configuration.
                if grant.policy != synapse_core::policy_fingerprint(reader.access_policy()) {
                    return Err(PublicError::AccessRefused);
                }
                rates.retain(|id, _| {
                    store
                        .clients()
                        .is_ok_and(|clients| clients.iter().any(|c| c.id == *id))
                });
                let rate = rates
                    .entry(grant.id.clone())
                    .or_insert((RATE_BURST, Instant::now()));
                rate.0 = (rate.0 + rate.1.elapsed().as_secs_f64() * RATE_PER_MINUTE / 60.0)
                    .min(RATE_BURST);
                rate.1 = Instant::now();
                let admitted = rate.0 >= 1.0;
                if admitted {
                    rate.0 -= 1.0;
                }
                if method != "POST" {
                    return Ok((405, Vec::new(), grant));
                }
                if headers
                    .get("content-type")
                    .map(|s| s.split(';').next().unwrap_or("").trim())
                    != Some("application/json")
                {
                    return Err(PublicError::Usage);
                }
                if headers
                    .get("mcp-protocol-version")
                    .is_some_and(|s| s != "2025-06-18")
                {
                    return Err(PublicError::Usage);
                }
                let length = headers
                    .get("content-length")
                    .ok_or(PublicError::Usage)?
                    .parse::<usize>()
                    .map_err(|_| PublicError::Usage)?;
                if length > MAX_BODY {
                    return Err(PublicError::ResourceLimit);
                }
                let mut body = vec![0; length];
                let mut offset = 0;
                while offset < length {
                    if start.elapsed() >= IO_TIME {
                        return Err(PublicError::Usage);
                    }
                    stream
                        .set_read_timeout(Some(IO_TIME.saturating_sub(start.elapsed())))
                        .map_err(|_| PublicError::Usage)?;
                    let count = stream
                        .read(&mut body[offset..])
                        .map_err(|_| PublicError::Usage)?;
                    if count == 0 {
                        return Err(PublicError::Usage);
                    }
                    offset += count;
                }
                if !admitted {
                    return Ok((429, Vec::new(), grant));
                }
                let value: serde_json::Value = crate::strict_json::parse(&body)?;
                if !value.is_object()
                    || value.get("id").is_some_and(|id| id.to_string().len() > 128)
                {
                    return Err(PublicError::Usage);
                }
                let handler = Handler {
                    reader: reader.clone(),
                    store: store.clone(),
                    model: model.clone(),
                    grant: grant.clone(),
                    cancel: cancel.clone(),
                    delivery: delivery.clone(),
                };
                let service = StreamableHttpService::new(
                    move || Ok(handler.clone()),
                    Arc::new(LocalSessionManager::default()),
                    StreamableHttpServerConfig {
                        stateful_mode: false,
                        sse_keep_alive: None,
                    },
                );
                let mut request = http::Request::builder().method("POST").uri("/mcp");
                // Never expose Authorization to SDK extensions or tracing.
                for name in ["content-type", "accept", "mcp-protocol-version"] {
                    if let Some(value) = headers.get(name) {
                        request = request.header(name, value);
                    }
                }
                let request = request
                    .body(Full::new(Bytes::from(body)))
                    .map_err(|_| PublicError::Usage)?;
                // One stateless request owns its runtime and SDK tasks. Consume
                // one complete envelope rather than waiting for the SDK's SSE
                // channel EOF; fast responses can otherwise outlive its close
                // notification. Dropping this runtime cancels all residual tasks.
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_time()
                    .build()
                    .map_err(|_| PublicError::ProviderUnavailable)?;
                let (status, mut body) = runtime.block_on(async {
                    tokio::time::timeout(REQUEST_TIME.saturating_sub(start.elapsed()), async {
                        let response = service.handle(request).await;
                        let status = response.status().as_u16();
                        let mut stream = Limited::new(response.into_body(), MAX_BODY);
                        let mut bytes = Vec::new();
                        while let Some(frame) = stream.frame().await {
                            let frame = frame.map_err(|_| PublicError::ProviderUnavailable)?;
                            if let Ok(data) = frame.into_data() {
                                bytes.extend_from_slice(&data);
                                if bytes.len() > MAX_BODY {
                                    return Err(PublicError::ResourceLimit);
                                }
                                let sse =
                                    bytes.starts_with(b"event:") || bytes.starts_with(b"data:");
                                if (sse
                                    && (bytes.windows(2).any(|v| v == b"\n\n")
                                        || bytes.windows(4).any(|v| v == b"\r\n\r\n")))
                                    || (!sse
                                        && serde_json::from_slice::<serde_json::Value>(&bytes)
                                            .is_ok())
                                {
                                    break;
                                }
                            }
                        }
                        Ok::<_, PublicError>((status, bytes))
                    })
                    .await
                    .map_err(|_| PublicError::ProviderUnavailable)?
                })?;
                drop(runtime);
                if body.starts_with(b"event:") || body.starts_with(b"data:") {
                    let raw = std::str::from_utf8(&body).map_err(|_| PublicError::Usage)?;
                    let payloads: Vec<_> = raw
                        .lines()
                        .filter_map(|line| line.strip_prefix("data:").map(str::trim))
                        .collect();
                    if payloads.len() != 1 {
                        return Err(PublicError::Usage);
                    }
                    body = payloads[0].as_bytes().to_vec();
                }
                if body.len() > MAX_BODY || start.elapsed() > REQUEST_TIME {
                    return Err(PublicError::ResourceLimit);
                }
                if let Ok(mut value) = serde_json::from_slice::<serde_json::Value>(&body) {
                    if value.get("error").is_some() {
                        value["error"] =
                            serde_json::json!({"code":-32600,"message":"request_unavailable"});
                        body = serde_json::to_vec(&value).map_err(|_| PublicError::Usage)?;
                    }
                } else if !body.is_empty() {
                    body = Vec::new();
                }
                Ok((status, body, grant))
            })();
            match response {
                Ok((status, mut body, grant)) => {
                    // Revocation and final delivery linearize under the same
                    // workspace lock. A completed revoke cannot be followed by
                    // delivery of an earlier result.
                    if let Ok(_lock) = store.lock() {
                        if delivery
                            .lock()
                            .map(|evidence| {
                                evidence.iter().any(|e| {
                                    !synapse_core::verify_evidence(
                                        reader.as_ref(),
                                        reader.access_policy(),
                                        e,
                                    )
                                })
                            })
                            .unwrap_or(true)
                        {
                            if let Ok(mut envelope) =
                                serde_json::from_slice::<serde_json::Value>(&body)
                            {
                                envelope["result"] = serde_json::json!({"content":[{"type":"text","text":"{\"status\":\"unavailable\",\"references\":[]}"}],"isError":false});
                                body = serde_json::to_vec(&envelope).unwrap_or_default();
                            } else {
                                body.clear();
                            }
                        }

                        if !cancel.is_cancelled()
                            && store.grant_current_locked(&grant).unwrap_or(false)
                        {
                            let _ = send(&mut stream, status, &body);
                        } else {
                            let _ = send(&mut stream, 401, &[]);
                        }
                    }
                }
                Err(_) => {
                    let _ = send(&mut stream, 400, &[]);
                }
            }
        }
        Ok(())
    }
}
fn send(stream: &mut TcpStream, status: u16, body: &[u8]) -> std::io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status} Response\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n",
        body.len()
    )?;
    stream.write_all(body)
}
