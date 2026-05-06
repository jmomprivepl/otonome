//! Hermes-style agent loop: Thought → tool_use → local execution → tool_result → repeat.

use crate::hardware_preference::InferenceHardwareSnapshot;
use crate::hermes_claude::{messages_create, parse_assistant_turn, tool_results_message, AssistantTurn};
use crate::hermes_prompt::hermes_otonome_system_prompt;
use crate::hermes_tools::{
    anthropic_tool_definitions, execute_read_local_file, execute_search_hubspot_contact_mock,
    external_isolation_from_router, routing_context_for_guard, TOOL_READ_LOCAL_FILE,
    TOOL_SEARCH_HUBSPOT_CONTACT,
};
use crate::router_llama_cpp::generate_routing_vector;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const BLOCKED_HUBSPOT_MSG: &str = "Action blocked by local SME privacy SOP.";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HermesSessionResult {
    pub assistant_final: String,
    pub turns_used: u32,
    pub log: Vec<String>,
    pub inference_hardware: InferenceHardwareSnapshot,
}

fn append_assistant_message(messages: &mut Vec<Value>, turn: &AssistantTurn) {
    let mut content: Vec<Value> = Vec::new();
    if !turn.text.trim().is_empty() {
        content.push(json!({
            "type": "text",
            "text": turn.text
        }));
    }
    for tu in &turn.tool_uses {
        content.push(json!({
            "type": "tool_use",
            "id": tu.id,
            "name": tu.name,
            "input": tu.input
        }));
    }
    messages.push(json!({
        "role": "assistant",
        "content": content
    }));
}

fn execute_tool_gated(user_task: &str, name: &str, input: &Value) -> Result<String, String> {
    if name == TOOL_SEARCH_HUBSPOT_CONTACT {
        let ctx = routing_context_for_guard(user_task, name, input);
        match generate_routing_vector(&ctx) {
            Ok(v) => {
                if external_isolation_from_router(&v) {
                    return Ok(BLOCKED_HUBSPOT_MSG.to_string());
                }
            }
            Err(e) => {
                return Ok(format!(
                    "Observation: local router unavailable ({e}). Cannot verify SME privacy SOP; HubSpot search not executed."
                ));
            }
        }
        return execute_search_hubspot_contact_mock(input);
    }
    if name == TOOL_READ_LOCAL_FILE {
        return execute_read_local_file(input);
    }
    Err(format!("unknown tool: {name}"))
}

/// Blocking multi-turn session (Hermes pulse). Uses `reqwest::blocking` inside `hermes_claude`.
pub fn run_agent_session(model: &str, user_task: &str, max_turns: u32) -> Result<HermesSessionResult, String> {
    let hw = crate::hardware_preference::inference_hardware_snapshot();
    let client = crate::hermes_claude::http_client()?;
    let system = hermes_otonome_system_prompt();
    let tools = anthropic_tool_definitions();
    let mut messages: Vec<Value> = vec![json!({
        "role": "user",
        "content": user_task.trim()
    })];
    let mut log: Vec<String> = Vec::new();
    let mut turns_used: u32 = 0;
    let max_tokens: u32 = 4096;

    for turn_idx in 0..max_turns.max(1) {
        turns_used += 1;
        log.push(format!("> Hermes turn {}: POST messages", turn_idx + 1));
        let resp = messages_create(&client, model, max_tokens, &system, &tools, &messages)?;
        let parsed = parse_assistant_turn(&resp)?;
        log.push(format!(
            "> stop_reason={:?} tool_uses={}",
            parsed.stop_reason,
            parsed.tool_uses.len()
        ));

        append_assistant_message(&mut messages, &parsed);

        if parsed.tool_uses.is_empty() {
            return Ok(HermesSessionResult {
                assistant_final: parsed.text.trim().to_string(),
                turns_used,
                log,
                inference_hardware: hw.clone(),
            });
        }

        let mut results: Vec<(String, String)> = Vec::new();
        for tu in &parsed.tool_uses {
            match execute_tool_gated(user_task, &tu.name, &tu.input) {
                Ok(out) => {
                    log.push(format!("> tool {} ok ({} bytes)", tu.name, out.len()));
                    results.push((tu.id.clone(), out));
                }
                Err(e) => {
                    log.push(format!("> tool {} error: {}", tu.name, e));
                    results.push((tu.id.clone(), format!("Error: {e}")));
                }
            }
        }
        messages.push(tool_results_message(&results));
    }

    Ok(HermesSessionResult {
        assistant_final: "Stopped: max_turns exceeded without a final text-only answer.".into(),
        turns_used,
        log,
        inference_hardware: hw,
    })
}

#[tauri::command]
pub fn hermes_run_agent_session(req: HermesRunAgentRequest) -> Result<HermesSessionResult, String> {
    let model = if req.model.trim().is_empty() {
        "claude-sonnet-4-20250514".to_string()
    } else {
        req.model.clone()
    };
    if req.user_prompt.trim().is_empty() {
        return Err("user_prompt is empty".into());
    }
    run_agent_session(&model, &req.user_prompt, req.max_turns)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HermesRunAgentRequest {
    pub model: String,
    pub user_prompt: String,
    #[serde(default = "default_max_turns")]
    pub max_turns: u32,
}

fn default_max_turns() -> u32 {
    16
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hubspot_blocked_when_p12_is_minus_one() {
        let mut v = [0i8; 32];
        v[crate::hermes_tools::ROUTER_PARAM12_EXTERNAL_INDEX] = -1;
        assert!(external_isolation_from_router(&v));
    }

    #[test]
    fn hubspot_allowed_when_p12_not_minus_one() {
        let v = [0i8; 32];
        assert!(!external_isolation_from_router(&v));
    }
}
