//! Native tool definitions (JSON Schema / Anthropic `input_schema`) and local execution.

use serde_json::{json, Value};

pub const TOOL_READ_LOCAL_FILE: &str = "read_local_file";
pub const TOOL_SEARCH_HUBSPOT_CONTACT: &str = "search_hubspot_contact";

/// Anthropic Messages API tool list (`tools` array).
pub fn anthropic_tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": TOOL_READ_LOCAL_FILE,
            "description": "Read a UTF-8 text file from the local filesystem (read-only). Path must stay under the app working directory or OTONOME_READ_ROOT.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative or absolute path to a text file."
                    }
                },
                "required": ["path"]
            }
        }),
        json!({
            "name": TOOL_SEARCH_HUBSPOT_CONTACT,
            "description": "Search HubSpot CRM for a contact by name (mock implementation for development).",
            "input_schema": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Contact name or partial name to search."
                    }
                },
                "required": ["name"]
            }
        }),
    ]
}

fn read_root() -> std::path::PathBuf {
    std::env::var_os("OTONOME_READ_ROOT")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")))
}

/// Resolve `path` under read root; rejects traversal outside root.
pub fn resolve_safe_path(user_path: &str) -> Result<std::path::PathBuf, String> {
    let root = read_root().canonicalize().map_err(|e| format!("read root: {e}"))?;
    let p = std::path::Path::new(user_path);
    let joined = if p.is_absolute() {
        p.to_path_buf()
    } else {
        root.join(p)
    };
    let canon = joined.canonicalize().map_err(|e| format!("path not found: {e}"))?;
    if !canon.starts_with(&root) {
        return Err(format!(
            "path escapes read root ({}): {}",
            root.display(),
            canon.display()
        ));
    }
    Ok(canon)
}

pub fn execute_read_local_file(args: &Value) -> Result<String, String> {
    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing path".to_string())?;
    let safe = resolve_safe_path(path)?;
    let bytes = std::fs::read(&safe).map_err(|e| format!("read {}: {e}", safe.display()))?;
    let cap = 256 * 1024usize;
    if bytes.len() > cap {
        return Err(format!("file too large (max {} bytes)", cap));
    }
    let text = String::from_utf8(bytes).map_err(|_| "file is not valid UTF-8".to_string())?;
    Ok(text)
}

pub fn execute_search_hubspot_contact_mock(args: &Value) -> Result<String, String> {
    let name = args
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing name".to_string())?;
    Ok(format!(
        "{{\"mock\":true,\"query\":{name:?},\"results\":[{{\"id\":\"mock-1\",\"email\":\"{name}@example.invalid\",\"company\":\"Demo Co\"}}]}}"
    ))
}

/// Router slot aligned with NSDAR **parameter 12** (1-based) = **ExternalRelations** → index **11** in the 32-vector.
pub const ROUTER_PARAM12_EXTERNAL_INDEX: usize = 11;

/// When true, SME policy treats external-relations dimension as isolation (block outbound CRM search).
pub fn external_isolation_from_router(v32: &[i8; 32]) -> bool {
    v32.get(ROUTER_PARAM12_EXTERNAL_INDEX).copied() == Some(-1)
}

pub fn routing_context_for_guard(user_task: &str, tool_name: &str, tool_input: &Value) -> String {
    format!(
        "User task:\n{}\n\nRequested tool: {}\nArguments JSON:\n{}",
        user_task.trim(),
        tool_name,
        serde_json::to_string_pretty(tool_input).unwrap_or_else(|_| "{}".into())
    )
}
