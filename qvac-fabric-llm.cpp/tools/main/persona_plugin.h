#pragma once

#include "llama.h"

#include <cstdint>
#include <string>
#include <vector>

/// Snapshot / merge / restore for QVP1 persona plugins (see docs/persona-plugin-format.md).
struct persona_session {
    struct llama_model * model = nullptr;
    struct ggml_tensor * tensor = nullptr;
    std::vector<uint8_t> backup;
    bool active = false;

    /// Load plugin, snapshot tensor, apply merge. Returns false on error (logs to LOG_WRN/ERR).
    bool apply_from_file(struct llama_model * mdl, const std::string & path, int layer_override, const std::string & default_suffix);

    /// Restore from backup; safe to call multiple times.
    void rollback();

    /// Log tensor type and size; optionally verify round-trip memcpy (no plugin).
    static bool dry_run_tensor(struct llama_model * mdl, const std::string & tensor_name);
};
