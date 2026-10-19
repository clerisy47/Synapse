use crate::{CanonicalWorkspace, ClientGrant, DiskStateStore};
use rmcp::{ErrorData, RoleServer, ServerHandler, model::*, service::RequestContext};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
use synapse_core::{Cancellation, ChatSession, ModelService, PublicError};
#[derive(Clone)]
pub(crate) struct Handler {
    pub reader: Arc<CanonicalWorkspace>,
    pub store: Arc<DiskStateStore>,
    pub model: Arc<dyn ModelService>,
    pub grant: ClientGrant,
    pub cancel: Cancellation,
    pub delivery: Arc<std::sync::Mutex<Vec<synapse_core::Evidence>>>,
}
fn unavailable() -> Value {
    json!({"status":"unavailable","references":[]})
}
fn tool(name: &'static str, description: &'static str, schema: Value) -> Tool {
    Tool::new(
        name,
        description,
        schema.as_object().cloned().unwrap_or_default(),
    )
}
impl Handler {
    fn query(&self, arguments: Value) -> Result<Value, PublicError> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Query {
            question: String,
        }
        let input: Query = serde_json::from_value(arguments).map_err(|_| PublicError::Usage)?;
        if input.question.trim().is_empty() || input.question.len() > 1024 {
            return Err(PublicError::Usage);
        }
        if !self.grant.query || !self.store.grant_current(&self.grant) {
            return Err(PublicError::AccessRefused);
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
        let cancel = Cancellation::default().with_budget(move || {
            u64::try_from(
                deadline
                    .saturating_duration_since(std::time::Instant::now())
                    .as_millis(),
            )
            .unwrap_or(u64::MAX)
        });
        let stop = std::sync::atomic::AtomicBool::new(false);
        let answer = std::thread::scope(|scope| {
            scope.spawn(|| {
                while !stop.load(std::sync::atomic::Ordering::Acquire) {
                    if std::time::Instant::now() >= deadline
                        || self.cancel.is_cancelled()
                        || !self.store.grant_current(&self.grant)
                    {
                        cancel.cancel();
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
            });
            let result = (|| {
                let mut chat =
                    ChatSession::new(self.reader.as_ref(), self.reader.access_policy().clone())?;
                let answer = chat.ask(
                    &input.question,
                    self.reader.as_ref(),
                    self.reader.access_policy(),
                    self.model.as_ref(),
                    &cancel,
                )?;
                if cancel.is_cancelled() {
                    return Err(PublicError::AccessRefused);
                }
                Ok(answer)
            })();
            stop.store(true, std::sync::atomic::Ordering::Release);
            result
        })?;
        *self
            .delivery
            .lock()
            .map_err(|_| PublicError::StateUnavailable)? = answer.sources.clone();
        // Only app-owned excerpts and ordinals cross this boundary. No paths,
        // titles, corpus counts, metadata or retrieval traces are projected.
        let references: Vec<_> = answer
            .sources
            .iter()
            .take(12)
            .enumerate()
            .map(|(i, e)| json!({"id":i+1,"excerpt":e.text.chars().take(600).collect::<String>()}))
            .collect();
        if references.is_empty() {
            Ok(unavailable())
        } else {
            Ok(json!({"status":"supported","references":references}))
        }
    }
}
impl ServerHandler for Handler {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::V_2025_06_18,
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            server_info: Implementation {
                name: "synapse".into(),
                version: env!("CARGO_PKG_VERSION").into(),
                ..Implementation::default()
            },
            instructions: None,
        }
    }
    async fn list_tools(
        &self,
        _: Option<PaginatedRequestParam>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let mut tools = Vec::new();
        if self.store.grant_current(&self.grant) {
            if self.grant.query {
                tools.push(tool("query_workspace",crate::mcp_strings::QUERY,json!({"type":"object","additionalProperties":false,"required":["question"],"properties":{"question":{"type":"string","minLength":1,"maxLength":1024}}})));
            }
            if self.grant.submit {
                tools.push(tool("submit_research",crate::mcp_strings::SUBMIT,json!({"type":"object","additionalProperties":false,"required":["idempotencyKey","text"],"properties":{"idempotencyKey":{"type":"string","minLength":16,"maxLength":128,"pattern":"^[A-Za-z0-9_-]+$"},"text":{"type":"string","minLength":1,"maxLength":32000},"sources":{"type":"array","maxItems":10,"items":{"type":"object","additionalProperties":false,"required":["url"],"properties":{"url":{"type":"string","maxLength":2048},"accessedOn":{"type":"string"}}}}}})));
            }
        }
        Ok(ListToolsResult {
            tools,
            next_cursor: None,
        })
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParam,
        _: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let args = Value::Object(request.arguments.unwrap_or_default());
        let value = if !self.store.grant_current(&self.grant) {
            unavailable()
        } else {
            match request.name.as_ref() {
                "query_workspace" => self.query(args).unwrap_or_else(|_| unavailable()),
                "submit_research" => match serde_json::from_value(args)
                    .map_err(|_| PublicError::Usage)
                    .and_then(|input| self.store.submit(self.reader.as_ref(), &self.grant, input))
                {
                    Ok(receipt) => json!({"status":"received","receipt":receipt}),
                    Err(PublicError::Conflict) => json!({"status":"conflict"}),
                    Err(_) => json!({"status":"unavailable"}),
                },
                _ => unavailable(),
            }
        };
        Ok(CallToolResult::success(vec![Content::text(
            value.to_string(),
        )]))
    }
}
