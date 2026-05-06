# Persona plugin binary format (QVP1)

Version 1. Used by `llama-cli --persona-plugin` for the double-inference flow: snapshot base weights, apply a ternary (or raw) overlay, run decode, then restore.

## Tensor naming

- Default target: `blk.{L}.{suffix}` where `L` is `--persona-layer` (default `0`) and `suffix` defaults to `attn_q.weight` (BitNet attention Q projection in this fork).
- If `tensor_suffix` in the header starts with `blk.`, it is treated as a **full** GGUF tensor name and `layer` is ignored for naming.

## Header (little-endian, 128 bytes)

| Offset | Size | Field |
|--------|------|--------|
| 0 | 4 | Magic ASCII `QVP1` |
| 4 | 4 | `version` (must be `1`) |
| 8 | 4 | `merge_mode` — `0` = raw replace (`payload` must equal `ggml_nbytes(tensor)`); `1` = F32 delta (see below) |
| 12 | 4 | `layer` — block index for default name construction |
| 16 | 4 | `reserved` (0) |
| 20 | 64 | `tensor_suffix` — NUL-terminated, e.g. `attn_q.weight` |
| 84 | 4 | `delta_scale` (float32) — scale for mode `1` |
| 88 | 8 | `payload_size` (uint64) |
| 96 | 32 | `reserved2` (0) |

Total header: **128 bytes**. Payload follows immediately.

## Merge mode 0 (raw replace)

- `payload_size` must equal `ggml_nbytes(target_tensor)`.
- Payload is copied verbatim over the tensor’s buffer (same layout as in RAM / GGUF for that type).

## Merge mode 1 (F32 ternary delta)

- Target tensor type must be `GGML_TYPE_F32`.
- `payload_size` must equal `ggml_nelements(tensor)` (each byte is a ternary `-1`, `0`, or `1`).
- Update: `w[i] += delta_scale * float(plugin[i])` where `plugin[i]` is clamped to `{-1,0,1}`.

## Quantized / non-F32 models

- Mode `1` is rejected with a warning unless the resolved tensor is F32.
- Mode `0` can still be used if you ship a byte-exact payload matching the tensor’s on-disk layout.

## RAM / backend notes

- Snapshot/restore uses `memcpy` on `ggml_get_data(tensor)`. This is appropriate for **CPU-mapped** weights; **GPU-resident** tensors may require backend-specific readback (not implemented in v1).
- Prefer `--gpu-layers 0` when testing persona swap on discrete GPUs until backend support exists.

## 32-parameter router (app layer)

The symbolic router lives in the Tauri app ([`src-tauri/src/ternary_router.rs`](../../src-tauri/src/ternary_router.rs)). It maps text to a **32-coefficient** ternary vector (parameters 1–32, stored as `v[0]..v[31]`) and an adapter id; it passes `--persona-plugin <path>` to `llama-cli` when a persona is configured, and may emit `--nsdar-vector` as a comma-separated list of **32** values for QVAC’s linear NSDAR merge. Indices **`v[27]`..`v[31]`** (parameters 28–32) are reserved for future routing / adapter slots and default to zero until tuned. The “32” here is the **NSDAR coefficient vector** size, not 32 separate QVP1 persona files. Plugin files can be generated offline to match the QVP1 format above.
