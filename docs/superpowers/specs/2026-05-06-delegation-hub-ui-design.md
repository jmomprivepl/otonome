# Delegation Hub UI — Product and UX Specification

**Date:** 2026-05-06  
**Status:** Approved (product direction) · Ready for implementation planning  
**Scope:** Desktop-first Otonome client (React + Tauri). Defines information architecture, application shell behaviors, delegation/monitoring UX, approvals, and focus-mode rules.

---

## 1. Purpose

Deliver a calm, SME-friendly logged-in experience where users **delegate work in natural language**, **Hermes routes** requests into either a **structured human/AI SOP workflow** or **immediate autonomous handling**, and users **never lose track** of active runs, running SOPs, or pending human approvals.

This specification separates **delegation posture** from **engineering “plumbing”**: standard users should not land on hardware/engine surfaces by default.

---

## 2. Problem Statement

Prior navigation treats **Agent Finetuning / engine command-center** idioms as a first-class home for logged-in users, which competes with the product spine (delegation and monitoring). Operational screens (graphs, dense boards) consume laptop viewport aggressively; delegation surfaces must coexist without habitual clutter yet preserve **critical visibility into approvals**.

---

## 3. Goals

1. **`/` after onboarding is the Delegation Hub** — Hermes + permanent monitoring column are the canonical home shell.
2. **Engine/hardware/plumbing is second-class by default** — relocated off `/`, discoverable intentionally (Advanced / power workflows).
3. **Monitoring is trustworthy** — users can always find **pending approvals**, **running SOPs**, and **active executions**.
4. **Hybrid shell** preserves screen-heavy workspaces on laptops — conversational chrome **compresses** on qualifying routes beneath a breakpoint, while **approval visibility and quantitative awareness** persist.
5. **Approvals are actionable and hard to miss** — primary queue in the monitoring column, with **time-sensitive** items also surfacing through a **lightweight modal**.

### 3.1 Non-goals (this document)

- Final visual design system (color, typography density, motion).
- Full copy deck for every empty state and edge case.
- Backend contract details for Hermes or execution engines (referenced only at the UX boundary).

---

## 4. Key Product Decisions (authoritative)

| Topic | Decision |
| --- | --- |
| **Product spine** | Ask once → Hermes routes to **SOP workflow** or **autonomous handling**. |
| **Canonical home** | **`/` = Delegation Hub** after auth and onboarding. |
| **Engine / hardware** | **Not** on `/`. Single secondary route (recommended: `/engine` or `/advanced/engine`) grouped under **Advanced** in navigation. |
| **Default shell** | **Two-pane:** Hermes **front-and-center** + **permanent monitoring context column** (not collapsible in full-shell mode). |
| **Hybrid focus mode** | On **narrow viewports**, on **focus-class routes**, minimize conversational chrome while keeping **pending approvals surfaced** plus **compact numeric indicators** for **running SOPs** and **active executions**. Expand restores the full Delegation Shell without losing workspace state. |
| **Focus triggering** | **Route class ∩ viewport breakpoint** (both required). Wide monitors retain full chrome on the same routes when practical. |
| **Focus-class routes** | **Canvas/graph editors** and **dense boards** (example: Tasks **board**). **Exclude** list/table-first layouts from automatic minimization triggers. |
| **Breakpoint default** | **`1280px` CSS max-width gate** for minimization eligibility on focus-class routes; validate in QA and adjust against target hardware cohorts. |
| **Approvals** | **Monitoring column owns the approval queue.** **Time-sensitive** approvals additionally raise a **lightweight modal** so they are not missed during typing or dense editing. |
| **Wireframes** | Low-fidelity reference: [`wireframes/delegation-hub-wireframes.html`](./wireframes/delegation-hub-wireframes.html). |

---

## 5. Information Architecture and Routing

### 5.1 Route responsibilities

- **`/` — Delegation Hub (canonical)**  
  - Hermes conversation + persistent monitoring column (full shell when not in focus-mode).
- **Secondary engine route (required relocation target)**  
  - Hosts hardware/engine/finetuning **plumbing** previously associated with command-center home. Exact path name: **`/engine`** *or* **`/advanced/engine`**; pick one during implementation for URL stability and bookmarks.
- **Existing operational modules**  
  - Tasks, Projects, Agents, Data, Agent SOP, Playground, Settings remain distinct routes but **inherit shell rules** defined in Sections 6–8.

### 5.2 Navigation model (SME vs power user)

- **Primary spine (sidebar emphasis):** **Delegate (home)** at `/`.  
- **Libraries and operations:** Tasks, Projects, Agents, Data, Agent SOP, etc.  
- **Advanced / plumbing:** engine route, and optionally Playground if product owners want it out of the default SME path (confirm during build; do not block on this document).

---

## 6. Delegation Hub — Full Shell Layout

When the application presents the **full Delegation Shell** (hub route at non-minimized widths, and non-focus-class routes broadly):

### 6.1 Hermes pane (primary, center column)

**Responsibilities**

- Accept freeform delegation prompts (composer anchored to bottom of pane).
- Render an understandable **conversation transcript**.
- Provide **lightweight routing transparency** (plain language: what path Hermes chose and why) without raw technical logs.
- Offer **optional next actions** (e.g., create tracked task, open run detail, attach to project) as short affordances, not mandatory wizards.

**Constraints**

- Hermes is the **narrative surface**; it must not replace structured monitoring in the context column for **queue-like** workloads (approvals, concurrent runs).

### 6.2 Monitoring context column (persistent, full shell)

**Non-collapsible** in full-shell posture. Vertical order is **semantic priority**, top to bottom:

1. **Pending human approvals** — primary accountability surface.  
2. **Running SOPs** — step summary and progress indicators; avoid embedding the heavy graph editor here.  
3. **Active executions** — async agents/jobs/runners rendered as dense rows/cards.

**Interactions**

- Every meaningful row/card **deep-links** to the best canonical detail surface (task, run overview, readable SOP linkage, approval detail drawer/page).
- **Progressive disclosure:** summary by default; step-level detail expands in-place or via linked detail—not in Hermes transcripts.

### 6.3 Sidebar (left)

- **Highlight** the spine item: Delegate / home (`/`).  
- Group **Advanced** destinations separately to avoid implying parity with delegation.

---

## 7. Hybrid Minimized Shell (Focus-Class + Narrow Breakpoint)

### 7.1 Activation rule (both required)

Minimized chrome applies **only if**:

1. **Route class** is **focus-class** — **canvas/graph editor** used for authoring, or **dense board** view (example: Tasks **board**); **exclude** list/table-first views; **and**  
2. **Viewport** is **at or below** the default **1280px** breakpoint (implementation: treat as a single CSS breakpoint token used consistently across the app shell).

On **wide** displays, the same screen-heavy routes should **prefer the full Delegation Shell** to leverage available horizontal space.

### 7.2 Minimized strip — required affordances

When minimized:

- **Hermes access** remains obvious (icon + short label or equivalent) with **Expand** restoring the full two-pane shell.
- **Pending approvals** remain **visibly present** (count and/or attention signal; exact visual treatment is implementation detail but must not be a hidden menu-only state).
- **Numeric indicators** for **running SOPs** and **active executions** are **always visible** in minimized mode (no step detail until expanded).
- **Expand** returns users to the **full hub shell** **without destroying** underlying editor/board state; prefer **overlay/drawer** patterns over hard route remounts that drop graph/board context.

### 7.3 Rationale

Standard laptop screens cannot sustain **three dense panes** (sidebar + Hermes + monitoring + workspace) simultaneously on canvas-like routes. Minimization preserves **operational clarity** without removing **accountability**.

---

## 8. Approvals — Column Queue + Time-Sensitive Modal

### 8.1 Primary surface: monitoring column

- Approvals render as **cards/rows** with: short title, consequence, actor/run reference, primary/secondary actions, and links to supporting evidence/detail.
- This is the **default** approval interaction surface.

### 8.2 Secondary surface: lightweight modal

Certain approvals **also** trigger a **small modal** layered over the current workspace so they are not missed while the user composes prompts in Hermes or manipulates graphs/boards.

**Modal constraints**

- **Short copy**, **high-signal**, with obvious **Approve / Reject / Open details** (wording finalized in copy pass).
- Must not fully replace the column queue; it is an **escalation channel** for attention, not a second queue.

### 8.3 Time-sensitive policy (product rules)

Mark an approval **time-sensitive** when **any** condition holds:

1. **Destructive or difficult-to-reverse** action (data loss, broad access grants, production-affecting change).  
2. **Regulated or sensitive category** (as defined by org policy tags on the approval type).  
3. **SLA/timer risk** — timer expired or within an implementation-defined “about to breach” window.  
4. **Explicit risk score** meets or exceeds a threshold configured per approval type.

Implementation must log which rule fired for analytics and tuning.

---

## 9. Coherence with Tasks, Projects, and SOP Surfaces

- **Hub is narrative; structured views are mirrors** — Hermes may create/update tasks and runs; Tasks/Projects remain dense operational centers.  
- **Tasks board** may trigger **minimized shell** per Section 7; **Tasks list/table** should **not** automatically trigger minimization by default.  
- **SOP graph editor** is **focus-class**; **SOP list** views are **not** (unless later product evidence shows equivalent density—requires explicit amendment to this spec).

---

## 10. Accessibility and Input Basics

- **Keyboard:** users can **expand** minimized shell and **navigate** approval queue without pointer-only affordances.  
- **Focus management:** time-sensitive modals use proper **focus trap** and restore focus on dismiss.  
- **Visual attention:** approval signals must not rely on color alone (pair counts with iconography/text in implementation).

---

## 11. Migration Notes (from Current Codebase Posture)

These notes ease engineering planning; they are not exhaustive audits.

- Today, logged-in **`/`** may host **Onboarding** or **NsdarCommandCenter**-style engine UI. This spec **replaces** that default home with the **Delegation Hub** for post-onboarding users.  
- Relocate engine/command-center capabilities to the **secondary engine route** and **Advanced** navigation grouping.  
- Hermes orchestration concepts already exist in code (e.g., routing phases, SOP vs direct paths); UI work should **surface** those states in the hub and monitoring column rather than only in engine screens.

---

## 12. Verification Criteria (UX acceptance)

1. Fresh SME user, post-onboarding: lands on **`/`** and sees **Hermes + monitoring column**, not engine controls.  
2. With concurrent runs and approvals: **all three** categories are discoverable without opening Advanced routes.  
3. On a **focus-class** route under the breakpoint: **minimized strip** shows **approvals** and **both numeric indicators**; **expand** restores full shell without losing editor/board state.  
4. **Time-sensitive** approvals: appear in column **and** modal per policy; non-time-sensitive approvals: **column only**.

---

## 13. References

- Interactive wireframes: [`wireframes/delegation-hub-wireframes.html`](./wireframes/delegation-hub-wireframes.html)  

---

## 14. Next Step (process)

After stakeholder review of this file, produce an implementation plan via the **writing-plans** workflow: route changes, shell componentization, state sources for monitoring column, approvals policy wiring, and incremental rollout behind feature flags if needed.
