# Otonome Phase 1 Monolith Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Phase 1 building blocks from `docs/superpowers/specs/2026-05-06-otonome-platform-design.md`: typed **`RunIntent` / `RouteDecision`** on the web stack with tests, a **mandatory Rust egress policy gate** before cloud Hermes payload construction, and an **append-only local run ledger** keyed by orchestrator `run_id`.

**Architecture:** Keep the existing Tauri monolith; add a thin **TypeScript contract module** consumed by the UI/store later, a **Rust `egress_policy`** module called from `hermes_agent`, and a **`run_store`** helper writing JSON Lines under the OS app data directory when a DAG run starts.

**Tech Stack:** Vite 6, React 18, TypeScript 5, Vitest (new dev dependency), Tauri 2 Rust crate `app` (`src-tauri/`).

---

### Task 1: Vitest + canonical TypeScript contracts

**Files:**
- Create: `src/domain/platformContracts.ts`
- Create: `src/domain/platformContracts.test.ts`
- Modify: `package.json` (scripts + devDependency)
- Modify: `package-lock.json` (via install)
- Modify: `vite.config.ts`

- [ ] **Step 1: Install Vitest**

Run:

```bash
cd c:\Otonome
npm install -D vitest@^3.1.1
```

Expected: `npm` exits 0 and `package-lock.json` updates.

- [ ] **Step 2: Wire Vitest into Vite config**

Apply this exact `vite.config.ts` shape (merge into the existing export; preserve current fields such as `optimizeDeps` and `server`; only add `/// reference`, `mergeConfig` import, and `test:` block):

```typescript
/// <reference types="vitest/config" />
import { defineConfig, mergeConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

export default mergeConfig(
  defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    optimizeDeps: {
      holdUntilCrawlEnd: false,
      include: [
        'react',
        'react/jsx-runtime',
        'react-dom',
        'react-dom/client',
        'react-router-dom',
        'lucide-react',
        'zustand',
        'clsx',
        'tailwind-merge',
      ],
      exclude: [
        'pyodide',
        '@huggingface/transformers',
        'kokoro-js',
        'onnxruntime-web',
        'onnxruntime-node',
      ],
    },
    worker: { format: 'es' },
    define: {
      'import.meta.env.allowLocalModels': true,
      'import.meta.env.allowRemoteModels': true,
      'import.meta.env.useBrowserCache': true,
    },
    envPrefix: ['VITE_', 'TAURI_ENV_*'],
    server: {
      port: 5173,
      strictPort: true,
      host: host || false,
      hmr: host
        ? { protocol: 'ws', host, port: 1421 }
        : undefined,
      watch: { ignored: ['**/src-tauri/**'] },
      warmup: {
        clientFiles: [
          './index.html',
          './src/main.tsx',
          './src/App.tsx',
          './src/components/Sidebar.tsx',
          './src/components/Landing.tsx',
        ],
      },
    },
    build: {
      target:
        process.env.TAURI_ENV_PLATFORM === 'windows'
          ? 'chrome105'
          : 'safari13',
      minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
      sourcemap: !!process.env.TAURI_ENV_DEBUG,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      passWithNoTests: false,
    },
  }),
  defineConfig({
    clearScreen: false,
  }),
);
```

- [ ] **Step 3: Add `test` script**

In `package.json` under `"scripts"`, add:

```json
"test": "vitest run"
```

- [ ] **Step 4: Add `src/domain/platformContracts.ts` and `src/domain/platformContracts.test.ts` together**

Create `src/domain/platformContracts.ts`:

```typescript
export type RunIntent = {
  correlationId: string;
  workspaceId?: string;
  rawText: string;
  structuredHints?: Record<string, unknown>;
};

export type RouteMode = 'sop' | 'adhoc';

export type RouteDecision = {
  mode: RouteMode;
  sopBundleId?: string;
  sopVersion?: string;
  entryNodeId?: string;
  confidence: number;
  rationaleTrace: string[];
};

export function assertRunIntent(input: unknown): asserts input is RunIntent {
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('RunIntent must be an object');
  }
  const o = input as Record<string, unknown>;
  if (typeof o.correlationId !== 'string' || o.correlationId.trim().length === 0) {
    throw new TypeError('RunIntent.correlationId must be a non-empty string');
  }
  if (typeof o.rawText !== 'string') {
    throw new TypeError('RunIntent.rawText must be a string');
  }
  if (o.workspaceId !== undefined && typeof o.workspaceId !== 'string') {
    throw new TypeError('RunIntent.workspaceId must be a string when provided');
  }
}

/**
 * Phase-1 placeholder classifier: deterministic enough for tests and UI scaffolding.
 * Replace with real router/SOP matching in a later plan.
 */
export function decideRoute(intent: RunIntent): RouteDecision {
  const t = intent.rawText.trim().toLowerCase();
  const trace: string[] = ['decideRoute:placeholder_v1'];
  if (t.includes('use sop') || t.includes('standard procedure')) {
    return {
      mode: 'sop',
      sopBundleId: 'embedded-default',
      sopVersion: '0.0.1',
      confidence: 0.85,
      rationaleTrace: [...trace, 'matched_keyword:sop'],
    };
  }
  return {
    mode: 'adhoc',
    confidence: 0.55,
    rationaleTrace: [...trace, 'default_adhoc'],
  };
}
```

Create `src/domain/platformContracts.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { assertRunIntent, decideRoute, type RunIntent } from './platformContracts';

describe('platformContracts', () => {
  it('rejects invalid intents', () => {
    expect(() => assertRunIntent(null)).toThrow();
    expect(() => assertRunIntent({})).toThrow();
  });

  it('classifies ad-hoc by default', () => {
    const intent: RunIntent = { correlationId: 'c1', rawText: 'Qualify these leads' };
    assertRunIntent(intent);
    const d = decideRoute(intent);
    expect(d.mode).toBe('adhoc');
    expect(d.confidence).toBeGreaterThan(0);
  });

  it('classifies SOP when keywords present', () => {
    const intent: RunIntent = { correlationId: 'c2', rawText: 'Please use sop for onboarding' };
    const d = decideRoute(intent);
    expect(d.mode).toBe('sop');
    expect(d.sopBundleId).toBe('embedded-default');
  });
});
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd c:\Otonome
npm run test
```

Expected: Vitest exits 0 with **3 passed** tests.

- [ ] **Step 6: Commit**

Run:

```bash
cd c:\Otonome
git add package.json package-lock.json vite.config.ts src/domain/platformContracts.ts src/domain/platformContracts.test.ts
git commit -m "test: vitest setup and Phase 1 platform contract types"
```

---

### Task 2: Rust egress policy gate before Hermes payload construction

**Files:**
- Create: `src-tauri/src/egress_policy.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/hermes_agent.rs`

- [ ] **Step 1: Write failing Rust unit tests**

Create `src-tauri/src/egress_policy.rs`:

```rust
//! Mandatory egress shaping before cloud-bound user text leaves the desktop runtime tier (spec §4.2, §6).

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EgressLimits {
    pub max_bytes: usize,
}

pub fn default_limits() -> EgressLimits {
    EgressLimits { max_bytes: 24 * 1024 }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EgressDisposition {
    Allow,
    Deny,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EgressDecision {
    pub disposition: EgressDisposition,
    pub sanitized_user_text: Option<String>,
    pub reason_codes: Vec<String>,
}

#[inline]
fn token_char_ok(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '+' || c == '-'
}

fn redact_whitespace_bounded_email_like_tokens(
    input: &str,
    reason_codes: &mut Vec<String>,
) -> String {
    let mut out = String::new();
    let mut first = true;
    for raw in input.split_whitespace() {
        if !first {
            out.push(' ');
        }
        first = false;

        if let Some(at) = raw.find('@') {
            let (Some(local), Some(domain)) = (raw.get(..at), raw.get(at + 1..)) else {
                out.push_str(raw);
                continue;
            };
            let ok = !local.is_empty()
                && !domain.is_empty()
                && domain.contains('.')
                && local.chars().all(token_char_ok)
                && domain.chars().all(token_char_ok);
            if ok {
                reason_codes.push("redacted_token:email_like".into());
                out.push_str("***@");
                out.push_str(domain);
                continue;
            }
        }

        out.push_str(raw);
    }
    out
}

pub fn evaluate_user_task_for_cloud(user_task: &str, limits: EgressLimits) -> EgressDecision {
    let mut reason_codes: Vec<String> = Vec::new();

    let mut text = user_task.trim().to_string();
    let original_len = text.len();
    if original_len > limits.max_bytes {
        return EgressDecision {
            disposition: EgressDisposition::Deny,
            sanitized_user_text: None,
            reason_codes: vec![format!(
                "payload_too_large:original_len_bytes={}",
                original_len
            )],
        };
    }

    // Block obvious secret-like patterns commonly pasted into chat/agent prompts.
    // This is deliberately conservative — extend via OrgPolicy-backed tables later.
    if text.contains("sk-ant-") {
        return EgressDecision {
            disposition: EgressDisposition::Deny,
            sanitized_user_text: None,
            reason_codes: vec!["blocked_substring:sk-ant-api-key-pattern".into()],
        };
    }
    if text.contains("Bearer ") {
        reason_codes.push("redacted_substring:bearer-token".into());
        text = text.replace("Bearer ", "Bearer **[REDACTED]** ");
    }

    // Lightweight email-like token redaction on whitespace-bounded tokens: `alice@example.com` -> `***@example.com`.
    // Intentionally conservative on token shape so normal prose with stray `@` is not mangled blindly.
    let out = redact_whitespace_bounded_email_like_tokens(&text, &mut reason_codes);

    let final_len = out.len();
    if final_len > limits.max_bytes {
        return EgressDecision {
            disposition: EgressDisposition::Deny,
            sanitized_user_text: None,
            reason_codes: vec![format!(
                "payload_too_large:after_sanitize_len_bytes={}",
                final_len
            )],
        };
    }

    EgressDecision {
        disposition: EgressDisposition::Allow,
        sanitized_user_text: Some(out),
        reason_codes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn denies_oversized_payload() {
        let s = "a".repeat(25 * 1024);
        let d = evaluate_user_task_for_cloud(&s, default_limits());
        assert_eq!(d.disposition, EgressDisposition::Deny);
        assert!(d.sanitized_user_text.is_none());
        assert!(
            d.reason_codes
                .iter()
                .any(|c| c.starts_with("payload_too_large:")),
            "{d:?}"
        );
    }

    #[test]
    fn denies_sk_ant_pattern() {
        let d =
            evaluate_user_task_for_cloud("token sk-ant-xxxx", EgressLimits { max_bytes: 1024 });
        assert_eq!(d.disposition, EgressDisposition::Deny);
    }

    #[test]
    fn redacts_bearer_prefix() {
        let d =
            evaluate_user_task_for_cloud("Authorization: Bearer SECRETVALUE", default_limits());
        assert_eq!(d.disposition, EgressDisposition::Allow);
        let t = d.sanitized_user_text.expect("sanitized text");
        assert!(!t.contains("SECRETVALUE"));
        assert!(t.contains("**[REDACTED]**"));
    }

    #[test]
    fn redacts_simple_email_like_token() {
        let d = evaluate_user_task_for_cloud(
            "Reach me at alice@example.com soon",
            default_limits(),
        );
        assert_eq!(d.disposition, EgressDisposition::Allow);
        let t = d.sanitized_user_text.expect("sanitized text");
        assert!(
            !t.contains("alice@"),
            "{t:?}"
        );
        assert!(
            t.contains("***@example.com"),
            "{t:?}"
        );
        assert!(
            d.reason_codes
                .iter()
                .any(|c| *c == "redacted_token:email_like"),
            "{d:?}"
        );
    }
}
```

- [ ] **Step 2: Register module**

In `src-tauri/src/lib.rs`, near other `mod ...` declarations, add:

```rust
mod egress_policy;
```

- [ ] **Step 3: Integrate into Hermes session entrypoint**

At the top of `pub fn run_agent_session` in `src-tauri/src/hermes_agent.rs`, immediately after the opening `{`, insert:

```rust
    let limits = crate::egress_policy::default_limits();
    let egress = crate::egress_policy::evaluate_user_task_for_cloud(user_task, limits);
    if egress.disposition != crate::egress_policy::EgressDisposition::Allow {
        return Err(format!(
            "egress_denied: {}",
            egress.reason_codes.join(",")
        ));
    }
    let user_task_sanitized = egress
        .sanitized_user_text
        .ok_or_else(|| "egress_missing_sanitized_text".to_string())?;
```

Then replace every subsequent use of `user_task` in that function that refers to the outbound user content with `user_task_sanitized.as_str()` (including `execute_tool_gated(user_task, ...)` calls should use the original `user_task` only if tool gating must see pre-redaction local context—**for cloud alignment, pass `user_task_sanitized` consistently** to both `execute_tool_gated` and the initial `messages` vector construction).

Concretely, change the initial messages vector to:

```rust
    let mut messages: Vec<Value> = vec![json!({
        "role": "user",
        "content": user_task_sanitized.trim()
    })];
```

And change `execute_tool_gated(user_task, name, input)` call sites to:

```rust
execute_tool_gated(user_task_sanitized.as_str(), name, input)
```

- [ ] **Step 4: Run Rust tests**

Run:

```bash
cd c:\Otonome\src-tauri
cargo test egress_policy
```

Expected: `test result: ok` with **4** unit tests passing (module filter may show `egress_policy::tests::*`).

- [ ] **Step 5: Commit**

```bash
cd c:\Otonome
git add src-tauri/src/egress_policy.rs src-tauri/src/lib.rs src-tauri/src/hermes_agent.rs
git commit -m "feat: cloud egress policy gate before Hermes session"
```

---

### Task 3: Local append-only run ledger (JSON Lines)

**Files:**
- Create: `src-tauri/src/run_store.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/orchestrator.rs`

- [ ] **Step 1: Implement `run_store.rs`**

Create `src-tauri/src/run_store.rs`:

```rust
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
```

`tempfile` is already present under `[dev-dependencies]` in `src-tauri/Cargo.toml`.

- [ ] **Step 2: Register module**

Add to `src-tauri/src/lib.rs`:

```rust
mod run_store;
```

- [ ] **Step 3: Call from orchestrator spawn**

In `spawn_run` (`src-tauri/src/orchestrator.rs`), immediately after computing `rid` and populating workflow scratch (`g.workflow.task_id`), call:

```rust
        let _ = crate::run_store::append_run_started(crate::run_store::RunStartedEvent {
            ts_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
            run_id: rid.as_str(),
            sop_id: opts.sop_id.as_deref(),
            task_id: opts.task_id.as_deref(),
            user_request_len: opts.user_request.clone().unwrap_or_default().len(),
        });
```

- [ ] **Step 4: Run tests**

```bash
cd c:\Otonome\src-tauri
cargo test run_store
```

Expected: at least **`appends_jsonl_line`** passes.

- [ ] **Step 5: Commit**

```bash
cd c:\Otonome
git add src-tauri/src/run_store.rs src-tauri/src/lib.rs src-tauri/src/orchestrator.rs
git commit -m "feat: append-only local JSONL run ledger on DAG start"
```

---

## Self-review (against the Phase 1 spec)

1. **Spec coverage:** Routing placeholder (`decideRoute`) covers early `RouteDecision` needs; egress policy aligns with **`OrgPolicy` gateway** commitment; ledger supports **`Run` auditability** minimally. Explicit **workflow bundle versioning** persistence and **CRM idempotency** are deferred to subsequent plans (`P1b` / connector plan).
2. **Placeholder scan:** None intended; do not introduce `TODO/TBD` in code while executing.
3. **Type consistency:** `RunIntent` / `RouteDecision` field names are camelCase-ready for future JSON sharing with Rust via serde on the next bridge task.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-06-otonome-platform-p1-monolith-contracts.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
