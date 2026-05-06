# Otonome platform — architecture and requirements (design spec)

**Date:** 2026-05-06  
**Status:** Approved for implementation planning (Sections 1–3)  
**Audience:** Engineers with no prior context; agents implementing the plan  

---

## 1. Summary

Otonome is a **privacy-first, local-first orchestration platform** that helps SMEs adopt AI by routing work between **multi-layer, versioned Standard Operating Procedures (SOPs)** and **autonomous ad-hoc execution**, with **local inference preferred** (including BitNet-class stacks, ternary routing, and on-device finetuning paths) and **optional, policy-governed cloud reasoning** for heavier multi-turn agent work.

The product is **desktop-first** (single installable runtime). An **optional workflow authority** runs **on the customer’s premises** (their server or VPC) for canonical **workflow definitions**, **versioning**, **team sync**, and **audit export**—without requiring SMEs to operate a full cluster on day one.

A **reference golden path** (not the only supported workflow): ingest signals from public or licensed sources → enrich → qualify → prioritize → identify contacts → propose or apply **CRM** updates (opportunity and structured fields) under **human-in-the-loop** where required.

---

## 2. Goals and non-goals

### 2.1 Goals

- **G1 — Local-first execution:** CRM credentials, enrichment payloads, and mutating tool actions default to **on-device** orchestration.
- **G2 — SOP vs ad-hoc:** Every business request is handled through an explicit **routing decision** between **published SOP DAGs** and **ad-hoc graphs** (planned or emergent), with **human clarification** when confidence or policy is insufficient.
- **G3 — Inference strategy:** Prefer **local** models (BitNet / GGUF / router LoRA / Pass-2 fusion paths in the current stack). Allow **third-party model APIs** only through a **mandatory egress policy gateway** (blocklists, PII handling, size caps, allowlisted fields).
- **G4 — Optional on-prem workflow authority:** SMEs **own and edit** their processes; the **canonical bundle store** may live on **customer infrastructure**, with the desktop **pulling, pinning, and caching** definitions.
- **G5 — Phase compatibility:** **Phase 1** ships as a **monolith** inside the existing desktop stack but uses **the same domain contracts** intended for the Phase 2 server so the on-prem service is a **drop-in authority**, not a rewrite of the orchestrator.

### 2.2 Non-goals (for this spec)

- **NG1 — Single-tenant SaaS** as the primary home for customer workflow IP.
- **NG2 — Kubernetes-first** as the only deployment story (cluster-native may appear later for large customers).
- **NG3 — Committing to one CRM**; the platform defines **adapter contracts**—initial connectors are implementation details of the plan phase.

---

## 3. Architectural decisions (locked)

| ID | Decision |
|----|----------|
| **D1** | **North-star topology:** **Approach 2** — **executor** (desktop) + optional **on-premises control plane** (workflow registry / audit / team sync). |
| **D2** | **Phase 1:** **Monolith-compatible contracts** — embedded local store for bundles and runs; **same JSON/contracts** as the future on-prem API. |
| **D3** | **Deployment modes:** **C** — desktop works standalone; **if** the on-prem service exists, the desktop **syncs** workflow bundles and optionally **exports** audit streams. |
| **D4** | **Cloud LLM posture:** **B** — cloud agents **allowed** only after **mandatory transformation policy** (deny, redact, trim, allowlist). Default logging is **redacted** for tool args and payloads. |
| **D5** | **Workflow ownership:** **Customer-owned** definitions; platform provides **templates** only as optional starters, not as authority over customer IP. |

---

## 4. High-level architecture

### 4.1 Components

- **Desktop runtime (current direction: Vite/React UI + Tauri + Rust orchestration):**
  - **DAG executor** with **human-in-the-loop** (approve, clarify, structured human review).
  - **Tool adapters** (CRM, HTTP, filesystem, sandboxed scripts) holding **secrets locally**.
  - **Local inference plane** — router + local decode paths (existing NSDAR/Qvac-class integration).
  - **Egress policy gateway** — every outbound model/tool call passes policy evaluation and logging of **policy decisions** (not raw blocked secrets by default).
- **Workflow authority — embedded mode (Phase 1):** Local persisted **workflow bundles**, template library, pin (`bundleId` + digest/`semver`).
- **Workflow authority — on-prem mode (Phase 2):** Customer-run service exposing **workflow CRUD**, **immutable versions**, **signing**, **sync/pull**, optional **append-only audit** ingestion from desktops.
- **Third-party APIs:** Hermes-class **multi-turn** agents reachable **only** through the gateway under **OrgPolicy**.

### 4.2 Trust tiers

| Tier | Definition |
|------|-------------|
| **T0** | Must not leave device without explicit policy allowance: CRM tokens, raw CRM payloads, full enrichment dumps, secrets. |
| **T1** | May leave device after gateway: minimized task descriptions, structured JSON summaries, policy-approved excerpts. |

### 4.3 Diagram

```mermaid
flowchart LR
  subgraph Desktop["Desktop runtime"]
    UI[React UI]
    ORC[Orchestrator DAG + HITL]
    POL[Egress policy gateway]
    LOC[Local inference plane]
    TOOL[Tool adapters]
  end
  subgraph Optional["Optional on-prem"]
    SRV[Workflow registry and audit"]
  end
  subgraph Cloud["Third-party APIs"]
    HERM[Hermes-style agent API"]
  end
  UI --> ORC
  ORC --> LOC
  ORC --> POL
  POL --> HERM
  ORC --> TOOL
  ORC <-->|"Workflow bundles sync"|SRV
```

---

## 5. Routing, data model, and execution semantics

### 5.1 Request lifecycle

1. **`RunIntent`:** Inputs include workspace context, raw user text (or webhook body), optional structured hints from UI, correlation identifiers, optional link to triggering run.
2. **Stage A — Classification (local-first):** Produce **`RouteDecision`**: `{ mode: 'sop' | 'adhoc', sopBundleId?, sopVersion?, entryNodeId?, confidence, rationaleTrace }`. Methods may combine entrypoint metadata, on-device embeddings, keyword gates, and ternary-slot router agreement. **Trace remains local** unless policy allows excerpts for cloud escalation.
3. **Stage B — SOP mode:** Load **immutable** `WorkflowBundle` for `sopBundleId@version`, bind parameters, execute DAG in topological order with HITL and tool stubs as defined per node.
4. **Stage C — Ad-hoc mode:** Planner produces a **`SessionGraph`** (still a DAG): nodes select **adapter + execution target** (local vs cloud). Cloud nodes require gateway approval.
5. **Escalation:** Low confidence, ambiguous router outcome, or policy conflict → **HITL** to choose bundle/version or confirm ad-hoc path, then resume with an auditable branch.

### 5.2 Core persisted types

| Type | Responsibility |
|------|----------------|
| **`WorkflowBundle`** | Identity (`id`), **`semver`/digest**, DAG (`nodes`, `edges`, node kinds, execution targets), **entrypoints**, policy hooks (e.g. required approvals), expectations for emitted artifacts (schemas). Optionally **signed** when sourced from on-prem. |
| **`OrgPolicy`** | Egress toggles, allowlists, PII/transform rules, maximum outbound bytes/fields, per-connector field allowlists, debug logging tier. |
| **`Run`** | `runId`, frozen `RunIntent`, `RouteDecision`, reference to pinned bundle or **adhoc** flag, lifecycle status, timing, cryptographic **digest references** into artifact storage where used. |
| **`RunArtifacts`** | Per-node outputs, CRM **proposals** vs **applied writes**, downloadable files; **encryption at rest** when policy requires. |

### 5.3 Failure handling, retries, idempotency

- **CRM and HTTP mutators:** **Idempotency key** derives from `(runId, nodeId)` (and natural business keys where applicable). Retries limited to categorized transient failures. Adapters prefer **UPSERT** semantics keyed by stable external identifiers agreed in the CRM mapping layer.
- **Local inference failure:** Bounded retries with backoff; degrade path narrows context, switches model tier, then **may offer** cloud execution **only if** `OrgPolicy` permits (never silent cross-tier promotion).
- **Cloud agent failure:** Structured error surfaced on the run timeline; optional **single** automatic retry **after** stricter gateway transformation—not after silent data shape changes without HITL if the node is guarded.
- **Human reject or approval timeout:** Run enters **`paused` or `failed`** with structured reason; **no partial CRM commits** when the active node mandates approval.

---

## 6. Observability and operational privacy

- **Run timeline:** Ordered, queryable events: classification outcomes, pinned bundle identifiers, node phases, gateway decisions, tool invocations (**args redacted** by default).
- **Audit export:** Optional push to customer on-prem audit endpoint (Phase 2) as **append-only** records with **digest chain** keyed by organization.
- **Structured logs:** JSON lines tagged with severity and **data class**; raw payload logging only when org explicitly enables diagnostics.
- **Local metrics:** Stage latencies (router, local inference, egress, CRM), and **bytes before vs after gateway** for every cloud call.

---

## 7. Testing strategy (design commitments)

- **Contract tests:** Schemas or equivalent conformance tests for `WorkflowBundle`, `RunIntent`, `RouteDecision`, CRM proposal/apply payloads; breaking changes require **bundle format version bumps**.
- **Policy gateway fixtures:** Golden files for PII, secrets, oversized bodies → deterministic deny/transform outcomes.
- **Orchestrator replay:** Stub tools + frozen routing vectors for regression on order, retries, HITL resume semantics.
- **Integration (optional CI jobs):** Sandboxed connectors and mocked external APIs (no production credentials in CI artifacts).

---

## 8. Phased delivery

| Phase | Deliverable focus |
|-------|-------------------|
| **P1 — Monolith contracts** | Single desktop artifact with embedded bundles and runs; full routing and gateway; connectors behind stable interfaces; **contracts stable** for P2 server. |
| **P2 — On-prem workflow service** | Customer-deployed workflow registry (**REST or gRPC**—choice is an implementation detail of the plan), semver, signatures, desktop sync and pin, audit ingest. |
| **P3 — Hardening and scale-out** | Multi-seat RBAC on server; backup/restore; stronger tamper evidence on receipts; hardened connector lifecycle. |

---

## 9. Relation to current repository

This repository already contains substantial **prototype** implementations: React routes and state (`src/`), DAG visualization and persisted SOPs on the front end (`src/store.ts`), and Rust-side orchestration (`src-tauri/src/orchestrator.rs`) with NSDAR/class routing (`src-tauri/src/nsdar.rs`) and Hermes-cloud paths. **Implementation work must converge** those pieces toward the **contracts and trust boundaries** in this document rather than rewriting without cause.

---

## 10. Glossary

| Term | Meaning |
|------|---------|
| **SOP (platform sense)** | A **published, versioned** `WorkflowBundle` representing a standard operating procedure. |
| **Ad-hoc** | A **`SessionGraph`** not strictly pinned to a published bundle snapshot at start—or explicitly chosen after escalation. |
| **Gateway** | The **mandatory egress policy** layer preceding any tier-T1 outbound model or non-local tool egress that policy governs. |
| **Golden path** | The reference scenario used to validate integrations end-to-end; not a closed product scope. |

---

## 11. Acceptance criteria for “spec complete”

- **A1:** A new engineer can describe **trust tiers**, **routing stages**, and **where secrets live** without reading source code.
- **A2:** Implementers can derive **phase boundaries** without guessing whether the server/API is required for Phase 1 (it is not).
- **A3:** No conflicting statements about SaaS-owning workflows vs customer-owned workflows (customer-owned; templates optional).
