//! RACI-aware SOP normalization via one-shot llama-cli completion + JSON validation.

use crate::llama_cli::{run_completion_once, LlamaCliStartOptions};
use serde::{Deserialize, Serialize};

fn default_vec_string() -> Vec<String> {
    Vec::new()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SopRaci {
    #[serde(default)]
    pub r: Option<String>,
    #[serde(default)]
    pub a: Option<String>,
    #[serde(default = "default_vec_string")]
    pub c: Vec<String>,
    #[serde(default = "default_vec_string")]
    pub i: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SopRaciWire {
    Obj(SopRaci),
    Str(String),
    Null(Option<serde_json::Value>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SopStep {
    pub n: u32,
    #[serde(default)]
    pub imperative: Option<String>,
    #[serde(default)]
    pub raci: Option<SopRaciWire>,
    #[serde(rename = "actionKind")]
    #[serde(default)]
    pub action_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedSop {
    pub steps: Vec<SopStep>,
}

fn clamp_short(s: String, max: usize) -> String {
    let t = s.trim().to_string();
    if t.chars().count() <= max {
        return t;
    }
    t.chars().take(max).collect::<String>().trim().to_string()
}

fn finalize_normalized(mut parsed: NormalizedSop) -> Result<NormalizedSop, String> {
    if parsed.steps.is_empty() {
        return Err("normalized SOP has no steps".into());
    }

    // Fill in nulls / blanks with safe defaults; clamp to keep UI clean.
    for (idx, step) in parsed.steps.iter_mut().enumerate() {
        let imperative = step
            .imperative
            .take()
            .unwrap_or_default()
            .trim()
            .to_string();
        if imperative.is_empty() {
            return Err(format!("normalized SOP step {} has empty imperative", idx + 1));
        }
        step.imperative = Some(clamp_short(imperative, 200));

        // Normalize `raci` which models sometimes emit as object, string role, or null/missing.
        let mut raci = match step.raci.take() {
            Some(SopRaciWire::Obj(r)) => r,
            Some(SopRaciWire::Str(role)) => SopRaci {
                r: Some(role.clone()),
                a: Some(role),
                c: Vec::new(),
                i: Vec::new(),
            },
            Some(SopRaciWire::Null(_)) | None => SopRaci {
                r: Some(String::new()),
                a: Some(String::new()),
                c: Vec::new(),
                i: Vec::new(),
            },
        };

        let r = raci.r.take().unwrap_or_default();
        let a = raci.a.take().unwrap_or_default();
        raci.r = Some(clamp_short(r, 80));
        raci.a = Some(clamp_short(a, 80));
        raci.c = raci
            .c
            .iter()
            .map(|s| clamp_short(s.clone(), 80))
            .filter(|s| !s.is_empty())
            .take(6)
            .collect();
        raci.i = raci
            .i
            .iter()
            .map(|s| clamp_short(s.clone(), 80))
            .filter(|s| !s.is_empty())
            .take(6)
            .collect();
        step.raci = Some(SopRaciWire::Obj(raci));

        let ak = step.action_kind.take().unwrap_or_else(|| "other".to_string());
        let ak = ak.trim();
        let ak = match ak {
            "inform_stakeholder" | "request_approval" | "execute_task" | "escalate" | "document" | "other" => ak,
            _ => "other",
        };
        step.action_kind = Some(ak.to_string());
    }

    Ok(parsed)
}

/// Keeps llama-cli `-n` bounded so a greedy model cannot run for many minutes on CPU.
const MAX_SOP_NORMALIZE_NEW_TOKENS: u32 = 4096;

/// Very long PDF paste + prompt must stay under context; truncation avoids pathological runs.
const MAX_RAW_SOP_CHARS: usize = 48_000;

pub fn build_sop_normalize_prompt(raw_sop: &str) -> String {
    format!(
        "System: You convert messy SOP prose into strict JSON only. No markdown, no fences, no commentary before/after.\n\
Output MUST be a single valid JSON object matching this schema:\n\
{{\"steps\":[{{\"n\":number,\"imperative\":string,\"raci\":{{\"r\":string,\"a\":string,\"c\":string[],\"i\":string[]}},\"actionKind\":string}}]}}\n\
Rules:\n\
- One JSON object only: exactly one top-level `steps` array. Never emit `steps` twice or a second root object.\n\
- Keep it SHORT so it fits: max 12 steps.\n\
- `imperative` <= 120 chars. Do not quote long source text.\n\
- `r` and `a` should be short role names (<= 40 chars).\n\
- `c` and `i` arrays: 0-3 short strings each (<= 40 chars each). Use [] if unsure.\n\
- actionKind must be one of: inform_stakeholder, request_approval, execute_task, escalate, document, other.\n\
- Stop generating immediately after the final `}}`.\n\
User: Normalize this SOP into numbered imperative steps with RACI hints:\n{}\nAssistant: ",
        raw_sop
    )
}

fn extract_json_object(s: &str) -> Option<String> {
    let start = s.find('{')?;
    let mut depth = 0i32;
    let bytes = s.as_bytes();
    for (i, b) in s[start..].bytes().enumerate() {
        match b {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    let end = start + i + 1;
                    return Some(s[start..end].to_string());
                }
            }
            _ => {}
        }
    }
    let _ = bytes;
    None
}

pub fn normalize_sop_with_llama(
    raw_sop: String,
    mut options: LlamaCliStartOptions,
) -> Result<NormalizedSop, String> {
    let raw_sop = if raw_sop.chars().count() > MAX_RAW_SOP_CHARS {
        let n = raw_sop.chars().count();
        let head: String = raw_sop.chars().take(MAX_RAW_SOP_CHARS).collect();
        format!(
            "{head}\n\n[Truncated from {n} Unicode chars for normalize; use a shorter excerpt or split the SOP.]",
        )
    } else {
        raw_sop
    };

    options.max_new_tokens = options
        .max_new_tokens
        .min(MAX_SOP_NORMALIZE_NEW_TOKENS)
        .max(128);

    options.initial_prompt = build_sop_normalize_prompt(&raw_sop);
    if !options.initial_prompt.starts_with("System:") {
        return Err("internal: prompt must start with System:".into());
    }
    if !options.initial_prompt.ends_with("Assistant: ") {
        return Err("internal: prompt must end with Assistant: ".into());
    }
    let text = run_completion_once(&options)?;
    let json_s = extract_json_object(&text).ok_or_else(|| {
        let trimmed = text.chars().take(400).collect::<String>();
        if text.find('{').is_some() {
            format!(
                "model output looks like truncated JSON (no complete object found). Try increasing maxNewTokens. raw (trimmed): {trimmed}"
            )
        } else {
            format!("model did not return JSON object; raw (trimmed): {trimmed}")
        }
    })?;
    let parsed: NormalizedSop =
        serde_json::from_str(&json_s).map_err(|e| format!("invalid normalized SOP JSON: {e}"))?;
    finalize_normalized(parsed)
}
