//! Minimal Anthropic Messages API client (blocking). Key: `ANTHROPIC_API_KEY` env.

use std::time::Duration;

pub fn complete_user_message(model: &str, user_text: &str) -> Result<String, String> {
    let key = std::env::var("ANTHROPIC_API_KEY").map_err(|_| {
        "ANTHROPIC_API_KEY is not set (required for CloudAnthropic nodes)".to_string()
    })?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e: reqwest::Error| e.to_string())?;
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 2048,
        "messages": [{"role": "user", "content": user_text}]
    });
    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .map_err(|e: reqwest::Error| e.to_string())?;
    if !res.status().is_success() {
        let txt = res.text().unwrap_or_default();
        return Err(format!("Anthropic API error: {txt}"));
    }
    let parsed: serde_json::Value = res.json().map_err(|e: reqwest::Error| e.to_string())?;
    let mut out = String::new();
    if let Some(arr) = parsed.get("content").and_then(|c| c.as_array()) {
        for block in arr {
            if let Some(t) = block.get("text").and_then(|x| x.as_str()) {
                out.push_str(t);
            }
        }
    }
    if out.is_empty() {
        return Err("empty response from Anthropic".into());
    }
    Ok(out.trim().to_string())
}
