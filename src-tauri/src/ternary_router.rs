//! 32-parameter ternary feature vector (symbolic layer) → adapter / persona plugin selection.
//!
//! Bands (1-based, stored in `v[0]..v[31]`):
//! - **1–9** contextual weighting (domain cues)
//! - **10–18** complexity / reasoning depth heuristics
//! - **19–27** persona / plugin affinity (maps to QVP1 personas when configured)
//! - **28–32** reserved (`v[27]..v[31]`, no keyword rules yet)

use serde::{Deserialize, Serialize};

/// Length of the NSDAR / router ternary vector (emitted as `--nsdar-vector` CSV).
pub const TERNARY_VECTOR_LEN: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct TernaryVector32 {
    /// Each entry is in {-1, 0, 1} (ternary); other values are clamped when routing.
    pub v: [i8; TERNARY_VECTOR_LEN],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteOutcome {
    pub adapter_id: String,
    pub score: f32,
    pub runner_up_adapter_id: Option<String>,
    pub runner_up_score: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ambiguity {
    pub top_adapters: Vec<String>,
    pub scores: Vec<f32>,
}

fn clamp_ternary(x: i8) -> f32 {
    x.clamp(-1, 1) as f32
}

fn dot(a: &[f32; TERNARY_VECTOR_LEN], b: &[f32; TERNARY_VECTOR_LEN]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

fn contains_any(hay: &str, words: &[&str]) -> bool {
    words.iter().any(|w| hay.contains(w))
}

/// Adapter prototypes (32 dims; trailing five zeros reserved). Tune against your QVP1 library under `personas/*.qvp1`.
const ADAPTER_PROTOTYPES: &[(&str, [i8; TERNARY_VECTOR_LEN])] = &[
    (
        "adapter.default",
        [
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0,
        ],
    ),
    (
        "adapter.persona.sop_engineer",
        [
            1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0,
        ],
    ),
    (
        "adapter.persona.compliance",
        [
            0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0,
        ],
    ),
    (
        "adapter.persona.cloud_analyst",
        [
            0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
            0, 0,
        ],
    ),
    (
        "adapter.persona.local_bitnet",
        // Favor explicit local / BitNet cues (v[23]–v[25]); avoid p[11] so short SOP lines
        // (v[11] = -1) do not tie sop_engineer.
        [
            0, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0,
            0, 0, 0,
        ],
    ),
    (
        "adapter.persona.narrative",
        [
            0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
            0, 0,
        ],
    ),
];

/// Maps router winner to an on-disk QVP1 path (relative to cwd) and optional `--persona-layer`.
pub fn persona_cli_options_for_adapter(adapter_id: &str) -> Option<(&'static str, Option<i32>)> {
    match adapter_id {
        "adapter.persona.sop_engineer" => Some(("personas/sop_engineer.qvp1", None)),
        "adapter.persona.compliance" => Some(("personas/compliance.qvp1", Some(0))),
        "adapter.persona.cloud_analyst" => None,
        "adapter.persona.local_bitnet" => None,
        "adapter.persona.narrative" => Some(("personas/narrative.qvp1", None)),
        _ => None,
    }
}

const MARGIN: f32 = 0.35;

pub fn route(vec: &TernaryVector32) -> Result<RouteOutcome, Ambiguity> {
    let mut x = [0f32; TERNARY_VECTOR_LEN];
    for i in 0..TERNARY_VECTOR_LEN {
        x[i] = clamp_ternary(vec.v[i]);
    }
    let mut scored: Vec<(&str, f32)> = ADAPTER_PROTOTYPES
        .iter()
        .map(|(id, p)| {
            let mut pv = [0f32; TERNARY_VECTOR_LEN];
            for i in 0..TERNARY_VECTOR_LEN {
                pv[i] = clamp_ternary(p[i]);
            }
            (*id, dot(&x, &pv))
        })
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let (best_id, best_s) = scored[0];
    let (second_id, second_s) = scored.get(1).map(|s| (s.0, s.1)).unwrap_or(("none", -999.0));
    let all_zero = scored.iter().all(|(_, s)| s.abs() < 1e-9);
    if all_zero {
        return Ok(RouteOutcome {
            adapter_id: "adapter.default".to_string(),
            score: 0.0,
            runner_up_adapter_id: scored.get(1).map(|(id, _)| (*id).to_string()),
            runner_up_score: scored.get(1).map(|(_, s)| *s),
        });
    }
    if best_s - second_s < MARGIN {
        return Err(Ambiguity {
            top_adapters: scored.iter().take(3).map(|(id, _)| (*id).to_string()).collect(),
            scores: scored.iter().take(3).map(|(_, s)| *s).collect(),
        });
    }
    Ok(RouteOutcome {
        adapter_id: best_id.to_string(),
        score: best_s,
        runner_up_adapter_id: Some(second_id.to_string()),
        runner_up_score: Some(second_s),
    })
}

/// Keyword-based vector, then apply manual locks `(index, value)` for `index < TERNARY_VECTOR_LEN`, `value` clamped to {-1,0,1}.
#[allow(dead_code)]
pub fn merge_prompt_vector_with_locks(prompt: &str, label: &str, locked: &[(usize, i8)]) -> TernaryVector32 {
    let mut t = vector_from_prompt(prompt, label);
    for &(i, val) in locked {
        if i < TERNARY_VECTOR_LEN {
            t.v[i] = val.clamp(-1, 1);
        }
    }
    t
}

/// CSV for `llama-cli --nsdar-vector`.
#[allow(dead_code)]
pub fn format_nsdar_csv(v: &TernaryVector32) -> String {
    v.v
        .iter()
        .map(|x| x.to_string())
        .collect::<Vec<_>>()
        .join(",")
}

/// Deterministic 32-vector from task text (no LLM). Indices 0..=26 = parameters 1..=27; 27..=31 reserved (zeros).
pub fn vector_from_prompt(prompt: &str, label: &str) -> TernaryVector32 {
    let mut v = [0i8; TERNARY_VECTOR_LEN];
    let hay = format!("{} {}", label, prompt).to_lowercase();

    // --- Parameters 1–9: contextual weighting ---
    if contains_any(
        &hay,
        &[
            "code", "rust", "python", "cpp", "c++", "typescript", "function", "api", "debug",
            "compile",
        ],
    ) {
        v[0] = 1;
    }
    if contains_any(
        &hay,
        &[
            "narrative",
            "story",
            "essay",
            "blog",
            "prose",
            "creative",
            "novel",
        ],
    ) {
        v[1] = 1;
    }
    if contains_any(
        &hay,
        &[
            "finance",
            "budget",
            "invoice",
            "ledger",
            "revenue",
            "profit",
            "forecast",
        ],
    ) {
        v[2] = 1;
    }
    if contains_any(
        &hay,
        &["legal", "contract", "liability", "counsel", "regulation", "gdpr"],
    ) {
        v[3] = 1;
    }
    if contains_any(
        &hay,
        &[
            "hr",
            "hiring",
            "onboarding",
            "employee",
            "payroll",
            "benefits",
            "resignation",
            "resign",
            "resigned",
            "quit",
            "quitting",
            "notice period",
            "two weeks notice",
            "offboarding",
            "retention",
            "stay interview",
        ],
    ) {
        v[4] = 1;
    }
    if contains_any(
        &hay,
        &["ops", "deploy", "incident", "sla", "runbook", "uptime"],
    ) {
        v[5] = 1;
    }
    if contains_any(
        &hay,
        &["customer", "support", "ticket", "csat", "retention"],
    ) {
        v[6] = 1;
    }
    if contains_any(&hay, &["product", "roadmap", "feature", "prd", "mvp"]) {
        v[7] = 1;
    }
    if contains_any(
        &hay,
        &["research", "paper", "experiment", "hypothesis", "citation"],
    ) {
        v[8] = 1;
    }

    // --- Parameters 10–18: complexity / reasoning ---
    if contains_any(
        &hay,
        &["proof", "theorem", "lemma", "derive", "formalize"],
    ) {
        v[9] = 1;
    }
    if contains_any(
        &hay,
        &["math", "equation", "integral", "matrix", "statistics", "probability"],
    ) {
        v[10] = 1;
    }
    let word_count = hay.split_whitespace().count();
    if word_count > 100 {
        v[11] = 1;
    } else if word_count < 10 {
        v[11] = -1;
    }
    if contains_any(
        &hay,
        &["step 1", "step one", "first,", "second,", "then ", "finally"],
    ) {
        v[12] = 1;
    }
    if contains_any(&hay, &["if ", "else", "unless", "either", "choose"]) {
        v[13] = 1;
    }
    if contains_any(&hay, &["table", "column", "row", "csv", "spreadsheet"]) {
        v[14] = 1;
    }
    if contains_any(&hay, &["risk", "mitigation", "threat", "failure mode"]) {
        v[15] = 1;
    }
    if contains_any(&hay, &["estimate", "approximate", "roughly", "ballpark"]) {
        v[16] = -1;
    }
    if contains_any(&hay, &["must", "shall", "required", "mandatory"]) {
        v[17] = 1;
    }

    // --- Parameters 19–27: persona / plugin affinity ---
    if contains_any(&hay, &["sop", "procedure", "checklist", "playbook", "runbook"]) {
        v[18] = 1;
        v[19] = 1;
    }
    if contains_any(
        &hay,
        &["approv", "audit", "compliance", "policy", "sign-off"],
    ) {
        v[20] = 1;
        v[21] = 1;
    }
    if contains_any(&hay, &["anthropic", "claude", "openai", "gpt", "cloud llm"]) {
        v[22] = 1;
    }
    if contains_any(
        &hay,
        &["local", "on-device", "bitnet", "qvac", "llama-cli", "offline"],
    ) {
        v[23] = 1;
    }
    if contains_any(&hay, &["summarize", "tl;dr", "brief", "executive summary"]) {
        v[24] = 1;
    }
    if contains_any(&hay, &["translate", "french", "german", "spanish", "locale"]) {
        v[25] = 1;
    }
    if contains_any(&hay, &["tone", "voice", "brand", "persona", "style guide"]) {
        v[26] = 1;
    }

    // v[27]..v[31]: reserved (Future feature 1–5), remain 0

    TernaryVector32 { v }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_vector_routes_without_ambiguity() {
        let o = route(&TernaryVector32::default()).unwrap();
        assert_eq!(o.adapter_id, "adapter.default");
    }

    #[test]
    fn default_vector_has_length_32() {
        assert_eq!(TernaryVector32::default().v.len(), TERNARY_VECTOR_LEN);
    }

    #[test]
    fn format_nsdar_csv_has_32_coefficients() {
        let csv = format_nsdar_csv(&TernaryVector32::default());
        assert_eq!(csv.split(',').count(), TERNARY_VECTOR_LEN);
    }

    #[test]
    fn code_hints_set_contextual_slot() {
        let v = vector_from_prompt("Implement a Python API handler", "Task");
        assert_eq!(v.v[0], 1);
    }

    #[test]
    fn sop_hints_trigger_persona_band() {
        let v = vector_from_prompt("Follow the SOP checklist for onboarding", "Step");
        assert_eq!(v.v[18], 1);
    }

    #[test]
    fn sop_text_routes_to_sop_engineer_adapter() {
        let v = vector_from_prompt("Execute the SOP playbook and checklist.", "Node");
        let o = route(&v).expect("route");
        assert_eq!(o.adapter_id, "adapter.persona.sop_engineer");
    }

    #[test]
    fn compliance_text_routes_to_compliance_adapter() {
        let v = vector_from_prompt("Audit compliance policy and sign-off.", "Node");
        let o = route(&v).expect("route");
        assert_eq!(o.adapter_id, "adapter.persona.compliance");
    }

    #[test]
    fn resignation_hints_set_hr_slot() {
        let v = vector_from_prompt("Paul sent his resignation letter; help retain him.", "Task");
        assert_eq!(v.v[4], 1);
    }
}
