//! Single resident BitNet base (`ms-2b-4t-pure.gguf`) for in-process QVAC / Otonome.
//!
//! - **Pass 1**: attach `router-lora.gguf`, short decode → 32-slot routing vector, then detach LoRA
//!   from the context while keeping the adapter in RAM for Pass 2 / the next Pass 1 on the same session.
//! - **Pass 2**: dynamically attach **multiple** per-slot adapters simultaneously during inference,
//!   using the native llama.cpp LoRA adapter APIs (see [`crate::qvac_pass2`]).
//!   Model load defaults to `use_mmap = true` (stream weights from disk) unless overridden by
//!   `OTONOME_MODEL_USE_MMAP=false`.
//!
//! **Device**: The default `llama_cpp` build links **CPU-only** llama.cpp; logs show layers on CPU.
//! - **CUDA**: install [NVIDIA CUDA Toolkit](https://developer.nvidia.com/cuda-downloads) so `nvcc` is on `PATH`
//!   (set `CUDAToolkit_ROOT` if CMake asks), then `cargo build --features llama_cpp_cuda` or `npm run tauri:dev:cuda`,
//!   and set `OTONOME_N_GPU_LAYERS=99`.
//! - **Vulkan**: install [LunarG Vulkan SDK](https://vulkan.lunarg.com/) and set `VULKAN_SDK`, then
//!   `--features llama_cpp_vulkan` / `npm run tauri:dev:vulkan`, plus `OTONOME_N_GPU_LAYERS`.
//! External `llama-cli` agents can still be faster if that binary was built with GPU support.
//!
//! **Pass 1**: `OTONOME_PASS1_GIVEUP_BYTES` (default 192) stops decode if output reaches that many
//! bytes without `[`, avoiding long loops when the model chats instead of emitting a vector.
//!
//! **Session reuse**: [`generate_routing_vector`] keeps a per-thread cached [`QvacDualPassSession`]
//! (invalidated on hardware preference changes) so repeated Pass 1 calls avoid reloading the base
//! model and router LoRA. [`run_pass2_qvac`] uses a separate per-thread **base-only** engine cache
//! (no router LoRA) so `nsdar_local_complete` base-model-only and `Pass2Engine::Standalone` paths
//! do not reload the GGUF on every invoke. Both caches are cleared when the user changes hardware.

const PASS1_VECTOR_LEN: usize = 32;
const PASS2_COEFF_LEN: usize = 27;

/// Compact, non-conversational spec. Do **not** end the assistant prompt with a literal `[`:
/// greedy BitNet+router often continues `[` as `[2,3,4]` (invalid length and invalid domain).
///
/// Do **not** embed a full 32-slot example here: models often **partially copy** it after chatty
/// filler, then hit the decode token cap before closing `]`.
pub const PASS1_SYSTEM_PROMPT: &str = r#"ZZ9-pass1|v=1|out:one_line
Output: '[' then 32 comma-separated ints each in {-1,0,1} then ']'. Nothing else—no apologies, labels, or sentences.

Idx→topic (0..26; 27..31 use 0 unless clearly required):
0:VisionStrategy 1:ProductDev 2:MarketSell 3:SupplyChain 4:ServiceDelivery 5:CustomerSvc 6:HumanCapital 7:IT 8:Finance 9:Assets 10:RiskCompliance 11:ExtRelations 12:BizCapabilities 13:Urgency 14:Privacy 15:RiskLevel 16:Sentiment(-1/0/+1) 17:Complexity 18:Knowledge 19:Authority 20:Format 21:Verification 22:Language 23:History 24:Ambiguity 25:Stability 26:Iteration 27..31:reserved"#;

#[cfg(not(feature = "llama_cpp"))]
pub fn generate_routing_vector(_user: &str) -> Result<[i8; PASS1_VECTOR_LEN], String> {
    Err("in-process Otonome engine requires building with `--features llama_cpp`.".into())
}

/// Sampling values used by Pass 2 in-process; **must match** the same fields on
/// [`crate::llama_cli::LlamaCliStartOptions`] sent to subprocess `llama-cli`.
#[derive(Debug, Clone, Copy)]
pub struct Pass2SamplingOptions {
    pub temp: f32,
    pub top_k: i32,
    pub top_p: f32,
    pub min_p: f32,
    pub repeat_penalty: f32,
    pub repeat_last_n: i32,
    /// Seed for `LlamaSampler::dist`. `LLAMA_DEFAULT_SEED` (`0xFFFFFFFF`) means *use a random seed*
    /// per llama.cpp convention. Any other value (including `0`) is used **deterministically** as
    /// the seed for that sampler — `0` is *not* "random".
    pub seed: u32,
}

/// Mirrors `LLAMA_DEFAULT_SEED` in upstream llama.cpp: when passed to `llama_sampler_init_dist`,
/// the sampler initializes from the OS random device.
pub const LLAMA_DEFAULT_SEED: u32 = 0xFFFF_FFFF;

impl Default for Pass2SamplingOptions {
    fn default() -> Self {
        Self {
            temp: crate::llama_cli::DEFAULT_LLAMA_TEMP,
            top_k: crate::llama_cli::DEFAULT_LLAMA_TOP_K,
            top_p: crate::llama_cli::DEFAULT_LLAMA_TOP_P,
            min_p: crate::llama_cli::DEFAULT_LLAMA_MIN_P,
            repeat_penalty: crate::llama_cli::DEFAULT_LLAMA_REPEAT_PENALTY,
            repeat_last_n: crate::llama_cli::DEFAULT_LLAMA_REPEAT_LAST_N,
            seed: LLAMA_DEFAULT_SEED,
        }
    }
}

#[cfg(not(feature = "llama_cpp"))]
#[allow(dead_code)]
pub fn run_pass2_qvac(
    _user_prompt: &str,
    _coefficients: &[i8; PASS2_COEFF_LEN],
    _max_new_tokens: usize,
    _initial_pass_2_prompt: Option<&str>,
    _sampling: Pass2SamplingOptions,
) -> Result<String, String> {
    Err("in-process Otonome engine requires building with `--features llama_cpp`.".into())
}

#[cfg(feature = "llama_cpp")]
mod imp {
    use super::PASS1_VECTOR_LEN;
    use super::PASS2_COEFF_LEN;
    use super::PASS1_SYSTEM_PROMPT;
    use crate::llama_cli::{DEFAULT_WORKMATE_SYSTEM_PROMPT, LLAMA_CLI_REVERSE_PROMPT};
    use std::cell::RefCell;
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    use std::path::PathBuf;
    use std::sync::atomic::Ordering;
    use crate::path_resolve::{resolve_repo_relative_dir, resolve_repo_relative_file};
    use llama_cpp_2::context::params::LlamaContextParams;
    use llama_cpp_2::llama_backend::LlamaBackend;
    use llama_cpp_2::llama_batch::LlamaBatch;
    use llama_cpp_2::model::{
        params::LlamaModelParams,
        AddBos, LlamaLoraAdapter, LlamaModel,
    };
    use crate::qvac_pass2::Pass2Prepared;

    /// When `initial` is set, it must be the full `-p` transcript (starts with `System:`, ends with `Assistant: `),
    /// identical to what `spawn_llama_cli` passes as `-p`. When unset, build the same transcript as
    /// `buildLlamaCliTranscript([User: user])` using [`DEFAULT_WORKMATE_SYSTEM_PROMPT`].
    fn assemble_pass2_prompt(user_prompt: &str, initial: Option<&str>) -> Result<String, String> {
        // Do not use `trim()` on the full transcript: it strips the trailing space after `Assistant:`
        // that llama-cli / the frontend contract requires.
        if let Some(s) = initial.map(str::trim_start).filter(|s| !s.is_empty()) {
            let mut raw = s.trim_end_matches(['\n', '\r']).to_string();
            if raw.ends_with("Assistant:") && !raw.ends_with("Assistant: ") {
                raw.push(' ');
            }
            if !raw.starts_with("System:") {
                return Err(
                    "initial_pass_2_prompt must start with \"System:\" when provided.".into(),
                );
            }
            if !raw.ends_with("Assistant: ") {
                return Err(
                    "initial_pass_2_prompt must end with exactly \"Assistant: \".".into(),
                );
            }
            return Ok(raw);
        }
        Ok(format!(
            "System: {}<|eot_id|>User: {}<|eot_id|>Assistant: ",
            DEFAULT_WORKMATE_SYSTEM_PROMPT,
            user_prompt.trim()
        ))
    }

    /// Run exactly one `llama_decode` with LoRA active for the full call.
    ///
    /// Some `llama-cpp-2` forks return an RAII `LlamaContextAdapterGuard` from `lora_adapter_set`;
    /// **crates.io 0.1.143** returns `()` instead, so we must not call `set` in a helper that returns
    /// before `decode` — adapters would not stay pinned across `decode`. This function attaches,
    /// decodes, then clears adapters (Pass 2: [`Pass2Prepared::detach`]) so the active window always
    /// covers `decode`.
    fn decode_batch_with_scoped_lora(
        ctx: &mut llama_cpp_2::context::LlamaContext<'static>,
        pass1_router: &mut Option<&mut LlamaLoraAdapter>,
        pass2_prep: &mut Option<&mut Pass2Prepared>,
        batch: &mut LlamaBatch<'_>,
    ) -> Result<(), String> {
        match (pass1_router.as_mut(), pass2_prep.as_mut()) {
            (Some(adapter), None) => {
                ctx.lora_adapter_set(*adapter, 1.0)
                    .map_err(|e| format!("LoRA set before decode failed: {e}"))?;
                let dec = ctx.decode(batch);
                let rm = ctx.lora_adapter_remove(*adapter);
                dec.map_err(|e| format!("decode failed: {e}"))?;
                rm.map_err(|e| format!("lora_adapter_remove after decode failed: {e}"))
            }
            (None, Some(prep)) => {
                prep.attach(ctx)
                    .map_err(|e| format!("Pass 2 LoRA attach before decode failed: {e}"))?;
                let dec = ctx.decode(batch);
                let detach = prep.detach(ctx);
                dec.map_err(|e| format!("decode failed: {e}"))?;
                detach
            }
            (None, None) => ctx.decode(batch).map_err(|e| format!("decode failed: {e}")),
            (Some(_), Some(_)) => Err("internal error: pass1 router and pass2 prep both set".into()),
        }
    }
    use llama_cpp_2::sampling::LlamaSampler;
    use std::num::NonZeroU32;

    pub(super) struct OtonomeLlm {
        model: LlamaModel,
        ctx: llama_cpp_2::context::LlamaContext<'static>,
    }

    fn backend() -> Result<&'static LlamaBackend, String> {
        use std::sync::OnceLock;
        // `OnceLock::get_or_try_init` is unstable on stable Rust.
        // Cache the init `Result` instead so failures are stable + repeatable.
        static BACKEND: OnceLock<Result<LlamaBackend, String>> = OnceLock::new();
        match BACKEND.get_or_init(|| {
            LlamaBackend::init().map_err(|e| format!("llama backend init failed: {e}"))
        }) {
            Ok(b) => Ok(b),
            Err(e) => Err(e.clone()),
        }
    }

    fn default_thread_count() -> i32 {
        let n = std::thread::available_parallelism()
            .map(|n| n.get() as i32)
            .unwrap_or(4);
        n.clamp(4, 8)
    }

    pub(super) fn models_dir() -> PathBuf {
        let raw = std::env::var_os("ROUTER_MODELS_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("bitnet-b1.58-2B-4T-gguf"));
        if raw.is_absolute() {
            raw
        } else {
            resolve_repo_relative_dir(raw.as_path())
        }
    }

    fn base_model_path() -> PathBuf {
        // Prefer explicit override so the UI can control which GGUF file is loaded.
        if let Some(p) = std::env::var_os("OTONOME_BASE_MODEL_PATH") {
            let pb = PathBuf::from(p);
            return if pb.is_absolute() {
                pb
            } else {
                resolve_repo_relative_file(pb.as_path())
            };
        }
        let rel = models_dir().join("ms-2b-4t-pure.gguf");
        if rel.is_absolute() {
            rel
        } else {
            resolve_repo_relative_file(rel.as_path())
        }
    }

    fn router_lora_path() -> PathBuf {
        let p = if let Some(p) = std::env::var_os("OTONOME_ROUTER_LORA_PATH") {
            PathBuf::from(p)
        } else {
            models_dir().join("router-lora.gguf")
        };
        if p.is_absolute() {
            p
        } else {
            resolve_repo_relative_file(p.as_path())
        }
    }

    /// Hash of paths and env that affect `LlamaModel` / adapter init so a cached session is not reused
    /// after configuration changes (see also [`invalidate_qvac_session_cache`]).
    fn dual_pass_session_fingerprint() -> u64 {
        let mut h = DefaultHasher::new();
        crate::hardware_preference::HARDWARE_PREFERENCE_EPOCH
            .load(Ordering::Relaxed)
            .hash(&mut h);
        base_model_path().display().to_string().hash(&mut h);
        router_lora_path().display().to_string().hash(&mut h);
        std::env::var("OTONOME_MODEL_USE_MMAP")
            .unwrap_or_default()
            .hash(&mut h);
        std::env::var("OTONOME_N_GPU_LAYERS")
            .unwrap_or_default()
            .hash(&mut h);
        std::env::var("OTONOME_CTX_SIZE")
            .unwrap_or_default()
            .hash(&mut h);
        std::env::var("OTONOME_PASS2_ADAPTERS_DIR")
            .unwrap_or_default()
            .hash(&mut h);
        h.finish()
    }

    /// Prefer mmap streaming by default; override with `OTONOME_MODEL_USE_MMAP=false`.
    ///
    /// `OTONOME_N_GPU_LAYERS`: number of layers to offload (e.g. `99`). Only effective when the
    /// dependency is built with `llama_cpp_cuda` / CUDA-enabled ggml.
    fn model_load_params() -> LlamaModelParams {
        let use_mmap = std::env::var("OTONOME_MODEL_USE_MMAP")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(true);
        let mut p = LlamaModelParams::default().with_use_mmap(use_mmap);
        if let Ok(s) = std::env::var("OTONOME_N_GPU_LAYERS") {
            if let Ok(n) = s.parse::<u32>() {
                p = p.with_n_gpu_layers(n);
            }
        }
        p
    }

    /// Render the prompt using the **Llama-3 chat format** directly.
    ///
    /// We do **not** rely on `model.apply_chat_template()` for two reasons:
    /// 1. `llama_chat_apply_template` does not interpret the Jinja template baked into bitnet GGUFs
    ///    and returns FFI -1 (unsupported template). Buffer-growing is not a fix for that error.
    /// 2. The model's tokenizer is Llama-3 (`<|begin_of_text|>` 128000, `<|start_header_id|>` 128006,
    ///    `<|end_header_id|>` 128007, `<|eot_id|>` 128009), so the canonical Llama-3 prompt format
    ///    is what the router LoRA was trained against.
    ///
    /// Format (kept as one string so the model sees stable framing under the router LoRA):
    /// ```text
    /// <|begin_of_text|><|start_header_id|>system<|end_header_id|>
    ///
    /// {system}<|eot_id|><|start_header_id|>user<|end_header_id|>
    ///
    /// {user}<|eot_id|><|start_header_id|>assistant<|end_header_id|>
    ///
    /// ```
    ///
    /// `AddBos::Never` because we already include `<|begin_of_text|>` literally.
    fn build_pass1_prompt(_model: &LlamaModel, user: &str) -> Result<(String, AddBos), String> {
        // Fence the scenario text so the assistant head is less likely to "answer" the user story
        // instead of emitting the routing bracket line.
        let user_block = format!(
            "---MSG---\n{}\n---END---\nROUTING_VECTOR_LINE_ONLY",
            user.trim()
        );
        let prompt = format!(
            "<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n{system}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n{user_block}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n",
            system = PASS1_SYSTEM_PROMPT,
            user_block = user_block,
        );
        Ok((prompt, AddBos::Never))
    }

    fn parse_vector(text: &str) -> Result<[i8; PASS1_VECTOR_LEN], String> {
        fn parse_json_array(s: &str) -> Result<[i8; PASS1_VECTOR_LEN], String> {
            let v: Vec<i64> =
                serde_json::from_str(s).map_err(|e| format!("invalid JSON array: {e}"))?;
            if v.len() != PASS1_VECTOR_LEN {
                return Err(format!(
                    "expected JSON array of length {PASS1_VECTOR_LEN}, got {}",
                    v.len()
                ));
            }
            let mut out = [0i8; PASS1_VECTOR_LEN];
            for (i, n) in v.into_iter().enumerate() {
                if n != -1 && n != 0 && n != 1 {
                    return Err(format!("invalid value at index {i}: expected -1/0/1, got {n}"));
                }
                out[i] = n as i8;
            }
            Ok(out)
        }

        /// Read exactly 32 comma-separated -1/0/1 values starting at byte `open_bracket` where
        /// `s.as_bytes()[open_bracket] == b'['`. Tolerates a missing closing `]` after slot 31.
        fn parse_bracket_ternary_32_at(s: &str, open_bracket: usize) -> Option<[i8; PASS1_VECTOR_LEN]> {
            let b = s.as_bytes();
            if b.get(open_bracket) != Some(&b'[') {
                return None;
            }
            let mut i = open_bracket + 1;
            let mut out = [0i8; PASS1_VECTOR_LEN];
            for n in 0..PASS1_VECTOR_LEN {
                while i < b.len() && b[i].is_ascii_whitespace() {
                    i += 1;
                }
                if i >= b.len() {
                    return None;
                }
                if b[i] == b']' {
                    return None;
                }
                let neg = if b[i] == b'-' {
                    i += 1;
                    true
                } else {
                    false
                };
                let d0 = i;
                while i < b.len() && b[i].is_ascii_digit() {
                    i += 1;
                }
                if i == d0 {
                    return None;
                }
                let v: i64 = s.get(d0..i)?.parse().ok()?;
                let v = if neg { -v } else { v };
                if v != -1 && v != 0 && v != 1 {
                    return None;
                }
                out[n] = v as i8;
                while i < b.len() && b[i].is_ascii_whitespace() {
                    i += 1;
                }
                if n + 1 < PASS1_VECTOR_LEN {
                    if i >= b.len() || b[i] != b',' {
                        return None;
                    }
                    i += 1;
                }
            }
            Some(out)
        }

        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Err("model returned empty output".into());
        }

        // Fast path: output is exactly the JSON array.
        if let Ok(v) = parse_json_array(trimmed) {
            return Ok(v);
        }

        // Models often prepend chitchat; try every `[` in case a partial copy of an example
        // appears first and the real vector appears later (rare but cheap to check).
        for (idx, _) in trimmed.match_indices('[') {
            if let Some(v) = parse_bracket_ternary_32_at(trimmed, idx) {
                log::warn!("Pass 1: bracket-scan parse at byte offset {idx} (non-JSON or prefixed output)");
                return Ok(v);
            }
        }

        // Recovery path: each `[` … next `]` span as strict JSON (handles whitespace-only gaps).
        let mut last_err: Option<String> = None;
        for (start, _) in trimmed.match_indices('[') {
            if let Some(rel_end) = trimmed[start..].find(']') {
                let end = start + rel_end;
                let inner = &trimmed[start..=end];
                match parse_json_array(inner) {
                    Ok(v) => return Ok(v),
                    Err(e) => last_err = Some(e),
                }
            }
        }

        if let Some(e) = last_err {
            return Err(e);
        }

        // Legacy single-span attempt (first `[` through last `]`) for odd nesting edge cases.
        let start = trimmed.find('[').ok_or_else(|| "missing '[' in output".to_string())?;
        let end = trimmed
            .rfind(']')
            .ok_or_else(|| "missing ']' in output (incomplete array?)".to_string())?;
        if end <= start {
            return Err("malformed JSON array brackets".into());
        }
        let inner = &trimmed[start..=end];
        parse_json_array(inner).map_err(|e| {
            format!(
                "{e} (slice starts {:?})",
                inner.chars().take(48).collect::<String>()
            )
        })
    }

    /// Same chain order `llama-cli` uses by default (after the initial `logit-bias` slot, which is a
    /// no-op when empty; with the disabled steps — `dry`, `top-n-sigma`, `typical`, `xtc` — left out):
    /// penalties → top_k → top_p → min_p → **temp-ext** → dist(seed).
    ///
    /// - `top_p` / `min_p` use **`min_keep = 0`**, matching `common_params_sampling::min_keep` defaults
    ///   (`llama_sampler_init_*_p(.., min_keep)` in upstream llama.cpp).
    /// - Temperature uses **`temp_ext(t, delta=0, exponent=1)`** so Pass 2 runs the same sampler as
    ///   `COMMON_SAMPLER_TYPE_TEMPERATURE` (`temp-ext` collapses to `llama_sampler_temp_impl` when
    ///   `dynatemp_range` is zero).
    ///
    /// `min_p` is critical for parity: omitting it lets the long tail survive `top_p`, which at
    /// non-zero `temp` can derail free-form generation.
    fn build_pass2_sampler(s: super::Pass2SamplingOptions) -> LlamaSampler {
        LlamaSampler::chain_simple([
            LlamaSampler::penalties(s.repeat_last_n, s.repeat_penalty, 0.0, 0.0),
            LlamaSampler::top_k(s.top_k),
            LlamaSampler::top_p(s.top_p, 0),
            LlamaSampler::min_p(s.min_p, 0),
            LlamaSampler::temp_ext(s.temp, 0.0, 1.0),
            LlamaSampler::dist(s.seed),
        ])
    }

    fn init_engine() -> Result<OtonomeLlm, String> {
        crate::hardware_preference::load_and_apply_for_model_init();

        let model_path = base_model_path();
        if !model_path.is_file() {
            return Err(format!("base model not found: {}", model_path.display()));
        }

        let backend = backend()?;
        let params = model_load_params();
        let model = LlamaModel::load_from_file(&backend, &model_path, &params)
            .map_err(|e| format!("model load failed ({}): {e}", model_path.display()))?;

        let n_threads = default_thread_count();
        let n_ctx_u = std::env::var("OTONOME_CTX_SIZE")
            .ok()
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(4096)
            .clamp(512, 131_072);
        let n_ctx = NonZeroU32::new(n_ctx_u).unwrap_or_else(|| NonZeroU32::new(4096).unwrap());
        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(Some(n_ctx))
            .with_n_batch(512)
            .with_n_threads(n_threads)
            .with_n_threads_batch(n_threads);

        let ctx = model
            .new_context(&backend, ctx_params)
            .map_err(|e| format!("context init failed: {e}"))?;

        let ctx: llama_cpp_2::context::LlamaContext<'static> =
            unsafe { std::mem::transmute::<_, llama_cpp_2::context::LlamaContext<'static>>(ctx) };

        Ok(OtonomeLlm {
            model,
            ctx,
        })
    }

    fn run_decode_with_sampler(
        model: &LlamaModel,
        ctx: &mut llama_cpp_2::context::LlamaContext<'static>,
        sampler: &mut LlamaSampler,
        add_bos: AddBos,
        prompt: &str,
        max_new_tokens: usize,
        stop_sequences: &[&str],
        // Pass 1: stop once output is this long in bytes and still has no `[` (`None` = disabled).
        giveup_bytes_without_open_bracket: Option<usize>,
        mut pass1_router: Option<&mut LlamaLoraAdapter>,
        mut pass2_prep: Option<&mut Pass2Prepared>,
    ) -> Result<String, String> {
        ctx.clear_kv_cache();
        sampler.reset();

        // Attaching/removing LoRA adapters around every `decode()` causes llama.cpp to re-reserve
        // graphs/buffers (very noisy logs + slower). For long generations this looks like a "loop".
        //
        // Keep adapters attached for the whole completion and clean up once at the end.
        //
        // We intentionally store raw pointers in the guard: holding `&ctx` for the whole function
        // would block `&mut ctx` borrows needed for `ctx.decode(...)`.
        struct AdapterCleanup {
            ctx: *const llama_cpp_2::context::LlamaContext<'static>,
            pass1_router: Option<*mut LlamaLoraAdapter>,
            pass2_prep: Option<*mut Pass2Prepared>,
        }
        impl Drop for AdapterCleanup {
            fn drop(&mut self) {
                unsafe {
                    let ctx = &*self.ctx;
                    if let Some(p) = self.pass2_prep {
                        let _ = (&mut *p).detach(ctx);
                    }
                    if let Some(r) = self.pass1_router {
                        let _ = ctx.lora_adapter_remove(&mut *r);
                    }
                }
            }
        }

        // Attach adapters once up-front.
        if let Some(r) = pass1_router.as_mut() {
            ctx.lora_adapter_set(*r, 1.0)
                .map_err(|e| format!("LoRA set before decode failed: {e}"))?;
        }
        if let Some(p) = pass2_prep.as_mut() {
            p.attach(ctx)
                .map_err(|e| format!("Pass 2 LoRA attach before decode failed: {e}"))?;
        }
        let _cleanup = AdapterCleanup {
            ctx: ctx as *const _,
            pass1_router: pass1_router
                .as_deref_mut()
                .map(|r| r as *mut LlamaLoraAdapter),
            pass2_prep: pass2_prep
                .as_deref_mut()
                .map(|p| p as *mut Pass2Prepared),
        };

        let tokens = model
            .str_to_token(prompt, add_bos)
            .map_err(|e| format!("tokenize failed: {e}"))?;

        if tokens.is_empty() {
            return Err("tokenize produced empty token list".into());
        }

        let mut batch = LlamaBatch::get_one(&tokens).map_err(|e| format!("batch init failed: {e}"))?;
        ctx.decode(&mut batch)
            .map_err(|e| format!("decode prompt failed: {e}"))?;
        sampler.accept_many(tokens.iter());

        let mut out_bytes: Vec<u8> = Vec::new();
        let mut cur_pos: i32 = batch.n_tokens();

        for _ in 0..max_new_tokens {
            // `llama_sampler_sample` forwards `idx` to `llama_get_logits_ith`. For batches where only
            // the last row has logits (e.g. `LlamaBatch::get_one`), positive `idx` must be that token's
            // *batch slot* — not the running sequence position. After the first decode-with-one-token
            // step, `cur_pos - 1` is wrong and can assert in llama.cpp. Use `-1` = last output row,
            // which matches our decode pattern (at most one logits row per `decode` call).
            let tok = sampler.sample(ctx, -1);
            sampler.accept(tok);

            if model.is_eog_token(tok) || tok == model.token_eos() {
                break;
            }

            if let Ok(b) = model.token_to_piece_bytes(tok, 256, false, None) {
                out_bytes.extend_from_slice(&b);
            }

            if !stop_sequences.is_empty() {
                let s = String::from_utf8_lossy(&out_bytes);
                if stop_sequences.iter().any(|stop| s.contains(stop)) {
                    break;
                }
            }

            if let Some(limit) = giveup_bytes_without_open_bracket {
                if out_bytes.len() >= limit && !out_bytes.contains(&b'[') {
                    break;
                }
            }

            let mut b = LlamaBatch::new(1, 1);
            b.add(tok, cur_pos, &[0], true)
                .map_err(|e| format!("batch add failed: {e}"))?;
            ctx.decode(&mut b).map_err(|e| format!("decode failed: {e}"))?;
            cur_pos += 1;
        }

        let mut s = String::from_utf8_lossy(&out_bytes).into_owned();
        if !stop_sequences.is_empty() {
            // Earliest stop wins. Keep `]` in the buffer (it closes the Pass-1 JSON array). Strip
            // special end tokens from the visible tail (matches llama-cli `-r "<|eot_id|>"` behavior).
            let best = stop_sequences
                .iter()
                .filter_map(|&stop| s.find(stop).map(|i| (i, stop)))
                .min_by_key(|&(i, _)| i);
            if let Some((i, stop)) = best {
                let end = if stop == "]" {
                    (i + stop.len()).min(s.len())
                } else {
                    i
                };
                s.truncate(end);
            }
        }
        Ok(s.trim().to_string())
    }

    /// One loaded base model + context + QVAC router LoRA adapter kept in RAM across Pass 1 / Pass 2.
    pub struct QvacDualPassSession {
        model: LlamaModel,
        ctx: llama_cpp_2::context::LlamaContext<'static>,
        router: LlamaLoraAdapter,
    }

    impl Drop for QvacDualPassSession {
        fn drop(&mut self) {
            let _ = self.ctx.lora_adapter_remove(&mut self.router);
        }
    }

    impl QvacDualPassSession {
        pub fn new() -> Result<Self, String> {
            let router_path = router_lora_path();
            if !router_path.is_file() {
                return Err(format!("router LoRA not found: {}", router_path.display()));
            }
            let OtonomeLlm {
                model,
                ctx,
            } = init_engine()?;
            let mut router = model
                .lora_adapter_init(&router_path)
                .map_err(|e| format!("router LoRA init failed: {e}"))?;
            let _ = ctx.lora_adapter_remove(&mut router);
            Ok(Self {
                model,
                ctx,
                router,
            })
        }

        /// Pass 1 decode with router LoRA scoped per `decode`, then detach router from the context
        /// (adapter remains resident for [`Self::run_pass2`] / the next Pass 1).
        pub fn run_pass1(&mut self, user: &str) -> Result<[i8; PASS1_VECTOR_LEN], String> {
            self.ctx
                .lora_adapter_remove(&mut self.router)
                .map_err(|e| format!("router LoRA remove before Pass 1 failed: {e}"))?;

            let mut pass1_sampler = LlamaSampler::chain_simple([
                LlamaSampler::temp(0.2),
                LlamaSampler::top_k(1),
                LlamaSampler::greedy(),
            ]);

            let giveup = std::env::var("OTONOME_PASS1_GIVEUP_BYTES")
                .ok()
                .and_then(|s| s.parse::<usize>().ok())
                .unwrap_or(192);

            let (prompt, add_bos) = build_pass1_prompt(&self.model, user.trim())?;
            let raw = run_decode_with_sampler(
                &self.model,
                &mut self.ctx,
                &mut pass1_sampler,
                add_bos,
                &prompt,
                256,
                &["]", "<|eot_id|>", "<|end_of_text|>"],
                Some(giveup),
                Some(&mut self.router),
                None,
            )?;

            self.ctx
                .lora_adapter_remove(&mut self.router)
                .map_err(|e| format!("router LoRA remove failed: {e}"))?;

            let text = raw.trim().to_string();
            log::info!("Pass 1 raw model output: {:?}", text);
            parse_vector(&text).map_err(|e| format!("{e} (raw output: {:?})", text))
        }

        /// Pass 2 decode (Pass 2 LoRA only during `decode`), then drop Pass 2 adapter files/handle and
        /// re-attach the QVAC router LoRA on the context for the next Pass 1.
        pub fn run_pass2(
            &mut self,
            user_prompt: &str,
            coefficients: &[i8; PASS2_COEFF_LEN],
            max_new_tokens: usize,
            initial_pass_2_prompt: Option<&str>,
            sampling: super::Pass2SamplingOptions,
        ) -> Result<String, String> {
            self.ctx
                .lora_adapter_remove(&mut self.router)
                .map_err(|e| format!("router LoRA remove before Pass 2 failed: {e}"))?;

            let prompt = assemble_pass2_prompt(user_prompt, initial_pass_2_prompt)?;

            let mut prep = crate::qvac_pass2::prepare_pass2_adapters(&self.model, coefficients)?;

            let mut pass2_sampler = build_pass2_sampler(sampling);

            const PASS2_STOPS: [&str; 2] = [LLAMA_CLI_REVERSE_PROMPT, "<|end_of_text|>"];

            let decode_result = run_decode_with_sampler(
                &self.model,
                &mut self.ctx,
                &mut pass2_sampler,
                AddBos::Always,
                &prompt,
                max_new_tokens,
                &PASS2_STOPS,
                None,
                None,
                prep.as_mut(),
            );

            if let Some(p) = prep {
                p.finish(&self.ctx);
            }

            let out = decode_result?;

            self.ctx
                .lora_adapter_set(&mut self.router, 1.0)
                .map_err(|e| format!("router LoRA re-attach after Pass 2 failed: {e}"))?;

            Ok(out.trim().to_string())
        }
    }

    struct QvacSessionCacheSlot {
        fingerprint: u64,
        session: QvacDualPassSession,
    }

    // `LlamaContext` is not `Send`; keep a per-thread cache so `generate_routing_vector` can reuse
    // one session without a process-wide `Mutex` over the context.
    thread_local! {
        static QVAC_SESSION_CACHE: RefCell<Option<QvacSessionCacheSlot>> = RefCell::new(None);
    }

    pub(super) fn invalidate_qvac_session_cache() {
        QVAC_SESSION_CACHE.with(|c| {
            *c.borrow_mut() = None;
        });
    }

    /// [`OtonomeLlm`] from [`init_engine`] only (no router LoRA). Reused for [`run_pass2_qvac_impl`]
    /// so sequential base decodes do not mmap/load the GGUF every time.
    struct BaseOnlyEngineSlot {
        fingerprint: u64,
        llm: OtonomeLlm,
    }

    thread_local! {
        static BASE_ONLY_ENGINE_CACHE: RefCell<Option<BaseOnlyEngineSlot>> = RefCell::new(None);
    }

    fn base_only_engine_fingerprint() -> u64 {
        let mut h = DefaultHasher::new();
        crate::hardware_preference::HARDWARE_PREFERENCE_EPOCH
            .load(Ordering::Relaxed)
            .hash(&mut h);
        base_model_path().display().to_string().hash(&mut h);
        std::env::var("OTONOME_MODEL_USE_MMAP")
            .unwrap_or_default()
            .hash(&mut h);
        std::env::var("OTONOME_N_GPU_LAYERS")
            .unwrap_or_default()
            .hash(&mut h);
        std::env::var("OTONOME_CTX_SIZE")
            .unwrap_or_default()
            .hash(&mut h);
        h.finish()
    }

    pub(super) fn invalidate_base_only_engine_cache() {
        BASE_ONLY_ENGINE_CACHE.with(|c| {
            *c.borrow_mut() = None;
        });
    }

    fn cached_session_run<T, F>(f: F) -> Result<T, String>
    where
        F: FnOnce(&mut QvacDualPassSession) -> Result<T, String>,
    {
        let fp = dual_pass_session_fingerprint();
        QVAC_SESSION_CACHE.with(|cell| {
            let mut guard = cell.borrow_mut();
            let replace = match guard.as_ref() {
                Some(slot) => slot.fingerprint != fp,
                None => true,
            };
            if replace {
                *guard = Some(QvacSessionCacheSlot {
                    fingerprint: fp,
                    session: QvacDualPassSession::new()?,
                });
            }
            f(&mut guard.as_mut().expect("QVAC session cache populated").session)
        })
    }

    pub(super) fn generate_routing_vector_impl(user: &str) -> Result<[i8; PASS1_VECTOR_LEN], String> {
        cached_session_run(|session| session.run_pass1(user))
    }

    pub(super) fn run_pass2_qvac_impl(
        user_prompt: &str,
        coefficients: &[i8; PASS2_COEFF_LEN],
        max_new_tokens: usize,
        initial_pass_2_prompt: Option<&str>,
        sampling: super::Pass2SamplingOptions,
    ) -> Result<String, String> {
        let prompt = assemble_pass2_prompt(user_prompt, initial_pass_2_prompt)?;

        let fp = base_only_engine_fingerprint();
        BASE_ONLY_ENGINE_CACHE.with(|cell| {
            let mut guard = cell.borrow_mut();
            let replace = match guard.as_ref() {
                Some(slot) => slot.fingerprint != fp,
                None => true,
            };
            if replace {
                *guard = Some(BaseOnlyEngineSlot {
                    fingerprint: fp,
                    llm: init_engine()?,
                });
            }

            let llm = &mut guard.as_mut().expect("BASE_ONLY_ENGINE_CACHE populated").llm;

            let mut prep = crate::qvac_pass2::prepare_pass2_adapters(&llm.model, coefficients)?;

            let mut pass2_sampler = build_pass2_sampler(sampling);

            const PASS2_STOPS: [&str; 2] = [LLAMA_CLI_REVERSE_PROMPT, "<|end_of_text|>"];

            let decode_result = run_decode_with_sampler(
                &llm.model,
                &mut llm.ctx,
                &mut pass2_sampler,
                AddBos::Always,
                &prompt,
                max_new_tokens,
                &PASS2_STOPS,
                None,
                None,
                prep.as_mut(),
            );

            if let Some(p) = prep {
                p.finish(&llm.ctx);
            }

            let out = decode_result?;
            Ok(out.trim().to_string())
        })
    }
}

#[cfg(feature = "llama_cpp")]
pub use imp::QvacDualPassSession;

#[cfg(feature = "llama_cpp")]
use std::sync::Mutex;

#[cfg(feature = "llama_cpp")]
static OTONOME_INFERENCE_MUTEX: Mutex<()> = Mutex::new(());

/// Serialize all in-process llama.cpp entry points (NSDAR, router tool, etc.) and clear the
/// per-thread QVAC dual-pass cache before each run. The **base-only** engine cache is *not* cleared
/// here so repeat base-model decodes reuse the loaded GGUF (see [`imp::run_pass2_qvac_impl`]).
#[cfg(feature = "llama_cpp")]
pub(crate) fn with_otonome_inference_lock<F, R>(f: F) -> R
where
    F: FnOnce() -> R,
{
    let _guard = OTONOME_INFERENCE_MUTEX
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    imp::invalidate_qvac_session_cache();
    f()
}

#[cfg(feature = "llama_cpp")]
pub fn generate_routing_vector(user: &str) -> Result<[i8; PASS1_VECTOR_LEN], String> {
    imp::generate_routing_vector_impl(user)
}

#[cfg(feature = "llama_cpp")]
pub fn run_pass2_qvac(
    user_prompt: &str,
    coefficients: &[i8; PASS2_COEFF_LEN],
    max_new_tokens: usize,
    initial_pass_2_prompt: Option<&str>,
    sampling: Pass2SamplingOptions,
) -> Result<String, String> {
    imp::run_pass2_qvac_impl(
        user_prompt,
        coefficients,
        max_new_tokens,
        initial_pass_2_prompt,
        sampling,
    )
}

/// Hook after the user changes hardware mode (persisted + env updated). Extend here if a
/// process-wide cached `LlamaContext` is added later.
#[cfg(feature = "llama_cpp")]
pub fn on_hardware_preference_changed() {
    let _guard = OTONOME_INFERENCE_MUTEX
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    imp::invalidate_qvac_session_cache();
    imp::invalidate_base_only_engine_cache();
    log::info!(
        "hardware preference updated; QVAC + base-engine thread caches cleared; next init uses new OTONOME_N_GPU_LAYERS / GGML_VK_VISIBLE_DEVICES"
    );
}

#[cfg(not(feature = "llama_cpp"))]
pub fn on_hardware_preference_changed() {}
