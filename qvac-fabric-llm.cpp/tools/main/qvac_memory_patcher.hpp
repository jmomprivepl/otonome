#pragma once

#include "llama.h"

#include <cstdint>
#include <string>
#include <vector>

/// RAM backup / linear adapter merge / restore for a single F32 `ggml_tensor` (e.g. FFN weight).
///
/// Intended use with llama-cli (see `main.cpp`):
/// - **Session scope:** snapshot pristine weights, apply `sum_i coeff[i] * adapter_i` once, run the
///   entire generation loop (all `llama_decode` calls), then restore in the destructor.
///   Per-token snapshot/restore around each `llama_decode` would destroy merged weights between steps.
///
/// Adapter files: `<nsdar_adapters_dir>/<index>.bin` where `<index>` matches the position in
/// `--nsdar-vector` (0-based). Coefficients must be -1, 0, or 1. Skips missing files when coeff is 0.
///
/// `.bin` layout: flat row-major data, either `nelements × float32` or `nelements × int8`
/// (chosen from file size vs `ggml_nelements`). Target tensor must be `GGML_TYPE_F32`.
namespace qvac_memory_patcher {

/// `blk.{layer}.{suffix}` unless `suffix` already starts with `blk.`.
std::string make_nsdar_tensor_name(int layer, const std::string & ffn_suffix);

std::vector<int8_t> parse_nsdar_vector(const std::string & s, std::string & err_msg);

struct session {
    struct llama_model * model = nullptr;
    struct ggml_tensor * tensor = nullptr;
    std::vector<uint8_t> backup;
    bool active = false;

    /// Resolve tensor by name; does not copy yet.
    bool init(struct llama_model * mdl, const std::string & tensor_name);

    /// Snapshot current tensor bytes, then `memcpy` them back and add `sum coeff[k] * adapter_k`.
    /// Call once before the first `llama_decode` of a run.
    bool apply(const std::vector<int8_t> & coeffs, const std::string & adapters_dir, std::string & err_msg);

    void restore();

    ~session();
};

} // namespace qvac_memory_patcher
