//! Element-wise composition of up to 27 standard LoRA GGUF adapters.
#![cfg_attr(not(feature = "llama_cpp"), allow(dead_code))]
//!
//! For each tensor name present in the participating adapters, we compute:
//! `out[i] = clamp_{[-1,1]}( sum_k  c_k * x_k[i] )` where `c_k ∈ {-1,0,1}` is the routing
//! coefficient for slot `k`, and `x_k` is that adapter's tensor decoded to `f32`.
//!
//! Output tensors are always **F32** in the composed GGUF (llama.cpp accepts F32 LoRA tensors).
//! Input tensors may be **F32** or **F16** (other types return an error until explicitly supported).

use gguf_rs_lib::builder::gguf_builder::GGUFBuilder;
use gguf_rs_lib::reader::file_reader::GGUFFileReader;
use gguf_rs_lib::tensor::TensorType;
use std::collections::BTreeSet;
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};

pub const PLUGIN_SLOT_COUNT: usize = 27;

/// Strict element clamp to [-1, 1] for composed delta weights (BitNet / ternary envelope).
#[inline]
pub fn clamp_delta_weight(x: f32) -> f32 {
    if x > 1.0 {
        1.0
    } else if x < -1.0 {
        -1.0
    } else {
        x
    }
}

fn decode_tensor_to_f32(tensor_type: TensorType, raw: &[u8], tensor_name: &str) -> std::result::Result<Vec<f32>, String> {
    let n_elem = match tensor_type {
        TensorType::F32 => raw.len() / 4,
        TensorType::F16 => raw.len() / 2,
        TensorType::BF16 => raw.len() / 2,
        _ => {
            return Err(format!(
                "tensor {tensor_name:?}: unsupported GGUF element type {:?} for compose (add F16/F32/BF16 support as needed)",
                tensor_type
            ));
        }
    };

    let mut out = Vec::with_capacity(n_elem);
    match tensor_type {
        TensorType::F32 => {
            if raw.len() != n_elem * 4 {
                return Err(format!("tensor {tensor_name:?}: corrupt F32 payload"));
            }
            for chunk in raw.chunks_exact(4) {
                out.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
            }
        }
        TensorType::F16 => {
            for chunk in raw.chunks_exact(2) {
                let h = half::f16::from_le_bytes([chunk[0], chunk[1]]);
                out.push(h.to_f32());
            }
        }
        TensorType::BF16 => {
            for chunk in raw.chunks_exact(2) {
                let w = u16::from_le_bytes([chunk[0], chunk[1]]);
                out.push(half::bf16::from_bits(w).to_f32());
            }
        }
        _ => unreachable!(),
    }
    Ok(out)
}

fn open_reader(path: &Path) -> std::result::Result<GGUFFileReader<BufReader<File>>, String> {
    let f = File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let r = BufReader::new(f);
    GGUFFileReader::new(r).map_err(|e| format!("GGUF parse {}: {e}", path.display()))
}

/// Compose LoRA GGUFs from 27 slots into `out_path`.
///
/// - `coefficients[i]` scales plugin `paths[i]` by {-1,0,1}. Zero skips that slot.
/// - If `coefficients[i] != 0` and `paths[i]` is `None` or missing on disk → error.
/// - Tensor union: every participating file must define the same shape for each shared tensor name.
pub fn compose_plugin_loras_to_path(
    coefficients: &[i8; PLUGIN_SLOT_COUNT],
    paths: &[Option<PathBuf>; PLUGIN_SLOT_COUNT],
    out_path: &Path,
) -> std::result::Result<(), String> {
    let mut active: Vec<(usize, i8, PathBuf)> = Vec::new();
    for i in 0..PLUGIN_SLOT_COUNT {
        let c = coefficients[i].clamp(-1, 1);
        if c == 0 {
            continue;
        }
        let p = paths[i]
            .as_ref()
            .ok_or_else(|| format!("non-zero coefficient at slot {i} but no plugin path configured"))?;
        if !p.is_file() {
            return Err(format!(
                "non-zero coefficient at slot {i} but plugin file missing: {}",
                p.display()
            ));
        }
        active.push((i, c, p.clone()));
    }
    active.sort_by_key(|(slot, _, _)| *slot);

    if active.is_empty() {
        return Err("compose_plugin_loras_to_path: no active plugins (all coefficients are 0)".into());
    }

    // Union of tensor names (stable order).
    let mut names: BTreeSet<String> = BTreeSet::new();
    for (_, _, p) in &active {
        let reader = open_reader(p)?;
        for t in reader.tensor_infos() {
            names.insert(t.name().to_string());
        }
    }

    // Clone metadata from the first participating adapter so llama.cpp sees a valid LoRA header.
    let first_reader = open_reader(&active[0].2)?;
    let mut builder = GGUFBuilder::new();
    for (k, v) in first_reader.metadata().data.iter() {
        builder = builder.add_metadata(k.clone(), v.clone());
    }

    for name in names.iter() {
        let mut acc: Option<(Vec<u64>, Vec<f32>)> = None;

        for &(_slot, coeff, ref path) in &active {
            if coeff == 0 {
                continue;
            }
            let mut reader = open_reader(path)?;
            let (expected_size, tensor_type, shape_dims, n) = match reader.get_tensor_info(name) {
                Some(info) => (
                    info.expected_data_size() as usize,
                    info.tensor_type(),
                    info.shape().dimensions.clone(),
                    info.element_count() as usize,
                ),
                None => continue,
            };
            let raw = reader
                .load_tensor_data(name)
                .map_err(|e| format!("{e:?}"))?
                .ok_or_else(|| format!("tensor {name:?}: empty data in {}", path.display()))?;
            let bytes = raw.as_slice();
            if bytes.len() != expected_size {
                return Err(format!(
                    "tensor {name:?}: size mismatch in {} (expected {}, got {})",
                    path.display(),
                    expected_size,
                    bytes.len()
                ));
            }
            let vec_f32 = decode_tensor_to_f32(tensor_type, bytes, name)?;
            if vec_f32.len() != n {
                return Err(format!(
                    "tensor {name:?}: decoded {} elements, expected {}",
                    vec_f32.len(),
                    n
                ));
            }

            match &mut acc {
                None => {
                    let mut v = vec![0f32; n];
                    for j in 0..n {
                        v[j] = coeff as f32 * vec_f32[j];
                    }
                    acc = Some((shape_dims, v));
                }
                Some((shape_ref, buf)) => {
                    if shape_ref != &shape_dims {
                        return Err(format!(
                            "tensor {name:?}: shape mismatch between adapters ({shape_ref:?} vs {shape_dims:?})"
                        ));
                    }
                    if buf.len() != vec_f32.len() {
                        return Err(format!("tensor {name:?}: length mismatch during accumulate"));
                    }
                    for j in 0..n {
                        buf[j] += coeff as f32 * vec_f32[j];
                    }
                }
            }
        }

        let Some((shape_dims, mut buf)) = acc else {
            continue;
        };
        for x in &mut buf {
            *x = clamp_delta_weight(*x);
        }
        builder = builder.add_f32_tensor(name.clone(), shape_dims, buf);
    }

    builder
        .build_to_file(out_path)
        .map_err(|e| format!("write composed GGUF {}: {e}", out_path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use gguf_rs_lib::format::metadata::MetadataValue;
    use std::io::Write;

    fn write_f32_plugin(path: &Path, w: &[f32]) -> std::result::Result<(), String> {
        let builder = GGUFBuilder::simple("test_lora", "synthetic")
            .add_metadata("test.kind", MetadataValue::String("fixture".into()))
            .add_f32_tensor("lora.test.weight", vec![w.len() as u64], w.to_vec());
        let (bytes, _) = builder.build_to_bytes().map_err(|e| e.to_string())?;
        let mut f = File::create(path).map_err(|e| e.to_string())?;
        f.write_all(&bytes).map_err(|e| e.to_string())?;
        Ok(())
    }

    #[test]
    fn compose_add_then_clamp_to_one() {
        let dir = tempfile::tempdir().unwrap();
        let p0 = dir.path().join("p0.gguf");
        let p1 = dir.path().join("p1.gguf");
        write_f32_plugin(&p0, &[0.7, 0.8, 0.9]).unwrap();
        write_f32_plugin(&p1, &[0.6, 0.6, 0.6]).unwrap();

        let mut paths: [Option<PathBuf>; PLUGIN_SLOT_COUNT] = Default::default();
        paths[0] = Some(p0);
        paths[1] = Some(p1);
        let mut coeff = [0i8; PLUGIN_SLOT_COUNT];
        coeff[0] = 1;
        coeff[1] = 1;

        let out = dir.path().join("composed.gguf");
        compose_plugin_loras_to_path(&coeff, &paths, &out).unwrap();

        let mut reader = open_reader(&out).unwrap();
        let data = reader.load_tensor_data("lora.test.weight").unwrap().unwrap();
        let bytes = data.as_slice();
        let v = decode_tensor_to_f32(TensorType::F32, bytes, "lora.test.weight").unwrap();
        assert_eq!(v.len(), 3);
        assert!((v[0] - 1.0).abs() < 1e-5, "expected clamp 1.3 -> 1.0, got {}", v[0]);
        assert!((v[1] - 1.0).abs() < 1e-5);
        assert!((v[2] - 1.0).abs() < 1e-5);
    }

    #[test]
    fn compose_subtract_and_clamp_negative() {
        let dir = tempfile::tempdir().unwrap();
        let p0 = dir.path().join("p0.gguf");
        let p1 = dir.path().join("p1.gguf");
        write_f32_plugin(&p0, &[1.0, -0.5, 0.25]).unwrap();
        write_f32_plugin(&p1, &[0.5, 1.0, 0.25]).unwrap();

        let mut paths: [Option<PathBuf>; PLUGIN_SLOT_COUNT] = Default::default();
        paths[0] = Some(p0);
        paths[1] = Some(p1);
        let mut coeff = [0i8; PLUGIN_SLOT_COUNT];
        coeff[0] = 1;
        coeff[1] = -1;

        let out = dir.path().join("composed.gguf");
        compose_plugin_loras_to_path(&coeff, &paths, &out).unwrap();

        let mut reader = open_reader(&out).unwrap();
        let data = reader.load_tensor_data("lora.test.weight").unwrap().unwrap();
        let bytes = data.as_slice();
        let v = decode_tensor_to_f32(TensorType::F32, bytes, "lora.test.weight").unwrap();
        assert!((v[0] - 0.5).abs() < 1e-5);
        assert!((v[1] - (-1.0)).abs() < 1e-5, "expected -1.5 clamped to -1, got {}", v[1]);
        assert!((v[2] - 0.0).abs() < 1e-5);
    }

    #[test]
    fn compose_f16_inputs_dequantized_then_clamped() {
        let dir = tempfile::tempdir().unwrap();
        let p0 = dir.path().join("p0.gguf");
        let mut f16bytes = Vec::new();
        for &x in &[1.0f32, 1.0f32] {
            let h = half::f16::from_f32(x);
            f16bytes.extend_from_slice(&h.to_le_bytes());
        }
        let builder = GGUFBuilder::simple("t", "t")
            .add_tensor("lora.h.weight", vec![2], TensorType::F16, f16bytes)
            .expect("add F16 tensor");
        let (bytes0, _) = builder.build_to_bytes().unwrap();
        std::fs::write(&p0, bytes0).unwrap();

        let p1 = dir.path().join("p1.gguf");
        write_f32_plugin(&p1, &[0.5, 0.5]).unwrap();

        let mut paths: [Option<PathBuf>; PLUGIN_SLOT_COUNT] = Default::default();
        paths[0] = Some(p0);
        paths[1] = Some(p1);
        let mut coeff = [0i8; PLUGIN_SLOT_COUNT];
        coeff[0] = 1;
        coeff[1] = 1;

        let out = dir.path().join("composed.gguf");
        compose_plugin_loras_to_path(&coeff, &paths, &out).unwrap();

        let mut reader = open_reader(&out).unwrap();
        let data = reader.load_tensor_data("lora.h.weight").unwrap().unwrap();
        let bytes = data.as_slice();
        let v = decode_tensor_to_f32(TensorType::F32, bytes, "lora.h.weight").unwrap();
        assert_eq!(v.len(), 2);
        assert!((v[0] - 1.0).abs() < 1e-3);
        assert!((v[1] - 1.0).abs() < 1e-3);
    }

    #[test]
    fn nonzero_without_path_errors() {
        let dir = tempfile::tempdir().unwrap();
        let paths: [Option<PathBuf>; PLUGIN_SLOT_COUNT] = Default::default();
        let mut coeff = [0i8; PLUGIN_SLOT_COUNT];
        coeff[3] = 1;
        let out = dir.path().join("composed.gguf");
        let e = compose_plugin_loras_to_path(&coeff, &paths, &out).unwrap_err();
        assert!(e.contains("slot 3"));
    }
}
