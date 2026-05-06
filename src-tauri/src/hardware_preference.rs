//! Persisted in-process llama.cpp device preference (CPU vs Vulkan iGPU/dGPU).
//!
//! Must match `identifier` in `tauri.conf.json` so CLI and Tauri resolve the same config directory
//! as [`tauri::path::PathResolver::app_config_dir`] (`dirs::config_dir()` + identifier).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

/// Tauri bundle identifier (`tauri.conf.json` → `identifier`).
const APP_IDENTIFIER: &str = "pro.workmates.app";
const CONFIG_FILE: &str = "hardware-preference.json";

/// Incremented when the user changes hardware mode so any future engine cache can invalidate.
pub static HARDWARE_PREFERENCE_EPOCH: AtomicU64 = AtomicU64::new(0);

/// What the in-process stack is configured to use (from disk + current process env).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InferenceHardwareSnapshot {
    /// Saved profile: `cpu`, `igpu`, or `dgpu`.
    pub profile: String,
    pub otonome_n_gpu_layers: Option<String>,
    pub ggml_vk_visible_devices: Option<String>,
    /// How this binary was built (e.g. `llama_cpp+vulkan`).
    pub llama_build: String,
}

/// `llama-cpp-2` feature set linked into this binary.
pub fn llama_build_kind() -> &'static str {
    if cfg!(not(feature = "llama_cpp")) {
        return "no_llama_cpp";
    }
    if cfg!(all(feature = "llama_cpp", feature = "llama_cpp_vulkan")) {
        return "llama_cpp+vulkan";
    }
    if cfg!(all(
        feature = "llama_cpp",
        feature = "llama_cpp_cuda",
        not(feature = "llama_cpp_vulkan")
    )) {
        return "llama_cpp+cuda";
    }
    "llama_cpp+cpu"
}

pub fn inference_hardware_snapshot() -> InferenceHardwareSnapshot {
    InferenceHardwareSnapshot {
        profile: load().as_str().to_string(),
        otonome_n_gpu_layers: std::env::var("OTONOME_N_GPU_LAYERS").ok(),
        ggml_vk_visible_devices: std::env::var("GGML_VK_VISIBLE_DEVICES").ok(),
        llama_build: llama_build_kind().to_string(),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HardwarePreference {
    Cpu,
    Igpu,
    Dgpu,
}

impl Default for HardwarePreference {
    fn default() -> Self {
        HardwarePreference::Igpu
    }
}

impl HardwarePreference {
    pub fn as_str(self) -> &'static str {
        match self {
            HardwarePreference::Cpu => "cpu",
            HardwarePreference::Igpu => "igpu",
            HardwarePreference::Dgpu => "dgpu",
        }
    }

    pub fn parse(mode: &str) -> Result<Self, String> {
        match mode.trim().to_ascii_lowercase().as_str() {
            "cpu" => Ok(HardwarePreference::Cpu),
            "igpu" => Ok(HardwarePreference::Igpu),
            "dgpu" => Ok(HardwarePreference::Dgpu),
            other => Err(format!(
                "unknown hardware mode {other:?}: expected \"cpu\", \"igpu\", or \"dgpu\""
            )),
        }
    }

    /// Apply process environment before `LlamaBackend::init` / `LlamaModel::load_from_file`.
    pub fn apply_env(self) {
        match self {
            HardwarePreference::Cpu => {
                std::env::set_var("OTONOME_N_GPU_LAYERS", "0");
                // Note: unsetting `GGML_VK_VISIBLE_DEVICES` still lets a **Vulkan-linked** binary
                // enumerate all Vulkan devices; `OTONOME_N_GPU_LAYERS=0` only avoids GGUF layer offload.
                // To match plain CPU `llama-cli.exe`, run a Tauri **CPU** feature build
                // (`npm run tauri:dev`, not `…:vulkan`). Full “no Vulkan in process” requires a `llama_cpp`
                // build without `llama_cpp_vulkan` (see `Cargo.toml` features).
                std::env::remove_var("GGML_VK_VISIBLE_DEVICES");
            }
            HardwarePreference::Igpu => {
                std::env::set_var("OTONOME_N_GPU_LAYERS", "999");
                std::env::set_var("GGML_VK_VISIBLE_DEVICES", "0");
            }
            HardwarePreference::Dgpu => {
                std::env::set_var("OTONOME_N_GPU_LAYERS", "999");
                std::env::set_var("GGML_VK_VISIBLE_DEVICES", "1");
            }
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct HardwarePreferenceFile {
    mode: HardwarePreference,
}

fn app_config_root() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join(APP_IDENTIFIER))
}

fn config_file_path() -> Option<PathBuf> {
    app_config_root().map(|d| d.join(CONFIG_FILE))
}

/// Read saved preference, or [`HardwarePreference::default`] if missing / invalid.
pub fn load() -> HardwarePreference {
    let Some(path) = config_file_path() else {
        return HardwarePreference::default();
    };
    let Ok(bytes) = fs::read(&path) else {
        return HardwarePreference::default();
    };
    serde_json::from_slice::<HardwarePreferenceFile>(&bytes)
        .map(|f| f.mode)
        .unwrap_or_default()
}

/// Persist preference next to other app config (same root as Tauri `app_config_dir`).
pub fn save(preference: HardwarePreference) -> Result<(), String> {
    let Some(root) = app_config_root() else {
        return Err("could not resolve config directory".into());
    };
    let path = root.join(CONFIG_FILE);
    fs::create_dir_all(&root).map_err(|e| format!("create config dir {}: {e}", root.display()))?;
    let body = serde_json::to_vec_pretty(&HardwarePreferenceFile { mode: preference })
        .map_err(|e| format!("serialize hardware preference: {e}"))?;
    fs::write(&path, body).map_err(|e| format!("write {}: {e}", path.display()))?;
    log::info!("saved hardware preference to {}", path.display());
    HARDWARE_PREFERENCE_EPOCH.fetch_add(1, Ordering::Release);
    Ok(())
}

/// Load from disk and apply env vars (call immediately before loading the GGUF).
#[cfg_attr(not(feature = "llama_cpp"), allow(dead_code))]
pub fn load_and_apply_for_model_init() {
    let p = load();
    p.apply_env();
    log::info!(
        "hardware preference {:?}: OTONOME_N_GPU_LAYERS={:?} GGML_VK_VISIBLE_DEVICES={:?}",
        p.as_str(),
        std::env::var("OTONOME_N_GPU_LAYERS").ok(),
        std::env::var("GGML_VK_VISIBLE_DEVICES").ok(),
    );
}

/// Save, apply env, and bump epoch so callers can drop cached engines.
pub fn set_from_user_choice(mode: &str) -> Result<HardwarePreference, String> {
    let p = HardwarePreference::parse(mode)?;
    save(p)?;
    p.apply_env();
    log::warn!(
        "hardware preference set to {:?}. Next model load uses new env vars; \
         if Vulkan already initialized in this process, restart the app once to re-read GGML_VK_VISIBLE_DEVICES.",
        p.as_str()
    );
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_roundtrip() {
        assert_eq!(HardwarePreference::parse("CPU").unwrap(), HardwarePreference::Cpu);
        assert_eq!(HardwarePreference::parse("iGPU").unwrap(), HardwarePreference::Igpu);
    }
}
