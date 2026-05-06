//! NSDAR Command Center: route preview and standalone local completion.
//!
//! Pass 1 prefers the in-process router LoRA; if `router-lora.gguf` is missing, falls back to the
//! deterministic keyword router.
//!
//! Pass 2 runs in-process generation with **native multi-LoRA fusion** (see [`crate::qvac_pass2`]).

use crate::hardware_preference::InferenceHardwareSnapshot;
use crate::llama_cli::LlamaCliStartOptions;
use crate::otonome_llm::{Pass2SamplingOptions, LLAMA_DEFAULT_SEED};
use crate::ternary_router::{route, Ambiguity, RouteOutcome, TernaryVector32, TERNARY_VECTOR_LEN};
use serde::{Deserialize, Serialize};
#[cfg(feature = "llama_cpp")]
use crate::ternary_router::{format_nsdar_csv, persona_cli_options_for_adapter};
#[cfg(feature = "llama_cpp")]
use std::path::Path;
use std::time::Instant;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NsdarSlotOverride {
    pub index: u8,
    pub value: i8,
    pub locked: bool,
}

fn locked_pairs(overrides: &[NsdarSlotOverride]) -> Vec<(usize, i8)> {
    overrides
        .iter()
        .filter(|o| o.locked && (o.index as usize) < TERNARY_VECTOR_LEN)
        .map(|o| (o.index as usize, o.value.clamp(-1, 1)))
        .collect()
}

/// Pass 1: prefer 27-slot routing inference from the in-process router LoRA.
///
/// If the router LoRA isn't available on disk, fall back to the deterministic keyword router
/// (`ternary_router::vector_from_prompt`) so the UI can still preview routing and run Pass 2.
///
/// The optional string is a Pass 1 warning (e.g. missing router LoRA) for logging in Pass 2.
fn pass1_vector_from_router(prompt: &str, label: &str, locked: &[(usize, i8)]) -> (TernaryVector32, Option<String>) {
    match crate::otonome_llm::generate_routing_vector(prompt) {
        Ok(v27) => {
            let mut t = TernaryVector32::default();
            for (i, x) in v27.iter().enumerate().take(TERNARY_VECTOR_LEN.min(27)) {
                t.v[i] = (*x).clamp(-1, 1);
            }
            for &(i, val) in locked {
                if i < TERNARY_VECTOR_LEN {
                    t.v[i] = val.clamp(-1, 1);
                }
            }
            (t, None)
        }
        Err(e) => (
            crate::ternary_router::merge_prompt_vector_with_locks(prompt, label, locked),
            Some(e),
        ),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NsdarRoutePreviewResponse {
    pub vector: Vec<i8>,
    pub elapsed_ms: u64,
    pub route: Option<RouteOutcome>,
    pub ambiguity: Option<Ambiguity>,
    #[serde(default)]
    pub log_lines: Vec<String>,
    pub inference_hardware: InferenceHardwareSnapshot,
}

#[tauri::command]
pub fn nsdar_route_preview(
    prompt: String,
    label: String,
    overrides: Vec<NsdarSlotOverride>,
    llama: Option<LlamaCliStartOptions>,
) -> Result<NsdarRoutePreviewResponse, String> {
    let t0 = Instant::now();
    let locked = locked_pairs(&overrides);
    let mut log_lines: Vec<String> = Vec::new();

    if llama.as_ref().is_some_and(|l| l.base_model_only) {
        let elapsed_ms = t0.elapsed().as_millis() as u64;
        let hw = crate::hardware_preference::inference_hardware_snapshot();
        log_lines.push("> Preview: base model only (LoRA/LoFA disabled) — routing skipped.".into());
        return Ok(NsdarRoutePreviewResponse {
            vector: vec![0i8; TERNARY_VECTOR_LEN],
            elapsed_ms,
            route: None,
            ambiguity: None,
            log_lines,
            inference_hardware: hw,
        });
    }

    let vec = {
        #[cfg(not(feature = "llama_cpp"))]
        {
            let _ = &llama;
            let (vec, _) = pass1_vector_from_router(&prompt, &label, &locked);
            vec
        }

        #[cfg(feature = "llama_cpp")]
        {
            crate::otonome_llm::with_otonome_inference_lock(|| {
            if let Some(llama) = llama {
                struct EnvGuard {
                    key: &'static str,
                    prev: Option<std::ffi::OsString>,
                }
                impl EnvGuard {
                    fn set(key: &'static str, val: std::ffi::OsString) -> Self {
                        let prev = std::env::var_os(key);
                        std::env::set_var(key, val);
                        Self { key, prev }
                    }
                }
                impl Drop for EnvGuard {
                    fn drop(&mut self) {
                        match self.prev.take() {
                            Some(v) => std::env::set_var(self.key, v),
                            None => std::env::remove_var(self.key),
                        }
                    }
                }

                let model_path = crate::path_resolve::resolve_repo_relative_file(std::path::Path::new(
                    &llama.model_path,
                ));
                let _base_guard =
                    EnvGuard::set("OTONOME_BASE_MODEL_PATH", model_path.clone().into_os_string());
                let _dir_guard = model_path.parent().map(|p| {
                    EnvGuard::set("ROUTER_MODELS_DIR", p.as_os_str().to_os_string())
                });
                let router_lora = model_path
                    .parent()
                    .map(|p| p.join("router-lora.gguf"))
                    .unwrap_or_else(|| std::path::PathBuf::from("router-lora.gguf"));
                let _router_guard =
                    EnvGuard::set("OTONOME_ROUTER_LORA_PATH", router_lora.into_os_string());

                let _preview_env = (_base_guard, _dir_guard, _router_guard);

                log_lines.push("> Pass 1: in-process router inference (preview)…".into());
                let (vec, warn) = pass1_vector_from_router(&prompt, &label, &locked);
                if let Some(w) = warn {
                    log_lines.push(format!("> Pass 1 warning: {w}"));
                    let fb = if w.contains("router LoRA not found") {
                        "> Pass 1 fallback: deterministic keyword router (router LoRA missing on disk)."
                    } else {
                        "> Pass 1 fallback: deterministic keyword router (in-process decode did not yield a valid 32-slot vector)."
                    };
                    log_lines.push(fb.into());
                } else {
                    log_lines.push("> Pass 1: router LoRA decode complete.".into());
                }
                vec
            } else {
                let (vec, _) = pass1_vector_from_router(&prompt, &label, &locked);
                log_lines.push("> Pass 1: deterministic keyword router (no llama options supplied for preview).".into());
                vec
            }
            })
        }
    };
    let elapsed_ms = t0.elapsed().as_millis() as u64;

    let mut vector = vec![0i8; TERNARY_VECTOR_LEN];
    vector.copy_from_slice(&vec.v);

    let hw = crate::hardware_preference::inference_hardware_snapshot();
    match route(&vec) {
        Ok(r) => Ok(NsdarRoutePreviewResponse {
            vector,
            elapsed_ms,
            route: Some(r),
            ambiguity: None,
            log_lines,
            inference_hardware: hw.clone(),
        }),
        Err(a) => Ok(NsdarRoutePreviewResponse {
            vector,
            elapsed_ms,
            route: None,
            ambiguity: Some(a),
            log_lines,
            inference_hardware: hw,
        }),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NsdarLocalCompleteResponse {
    pub success: bool,
    pub assistant_text: Option<String>,
    pub log_lines: Vec<String>,
    pub route: Option<RouteOutcome>,
    pub ambiguity: Option<Ambiguity>,
    pub error: Option<String>,
    pub inference_hardware: InferenceHardwareSnapshot,
}

#[tauri::command]
pub fn nsdar_local_complete(
    prompt: String,
    label: String,
    overrides: Vec<NsdarSlotOverride>,
    llama: LlamaCliStartOptions,
    initial_pass_2_prompt: Option<String>,
) -> Result<NsdarLocalCompleteResponse, String> {
    let hw = crate::hardware_preference::inference_hardware_snapshot();
    let mut log_lines: Vec<String> = vec!["> Prompt received.".to_string()];
    // `trim()` would remove the mandatory trailing space after `Assistant:` in llama-cli transcripts.
    let pass2_initial = initial_pass_2_prompt
        .as_ref()
        .map(|s| s.trim_start())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    if pass2_initial.is_some() {
        log_lines.push("> Pass 2: using caller-supplied llama-cli transcript (initial_pass_2_prompt).".into());
    }

    #[cfg(not(feature = "llama_cpp"))]
    {
        let _ = (&prompt, &label, &overrides, &llama, &pass2_initial);
        log_lines.push(
            "> NSDAR Pass 2 requires `llama_cpp`: rebuild src-tauri with `--features llama_cpp`."
                .into(),
        );
        return Ok(NsdarLocalCompleteResponse {
            success: false,
            assistant_text: None,
            log_lines,
            route: None,
            ambiguity: None,
            error: Some(
                "This build does not include the in-process Otonome engine. Enable feature `llama_cpp`."
                    .into(),
            ),
            inference_hardware: hw,
        });
    }

    #[cfg(feature = "llama_cpp")]
    {
        return crate::otonome_llm::with_otonome_inference_lock(|| {
        struct EnvGuard {
            key: &'static str,
            prev: Option<std::ffi::OsString>,
        }
        impl EnvGuard {
            fn set(key: &'static str, val: std::ffi::OsString) -> Self {
                let prev = std::env::var_os(key);
                std::env::set_var(key, val);
                Self { key, prev }
            }
        }
        impl Drop for EnvGuard {
            fn drop(&mut self) {
                match self.prev.take() {
                    Some(v) => std::env::set_var(self.key, v),
                    None => std::env::remove_var(self.key),
                }
            }
        }

        // Base-only and fusion paths share the same model env so `run_pass2_qvac` hits `llama.model_path`.
        let model_path = crate::path_resolve::resolve_repo_relative_file(std::path::Path::new(
            &llama.model_path,
        ));
        let _base_guard =
            EnvGuard::set("OTONOME_BASE_MODEL_PATH", model_path.clone().into_os_string());
        let _dir_guard = model_path
            .parent()
            .map(|p| EnvGuard::set("ROUTER_MODELS_DIR", p.as_os_str().to_os_string()));
        let router_lora = model_path
            .parent()
            .map(|p| p.join("router-lora.gguf"))
            .unwrap_or_else(|| std::path::PathBuf::from("router-lora.gguf"));
        let _router_guard =
            EnvGuard::set("OTONOME_ROUTER_LORA_PATH", router_lora.into_os_string());
        let _ctx_guard = EnvGuard::set(
            "OTONOME_CTX_SIZE",
            std::ffi::OsString::from(llama.ctx_size.to_string()),
        );

        // Same numbers as `--temp / --top-k / --top-p / --repeat-penalty / --repeat-last-n` on the
        // matching `LlamaCliStartOptions` (see `llama_cli::spawn_llama_cli{,_oneshot}`). Forwarded to
        // both Pass 2 paths so subprocess `llama-cli` and in-process decode use identical sampling.
        let pass2_sampling = Pass2SamplingOptions {
            temp: llama.temp,
            top_k: llama.top_k,
            top_p: llama.top_p,
            min_p: llama.min_p,
            repeat_penalty: llama.repeat_penalty,
            repeat_last_n: llama.repeat_last_n,
            // `LLAMA_DEFAULT_SEED` (`0xFFFFFFFF`) = use OS random device, matching `llama-cli`'s
            // default. Seed `0` would be deterministic-with-zero and cause repeated bad outputs.
            seed: LLAMA_DEFAULT_SEED,
        };
        log_lines.push(format!(
            "> Pass 2 sampling: temp={:.2}, top_k={}, top_p={:.3}, min_p={:.3}, repeat_penalty={:.2}, repeat_last_n={} (matches `llama-cli` flags).",
            pass2_sampling.temp,
            pass2_sampling.top_k,
            pass2_sampling.top_p,
            pass2_sampling.min_p,
            pass2_sampling.repeat_penalty,
            pass2_sampling.repeat_last_n,
        ));

        if llama.base_model_only {
            log_lines.push("> Base model only enabled: routing + adapter fusion disabled.".into());
            let coeffs = [0i8; 27];
            let max_new = llama.max_new_tokens.min(8192).max(1) as usize;
            log_lines.push(format!(
                "> Base decode: up to {max_new} new tokens (CPU-only builds often need minutes; EOS stops early)."
            ));
            let t_decode = Instant::now();
            match crate::otonome_llm::run_pass2_qvac(
                &prompt,
                &coeffs,
                max_new,
                pass2_initial.as_deref(),
                pass2_sampling,
            ) {
                Ok(text) => {
                    let ms = t_decode.elapsed().as_millis() as u64;
                    log_lines.push(format!("> Base decode complete ({} ms).", ms));
                    return Ok(NsdarLocalCompleteResponse {
                        success: true,
                        assistant_text: Some(text),
                        log_lines,
                        route: None,
                        ambiguity: None,
                        error: None,
                        inference_hardware: hw.clone(),
                    });
                }
                Err(e) => {
                    log_lines.push(format!("> Base decode error: {e}"));
                    return Ok(NsdarLocalCompleteResponse {
                        success: false,
                        assistant_text: None,
                        log_lines,
                        route: None,
                        ambiguity: None,
                        error: Some(e),
                        inference_hardware: hw,
                    });
                }
            }
        }

        let model_dir = model_path
            .parent()
            .map(std::path::Path::to_path_buf)
            .ok_or_else(|| format!("invalid model path (no parent directory): {}", model_path.display()))?;

        // Create tiny placeholder Pass 2 adapter GGUFs next to the base model (dev convenience).
        if let Err(e) =
            crate::pass2_dummy_adapters::ensure_dummy_pass2_adapters(&model_dir, &model_path)
        {
            log_lines.push(format!("> Pass 2 setup error (dummy adapters): {e}"));
            return Ok(NsdarLocalCompleteResponse {
                success: false,
                assistant_text: None,
                log_lines,
                route: None,
                ambiguity: None,
                error: Some(e),
                inference_hardware: hw.clone(),
            });
        }

        // Pass 2 per-slot adapter GGUFs: prefer explicit UI directory, otherwise default to the model folder.
        let pass2_dir = llama
            .nsdar_adapters_dir
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .map(std::path::PathBuf::from)
            .map(|pb| {
                if pb.is_absolute() {
                    pb
                } else {
                    crate::path_resolve::resolve_repo_relative_dir(pb.as_path())
                }
            })
            .unwrap_or_else(|| model_dir.clone());
        let _pass2_adapters_guard =
            EnvGuard::set("OTONOME_PASS2_ADAPTERS_DIR", pass2_dir.clone().into_os_string());
        log_lines.push(format!(
            "> Pass 2: adapter directory = {}",
            pass2_dir.display()
        ));

        let _env_guards = (
            _base_guard,
            _dir_guard,
            _router_guard,
            _ctx_guard,
            _pass2_adapters_guard,
        );

        let locked = locked_pairs(&overrides);

        /// One loaded model+context for Pass 1 then Pass 2, or the legacy two-init path if session init fails.
        enum Pass2Engine {
            Shared(crate::otonome_llm::QvacDualPassSession),
            Standalone,
        }

        let (vec, pass1_warn, mut pass2_engine) =
            match crate::otonome_llm::QvacDualPassSession::new() {
                Ok(mut session) => match session.run_pass1(&prompt) {
                    Ok(v27) => {
                        let mut t = TernaryVector32::default();
                        for (i, x) in v27.iter().enumerate().take(TERNARY_VECTOR_LEN.min(27)) {
                            t.v[i] = (*x).clamp(-1, 1);
                        }
                        for &(i, val) in &locked {
                            if i < TERNARY_VECTOR_LEN {
                                t.v[i] = val.clamp(-1, 1);
                            }
                        }
                        (t, None, Pass2Engine::Shared(session))
                    }
                    Err(e) => {
                        let t = crate::ternary_router::merge_prompt_vector_with_locks(
                            &prompt, &label, &locked,
                        );
                        (t, Some(e), Pass2Engine::Shared(session))
                    }
                },
                Err(_) => {
                    let (t, w) = pass1_vector_from_router(&prompt, &label, &locked);
                    (t, w, Pass2Engine::Standalone)
                }
            };

        if let Some(ref w) = pass1_warn {
            log_lines.push(format!("> Pass 1 warning: {w}"));
            let fb = if w.contains("router LoRA not found") {
                "> Pass 1 fallback: deterministic keyword router (router LoRA missing on disk)."
            } else {
                "> Pass 1 fallback: deterministic keyword router (in-process decode did not yield a valid 32-slot vector)."
            };
            log_lines.push(fb.into());
        }
        let csv = format_nsdar_csv(&vec);
        log_lines.push(format!("> Vector: [{}]", csv));

        let t_route = Instant::now();
        let route_out = match route(&vec) {
            Ok(r) => {
                log_lines.push(format!(
                    "> Router: {} (score {:.3}) — {} ms",
                    r.adapter_id,
                    r.score,
                    t_route.elapsed().as_millis()
                ));
                if let Some((path, _)) = persona_cli_options_for_adapter(&r.adapter_id) {
                    if Path::new(path).is_file() {
                        log_lines.push(format!(
                            "> Note: persona plugin {} not applied in in-process Pass 2.",
                            path
                        ));
                    }
                }
                r
            }
            Err(a) => {
                log_lines.push(format!(
                    "> Router: AMBIGUOUS — {:?} — {} ms",
                    a.top_adapters,
                    t_route.elapsed().as_millis()
                ));
                return Ok(NsdarLocalCompleteResponse {
                    success: false,
                    assistant_text: None,
                    log_lines,
                    route: None,
                    ambiguity: Some(a),
                    error: Some(
                        "Ambiguous adapter selection; narrow the prompt or adjust overrides.".into(),
                    ),
                    inference_hardware: hw.clone(),
                });
            }
        };

        let mut coeffs = [0i8; 27];
        for i in 0..27 {
            coeffs[i] = vec.v[i];
        }

        let active_slots: Vec<String> = coeffs
            .iter()
            .enumerate()
            .filter(|(_, &c)| c != 0)
            .map(|(i, &c)| format!("{i}:{c}"))
            .collect();
        if active_slots.is_empty() {
            log_lines.push("> Pass 2: Native LoRA Fusion — no active slots; base decode.".into());
        } else {
            log_lines.push(format!(
                "> Pass 2: Native LoRA Fusion initialized for slots [{}].",
                active_slots.join(", ")
            ));
        }

        let max_new = llama.max_new_tokens.min(8192).max(1) as usize;

        let t_decode = Instant::now();
        let pass2_result = match &mut pass2_engine {
            Pass2Engine::Shared(session) => session.run_pass2(
                &prompt,
                &coeffs,
                max_new,
                pass2_initial.as_deref(),
                pass2_sampling,
            ),
            Pass2Engine::Standalone => crate::otonome_llm::run_pass2_qvac(
                &prompt,
                &coeffs,
                max_new,
                pass2_initial.as_deref(),
                pass2_sampling,
            ),
        };

        match pass2_result {
            Ok(text) => {
                let ms = t_decode.elapsed().as_millis() as u64;
                log_lines.push(format!("> Otonome decode complete ({} ms).", ms));
                Ok(NsdarLocalCompleteResponse {
                    success: true,
                    assistant_text: Some(text),
                    log_lines,
                    route: Some(route_out),
                    ambiguity: None,
                    error: None,
                    inference_hardware: hw.clone(),
                })
            }
            Err(e) => {
                log_lines.push(format!("> Pass 2 error: {e}"));
                Ok(NsdarLocalCompleteResponse {
                    success: false,
                    assistant_text: None,
                    log_lines,
                    route: Some(route_out),
                    ambiguity: None,
                    error: Some(e),
                    inference_hardware: hw,
                })
            }
        }
        });
    }
}
