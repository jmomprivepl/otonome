//! Spawn `llama-cli` for GGUF inference with interactive (`-i`) stdin/stdout streaming.

use crate::path_resolve::{resolve_repo_relative_dir, resolve_repo_relative_file};
use serde::Deserialize;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// End-of-turn string for `llama-cli -r`; must match `LLAMA_CLI_REVERSE_PROMPT` in `formatLlamaCliTranscript.ts`
/// and Pass 2 stop sequences in `otonome_llm.rs`.
pub const LLAMA_CLI_REVERSE_PROMPT: &str = "<|eot_id|>";

/// Default `System:` body for Agents / NSDAR when using `buildLlamaCliTranscript` / `LlamaCliStartOptions.initial_prompt`.
/// **Must match** `DEFAULT_SYSTEM` in `src/llm/formatLlamaCliTranscript.ts` exactly (same bytes / newlines).
/// Canonical sampling defaults shared by **both** subprocess `llama-cli` (`spawn_llama_cli` /
/// `spawn_llama_cli_oneshot`) and in-process Pass 2 (`otonome_llm::run_pass2_qvac` /
/// `QvacDualPassSession::run_pass2`).
///
/// **Must match** `DEFAULT_LLAMA_SAMPLING` in `src/llm/llamaSamplingDefaults.ts` exactly so the UI
/// and both backends agree on temp/top-k/top-p/repeat-penalty/repeat-last-n.
pub const DEFAULT_LLAMA_TEMP: f32 = 0.7;
pub const DEFAULT_LLAMA_TOP_K: i32 = 40;
pub const DEFAULT_LLAMA_TOP_P: f32 = 0.95;
/// Matches `llama-cli` default `min_p = 0.05`. Critical for parity: without this prune the long tail
/// of low-probability tokens survives `top_p`, and at non-zero `temp` the model can fall into
/// degenerate token loops (observed: NSDAR loops on JSON syntax for free-form prompts).
pub const DEFAULT_LLAMA_MIN_P: f32 = 0.05;
pub const DEFAULT_LLAMA_REPEAT_PENALTY: f32 = 1.1;
pub const DEFAULT_LLAMA_REPEAT_LAST_N: i32 = 64;

pub const DEFAULT_WORKMATE_SYSTEM_PROMPT: &str = r#"You are Workmate Manager. Use JSON for app actions. Use brief text for casual chat.
Screens: /tasks, /agents, /data, /settings, /agent-sop, /playground

Example Input: go to tasks
Example Output: {"action": "goto", "screen_name": "/tasks"}

Example Input: create task [title]
Example Output: {"action": "create_task", "task": {"title": "[title]", "description": ""}}

Example Input: I want to write a LinkedIn post tomorrow
Example Output: {"action": "create_task", "task": {"title": "Write LinkedIn post", "description": "Tomorrow"}}

Example Input: what is your name?
Example Output: I am Workmate Manager. How can I help you today?"#;

#[derive(Default)]
pub struct LlamaCliState(pub Mutex<LlamaInner>);

#[derive(Default)]
pub struct LlamaInner {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
}

impl Drop for LlamaInner {
    fn drop(&mut self) {
        if let Some(mut c) = self.child.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
        self.stdin.take();
    }
}

fn kill_inner(inner: &mut LlamaInner) {
    if let Some(mut c) = inner.child.take() {
        let _ = c.kill();
        let _ = c.wait();
    }
    inner.stdin.take();
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaCliStartOptions {
    pub exe_path: String,
    pub model_path: String,
    /// When true, NSDAR should run the **base model only** (no router LoRA, no Pass 2 adapters).
    /// This is ignored by llama-cli spawning; it's consumed by in-process commands like `nsdar_local_complete`.
    #[serde(default)]
    pub base_model_only: bool,
    /// When set, passed to llama-cli as `--persona-plugin` (QVP1 file).
    #[serde(default)]
    pub persona_plugin_path: Option<String>,
    #[serde(default)]
    pub persona_layer: Option<i32>,
    #[serde(default)]
    pub persona_tensor_suffix: Option<String>,
    #[serde(default)]
    pub nsdar_vector: Option<String>,
    #[serde(default)]
    pub nsdar_adapters_dir: Option<String>,
    #[serde(default)]
    pub nsdar_layer: Option<i32>,
    #[serde(default)]
    pub nsdar_ffn_suffix: Option<String>,
    #[serde(default = "default_ctx")]
    pub ctx_size: u32,
    /// `--temp` for `llama-cli` and `LlamaSampler::temp_ext(temp, 0.0, 1.0)` for in-process Pass 2
    /// (matches default `temp-ext` chain when dynamic temperature is off).
    #[serde(default = "default_temp")]
    pub temp: f32,
    /// `--repeat-penalty` for `llama-cli` and `LlamaSampler::penalties(.., penalty_repeat, ..)` in-process.
    #[serde(default = "default_repeat_penalty")]
    pub repeat_penalty: f32,
    /// `--top-k` for `llama-cli` and `LlamaSampler::top_k(...)` in-process. `1` = greedy.
    #[serde(default = "default_top_k")]
    pub top_k: i32,
    /// `--top-p` for `llama-cli` and `LlamaSampler::top_p(...)` in-process. `1.0` = disabled.
    #[serde(default = "default_top_p")]
    pub top_p: f32,
    /// `--min-p` for `llama-cli` and `LlamaSampler::min_p(...)` in-process. `0.0` = disabled.
    #[serde(default = "default_min_p")]
    pub min_p: f32,
    /// `--repeat-last-n` for `llama-cli` and `LlamaSampler::penalties(penalty_last_n, ..)` in-process.
    #[serde(default = "default_repeat_last_n")]
    pub repeat_last_n: i32,
    /// `-r` for `llama-cli` and Pass 2 stop sequence for in-process decode.
    #[serde(default = "default_reverse")]
    pub reverse_prompt: String,
    /// Raw transcript for `-p` (no Jinja): `System:` … `<|eot_id|>` turns; ends with `Assistant: `.
    pub initial_prompt: String,
    #[serde(default = "default_max_tokens")]
    pub max_new_tokens: u32,
}

fn default_ctx() -> u32 {
    4096
}
fn default_temp() -> f32 {
    DEFAULT_LLAMA_TEMP
}
fn default_repeat_penalty() -> f32 {
    DEFAULT_LLAMA_REPEAT_PENALTY
}
fn default_top_k() -> i32 {
    DEFAULT_LLAMA_TOP_K
}
fn default_top_p() -> f32 {
    DEFAULT_LLAMA_TOP_P
}
fn default_min_p() -> f32 {
    DEFAULT_LLAMA_MIN_P
}
fn default_repeat_last_n() -> i32 {
    DEFAULT_LLAMA_REPEAT_LAST_N
}
fn default_reverse() -> String {
    LLAMA_CLI_REVERSE_PROMPT.to_string()
}
fn default_max_tokens() -> u32 {
    1024
}

fn append_nsdar_cli_args(cmd: &mut Command, opts: &LlamaCliStartOptions) {
    let Some(ref dir) = opts.nsdar_adapters_dir else {
        return;
    };
    if dir.is_empty() {
        return;
    }
    let Some(ref csv) = opts.nsdar_vector else {
        return;
    };
    if csv.is_empty() {
        return;
    }
    let dir_resolved = resolve_repo_relative_dir(Path::new(dir));
    cmd.arg("--nsdar-vector").arg(csv);
    cmd.arg("--nsdar-adapters-dir").arg(dir_resolved);
    if let Some(l) = opts.nsdar_layer {
        cmd.arg("--nsdar-layer").arg(l.to_string());
    }
    if let Some(ref s) = opts.nsdar_ffn_suffix {
        if !s.is_empty() {
            cmd.arg("--nsdar-ffn-suffix").arg(s);
        }
    }
}

fn append_persona_cli_args(cmd: &mut Command, opts: &LlamaCliStartOptions) {
    if let Some(ref p) = opts.persona_plugin_path {
        if p.is_empty() {
            return;
        }
        let p_resolved = resolve_repo_relative_file(Path::new(p));
        cmd.arg("--persona-plugin").arg(p_resolved);
        if let Some(l) = opts.persona_layer {
            cmd.arg("--persona-layer").arg(l.to_string());
        }
        if let Some(ref s) = opts.persona_tensor_suffix {
            if !s.is_empty() {
                cmd.arg("--persona-tensor-suffix").arg(s);
            }
        }
    }
}

fn spawn_llama_cli(opts: &LlamaCliStartOptions) -> Result<(Child, ChildStdin), String> {
    // Raw interactive mode: never use GGUF Jinja chat templates (-cnv / conversation mode).
    // `-no-cnv` is required so `-p` is plain text and does not hit "Value is not callable: null template".
    let prompt = opts.initial_prompt.trim_start();
    if !prompt.starts_with("System:") {
        return Err(
            "initial_prompt must start with \"System:\" (leading trim only); do not rely on -sys/-cnv"
                .to_string(),
        );
    }
    if !prompt.ends_with("Assistant: ") {
        return Err(
            "initial_prompt must end with exactly \"Assistant: \" (trailing space) for completion"
                .to_string(),
        );
    }

    let exe = resolve_repo_relative_file(Path::new(&opts.exe_path));
    let model = resolve_repo_relative_file(Path::new(&opts.model_path));
    let mut cmd = Command::new(&exe);
    cmd.arg("-m")
        .arg(&model)
        .arg("-c")
        .arg(opts.ctx_size.to_string())
        .arg("--temp")
        .arg(format!("{}", opts.temp))
        .arg("--repeat-penalty")
        .arg(format!("{}", opts.repeat_penalty))
        .arg("--top-k")
        .arg(opts.top_k.to_string())
        .arg("--top-p")
        .arg(format!("{}", opts.top_p))
        .arg("--min-p")
        .arg(format!("{}", opts.min_p))
        .arg("--repeat-last-n")
        .arg(opts.repeat_last_n.to_string())
        .arg("--no-display-prompt")
        .arg("--special")
        .arg("-no-cnv")
        .arg("-i")
        .arg("-r")
        .arg(opts.reverse_prompt.trim())
        .arg("-p")
        .arg(prompt)
        .arg("-n")
        .arg(opts.max_new_tokens.to_string());
    append_persona_cli_args(&mut cmd, opts);
    append_nsdar_cli_args(&mut cmd, opts);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|e| format!("failed to spawn llama-cli: {e}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to capture llama-cli stdin".to_string())?;
    Ok((child, stdin))
}

/// Single `-p` completion without `-i`: process exits after generation; avoids blocking on stdin forever.
fn spawn_llama_cli_oneshot(opts: &LlamaCliStartOptions) -> Result<Child, String> {
    let prompt = opts.initial_prompt.trim_start();
    if !prompt.starts_with("System:") {
        return Err(
            "initial_prompt must start with \"System:\" (leading trim only); do not rely on -sys/-cnv"
                .to_string(),
        );
    }
    if !prompt.ends_with("Assistant: ") {
        return Err(
            "initial_prompt must end with exactly \"Assistant: \" (trailing space) for completion"
                .to_string(),
        );
    }

    let exe = resolve_repo_relative_file(Path::new(&opts.exe_path));
    let model = resolve_repo_relative_file(Path::new(&opts.model_path));
    let mut cmd = Command::new(&exe);
    cmd.arg("-m")
        .arg(&model)
        .arg("-c")
        .arg(opts.ctx_size.to_string())
        .arg("--temp")
        .arg(format!("{}", opts.temp))
        .arg("--repeat-penalty")
        .arg(format!("{}", opts.repeat_penalty))
        .arg("--top-k")
        .arg(opts.top_k.to_string())
        .arg("--top-p")
        .arg(format!("{}", opts.top_p))
        .arg("--min-p")
        .arg(format!("{}", opts.min_p))
        .arg("--repeat-last-n")
        .arg(opts.repeat_last_n.to_string())
        .arg("--no-display-prompt")
        .arg("--special")
        .arg("-no-cnv")
        .arg("-r")
        .arg(opts.reverse_prompt.trim())
        .arg("-p")
        .arg(prompt)
        .arg("-n")
        .arg(opts.max_new_tokens.to_string());
    append_persona_cli_args(&mut cmd, opts);
    append_nsdar_cli_args(&mut cmd, opts);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.spawn().map_err(|e| format!("failed to spawn llama-cli: {e}"))
}

fn find_sub(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|w| w == needle)
}

/// True when `acc` ends with `start` (stdin echo tail) or the same plus a line ending from `writeln!`.
fn acc_ends_with_stdin_echo_complete(acc: &[u8], start: &[u8]) -> bool {
    if acc.ends_with(start) {
        return true;
    }
    if acc.len() > start.len() && acc[acc.len() - 1] == b'\n' && acc[..acc.len() - 1].ends_with(start) {
        return true;
    }
    if acc.len() > start.len() + 1
        && acc.ends_with(b"\r\n")
        && acc[..acc.len() - 2].ends_with(start)
    {
        return true;
    }
    false
}

/// Byte-stream stdout: Turn 1 streams immediately; Turn 2+ discard bytes until the stdin echo ends with
/// `<|eot_id|>Assistant: ` (proves the full User line + reverse prompt echoed before model output).
fn start_stdout_reader(app: AppHandle, node_id: String, mut stdout: std::process::ChildStdout, _rev: String) {
    const START: &[u8] = b"<|eot_id|>Assistant: ";
    const STOP: &[u8] = b"<|eot_id|>";

    std::thread::spawn(move || {
        let mut buffer = [0u8; 1];
        let mut acc: Vec<u8> = Vec::new();
        // Turn 1: `--no-display-prompt` → no prompt echo; first bytes are the completion.
        let mut has_started_responding = true;
        let mut stream_byte_count: u32 = 0;

        while stdout.read_exact(&mut buffer).is_ok() {
            acc.push(buffer[0]);

            if !has_started_responding {
                // Wait until the full stdin tail has echoed (`User: …<|eot_id|>Assistant: `), then drop it.
                if acc_ends_with_stdin_echo_complete(&acc, START) {
                    has_started_responding = true;
                    acc.clear();
                    stream_byte_count = 0;
                }
            } else if let Some(j) = find_sub(&acc, STOP) {
                let text = String::from_utf8_lossy(&acc[..j]).trim_start().to_string();
                let _ = app.emit(
                    "native-llm",
                    serde_json::json!({
                        "kind": "partial",
                        "nodeId": &node_id,
                        "text": &text,
                    }),
                );
                let _ = app.emit(
                    "native-llm",
                    serde_json::json!({
                        "kind": "turn_done",
                        "nodeId": &node_id,
                    }),
                );
                has_started_responding = false;
                acc.clear();
                stream_byte_count = 0;
                continue;
            } else {
                stream_byte_count = stream_byte_count.saturating_add(1);
                if stream_byte_count % 10 == 0 {
                    let t = String::from_utf8_lossy(&acc).trim_start().to_string();
                    let _ = app.emit(
                        "native-llm",
                        serde_json::json!({
                            "kind": "partial",
                            "nodeId": &node_id,
                            "text": t,
                        }),
                    );
                }
            }
        }

        if has_started_responding && !acc.is_empty() {
            let text = String::from_utf8_lossy(&acc).trim().to_string();
            if !text.is_empty() {
                let _ = app.emit(
                    "native-llm",
                    serde_json::json!({
                        "kind": "partial",
                        "nodeId": &node_id,
                        "text": &text,
                    }),
                );
            }
        }
        let _ = app.emit(
            "native-llm",
            serde_json::json!({
                "kind": "end",
                "nodeId": &node_id,
            }),
        );
    });
}

fn start_stderr_drain(stderr: std::process::ChildStderr) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            let Ok(l) = line else { break };
            let t = l.trim();
            if !t.is_empty() {
                log::warn!("[llama-cli stderr] {t}");
            }
        }
    });
}

/// Single-turn completion: non-interactive spawn, read stdout until EOF (process exits).
/// Interactive `-i` + piped stdin caused hangs: the binary waits for the next user line while we wait for `<|eot_id|>`.
pub fn run_completion_once(opts: &LlamaCliStartOptions) -> Result<String, String> {
    let mut child = spawn_llama_cli_oneshot(opts)?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture llama-cli stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture llama-cli stderr".to_string())?;
    start_stderr_drain(stderr);

    let mut acc: Vec<u8> = Vec::new();
    stdout
        .read_to_end(&mut acc)
        .map_err(|e| format!("failed to read llama-cli stdout: {e}"))?;
    let status = child.wait().map_err(|e| format!("llama-cli wait: {e}"))?;

    let mut text = String::from_utf8_lossy(&acc).trim().to_string();
    if !status.success() && text.is_empty() {
        return Err(format!(
            "llama-cli exited with {} (no stdout); check model path and stderr logs",
            status
        ));
    }
    const STOP: &[u8] = b"<|eot_id|>";
    if let Some(j) = find_sub(text.as_bytes(), STOP) {
        text = text[..j].trim().to_string();
    }
    if text.is_empty() {
        return Err(
            "no text in llama-cli stdout (empty output). Is the model path correct and llama-cli working?"
                .into(),
        );
    }
    Ok(text)
}

/// Kill any running `llama-cli` and clear state.
#[tauri::command]
pub fn llama_cli_stop(state: tauri::State<'_, LlamaCliState>) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    kill_inner(&mut *inner);
    Ok(())
}

/// Start (or restart) an interactive session. The first completion is driven by `initial_prompt` (`-p`);
/// use `llama_cli_send_line` only for later turns (do not duplicate the first user message on stdin).
#[tauri::command]
pub fn llama_cli_start_session(
    app: AppHandle,
    state: tauri::State<'_, LlamaCliState>,
    node_id: String,
    options: LlamaCliStartOptions,
) -> Result<(), String> {
    {
        let mut inner = state.0.lock().map_err(|e| e.to_string())?;
        kill_inner(&mut *inner);
    }

    let (mut child, stdin) = spawn_llama_cli(&options)?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture llama-cli stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture llama-cli stderr".to_string())?;

    start_stderr_drain(stderr);
    start_stdout_reader(app, node_id, stdout, options.reverse_prompt.clone());

    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    inner.child = Some(child);
    inner.stdin = Some(stdin);
    Ok(())
}

/// Send one user line (interactive). Session must be started with `llama_cli_start_session`.
#[tauri::command]
pub fn llama_cli_send_line(state: tauri::State<'_, LlamaCliState>, line: String) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    let stdin = inner
        .stdin
        .as_mut()
        .ok_or_else(|| "llama-cli session not started".to_string())?;
    writeln!(stdin, "{line}").map_err(|e| format!("failed to write stdin: {e}"))?;
    stdin.flush().map_err(|e| format!("failed to flush stdin: {e}"))?;
    Ok(())
}
