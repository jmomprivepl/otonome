//! DAG graph types shared with the React SOP visualizer (camelCase JSON).

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionTarget {
    LocalQvac,
    CloudAnthropic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RaciLayer {
    Responsible,
    Accountable,
    Consulted,
    Informed,
}

/// Agent nodes call the inference worker (Hermes / local stack). Human nodes pause for UI review only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum DagNodeKind {
    #[default]
    Agent,
    Human,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DagNode {
    pub id: String,
    pub label: String,
    pub prompt: String,
    pub execution_target: ExecutionTarget,
    #[serde(default)]
    pub node_kind: DagNodeKind,
    /// When true, running this node triggers HITL before any side effect (stub tools).
    pub requires_system_tool: bool,
    pub system_tool_name: Option<String>,
    pub system_tool_args_summary: Option<String>,
    pub raci_layer: RaciLayer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DagEdge {
    pub id: String,
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DagGraph {
    pub nodes: Vec<DagNode>,
    pub edges: Vec<DagEdge>,
}

impl DagGraph {
    pub fn validate(&self) -> Result<(), String> {
        let ids: HashSet<_> = self.nodes.iter().map(|n| n.id.as_str()).collect();
        if ids.len() != self.nodes.len() {
            return Err("duplicate node id".into());
        }
        for e in &self.edges {
            if !ids.contains(e.source.as_str()) || !ids.contains(e.target.as_str()) {
                return Err(format!("edge {} references unknown node", e.id));
            }
        }
        let _ = topological_order(self)?;
        Ok(())
    }
}

/// Kahn topological sort; returns Err if cycle.
pub fn topological_order(graph: &DagGraph) -> Result<Vec<String>, String> {
    let mut indeg: HashMap<String, usize> = graph.nodes.iter().map(|n| (n.id.clone(), 0)).collect();
    let mut adj: HashMap<String, Vec<String>> = HashMap::new();
    for n in &graph.nodes {
        adj.entry(n.id.clone()).or_default();
    }
    for e in &graph.edges {
        *indeg.entry(e.target.clone()).or_insert(0) += 1;
        adj.entry(e.source.clone()).or_default().push(e.target.clone());
    }
    let mut q: VecDeque<String> = indeg
        .iter()
        .filter(|(_, &d)| d == 0)
        .map(|(id, _)| id.clone())
        .collect();
    let mut out = Vec::new();
    while let Some(u) = q.pop_front() {
        out.push(u.clone());
        if let Some(succ) = adj.get(&u) {
            for v in succ {
                let e = indeg.get_mut(v).ok_or_else(|| "internal: indeg".to_string())?;
                *e -= 1;
                if *e == 0 {
                    q.push_back(v.clone());
                }
            }
        }
    }
    if out.len() != graph.nodes.len() {
        return Err("graph has a cycle".into());
    }
    Ok(out)
}
