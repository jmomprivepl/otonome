//! Human-in-the-loop: block orchestration until the UI approves or supplies clarification.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{mpsc, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct HitlCoordinator {
    approval_tx: Mutex<HashMap<String, mpsc::Sender<bool>>>,
    clarify_tx: Mutex<HashMap<String, mpsc::Sender<String>>>,
    human_review_tx: Mutex<HashMap<String, mpsc::Sender<HumanReviewResponse>>>,
    /// Last serialized payload per channel — skip `emit` if identical to previous (defensive; cleared on resolve).
    last_approval_emit_json: Mutex<Option<String>>,
    last_clarify_emit_json: Mutex<Option<String>>,
    last_human_emit_json: Mutex<Option<String>>,
}

fn fingerprint_and_duplicate_check<T: Serialize>(
    last_json: &Mutex<Option<String>>,
    payload: &T,
) -> Result<(String, bool), String> {
    let fp = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    let dup = {
        let guard = last_json.lock().map_err(|e| e.to_string())?;
        guard.as_deref() == Some(fp.as_str())
    };
    Ok((fp, dup))
}

fn try_emit_hitl_event<T: Serialize + Clone>(
    app: &AppHandle,
    event: &str,
    payload: &T,
    last_json: &Mutex<Option<String>>,
) -> Result<(), String> {
    let (fp, dup) = fingerprint_and_duplicate_check(last_json, payload)?;
    if dup {
        eprintln!("[hitl-dedupe] skip duplicate Rust emit event={event} (same JSON as previous)");
        return Ok(());
    }
    app.emit(event, payload.clone()).map_err(|e| e.to_string())?;
    let mut guard = last_json.lock().map_err(|e| e.to_string())?;
    *guard = Some(fp);
    Ok(())
}

/// CamelCase JSON fields aligned with `HitlSensitivityMeta` on the TS client.
/// Emitted on every HITL event so the UI can treat backend values as primary; client inference is fallback only.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HitlSensitivityHints {
    /// Primary backend signal: when `Some`, the frontend should not infer urgency for this payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_sensitive: Option<bool>,
    /// Which product rule produced `time_sensitive` (logs / analytics; matches TS `timeSensitivityRule` style IDs).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_sensitivity_rule: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destructive: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    /// Seconds until SLA breach (when applicable); pairs with the §8 under-120s client policy.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sla_seconds_remaining: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub risk_score: Option<f64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionPendingPayload {
    pub id: String,
    pub tool_name: String,
    pub args_summary: String,
    pub node_id: Option<String>,
    #[serde(flatten)]
    pub sensitivity: HitlSensitivityHints,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClarificationPayload {
    pub id: String,
    pub question: String,
    pub options: Vec<String>,
    pub node_id: Option<String>,
    #[serde(flatten)]
    pub sensitivity: HitlSensitivityHints,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HumanReviewPayload {
    pub id: String,
    pub run_id: String,
    pub node_id: String,
    pub instructions: String,
    pub state_snapshot: serde_json::Value,
    #[serde(flatten)]
    pub sensitivity: HitlSensitivityHints,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HumanReviewResponse {
    pub approved: bool,
    #[serde(default)]
    pub reply: serde_json::Value,
}

/// Classify a pending system-tool approval from tool id + args summary (DAG / Hermes stubs).
fn classify_system_tool(tool_name: &str, args_summary: &str) -> HitlSensitivityHints {
    let destructive = tool_or_args_looks_destructive(tool_name, args_summary);
    let regulated = args_looks_regulated(args_summary);
    let risk_score = if destructive {
        0.92_f64
    } else if regulated {
        0.88
    } else {
        0.28
    };
    let time_sensitive = destructive || regulated || risk_score >= 0.85;
    let rule = if destructive {
        "destructive"
    } else if regulated {
        "regulated_category"
    } else if risk_score >= 0.85 {
        "risk_score"
    } else {
        "none"
    };
    HitlSensitivityHints {
        time_sensitive: Some(time_sensitive),
        time_sensitivity_rule: Some(rule.to_string()),
        destructive: Some(destructive),
        category: if regulated {
            Some("regulated".to_string())
        } else {
            None
        },
        sla_seconds_remaining: None,
        risk_score: Some(risk_score),
    }
}

fn tool_or_args_looks_destructive(tool_name: &str, args_summary: &str) -> bool {
    let needles = [
        "delete",
        "remove",
        "drop",
        "truncate",
        "wipe",
        "destroy",
        "format",
        "rm ",
        "unlink",
        "revoke",
        "shell",
        "exec",
        "subprocess",
        "sudo",
        "chmod",
        "grant_admin",
    ];
    let hay = format!(
        "{} {}",
        tool_name.to_lowercase(),
        args_summary.to_lowercase()
    );
    needles.iter().any(|n| hay.contains(n))
}

fn args_looks_regulated(args_summary: &str) -> bool {
    let hay = args_summary.to_lowercase();
    let needles = [
        "hipaa",
        "phi",
        "pci",
        "passport",
        "ssn",
        "social security",
        "tax id",
        "ein ",
        "medical record",
        "card number",
        "ciphertext",
        "credentials",
    ];
    needles.iter().any(|n| hay.contains(n))
}

/// Adapter / routing clarification blocks the DAG until answered — treat as SLA‑adjacent urgency (§8.3.3).
fn classify_clarification() -> HitlSensitivityHints {
    const ROUTING_SLA_SECS: i64 = 90;
    HitlSensitivityHints {
        time_sensitive: Some(true),
        time_sensitivity_rule: Some("sla_breach".to_string()),
        destructive: Some(false),
        category: None,
        sla_seconds_remaining: Some(ROUTING_SLA_SECS),
        risk_score: Some(0.55),
    }
}

/// Human review gates always pause execution; always surfaced as time‑critical (primary signal via `time_sensitive`).
fn classify_human_review() -> HitlSensitivityHints {
    HitlSensitivityHints {
        time_sensitive: Some(true),
        time_sensitivity_rule: Some("explicit_true".to_string()),
        destructive: Some(false),
        category: Some("human_gate".to_string()),
        sla_seconds_remaining: None,
        risk_score: Some(0.90),
    }
}

impl HitlCoordinator {
    fn clear_approval_emit_dedupe(&self) -> Result<(), String> {
        let mut g = self
            .last_approval_emit_json
            .lock()
            .map_err(|e| e.to_string())?;
        *g = None;
        Ok(())
    }

    fn clear_clarify_emit_dedupe(&self) -> Result<(), String> {
        let mut g = self
            .last_clarify_emit_json
            .lock()
            .map_err(|e| e.to_string())?;
        *g = None;
        Ok(())
    }

    fn clear_human_emit_dedupe(&self) -> Result<(), String> {
        let mut g = self
            .last_human_emit_json
            .lock()
            .map_err(|e| e.to_string())?;
        *g = None;
        Ok(())
    }

    pub fn await_approval(
        &self,
        app: &AppHandle,
        tool_name: String,
        args_summary: String,
        node_id: Option<String>,
    ) -> Result<bool, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::channel();
        self.approval_tx
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.clone(), tx);
        let sensitivity = classify_system_tool(&tool_name, &args_summary);
        let payload = ActionPendingPayload {
            id: id.clone(),
            tool_name,
            args_summary,
            node_id,
            sensitivity,
        };
        try_emit_hitl_event(
            app,
            "action_pending_approval",
            &payload,
            &self.last_approval_emit_json,
        )?;
        rx.recv().map_err(|_| {
            let _ = self.clear_approval_emit_dedupe();
            "approval wait cancelled".to_string()
        })
    }

    pub fn await_clarification(
        &self,
        app: &AppHandle,
        question: String,
        options: Vec<String>,
        node_id: Option<String>,
    ) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::channel();
        self.clarify_tx
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.clone(), tx);
        let sensitivity = classify_clarification();
        let payload = ClarificationPayload {
            id: id.clone(),
            question,
            options,
            node_id,
            sensitivity,
        };
        try_emit_hitl_event(
            app,
            "clarification_needed",
            &payload,
            &self.last_clarify_emit_json,
        )?;
        rx.recv().map_err(|_| {
            let _ = self.clear_clarify_emit_dedupe();
            "clarification wait cancelled".to_string()
        })
    }

    pub fn resolve_approval(&self, id: &str, approved: bool) -> Result<(), String> {
        let tx = self
            .approval_tx
            .lock()
            .map_err(|e| e.to_string())?
            .remove(id)
            .ok_or_else(|| format!("unknown approval id {id}"))?;
        let out = tx
            .send(approved)
            .map_err(|_| "failed to deliver approval (orchestrator gone)".to_string());
        let _ = self.clear_approval_emit_dedupe();
        out
    }

    pub fn submit_clarification(&self, id: &str, response: String) -> Result<(), String> {
        let tx = self
            .clarify_tx
            .lock()
            .map_err(|e| e.to_string())?
            .remove(id)
            .ok_or_else(|| format!("unknown clarification id {id}"))?;
        let out = tx
            .send(response)
            .map_err(|_| "failed to deliver clarification".to_string());
        let _ = self.clear_clarify_emit_dedupe();
        out
    }

    pub fn await_human_review(
        &self,
        app: &AppHandle,
        run_id: String,
        node_id: String,
        instructions: String,
        state_snapshot: serde_json::Value,
    ) -> Result<HumanReviewResponse, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::channel();
        self.human_review_tx
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.clone(), tx);
        let sensitivity = classify_human_review();
        let payload = HumanReviewPayload {
            id: id.clone(),
            run_id,
            node_id,
            instructions,
            state_snapshot,
            sensitivity,
        };
        try_emit_hitl_event(
            app,
            "workflow_human_needed",
            &payload,
            &self.last_human_emit_json,
        )?;
        rx.recv().map_err(|_| {
            let _ = self.clear_human_emit_dedupe();
            "human review wait cancelled".to_string()
        })
    }

    pub fn submit_human_review(&self, id: &str, body: HumanReviewResponse) -> Result<(), String> {
        let tx = self
            .human_review_tx
            .lock()
            .map_err(|e| e.to_string())?
            .remove(id)
            .ok_or_else(|| format!("unknown human review id {id}"))?;
        let out = tx
            .send(body)
            .map_err(|_| "failed to deliver human review (orchestrator gone)".to_string());
        let _ = self.clear_human_emit_dedupe();
        out
    }
}

/// Interceptor for system-level effects: never run `run` without prior HITL approval.
pub fn run_after_approval<T>(
    app: &AppHandle,
    hitl: &HitlCoordinator,
    tool_name: &str,
    args_summary: &str,
    node_id: Option<&str>,
    run: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    if !hitl.await_approval(
        app,
        tool_name.to_string(),
        args_summary.to_string(),
        node_id.map(|s| s.to_string()),
    )? {
        return Err("user rejected system action".into());
    }
    run()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn destructive_tool_is_time_sensitive_with_scores() {
        let h = classify_system_tool("file.delete", "{\"path\":\"/tmp/x\"}");
        assert_eq!(h.time_sensitive, Some(true));
        assert_eq!(h.destructive, Some(true));
        assert!(h.risk_score.unwrap_or(0.0) >= 0.85);
    }

    #[test]
    fn benign_tool_is_not_time_sensitive() {
        let h = classify_system_tool("system.stub", "{}");
        assert_eq!(h.time_sensitive, Some(false));
        assert_eq!(h.destructive, Some(false));
    }

    #[test]
    fn regulated_args_trigger_category() {
        let h = classify_system_tool(
            "export.csv",
            "subset of HIPAA-covered member identifiers for Q4 audit",
        );
        assert_eq!(h.time_sensitive, Some(true));
        assert_eq!(h.category.as_deref(), Some("regulated"));
    }

    #[test]
    fn emit_dedupe_detects_identical_serialized_payload() {
        let last = Mutex::new(None::<String>);
        let sens = classify_system_tool("system.stub", "{}");
        let p = ActionPendingPayload {
            id: "same-id".into(),
            tool_name: "system.stub".into(),
            args_summary: "{}".into(),
            node_id: None,
            sensitivity: sens.clone(),
        };
        let (fp, dup) = fingerprint_and_duplicate_check(&last, &p).unwrap();
        assert!(!dup, "first emit should not be duplicate");
        *last.lock().unwrap() = Some(fp);
        let (_, dup2) = fingerprint_and_duplicate_check(&last, &p).unwrap();
        assert!(dup2, "second identical JSON should be duplicate");
        *last.lock().unwrap() = None;
        let (_, dup3) = fingerprint_and_duplicate_check(&last, &p).unwrap();
        assert!(!dup3, "after clear, same shape should not be duplicate");
    }
}
