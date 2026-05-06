mod anthropic;
mod dag_types;
mod egress_policy;
mod hermes_agent;
mod hermes_claude;
mod hermes_prompt;
mod hermes_tools;
mod hitl;
mod llama_cli;
mod lora_compose;
mod path_resolve;
mod hardware_preference;
mod otonome_llm;
#[cfg(feature = "llama_cpp")]
mod pass2_dummy_adapters;
#[cfg(feature = "llama_cpp")]
mod qvac_pass2;
mod router_llama_cpp;
mod nsdar;
mod orchestrator;
mod sop_normalize;
mod ternary_router;
mod workflow_state;

use dag_types::DagGraph;
use llama_cli::{
    llama_cli_send_line, llama_cli_start_session, llama_cli_stop, LlamaCliStartOptions, LlamaCliState,
};
use hermes_agent::hermes_run_agent_session;
use nsdar::{nsdar_local_complete, nsdar_route_preview};
use hitl::HumanReviewResponse;
use orchestrator::{AgentRuntimeState, DagGraphPayload, DagRunOptions, DagRunStartArgs};
use router_llama_cpp::router_generate_routing_vector;
use sop_normalize::{normalize_sop_with_llama, NormalizedSop};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(LlamaCliState::default())
        .manage(AgentRuntimeState::default())
        .invoke_handler(tauri::generate_handler![
            llama_cli_stop,
            llama_cli_start_session,
            llama_cli_send_line,
            dag_publish_graph,
            dag_run_start,
            workflow_run_start,
            hitl_resolve_action,
            hitl_submit_clarification,
            hitl_submit_human_review,
            sop_normalize,
            nsdar_route_preview,
            nsdar_local_complete,
            router_generate_routing_vector,
            hermes_run_agent_session,
            set_hardware_preference,
            get_hardware_preference,
            get_inference_hardware_snapshot,
        ])
        .setup(|_app| {
            eprintln!("[Otonome] Tauri setup: registering plugins…");

            if cfg!(debug_assertions) {
                _app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            eprintln!(
                "[Otonome] Tauri setup done. Dev UI: {} — if the window is blank, open that URL in a browser.",
                "http://localhost:5173"
            );
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn dag_publish_graph(
    graph: DagGraph,
    state: tauri::State<'_, AgentRuntimeState>,
) -> Result<(), String> {
    state.publish_graph(graph)
}

#[tauri::command]
fn dag_run_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentRuntimeState>,
    args: DagRunStartArgs,
) -> Result<(), String> {
    let DagRunStartArgs {
        llama_options,
        anthropic_model,
        user_request,
        sop_id,
        task_id,
        hermes_model,
        hermes_max_turns,
    } = args;
    state.try_start_run(
        app,
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

#[tauri::command]
fn workflow_run_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentRuntimeState>,
    payload: DagGraphPayload,
) -> Result<(), String> {
    state.try_start_workflow_run(app, payload)
}

#[tauri::command]
fn hitl_resolve_action(
    id: String,
    approved: bool,
    state: tauri::State<'_, AgentRuntimeState>,
) -> Result<(), String> {
    state.hitl.resolve_approval(&id, approved)
}

#[tauri::command]
fn hitl_submit_clarification(
    id: String,
    response: String,
    state: tauri::State<'_, AgentRuntimeState>,
) -> Result<(), String> {
    state.hitl.submit_clarification(&id, response)
}

#[tauri::command]
fn hitl_submit_human_review(
    id: String,
    approved: bool,
    reply: serde_json::Value,
    state: tauri::State<'_, AgentRuntimeState>,
) -> Result<(), String> {
    state.hitl.submit_human_review(
        &id,
        HumanReviewResponse { approved, reply },
    )
}

#[tauri::command]
fn sop_normalize(raw_sop: String, options: LlamaCliStartOptions) -> Result<NormalizedSop, String> {
    normalize_sop_with_llama(raw_sop, options)
}

/// Persist and apply CPU / Vulkan iGPU / Vulkan dGPU routing for the next in-process llama.cpp load.
/// See `hardware_preference` module: `GGML_VK_VISIBLE_DEVICES` is read when Vulkan first initializes;
/// if the process already touched Vulkan, fully switching GPUs may require an app restart once.
#[tauri::command]
fn set_hardware_preference(mode: String) -> Result<(), String> {
    hardware_preference::set_from_user_choice(&mode)?;
    otonome_llm::on_hardware_preference_changed();
    Ok(())
}

#[tauri::command]
fn get_hardware_preference() -> String {
    hardware_preference::load().as_str().to_string()
}

#[tauri::command]
fn get_inference_hardware_snapshot() -> hardware_preference::InferenceHardwareSnapshot {
    hardware_preference::inference_hardware_snapshot()
}
