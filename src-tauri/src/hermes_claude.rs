//! Anthropic Messages API (blocking `reqwest`) with native `tool_use` / `tool_result` turns.

use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::time::Duration;

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

fn api_key() -> Result<String, String> {
    std::env::var("ANTHROPIC_API_KEY").map_err(|_| "ANTHROPIC_API_KEY is not set".to_string())
}

pub fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(180))
        .https_only(true)
        .user_agent("Otonome-Hermes/1.0")
        .build()
        .map_err(|e| e.to_string())
}

/// One assistant turn: returns aggregated text blocks and any `tool_use` blocks.
pub struct AssistantTurn {
    pub text: String,
    pub tool_uses: Vec<ToolUseBlock>,
    pub stop_reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ToolUseBlock {
    pub id: String,
    pub name: String,
    pub input: Value,
}

pub fn messages_create(
    client: &Client,
    model: &str,
    max_tokens: u32,
    system: &str,
    tools: &[Value],
    messages: &[Value],
) -> Result<Value, String> {
    let key = api_key()?;
    let body = json!({
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "tools": tools,
        "messages": messages,
    });
    let res = client
        .post(ANTHROPIC_URL)
        .header("x-api-key", key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;
    let status = res.status();
    if !status.is_success() {
        let txt = res.text().unwrap_or_default();
        return Err(format!("Anthropic API {status}: {txt}"));
    }
    res.json().map_err(|e| e.to_string())
}

pub fn parse_assistant_turn(response: &Value) -> Result<AssistantTurn, String> {
    let stop = response
        .get("stop_reason")
        .and_then(|v| v.as_str())
        .map(String::from);
    let mut text = String::new();
    let mut tool_uses = Vec::new();
    if let Some(arr) = response.get("content").and_then(|c| c.as_array()) {
        for block in arr {
            let ty = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if ty == "text" {
                if let Some(t) = block.get("text").and_then(|x| x.as_str()) {
                    text.push_str(t);
                }
            } else if ty == "tool_use" {
                let id = block
                    .get("id")
                    .and_then(|x| x.as_str())
                    .ok_or_else(|| "tool_use missing id".to_string())?
                    .to_string();
                let name = block
                    .get("name")
                    .and_then(|x| x.as_str())
                    .ok_or_else(|| "tool_use missing name".to_string())?
                    .to_string();
                let input = block.get("input").cloned().unwrap_or(json!({}));
                tool_uses.push(ToolUseBlock { id, name, input });
            }
        }
    }
    Ok(AssistantTurn {
        text,
        tool_uses,
        stop_reason: stop,
    })
}

/// Build a user message containing `tool_result` blocks (Anthropic format).
pub fn tool_results_message(results: &[(String, String)]) -> Value {
    let content: Vec<Value> = results
        .iter()
        .map(|(tool_use_id, body)| {
            json!({
                "type": "tool_result",
                "tool_use_id": tool_use_id,
                "content": body
            })
        })
        .collect();
    json!({ "role": "user", "content": content })
}
