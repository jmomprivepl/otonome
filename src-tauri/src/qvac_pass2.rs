//! QVAC Pass 2: dynamic multi-LoRA fusion at inference time.
//!
//! Pass 2 receives the 27 ternary routing coefficients from Pass 1 and applies the matching
//! per-slot LoRA GGUFs on the active llama.cpp context.
//!
//! - **0 active slots**: [`prepare_pass2_adapters`] returns [`None`]; run the base model.
//! - **1 active slot**: load that GGUF, attach with per-slot scale in {-1,0,1}.
//! - **2+ active slots**: element-wise compose into a temp GGUF via
//!   [`crate::lora_compose::compose_plugin_loras_to_path`], then attach at scale `1.0`.
//!
//! [`Pass2Prepared`] is separate from [`LlamaContext`] so the caller can hold `&mut LlamaContext`
//! for decode while still cleaning up adapters afterward (no overlapping `&` / `&mut` borrows).

use crate::lora_compose::PLUGIN_SLOT_COUNT;

#[cfg(feature = "llama_cpp")]
mod imp {
    use super::PLUGIN_SLOT_COUNT;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    use llama_cpp_2::context::LlamaContext;
    use llama_cpp_2::model::{LlamaLoraAdapter, LlamaModel};

    static COMPOSE_TMP_SEQ: AtomicU64 = AtomicU64::new(0);

    fn adapter_path_for_slot(slot: usize) -> PathBuf {
        fn models_dir() -> PathBuf {
            let raw = if let Some(p) = std::env::var_os("OTONOME_PASS2_ADAPTERS_DIR") {
                PathBuf::from(p)
            } else {
                std::env::var_os("ROUTER_MODELS_DIR")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from("bitnet-b1.58-2B-4T-gguf"))
            };
            if raw.is_absolute() {
                raw
            } else {
                crate::path_resolve::resolve_repo_relative_dir(raw.as_path())
            }
        }

        let template = std::env::var("OTONOME_PASS2_ADAPTER_TEMPLATE")
            .unwrap_or_else(|_| "pass2-slot-{slot1}.gguf".to_string());
        let file = template
            .replace("{slot1}", &(slot + 1).to_string())
            .replace("{slot}", &slot.to_string());
        models_dir().join(file)
    }

    /// Loaded adapter state (not yet attached, or attached — see [`Self::attach`] / [`Self::finish`]).
    pub struct Pass2Prepared {
        adapter: LlamaLoraAdapter,
        composed_tmp: Option<PathBuf>,
        scale: f32,
    }

    impl Pass2Prepared {
        /// Apply this adapter set to `ctx` (clears any prior adapters first).
        pub fn attach(&mut self, ctx: &LlamaContext<'_>) -> Result<(), String> {
            ctx.lora_adapter_remove(&mut self.adapter)
                .map_err(|e| format!("lora_adapter_remove(clear) failed: {e}"))?;
            ctx.lora_adapter_set(&mut self.adapter, self.scale)
                .map_err(|e| format!("lora_adapter_set failed: {e}"))?;
            Ok(())
        }

        /// Remove this adapter from `ctx` after a decode (next [`Self::attach`] will re-apply).
        pub fn detach(&mut self, ctx: &LlamaContext<'_>) -> Result<(), String> {
            ctx.lora_adapter_remove(&mut self.adapter)
                .map_err(|e| format!("lora_adapter_remove(detach) failed: {e}"))
        }

        /// Clear adapters from `ctx`, free the adapter, and delete any temp compose file.
        pub fn finish(mut self, ctx: &LlamaContext<'_>) {
            let _ = ctx.lora_adapter_remove(&mut self.adapter);
            if let Some(p) = self.composed_tmp.take() {
                let _ = fs::remove_file(&p);
            }
        }
    }

    /// Build adapter state from routing coefficients (does not touch [`LlamaContext`] yet).
    pub fn prepare_pass2_adapters(
        model: &LlamaModel,
        coefficients: &[i8; PLUGIN_SLOT_COUNT],
    ) -> Result<Option<Pass2Prepared>, String> {
        let mut active: Vec<(usize, i8, PathBuf)> = Vec::new();

        for (slot, &c_raw) in coefficients.iter().enumerate() {
            let c = c_raw.clamp(-1, 1);
            if c == 0 {
                continue;
            }
            let path = adapter_path_for_slot(slot);
            if !path.is_file() {
                return Err(format!(
                    "Pass 2 adapter missing for active slot {slot} (coeff {c}): {}",
                    path.display()
                ));
            }
            active.push((slot, c, path));
        }

        if active.is_empty() {
            log::info!("Pass 2: no active adapter slots; running base model");
            return Ok(None);
        }

        active.sort_by_key(|(s, _, _)| *s);

        if active.len() == 1 {
            let (_slot, c, path) = &active[0];
            log::info!(
                "Pass 2: prepared single LoRA adapter slot {} coeff {} file {}",
                _slot,
                c,
                path.display()
            );
            let adapter = model
                .lora_adapter_init(path)
                .map_err(|e| format!("LoRA init failed ({}): {e}", path.display()))?;
            return Ok(Some(Pass2Prepared {
                adapter,
                composed_tmp: None,
                scale: *c as f32,
            }));
        }

        let mut paths: [Option<PathBuf>; PLUGIN_SLOT_COUNT] = Default::default();
        let mut coeff_for_compose = [0i8; PLUGIN_SLOT_COUNT];
        for (slot, c, p) in &active {
            if *slot >= PLUGIN_SLOT_COUNT {
                return Err(format!(
                    "active slot index {slot} out of range (max {})",
                    PLUGIN_SLOT_COUNT - 1
                ));
            }
            paths[*slot] = Some(p.clone());
            coeff_for_compose[*slot] = *c;
        }

        let seq = COMPOSE_TMP_SEQ.fetch_add(1, Ordering::Relaxed);
        let tmp = std::env::temp_dir().join(format!(
            "otonome_pass2_compose_{}_{seq}.gguf",
            std::process::id()
        ));

        log::info!(
            "Pass 2: composing {} adapter(s) into {}",
            active.len(),
            tmp.display()
        );
        if let Err(e) = crate::lora_compose::compose_plugin_loras_to_path(&coeff_for_compose, &paths, &tmp) {
            let _ = fs::remove_file(&tmp);
            return Err(format!("compose Pass 2 adapters: {e}"));
        }

        let adapter = model
            .lora_adapter_init(&tmp)
            .map_err(|e| format!("LoRA init failed on composed file {}: {e}", tmp.display()))?;

        Ok(Some(Pass2Prepared {
            adapter,
            composed_tmp: Some(tmp),
            scale: 1.0,
        }))
    }
}

#[cfg(feature = "llama_cpp")]
pub use imp::{prepare_pass2_adapters, Pass2Prepared};

#[cfg(not(feature = "llama_cpp"))]
pub struct Pass2Prepared;

#[cfg(not(feature = "llama_cpp"))]
pub fn prepare_pass2_adapters(
    _model: &(),
    _coefficients: &[i8; PLUGIN_SLOT_COUNT],
) -> Result<Option<Pass2Prepared>, String> {
    Err("Pass 2 multi-LoRA fusion requires building with `--features llama_cpp`.".into())
}
