//! Resolve paths relative to the repo root when the process cwd is `src-tauri/` or `target/debug/`.
//!
//! Vite injects `VITE_LLAMA_MODEL_PATH` as a path under the workspace; `tauri dev` often leaves
//! `std::env::current_dir()` at `src-tauri/`, so a plain join would miss `../bitnet-…`.

use std::path::{Path, PathBuf};

const MAX_ANCESTOR_HOPS: usize = 12;

fn try_resolve_from_anchor(mut anchor: PathBuf, relative: &Path, want_dir: bool) -> Option<PathBuf> {
    for _ in 0..MAX_ANCESTOR_HOPS {
        let candidate = anchor.join(relative);
        if want_dir {
            if candidate.is_dir() {
                return Some(candidate);
            }
        } else if candidate.is_file() {
            return Some(candidate);
        }
        anchor = anchor.parent()?.to_path_buf();
    }
    None
}

/// Resolve a relative path to an existing file by walking from [`std::env::current_dir`] upward.
/// Absolute paths are returned unchanged.
pub fn resolve_repo_relative_file(p: &Path) -> PathBuf {
    if p.is_absolute() {
        return p.to_path_buf();
    }
    if let Ok(cwd) = std::env::current_dir() {
        if let Some(hit) = try_resolve_from_anchor(cwd, p, false) {
            return hit;
        }
    }
    #[cfg(debug_assertions)]
    if let Some(root) = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().map(Path::to_path_buf) {
        if let Some(hit) = try_resolve_from_anchor(root, p, false) {
            return hit;
        }
    }
    std::env::current_dir().map_or_else(|_| p.to_path_buf(), |cwd| cwd.join(p))
}

/// Same idea as [`resolve_repo_relative_file`] but for an existing directory.
pub fn resolve_repo_relative_dir(p: &Path) -> PathBuf {
    if p.is_absolute() {
        return p.to_path_buf();
    }
    if let Ok(cwd) = std::env::current_dir() {
        if let Some(hit) = try_resolve_from_anchor(cwd, p, true) {
            return hit;
        }
    }
    #[cfg(debug_assertions)]
    if let Some(root) = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().map(Path::to_path_buf) {
        if let Some(hit) = try_resolve_from_anchor(root, p, true) {
            return hit;
        }
    }
    std::env::current_dir().map_or_else(|_| p.to_path_buf(), |cwd| cwd.join(p))
}
