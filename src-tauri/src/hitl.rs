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
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionPendingPayload {
    pub id: String,
    pub tool_name: String,
    pub args_summary: String,
    pub node_id: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClarificationPayload {
    pub id: String,
    pub question: String,
    pub options: Vec<String>,
    pub node_id: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HumanReviewPayload {
    pub id: String,
    pub run_id: String,
    pub node_id: String,
    pub instructions: String,
    pub state_snapshot: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HumanReviewResponse {
    pub approved: bool,
    #[serde(default)]
    pub reply: serde_json::Value,
}

impl HitlCoordinator {
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
        app.emit(
            "action_pending_approval",
            ActionPendingPayload {
                id: id.clone(),
                tool_name,
                args_summary,
                node_id,
            },
        )
        .map_err(|e| e.to_string())?;
        rx.recv().map_err(|_| "approval wait cancelled".to_string())
    }

    pub fn resolve_approval(&self, id: &str, approved: bool) -> Result<(), String> {
        let tx = self
            .approval_tx
            .lock()
            .map_err(|e| e.to_string())?
            .remove(id)
            .ok_or_else(|| format!("unknown approval id {id}"))?;
        tx.send(approved)
            .map_err(|_| "failed to deliver approval (orchestrator gone)".to_string())
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
        app.emit(
            "clarification_needed",
            ClarificationPayload {
                id: id.clone(),
                question,
                options,
                node_id,
            },
        )
        .map_err(|e| e.to_string())?;
        rx.recv().map_err(|_| "clarification wait cancelled".to_string())
    }

    pub fn submit_clarification(&self, id: &str, response: String) -> Result<(), String> {
        let tx = self
            .clarify_tx
            .lock()
            .map_err(|e| e.to_string())?
            .remove(id)
            .ok_or_else(|| format!("unknown clarification id {id}"))?;
        tx.send(response)
            .map_err(|_| "failed to deliver clarification".to_string())
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
        app.emit(
            "workflow_human_needed",
            HumanReviewPayload {
                id: id.clone(),
                run_id,
                node_id,
                instructions,
                state_snapshot,
            },
        )
        .map_err(|e| e.to_string())?;
        rx.recv()
            .map_err(|_| "human review wait cancelled".to_string())
    }

    pub fn submit_human_review(&self, id: &str, body: HumanReviewResponse) -> Result<(), String> {
        let tx = self
            .human_review_tx
            .lock()
            .map_err(|e| e.to_string())?
            .remove(id)
            .ok_or_else(|| format!("unknown human review id {id}"))?;
        tx.send(body)
            .map_err(|_| "failed to deliver human review (orchestrator gone)".to_string())
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
