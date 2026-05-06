//! Pass 2 dummy LoRA adapter fixtures (development).
//!
//! llama.cpp validates LoRA GGUFs strictly (see `llama.cpp/src/llama-adapter.cpp`):
//! - `general.type` must be `"adapter"`
//! - `adapter.type` must be `"lora"`
//! - `general.architecture` must match the base model
//! - tensors must be named like `<base_tensor_name>.lora_a` / `.lora_b` where `<base_tensor_name>`
//!   exists in the base model, with shapes compatible with that tensor.
//!
//! We generate **32** tiny rank-1 LoRA pairs targeting a small 2D base weight tensor picked from the
//! base GGUF (preferring small matrices). Tensor shapes follow `llama.cpp`'s non-embedding LoRA rules
//! (`lora_a` is `(n0, r)`, `lora_b` is `(r, n1)` for a `(n0, n1)` base weight).

use gguf_rs_lib::builder::gguf_builder::GGUFBuilder;
use gguf_rs_lib::format::metadata::MetadataValue;
use gguf_rs_lib::reader::file_reader::GGUFFileReader;
use gguf_rs_lib::tensor::TensorType;
use half::f16;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const SLOT_COUNT: usize = 32;

/// Bumped when dummy tensor layout/metadata must change so existing fixtures are rewritten.
const DUMMY_LAYOUT_VERSION: u32 = 3;

fn open_reader(path: &Path) -> Result<GGUFFileReader<BufReader<File>>, String> {
    let f = File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let r = BufReader::new(f);
    GGUFFileReader::new(r).map_err(|e| format!("GGUF parse {}: {e}", path.display()))
}

// --- Minimal streaming GGUF metadata + tensor-info reader --------------------------------------
//
// `gguf-rs-lib` bails on the bitnet base model in two ways:
//   1. Its hard cap of 65 536 elements per metadata array rejects the 128 256-element vocab arrays
//      (`tokenizer.ggml.tokens`, etc.).
//   2. Its `GGUFTensorType` enum stops at value 31; the bitnet base uses TQ1_0 (value 34) which is
//      "unknown".
//
// For Pass 2 dummy adapter generation we only need:
//   - `general.architecture` (string), to stamp into the dummy adapter header.
//   - One `<base>.weight` 2D tensor name + dimensions, so the dummy lora_a/lora_b shapes match.
//
// Both can be obtained without instantiating the full vocab arrays, and without resolving the
// base tensor's quantization type (we always emit F16 LoRA pairs, which llama.cpp accepts for any
// base type the adapter loader supports).

const GGUF_MAGIC: u32 = 0x4655_4747; // 'GGUF' little-endian

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GValueType {
    U8 = 0, I8 = 1, U16 = 2, I16 = 3, U32 = 4, I32 = 5, F32 = 6,
    Bool = 7, String = 8, Array = 9, U64 = 10, I64 = 11, F64 = 12,
}

impl GValueType {
    fn from_u32(v: u32) -> Result<Self, String> {
        Ok(match v {
            0 => Self::U8, 1 => Self::I8, 2 => Self::U16, 3 => Self::I16,
            4 => Self::U32, 5 => Self::I32, 6 => Self::F32, 7 => Self::Bool,
            8 => Self::String, 9 => Self::Array,
            10 => Self::U64, 11 => Self::I64, 12 => Self::F64,
            other => return Err(format!("unknown GGUF value type: {other}")),
        })
    }

    fn fixed_size(self) -> Option<u64> {
        Some(match self {
            Self::U8 | Self::I8 | Self::Bool => 1,
            Self::U16 | Self::I16 => 2,
            Self::U32 | Self::I32 | Self::F32 => 4,
            Self::U64 | Self::I64 | Self::F64 => 8,
            Self::String | Self::Array => return None,
        })
    }
}

struct StreamReader<R: Read + Seek> {
    inner: R,
}

impl<R: Read + Seek> StreamReader<R> {
    fn new(inner: R) -> Self { Self { inner } }

    fn read_u32(&mut self) -> Result<u32, String> {
        let mut b = [0u8; 4];
        self.inner.read_exact(&mut b).map_err(|e| format!("read u32: {e}"))?;
        Ok(u32::from_le_bytes(b))
    }
    fn read_u64(&mut self) -> Result<u64, String> {
        let mut b = [0u8; 8];
        self.inner.read_exact(&mut b).map_err(|e| format!("read u64: {e}"))?;
        Ok(u64::from_le_bytes(b))
    }
    fn read_string(&mut self) -> Result<String, String> {
        let len = self.read_u64()? as usize;
        // Sanity guard against absurd lengths (1 GB cap is plenty for any GGUF key/string value).
        if len > 1 << 30 {
            return Err(format!("GGUF string length absurd: {len}"));
        }
        let mut bytes = vec![0u8; len];
        self.inner.read_exact(&mut bytes).map_err(|e| format!("read string body: {e}"))?;
        String::from_utf8(bytes).map_err(|e| format!("GGUF string not UTF-8: {e}"))
    }

    /// Skip `n` bytes forward from the current position.
    fn skip(&mut self, n: u64) -> Result<(), String> {
        self.inner
            .seek(SeekFrom::Current(n as i64))
            .map(|_| ())
            .map_err(|e| format!("seek skip {n}: {e}"))
    }

    /// Skip a single value of the given metadata type (no value retained in memory).
    fn skip_value(&mut self, ty: GValueType) -> Result<(), String> {
        match ty {
            GValueType::String => {
                let len = self.read_u64()?;
                self.skip(len)?;
            }
            GValueType::Array => {
                let elem_ty = GValueType::from_u32(self.read_u32()?)?;
                let count = self.read_u64()?;
                match elem_ty {
                    GValueType::String => {
                        for _ in 0..count {
                            let len = self.read_u64()?;
                            self.skip(len)?;
                        }
                    }
                    GValueType::Array => {
                        // Nested arrays are technically allowed; recurse element-wise.
                        for _ in 0..count {
                            self.skip_value(GValueType::Array)?;
                        }
                    }
                    primitive => {
                        let sz = primitive.fixed_size().expect("primitive has fixed size");
                        self.skip(sz.saturating_mul(count))?;
                    }
                }
            }
            primitive => {
                let sz = primitive.fixed_size().expect("primitive has fixed size");
                self.skip(sz)?;
            }
        }
        Ok(())
    }
}

/// 2D weight tensor info needed to generate a shape-compatible dummy LoRA pair.
#[derive(Debug, Clone)]
struct BaseProbe {
    architecture: String,
    target_name: String,
    target_n0: u64,
    target_n1: u64,
}

/// Walk the base GGUF header just far enough to find `general.architecture` and a small 2D weight.
///
/// Skips any metadata array (including the 128k-element vocab arrays in bitnet) without
/// materializing it, and tolerates tensor types that aren't in `gguf-rs-lib`'s enum (TQ1_0, etc.).
fn probe_base_model(path: &Path) -> Result<BaseProbe, String> {
    let f = File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut r = StreamReader::new(BufReader::new(f));

    let magic = r.read_u32()?;
    if magic != GGUF_MAGIC {
        return Err(format!("not a GGUF file (bad magic 0x{magic:08x}): {}", path.display()));
    }
    let version = r.read_u32()?;
    if version != 2 && version != 3 {
        return Err(format!("unsupported GGUF version {version} in {}", path.display()));
    }
    let tensor_count = r.read_u64()?;
    let kv_count = r.read_u64()?;

    let mut architecture: Option<String> = None;
    for _ in 0..kv_count {
        let key = r.read_string()?;
        let ty = GValueType::from_u32(r.read_u32()?)?;
        if key == "general.architecture" && ty == GValueType::String {
            architecture = Some(r.read_string()?);
        } else {
            r.skip_value(ty)?;
        }
    }

    // Tensor info section: pick the smallest 2D weight that isn't the embedding.
    let mut best: Option<(u128, String, u64, u64)> = None;
    for _ in 0..tensor_count {
        let name = r.read_string()?;
        let n_dims = r.read_u32()?;
        if n_dims > 8 {
            return Err(format!("absurd tensor n_dims={n_dims} for {name:?}"));
        }
        let mut dims = Vec::with_capacity(n_dims as usize);
        for _ in 0..n_dims {
            dims.push(r.read_u64()?);
        }
        let _tensor_type_raw = r.read_u32()?; // we don't need this
        let _offset = r.read_u64()?;

        if !name.ends_with(".weight") || name == "token_embd.weight" || name.contains("lora_") {
            continue;
        }
        if dims.len() != 2 {
            continue;
        }
        let n0 = dims[0];
        let n1 = dims[1];
        if n0 == 0 || n1 == 0 {
            continue;
        }
        let elems = (n0 as u128).saturating_mul(n1 as u128);
        // Bounded so the 32 dummy GGUFs stay tiny on disk and quick to (re)create.
        if elems > 8_000_000 {
            continue;
        }
        match &best {
            None => best = Some((elems, name, n0, n1)),
            Some((s, _, _, _)) if elems < *s => best = Some((elems, name, n0, n1)),
            _ => {}
        }
    }

    let Some((_, target_name, target_n0, target_n1)) = best else {
        return Err(format!(
            "no suitable 2D *.weight tensor in base model (excluding token_embd.weight): {}",
            path.display()
        ));
    };

    Ok(BaseProbe {
        architecture: architecture.unwrap_or_else(|| "llama".to_string()),
        target_name,
        target_n0,
        target_n1,
    })
}

fn zero_payload(tt: TensorType, n_elems: usize) -> Result<Vec<u8>, String> {
    match tt {
        TensorType::F32 => Ok(vec![0u8; n_elems * 4]),
        TensorType::F16 => {
            let z = f16::from_f32(0.0).to_le_bytes();
            let mut out = Vec::with_capacity(n_elems * 2);
            for _ in 0..n_elems {
                out.extend_from_slice(&z);
            }
            Ok(out)
        }
        TensorType::BF16 => {
            let z = half::bf16::from_f32(0.0).to_le_bytes();
            let mut out = Vec::with_capacity(n_elems * 2);
            for _ in 0..n_elems {
                out.extend_from_slice(&z);
            }
            Ok(out)
        }
        _ => Err(format!("unsupported tensor type for dummy LoRA payload: {tt:?}")),
    }
}

fn write_dummy_adapter(
    out: &Path,
    slot: usize,
    arch: &str,
    base_weight: &str,
    out_type: TensorType,
    n0: u64,
    n1: u64,
) -> Result<(), String> {
    // Rank-1 LoRA: r=1
    let r = 1u64;

    // Names must be `<base>.lora_a` / `<base>.lora_b` where `<base>` is an actual model tensor name.
    let lora_a = format!("{base_weight}.lora_a");
    let lora_b = format!("{base_weight}.lora_b");

    // Shapes for non-embedding weights (see `llama.cpp` `llama_adapter_lora_init_impl`):
    // - `model_tensor->ne[0] == lora_a->ne[0]` and `model_tensor->ne[1] == lora_b->ne[1]`
    // - `lora_a->ne[1] == lora_b->ne[0]` (rank `r` on the "inner" axis; `lora_a` is the transposed side)
    //
    // So for base weight dims `(n0, n1)` matching GGUF / ggml `ne[0], ne[1]`:
    // - `lora_a`: `(n0, r)`
    // - `lora_b`: `(r, n1)`
    let a_elems = (n0 as usize).saturating_mul(r as usize);
    let b_elems = (r as usize).saturating_mul(n1 as usize);

    let a_bytes = zero_payload(out_type, a_elems)?;
    let b_bytes = zero_payload(out_type, b_elems)?;

    let builder = GGUFBuilder::simple(format!("pass2_dummy_slot_{}", slot + 1), "synthetic")
        .add_metadata("general.type", MetadataValue::String("adapter".into()))
        .add_metadata("adapter.type", MetadataValue::String("lora".into()))
        .add_metadata("general.architecture", MetadataValue::String(arch.to_string()))
        .add_metadata("adapter.lora.alpha", MetadataValue::F32(1.0))
        .add_metadata("otonome.kind", MetadataValue::String("pass2_dummy_adapter".into()))
        .add_metadata("otonome.slot", MetadataValue::U32(slot as u32))
        .add_metadata(
            "otonome.pass2_dummy_layout",
            MetadataValue::U32(DUMMY_LAYOUT_VERSION),
        )
        .add_metadata("otonome.target_weight", MetadataValue::String(base_weight.to_string()))
        .add_tensor(
            lora_a,
            vec![n0, r],
            out_type,
            a_bytes,
        )
        .map_err(|e| format!("build tensor lora_a: {e}"))?
        .add_tensor(
            lora_b,
            vec![r, n1],
            out_type,
            b_bytes,
        )
        .map_err(|e| format!("build tensor lora_b: {e}"))?;

    builder
        .build_to_file(out)
        .map_err(|e| format!("write dummy adapter {}: {e}", out.display()))?;

    Ok(())
}

pub fn ensure_dummy_pass2_adapters(model_dir: &Path, base_model_path: &Path) -> Result<(), String> {
    if !model_dir.is_dir() {
        return Err(format!(
            "cannot create dummy Pass 2 adapters: not a directory: {}",
            model_dir.display()
        ));
    }
    if !base_model_path.is_file() {
        return Err(format!(
            "cannot create dummy Pass 2 adapters: base model not found: {}",
            base_model_path.display()
        ));
    }

    let probe = probe_base_model(base_model_path)?;
    let arch = probe.architecture;
    let target = probe.target_name;
    let n0 = probe.target_n0;
    let n1 = probe.target_n1;

    // Dummy LoRA pairs are always F16: that's the type llama.cpp's adapter loader handles for
    // arbitrary base tensor types (including ternary/IQ quants like the bitnet base's TQ1_0).
    let out_type = TensorType::F16;

    log::info!(
        "Pass 2 dummy adapters: using base tensor {:?} ({n0}x{n1}, {:?}) under arch {:?}",
        target,
        out_type,
        arch
    );

    for slot in 0..SLOT_COUNT {
        let file = format!("pass2-slot-{}.gguf", slot + 1);
        let out: PathBuf = model_dir.join(&file);

        // Regenerate obviously-invalid fixtures from earlier iterations.
        let mut regen = !out.is_file();
        if out.is_file() && !regen {
            if let Ok(r) = open_reader(&out) {
                let meta_ok = r.metadata().get("general.type").is_some()
                    && r.metadata().get("adapter.type").is_some()
                    && r.metadata().get("general.architecture").is_some();
                let layout_ok = r
                    .metadata()
                    .get("otonome.pass2_dummy_layout")
                    .and_then(|v| match v {
                        MetadataValue::U32(v) => Some(*v == DUMMY_LAYOUT_VERSION),
                        _ => None,
                    })
                    .unwrap_or(false);
                if !meta_ok || !layout_ok {
                    regen = true;
                }
            } else {
                regen = true;
            }
        }

        if !regen {
            continue;
        }

        write_dummy_adapter(&out, slot, &arch, &target, out_type, n0, n1)?;
        log::info!("Created dummy Pass 2 adapter: {}", out.display());
    }

    Ok(())
}
