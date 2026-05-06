//! In-process routing vector API (delegates to [`crate::otonome_llm`]).
//!
//! The Otonome engine keeps the base GGUF resident in RAM, attaches `router-lora.gguf` only for
//! Pass 1 routing inference, then removes it. Pass 2 generation uses the same engine via
//! `otonome_llm::run_pass2_qvac` (no LoRA; in-RAM QVAC patch path).

/// Generate the **32-parameter** ternary routing vector for a user string.
pub fn generate_routing_vector(user: &str) -> Result<[i8; 32], String> {
    crate::otonome_llm::generate_routing_vector(user)
}

/// Convenience: same as `generate_routing_vector`, but returns a Vec for JSON/IPC.
pub fn generate_routing_vector_vec(user: &str) -> Result<Vec<i8>, String> {
    let v = generate_routing_vector(user)?;
    Ok(v.to_vec())
}

#[tauri::command]
pub fn router_generate_routing_vector(user: String) -> Result<Vec<i8>, String> {
    #[cfg(feature = "llama_cpp")]
    {
        return crate::otonome_llm::with_otonome_inference_lock(|| {
            generate_routing_vector_vec(&user)
        });
    }
    #[cfg(not(feature = "llama_cpp"))]
    {
        generate_routing_vector_vec(&user)
    }
}
