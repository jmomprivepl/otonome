//! DAG execution: workflow state, human vs agent nodes, Hermes multi-turn (cloud) and NSDAR (local).

use crate::dag_types::{topological_order, DagGraph, DagNodeKind, ExecutionTarget};
use crate::hermes_agent;
use crate::hitl::{run_after_approval, HitlCoordinator};
use crate::llama_cli::LlamaCliStartOptions;
use crate::nsdar::{nsdar_local_complete, NsdarSlotOverride};
use crate::ternary_router::{route, vector_from_prompt, RouteOutcome};
use crate::workflow_state::WorkflowPublicSnapshot;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const LOCAL_DAG_SYSTEM: &str = "You are a concise worker node in an enterprise workflow DAG. Follow the task using the workflow JSON context. Reply with plain text only unless the task asks for structured output.";

#[derive(Clone, Default)]
pub struct DagRunOptions {
    pub anthropic_model: Option<String>,
    pub user_request: Option<String>,
    pub sop_id: Option<String>,
    pub task_id: Option<String>,
    pub hermes_model: Option<String>,
    pub hermes_max_turns: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DagRunStartArgs {
    pub llama_options: Option<LlamaCliStartOptions>,
    pub anthropic_model: Option<String>,
    #[serde(default)]
    pub user_request: Option<String>,
    #[serde(default)]
    pub sop_id: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub hermes_model: Option<String>,
    #[serde(default)]
    pub hermes_max_turns: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DagGraphPayload {
    pub graph: DagGraph,
    pub llama_options: Option<LlamaCliStartOptions>,
    pub anthropic_model: Option<String>,
    #[serde(default)]
    pub user_request: Option<String>,
    #[serde(default)]
    pub sop_id: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub hermes_model: Option<String>,
    #[serde(default)]
    pub hermes_max_turns: Option<u32>,
}

#[derive(Clone)]
pub struct AgentRuntimeState {
    pub hitl: Arc<HitlCoordinator>,
    inner: Arc<Mutex<OrchestratorInner>>,
    running: Arc<AtomicBool>,
}

struct OrchestratorInner {
    graph: Option<DagGraph>,
    workflow: WorkflowScratch,
}

#[derive(Clone, Default)]
struct WorkflowScratch {
    run_id: String,
    user_request: String,
    sop_id: Option<String>,
    task_id: Option<String>,
    node_outputs: HashMap<String, String>,
    human_inputs: HashMap<String, serde_json::Value>,
}

impl Default for OrchestratorInner {
    fn default() -> Self {
        Self {
            graph: None,
            workflow: WorkflowScratch::default(),
        }
    }
}

impl Default for AgentRuntimeState {
    fn default() -> Self {
        Self {
            hitl: Arc::new(HitlCoordinator::default()),
            inner: Arc::new(Mutex::new(OrchestratorInner::default())),
            running: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DagNodeEvent {
    pub node_id: String,
    pub phase: String,
    pub detail: Option<String>,
}

fn new_run_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

impl AgentRuntimeState {
    pub fn publish_graph(&self, graph: DagGraph) -> Result<(), String> {
        graph.validate()?;
        let mut g = self.inner.lock().map_err(|e| e.to_string())?;
        g.graph = Some(graph);
        g.workflow = WorkflowScratch::default();
        Ok(())
    }

    pub fn try_start_run(
        &self,
        app: AppHandle,
        llama_options: Option<LlamaCliStartOptions>,
        opts: DagRunOptions,
    ) -> Result<(), String> {
        let graph = {
            let g = self.inner.lock().map_err(|e| e.to_string())?;
            g.graph
                .clone()
                .ok_or_else(|| "no graph published".to_string())?
        };
        self.spawn_run(
            app,
            graph,
            llama_options,
            opts,
        )
    }

    pub fn try_start_workflow_run(&self, app: AppHandle, payload: DagGraphPayload) -> Result<(), String> {
        let DagGraphPayload {
            graph,
            llama_options,
            anthropic_model,
            user_request,
            sop_id,
            task_id,
            hermes_model,
            hermes_max_turns,
        } = payload;
        graph.validate()?;
        {
            let mut g = self.inner.lock().map_err(|e| e.to_string())?;
            g.graph = Some(graph.clone());
            g.workflow = WorkflowScratch::default();
        }
        self.spawn_run(
            app,
            graph,
            llama_options,
            DagRunOptions {
                anthropic_model,
                user_request,
                sop_id,
                task_id,
                hermes_model,
                hermes_max_turns,
            },
        )
    }

    fn spawn_run(
        &self,
        app: AppHandle,
        graph: DagGraph,
        llama_options: Option<LlamaCliStartOptions>,
        opts: DagRunOptions,
    ) -> Result<(), String> {
        if self
            .running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err("orchestrator already running".into());
        }
        let rid = new_run_id();
        {
            let mut g = self.inner.lock().map_err(|e| e.to_string())?;
            g.workflow.run_id = rid.clone();
            g.workflow.user_request = opts.user_request.clone().unwrap_or_default();
            g.workflow.sop_id = opts.sop_id.clone();
            g.workflow.task_id = opts.task_id.clone();
            g.workflow.node_outputs.clear();
            g.workflow.human_inputs.clear();
        }
        let _ = crate::run_store::append_run_started(crate::run_store::RunStartedEvent {
            ts_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
            run_id: rid.as_str(),
            sop_id: opts.sop_id.as_deref(),
            task_id: opts.task_id.as_deref(),
            user_request_len: opts.user_request.clone().unwrap_or_default().len(),
        });

        let rt = self.clone();
        let anthropic_model = opts
            .anthropic_model
            .clone()
            .unwrap_or_else(|| {
                std::env::var("ANTHROPIC_MODEL").unwrap_or_else(|_| "claude-3-5-sonnet-20241022".into())
            });
        let hermes_model = opts.hermes_model.clone().unwrap_or_else(|| anthropic_model.clone());
        let hermes_max_turns = opts.hermes_max_turns.unwrap_or(16);
        std::thread::spawn(move || {
            run_dag_thread(
                app,
                rt,
                graph,
                llama_options,
                hermes_model,
                hermes_max_turns,
            );
        });
        Ok(())
    }

    fn store_output(&self, node_id: &str, text: String) -> Result<(), String> {
        let mut g = self.inner.lock().map_err(|e| e.to_string())?;
        g.workflow.node_outputs.insert(node_id.to_string(), text);
        Ok(())
    }

    fn get_output(&self, node_id: &str) -> Option<String> {
        self.inner
            .lock()
            .ok()
            .and_then(|g| g.workflow.node_outputs.get(node_id).cloned())
    }

    fn merge_human_reply(&self, node_id: &str, reply: serde_json::Value) -> Result<(), String> {
        let mut g = self.inner.lock().map_err(|e| e.to_string())?;
        g.workflow
            .human_inputs
            .insert(node_id.to_string(), reply);
        Ok(())
    }

    pub fn workflow_snapshot_public(&self) -> Result<WorkflowPublicSnapshot, String> {
        let g = self.inner.lock().map_err(|e| e.to_string())?;
        Ok(WorkflowPublicSnapshot {
            run_id: g.workflow.run_id.clone(),
            user_request: g.workflow.user_request.clone(),
            sop_id: g.workflow.sop_id.clone(),
            task_id: g.workflow.task_id.clone(),
            node_outputs: g.workflow.node_outputs.clone(),
            human_inputs: g.workflow.human_inputs.clone(),
        })
    }
}

fn emit_node(app: &AppHandle, node_id: &str, phase: &str, detail: Option<String>) {
    let _ = app.emit(
        "dag_node_event",
        DagNodeEvent {
            node_id: node_id.to_string(),
            phase: phase.to_string(),
            detail,
        },
    );
}

fn emit_workflow_state(app: &AppHandle, snap: &WorkflowPublicSnapshot) {
    let _ = app.emit("workflow_state_updated", snap);
}

fn finish_run(
    app: &AppHandle,
    rt: &AgentRuntimeState,
    ok: bool,
    err: Option<String>,
    snap: WorkflowPublicSnapshot,
) {
    rt.running.store(false, Ordering::SeqCst);
    let _ = app.emit(
        "dag_run_finished",
        serde_json::json!({
            "ok": ok,
            "error": err,
            "runId": snap.run_id,
            "workflow": snap,
        }),
    );
}

fn workflow_json_for_prompt(rt: &AgentRuntimeState) -> String {
    rt.workflow_snapshot_public()
        .map(|s| s.to_json_pretty())
        .unwrap_or_else(|_| "{}".into())
}

fn human_node_snapshot_value(rt: &AgentRuntimeState) -> serde_json::Value {
    match rt.workflow_snapshot_public() {
        Ok(s) => serde_json::to_value(&s).unwrap_or(serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    }
}

fn run_dag_thread(
    app: AppHandle,
    rt: AgentRuntimeState,
    graph: DagGraph,
    llama_options: Option<LlamaCliStartOptions>,
    hermes_model: String,
    hermes_max_turns: u32,
) {
    let fail = |msg: String| {
        let snap = rt.workflow_snapshot_public().unwrap_or_default();
        finish_run(&app, &rt, false, Some(msg), snap);
    };

    let order = match topological_order(&graph) {
        Ok(o) => o,
        Err(e) => {
            fail(e);
            return;
        }
    };
    let node_by_id: HashMap<_, _> = graph.nodes.iter().map(|n| (n.id.clone(), n.clone())).collect();

    if let Ok(s0) = rt.workflow_snapshot_public() {
        emit_workflow_state(&app, &s0);
    }

    for nid in order {
        let node = match node_by_id.get(&nid) {
            Some(n) => n.clone(),
            None => continue,
        };
        emit_node(&app, &nid, "started", None);

        if node.node_kind == DagNodeKind::Human {
            let instructions = if node.prompt.trim().is_empty() {
                format!("Human review: {}", node.label)
            } else {
                node.prompt.clone()
            };
            let snapshot = human_node_snapshot_value(&rt);
            let review = match rt.hitl.await_human_review(
                &app,
                rt.workflow_snapshot_public()
                    .map(|s| s.run_id)
                    .unwrap_or_default(),
                nid.clone(),
                instructions,
                snapshot,
            ) {
                Ok(r) => r,
                Err(e) => {
                    emit_node(&app, &nid, "failed", Some(e.clone()));
                    fail(e);
                    return;
                }
            };
            if !review.approved {
                emit_node(
                    &app,
                    &nid,
                    "failed",
                    Some("human review rejected".into()),
                );
                fail("human review rejected".into());
                return;
            }
            let _ = rt.merge_human_reply(&nid, review.reply.clone());
            let note = review
                .reply
                .get("notes")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| match review.reply.as_object() {
                    Some(m) if !m.is_empty() => review.reply.to_string(),
                    _ => "(approved)".into(),
                });
            let _ = rt.store_output(&nid, note);
            emit_node(&app, &nid, "done", Some("human input recorded".into()));
            if let Ok(s) = rt.workflow_snapshot_public() {
                emit_workflow_state(&app, &s);
            }
            continue;
        }

        let vec = vector_from_prompt(&node.prompt, &node.label);
        let route_outcome: RouteOutcome = match route(&vec) {
            Ok(r) => r,
            Err(amb) => {
                let q = format!(
                    "Ambiguous adapter selection. Top candidates: {}. Pick one or type a short preference.",
                    amb.top_adapters.join(", ")
                );
                let opts = amb.top_adapters.clone();
                let answer = match rt
                    .hitl
                    .await_clarification(&app, q, opts, Some(nid.clone()))
                {
                    Ok(a) => a,
                    Err(e) => {
                        emit_node(&app, &nid, "failed", Some(e.clone()));
                        fail(e);
                        return;
                    }
                };
                let vec2 = vector_from_prompt(
                    &format!("{} {}", node.prompt, answer),
                    &node.label,
                );
                match route(&vec2) {
                    Ok(r) => r,
                    Err(_) => RouteOutcome {
                        adapter_id: "adapter.default".into(),
                        score: 0.0,
                        runner_up_adapter_id: None,
                        runner_up_score: None,
                    },
                }
            }
        };

        if node.requires_system_tool {
            let tool = node
                .system_tool_name
                .clone()
                .unwrap_or_else(|| "system.stub".into());
            let summary = node
                .system_tool_args_summary
                .clone()
                .unwrap_or_else(|| "{}".into());
            let app_ref = app.clone();
            let hid = Arc::clone(&rt.hitl);
            let res = run_after_approval(&app_ref, &hid, &tool, &summary, Some(&nid), || {
                Ok(format!("approved stub for {tool}"))
            });
            if let Err(e) = res {
                emit_node(&app, &nid, "failed", Some(e.clone()));
                fail(e);
                return;
            }
        }

        let mut upstream = String::new();
        for e in &graph.edges {
            if e.target == nid {
                if let Some(out) = rt.get_output(&e.source) {
                    upstream.push_str(&format!("[{}]: {}\n", e.source, out));
                }
            }
        }

        let wf_json = workflow_json_for_prompt(&rt);
        let safe_user = format!(
            "Adapter hint: {}.\nOriginal user request:\n{}\n\nUpstream node outputs:\n{}\n\nWorkflow state (JSON):\n{}\n\nYour node task (do only this):\n{}",
            route_outcome.adapter_id,
            rt.workflow_snapshot_public()
                .map(|s| s.user_request.clone())
                .unwrap_or_default(),
            upstream,
            wf_json,
            node.prompt
        )
        .replace("System:", "System(text):");

        let exec_result = match node.execution_target {
            ExecutionTarget::LocalQvac => {
                let Some(opts) = llama_options.clone() else {
                    fail("local node requires llamaOptions (exePath, modelPath, …)".into());
                    return;
                };
                let user_block = format!(
                    "{}\n\n---\nAdapter hint: {}.\nUpstream:\n{}\n---\nWorkflow JSON:\n{}",
                    node.prompt, route_outcome.adapter_id, upstream, wf_json
                );
                let initial_pass_2 = format!(
                    "System: {LOCAL_DAG_SYSTEM}<|eot_id|>User: {}\n<|eot_id|>Assistant: ",
                    user_block.replace("System:", "System(text):")
                );
                match nsdar_local_complete(
                    user_block,
                    "DAG".into(),
                    vec![] as Vec<NsdarSlotOverride>,
                    opts.clone(),
                    Some(initial_pass_2),
                ) {
                    Ok(resp) => {
                        if resp.success {
                            Ok(resp.assistant_text.unwrap_or_default())
                        } else {
                            Err(resp.error.unwrap_or_else(|| "nsdar local failed".into()))
                        }
                    }
                    Err(e) => Err(e),
                }
            }
            ExecutionTarget::CloudAnthropic => {
                match hermes_agent::run_agent_session(
                    &hermes_model,
                    &safe_user,
                    hermes_max_turns,
                ) {
                    Ok(res) => Ok(res.assistant_final),
                    Err(e) => Err(e),
                }
            }
        };

        match exec_result {
            Ok(text) => {
                let _ = rt.store_output(&nid, text.clone());
                emit_node(
                    &app,
                    &nid,
                    "done",
                    Some(text.chars().take(200).collect()),
                );
                if let Ok(s) = rt.workflow_snapshot_public() {
                    emit_workflow_state(&app, &s);
                }
            }
            Err(e) => {
                emit_node(&app, &nid, "failed", Some(e.clone()));
                fail(e);
                return;
            }
        }
    }

    let snap = match rt.workflow_snapshot_public() {
        Ok(s) => s,
        Err(e) => {
            fail(e);
            return;
        }
    };
    finish_run(&app, &rt, true, None, snap);
}
