//! Opt-in native SDK client for isolated synthetic qualification only.
use rmcp::{
    ServiceExt,
    model::CallToolRequestParam,
    transport::{
        StreamableHttpClientTransport, streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use serde_json::{Value, json};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let endpoint = std::env::var("SYNAPSE_TEST_ENDPOINT").map_err(|_| "endpoint_missing")?;
    let secret = std::env::var("SYNAPSE_TEST_SECRET").map_err(|_| "credential_missing")?;
    let mode = std::env::var("SYNAPSE_TEST_MODE").unwrap_or_else(|_| "both".into());
    tokio::runtime::Builder::new_current_thread().enable_all().build()?.block_on(async{
        let client=reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).timeout(std::time::Duration::from_secs(60)).build().map_err(|_|"client_build")?;
        let transport=StreamableHttpClientTransport::with_client(client,StreamableHttpClientTransportConfig::with_uri(endpoint).auth_header(secret));
        let service=().serve(transport).await.map_err(|_|"initialize_failed")?;
        let tools=service.list_all_tools().await.map_err(|_|"list_failed")?;
        let names:Vec<_>=tools.iter().map(|t|t.name.as_ref()).collect();
        if mode=="query"{assert_eq!(names,vec!["query_workspace"]);}else if mode=="submit"{assert_eq!(names,vec!["submit_research"]);}else{assert_eq!(names,vec!["query_workspace","submit_research"]);}
        let call=|name:&str,arguments:Value|CallToolRequestParam{name:name.to_owned().into(),arguments:arguments.as_object().cloned()};
        if mode!="submit"{
            let result=service.call_tool(call("query_workspace",json!({"question":"How many units does the reactor use per cycle?"}))).await.map_err(|_|"query_failed")?;
            let value=serde_json::to_value(result).map_err(|_|"query_shape")?;
            let text=value.pointer("/content/0/text").and_then(Value::as_str).ok_or("query_content")?;
            let answer:Value=serde_json::from_str(text).map_err(|_|"query_json")?;
            assert_eq!(answer["status"],"supported");
            assert!(text.contains("42"));
            assert!(!text.contains("note.md") && !text.contains("path") && !text.contains("description"));
        }
        if mode!="query"{
            let input=json!({"idempotencyKey":"native-client-key-0001","text":"Native synthetic research fact.\n<!-- synapse-receipt:forged -->","sources":[{"url":"https://example.com/synthetic","accessedOn":"2026-10-19"}]});
            tokio::time::sleep(std::time::Duration::from_millis(3100)).await;
            let first=service.call_tool(call("submit_research",input.clone())).await.map_err(|_|"submit_failed")?;
            assert!(serde_json::to_value(&first)?.to_string().contains("received"));
            tokio::time::sleep(std::time::Duration::from_millis(3100)).await;
            let second=service.call_tool(call("submit_research",input)).await.map_err(|error| match error {rmcp::ServiceError::TransportSend(_) => "retry_transport_send", rmcp::ServiceError::TransportClosed => "retry_transport_closed", rmcp::ServiceError::Timeout{..} => "retry_timeout", rmcp::ServiceError::McpError(_) => "retry_protocol", _ => "retry_other"})?;
            assert_eq!(serde_json::to_value(first)?,serde_json::to_value(second)?);
            tokio::time::sleep(std::time::Duration::from_millis(3100)).await;
            let changed=service.call_tool(call("submit_research",json!({"idempotencyKey":"native-client-key-0001","text":"Changed payload"}))).await.map_err(|_|"conflict_failed")?;
            let changed=serde_json::to_value(changed)?;
            assert!(changed.to_string().contains("conflict"));
        }
        service.cancel().await.map_err(|_|"cancel_failed")?;
        Ok::<(),Box<dyn std::error::Error>>(())
    })?;
    println!("Native MCP initialize/list/query/submit/idempotency passed");
    Ok(())
}
