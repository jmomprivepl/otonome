//! Serializable workflow context that travels with a DAG run (shared "state folder").

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowPublicSnapshot {
    pub run_id: String,
    pub user_request: String,
    pub sop_id: Option<String>,
    pub task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_digest: Option<String>,
    pub node_outputs: HashMap<String, String>,
    pub human_inputs: HashMap<String, serde_json::Value>,
}

impl Default for WorkflowPublicSnapshot {
    fn default() -> Self {
        Self {
            run_id: String::new(),
            user_request: String::new(),
            sop_id: None,
            task_id: None,
            bundle_id: None,
            bundle_version: None,
            content_digest: None,
            node_outputs: std::collections::HashMap::new(),
            human_inputs: std::collections::HashMap::new(),
        }
    }
}

impl WorkflowPublicSnapshot {
    pub fn to_json_pretty(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}
