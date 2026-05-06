//! Append-only local run ledger (Phase 1; on-prem audit export comes later).

use serde::Serialize;

#[derive(Serialize)]
pub struct RunStartedEvent<'a> {
    pub ts_ms: i64,
    pub run_id: &'a str,
    pub sop_id: Option<&'a str>,
    pub task_id: Option<&'a str>,
    pub user_request_len: usize,
}

fn ledger_path() -> Result<std::path::PathBuf, String> {
    if let Ok(dir_raw) = std::env::var("OTONOME_RUN_LEDGER_DIR") {
        let dir = std::path::PathBuf::from(dir_raw);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        return Ok(dir.join("runs.jsonl"));
    }

    let base =
        dirs::data_local_dir().ok_or_else(|| "no data_local_dir for platform".to_string())?;
    let dir = base.join("Work.otono.me").join("runs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("runs.jsonl"))
}

pub fn append_run_started(event: RunStartedEvent<'_>) -> Result<(), String> {
    let path = ledger_path()?;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("run ledger open failed ({}): {e}", path.display()))?;
    let line =
        serde_json::to_string(&event).map_err(|e| format!("run ledger serialize: {e}"))?;
    use std::io::Write as _;
    writeln!(f, "{line}").map_err(|e| format!("run ledger append: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    #[test]
    fn appends_jsonl_line() -> Result<(), String> {
        let _g = ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();

        let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
        let key = "OTONOME_RUN_LEDGER_DIR";

        struct EnvRestore {
            key: &'static str,
            prev: Option<std::ffi::OsString>,
        }

        impl Drop for EnvRestore {
            fn drop(&mut self) {
                match self.prev.take() {
                    Some(v) => std::env::set_var(self.key, v),
                    None => std::env::remove_var(self.key),
                }
            }
        }

        let prev = std::env::var_os(key);
        std::env::set_var(key, dir.path().as_os_str());
        let mut _restore = EnvRestore { key, prev };

        append_run_started(RunStartedEvent {
            ts_ms: 1,
            run_id: "r1",
            sop_id: None,
            task_id: None,
            user_request_len: 3,
        })?;

        let p = dir.path().join("runs.jsonl");
        let s = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
        assert!(s.trim().starts_with('{'));
        assert!(s.contains("r1"));

        Ok(())
    }
}
