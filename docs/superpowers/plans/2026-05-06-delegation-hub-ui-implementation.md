# Delegation Hub UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved [Delegation Hub UI spec](../specs/2026-05-06-delegation-hub-ui-design.md): **home hub** Hermes + monitoring at **`/`**, hybrid **focus-route + narrow** chrome (**minimized strip** + expandable **drawer overlay**), engine at **`/engine`**, and **time-sensitive** HITL modals on top of existing infrastructure.

**Architecture (canonical — 2026-05 reconciled):** Use **pure routing rules** (`delegationShellRules` + **`useDelegationMinimizedChrome`** with `useViewportNarrow` against **`delegation/hubConstants.ts`**). **`DelegationHubScreen`** owns the calm **logged-in hub** (`OtonomeChat` + **`DelegationMonitoringColumn`**). **`DelegationShellChrome`** (mounted from **`App.tsx`**) overlays **strip + drawer** when **`delegationChromeHostActive`** (narrow viewport ∧ focus-class route); underlying route (Kanban graph, playground, tasks board, etc.) **stays mounted**. **`computeDelegationStripCounts`** feeds badge counts. **`tasksWorkspaceLayout`** in Zustand drives Tasks board-vs-list focus-class. **Outlet-based `DelegationAppShell`** (earlier sketch below) is **superseded** — do **not** implement it unless requirements change.

**Time-sensitive HITL (§8.3):** **`AgentHitlBridge`** enriches Tauri payloads with **`withResolvedTimeSensitivity`** (`src/domain/hitlTimeSensitivity.ts`); modals receive **`variant="timeSensitive" | "standard"`** (higher **`z-index`**, stronger backdrop blur, amber ring/banner); monitoring column shows a **Time-sensitive** chip on queued items.

**Tech Stack:** React 18, react-router-dom 7, TypeScript, Vite, Vitest (Node environment), Zustand, Tailwind 4, Tauri events for HITL.

---

## File structure map (canonical)

| File | Responsibility |
| --- | --- |
| `src/lib/delegationShellRules.ts` | Focus-class pathname rules; `TasksWorkspaceLayout`. |
| `src/lib/delegationShellRules.test.ts` | Vitest for shell rules. |
| `src/delegation/useDelegationMinimizedChrome.ts` | **`delegationChromeHostActive`** = narrow ∧ focus-class (`tasksWorkspaceLayout`). |
| `src/delegation/useViewportNarrow.ts` | `matchMedia` gate for breakpoint. |
| `src/delegation/hubConstants.ts` | `DELEGATION_SHELL_BREAKPOINT_PX` (1280). |
| `src/components/delegation/DelegationHubScreen.tsx` | Route **`/`** hub: Hermes + monitoring chrome. |
| `src/components/delegation/DelegationShellChrome.tsx` | Global minimized host: badges + **`DelegationMinimizedStrip`** / **`DelegationExpandedDrawer`**. |
| `src/components/delegation/DelegationExpandedDrawer.tsx` | Full hub overlay over workspace (`z-[100]`); under time-sensitive modals (`z-[110]`). |
| `src/components/delegation/DelegationMinimizedStrip.tsx` | Strip UI + Expand. |
| `src/lib/delegationMonitoringCounts.ts` | `computeDelegationStripCounts`. |
| `src/store.ts` | `tasksWorkspaceLayout`, delegation/DAG volatility, pending HITL payloads. |
| `src/App.tsx` | Routes; **`DelegationShellChrome`** sibling; hides floating **`ChatSidebar`** when `delegationChromeHostActive`. |
| `src/components/TasksScreen.tsx` | Board/list synced to **`tasksWorkspaceLayout`**. |
| `src/domain/hitlTimeSensitivity.ts` | Infer **`timeSensitive`** + rule ID when backend omits flag. |
| `src/domain/hitlTimeSensitivity.test.ts` | Rules unit tests. |
| `src/components/AgentHitlBridge.tsx` | Tauri listeners → **`withResolvedTimeSensitivity`** → store → modals. |
| `src/types/agentDag.ts` | `HitlSensitivityMeta`, **`HitlModalVariant`**. |
| `ActionApprovalModal` / `ClarificationModal` / `HumanReviewModal` | `variant` visuals + focus containment when urgent. |
| `src/components/AuthenticatedWorkspaceFrame.tsx` | Shared **`Header` + `pt-[73px]` + `pl-16`/`pl-64`** for logged-in workspace routes (reduces duplicated layout). |

**Superseded (do not implement as written):** `DelegationAppShell.tsx`, `DelegationHubHomeBody.tsx`, nested `Outlet` three-column shell in **`App.tsx`** — replaced by **`DelegationHubScreen` + DelegationShellChrome overlay** pattern above.

---

### Task 1: Routing and shell rules (TDD)

**Files:**
- Create: `src/lib/delegationShellRules.ts`
- Create: `src/lib/delegationShellRules.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'vitest';
import {
  DELEGATION_SHELL_MINIMIZE_MAX_WIDTH_PX,
  isFocusClassRoute,
  shouldMinimizeDelegationShell,
  type TasksWorkspaceLayout,
} from './delegationShellRules';

describe('isFocusClassRoute', () => {
  it('treats SOP graph editor as focus-class', () => {
    expect(isFocusClassRoute('/agent-sop/edit/abc-123', 'board')).toBe(true);
  });

  it('does not treat SOP list as focus-class', () => {
    expect(isFocusClassRoute('/agent-sop', 'board')).toBe(false);
  });

  it('treats Playground as focus-class', () => {
    expect(isFocusClassRoute('/playground', 'list')).toBe(true);
  });

  it('treats Tasks as focus-class only in board layout', () => {
    expect(isFocusClassRoute('/tasks', 'board')).toBe(true);
    expect(isFocusClassRoute('/tasks', 'list')).toBe(false);
  });

  it('does not treat hub home as focus-class', () => {
    expect(isFocusClassRoute('/', 'board')).toBe(false);
  });
});

describe('shouldMinimizeDelegationShell', () => {
  const narrow = DELEGATION_SHELL_MINIMIZE_MAX_WIDTH_PX;
  const wide = narrow + 1;

  it('returns false when viewport is null (SSR / unknown)', () => {
    expect(shouldMinimizeDelegationShell('/playground', 'board', null, false)).toBe(false);
  });

  it('returns false when viewport is wider than breakpoint even on focus routes', () => {
    expect(shouldMinimizeDelegationShell('/playground', 'board', wide, false)).toBe(false);
  });

  it('returns true on focus route when viewport is at breakpoint', () => {
    expect(shouldMinimizeDelegationShell('/playground', 'board', narrow, false)).toBe(true);
  });

  it('returns false on non-focus route even when narrow', () => {
    expect(shouldMinimizeDelegationShell('/overview', 'board', narrow, false)).toBe(false);
  });

  it('returns false when user forced expanded', () => {
    expect(shouldMinimizeDelegationShell('/playground', 'board', narrow, true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- src/lib/delegationShellRules.test.ts`  
Expected: **FAIL** (module missing or functions not exported).

- [ ] **Step 3: Implement rules module**

```typescript
/**
 * Shell minimization breakpoint (spec §4 / §7). CSS pixel width using `window.innerWidth`.
 */
export const DELEGATION_SHELL_MINIMIZE_MAX_WIDTH_PX = 1280;

export type TasksWorkspaceLayout = 'board' | 'list';

/**
 * Focus-class routes: canvas/graph editors + dense task board (not list/table-first).
 */
export function isFocusClassRoute(pathname: string, tasksLayout: TasksWorkspaceLayout): boolean {
  if (pathname.startsWith('/playground')) return true;
  if (/^\/agent-sop\/edit\//u.test(pathname)) return true;
  if (pathname === '/tasks' || pathname.startsWith('/tasks/')) {
    return tasksLayout === 'board';
  }
  return false;
}

/**
 * When true, render minimized delegation strip instead of full Hermes + monitoring columns.
 * @param userExpandedOverride user clicked Expand — keeps full shell until they collapse again (handled in UI layer).
 */
export function shouldMinimizeDelegationShell(
  pathname: string,
  tasksLayout: TasksWorkspaceLayout,
  viewportWidth: number | null,
  userExpandedOverride: boolean,
): boolean {
  if (userExpandedOverride) return false;
  if (viewportWidth == null) return false;
  if (viewportWidth > DELEGATION_SHELL_MINIMIZE_MAX_WIDTH_PX) return false;
  return isFocusClassRoute(pathname, tasksLayout);
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- src/lib/delegationShellRules.test.ts`  
Expected: **PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/delegationShellRules.ts src/lib/delegationShellRules.test.ts
git commit -m "feat(delegation): add shell minimization routing rules"
```

---

### Task 2: Persist Tasks workspace layout for focus-class detection

**Files:**
- Modify: `src/store.ts` (add state + actions)
- Modify: `src/components/TasksScreen.tsx` (sync Board/List toggle)

- [ ] **Step 1: Extend Zustand store**

In `store.ts`, add to the store interface and initial state:

```typescript
/** Layout for /tasks — drives delegation-shell focus-class (board is dense). */
tasksWorkspaceLayout: 'board' | 'list';

setTasksWorkspaceLayout: (layout: 'board' | 'list') => void;
```

Initialize `tasksWorkspaceLayout: 'board'`. Implement `setTasksWorkspaceLayout` as a simple setter.

- [ ] **Step 2: Wire TasksScreen**

At the top of `TasksScreen` where `useState<'board' | 'list'>('board')` exists, replace with:

```typescript
const tasksWorkspaceLayout = useKanbanStore((s) => s.tasksWorkspaceLayout);
const setTasksWorkspaceLayout = useKanbanStore((s) => s.setTasksWorkspaceLayout);
```

Use `tasksWorkspaceLayout` instead of local `viewMode`, and call `setTasksWorkspaceLayout('board')` / `('list')` from the existing toggle buttons.

- [ ] **Step 3: Run tests**

Run: `npm test`  
Expected: **PASS** (existing suite).

- [ ] **Step 4: Commit**

```bash
git add src/store.ts src/components/TasksScreen.tsx
git commit -m "feat(tasks): persist board/list layout for delegation shell"
```

---

### Task 3: Viewport observer hook

**Files:**
- Create: `src/hooks/useViewportInnerWidth.ts`

- [ ] **Step 1: Implement hook**

```typescript
import { useEffect, useState } from 'react';

/** `null` before mount / in non-browser environments */
export function useViewportInnerWidth(): number | null {
  const [w, setW] = useState<number | null>(null);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      setW(window.innerWidth);
    });
    setW(window.innerWidth);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, []);

  return w;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useViewportInnerWidth.ts
git commit -m "feat(hooks): track viewport width for delegation shell"
```

---

### Task 4: Delegation minimize strip (presentational)

**Files:**
- Create: `src/components/delegation/DelegationMinimizedStrip.tsx`

- [ ] **Step 1: Add component**

```typescript
type DelegationMinimizedStripProps = {
  approvalCount: number;
  runningSopCount: number;
  activeJobCount: number;
  onExpand: () => void;
};

export function DelegationMinimizedStrip({
  approvalCount,
  runningSopCount,
  activeJobCount,
  onExpand,
}: DelegationMinimizedStripProps) {
  return (
    <header
      className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200/50 bg-amber-50/90 px-3 py-2 dark:border-amber-800/40 dark:bg-amber-950/40"
      role="banner"
    >
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          Hermes · minimized
        </p>
        <p className="truncate text-xs text-slate-700 dark:text-slate-300">
          Approvals stay visible — expand for full delegation + monitoring columns.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-red-700 dark:bg-slate-900/60 dark:text-red-300">
          Approvals · {approvalCount}
        </span>
        <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-violet-800 dark:bg-slate-900/60 dark:text-violet-300">
          SOPs · {runningSopCount}
        </span>
        <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-sky-800 dark:bg-slate-900/60 dark:text-sky-300">
          Jobs · {activeJobCount}
        </span>
        <button
          type="button"
          onClick={onExpand}
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-violet-700"
        >
          Expand
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Run lint**

Run: `npm run lint`  
Expected: no errors in new file.

- [ ] **Step 3: Commit**

```bash
git add src/components/delegation/DelegationMinimizedStrip.tsx
git commit -m "feat(delegation): add minimized strip for focus routes"
```

---

### Task 5: Badge counts derivation (pure helper + test)

**Files:**
- Create: `src/lib/delegationMonitoringCounts.ts`
- Create: `src/lib/delegationMonitoringCounts.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'vitest';
import { computeDelegationStripCounts } from './delegationMonitoringCounts';
import type { DelegationHermesActivity } from '@/types/delegationHub';
import type { ActiveDagRunSnapshot } from '@/types/delegationHub';

describe('computeDelegationStripCounts', () => {
  it('counts Hermes sop_running as one running SOP', () => {
    const hermes: DelegationHermesActivity = {
      busy: true,
      phase: 'sop_running',
      headline: '',
      sopSteps: [],
      platformRoute: null,
    };
    const res = computeDelegationStripCounts({
      pendingApprovalsCount: 2,
      hermesActivity: hermes,
      dag: null,
    });
    expect(res.approvals).toBe(2);
    expect(res.runningSops).toBe(1);
  });

  it('counts DAG run preview as jobs when DAG active', () => {
    const dag: ActiveDagRunSnapshot = {
      runId: 'r',
      userRequestPreview: 'x',
      completedNodes: 0,
      updatedAt: 0,
    };
    const hermes: DelegationHermesActivity = {
      busy: false,
      phase: 'idle',
      headline: '',
      sopSteps: [],
      platformRoute: null,
    };
    const res = computeDelegationStripCounts({
      pendingApprovalsCount: 0,
      hermesActivity: hermes,
      dag,
    });
    expect(res.activeJobs).toBeGreaterThanOrEqual(1);
  });
});
```

Adjust import paths if `@/` alias unavailable in Vitest — it is configured via Vite.

- [ ] **Step 2: Implement**

```typescript
import type { ActiveDagRunSnapshot, DelegationHermesActivity } from '@/types/delegationHub';

export type DelegationStripCounts = {
  approvals: number;
  runningSops: number;
  activeJobs: number;
};

export function computeDelegationStripCounts(input: {
  pendingApprovalsCount: number;
  hermesActivity: DelegationHermesActivity | null;
  dag: ActiveDagRunSnapshot | null;
}): DelegationStripCounts {
  const sopFromHermes =
    Boolean(input.hermesActivity?.busy && input.hermesActivity.phase === 'sop_running');
  const hermesBusyNonSop =
    Boolean(
      input.hermesActivity?.busy &&
        input.hermesActivity.phase !== 'idle' &&
        input.hermesActivity.phase !== 'sop_running',
    );
  const jobsFromDag = input.dag ? 1 : 0;
  const jobs = jobsFromDag + (hermesBusyNonSop ? 1 : 0);

  return {
    approvals: input.pendingApprovalsCount,
    runningSops: sopFromHermes ? 1 : 0,
    activeJobs: jobs,
  };
}
```

Tune logic later when multiple concurrent runs exist — spec expects **badge counts**, not exhaustive analytics.

- [ ] **Step 3: Run tests**

Run: `npm test -- src/lib/delegationMonitoringCounts.test.ts`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/delegationMonitoringCounts.ts src/lib/delegationMonitoringCounts.test.ts
git commit -m "feat(delegation): derive minimized strip badge counts"
```

---

### Task 6 *(superseded by overlay UX)* — store “force expanded”

An earlier spike used **`delegationShellForceExpanded`** in the store coupled to **`shouldMinimizeDelegationShell`**. That conflicted with **drawer-mounted** delegation chrome (unmounting killed in-flight drawer state). **Current code:** **`delegationChromeHostActive`** gates whether **`DelegationShellChrome`** mounts at all; **`drawerOpen`** hides the strip while keeping the host mounted — **no Zustand override required**. Keep this subsection as history only.

---

### Task 7 *(superseded)* — Outlet-based **`DelegationAppShell`**

~~The steps and React snippet below were the original blueprint.~~ **Canonical implementation:** **`DelegationHubScreen`** (route `/`) provides the SME hub Hermes + monitoring surface. **`DelegationShellChrome`** + **`DelegationExpandedDrawer`** + **`DelegationMinimizedStrip`** satisfy §7 hybrid minimize **without** wrapping every route in a three-column **`Outlet`**. Per-route chrome duplication is addressed by **`AuthenticatedWorkspaceFrame`** (**Task 8**).

---

### Task 8: Header duplication — **done**

**`AuthenticatedWorkspaceFrame`** (`src/components/AuthenticatedWorkspaceFrame.tsx`) centralizes **`Header` + `pt-[73px]` + `pl-16`/`pl-64`** across logged-in workspace routes (Tasks, Projects, Dashboard, Settings, Playground, SOP graph/list, Python tools, etc.). **`Onboarding`** still mounts **`Header`** directly (non–workspace-pattern).

---

### Task 9: Time-sensitive approvals (§8.3) — **implemented**

**Status:** Complete in codebase (no further code changes required for Task 9 scope).

| Area | Implementation |
| --- | --- |
| Types | **`HitlSensitivityMeta`** + **`HitlModalVariant`** in `src/types/agentDag.ts` |
| Inference | **`inferTimeSensitiveFromPayload`** / **`withResolvedTimeSensitivity`** in `src/domain/hitlTimeSensitivity.ts`; tests in **`hitlTimeSensitivity.test.ts`** |
| Bridge | **`AgentHitlBridge`** enriches Tauri payloads on ingest; **`logTimeSensitivityResolution`** for console analytics |
| Modals | **`variant="timeSensitive"`** → `z-[110]`, heavier backdrop **`blur-md`**, amber **ring + banner**, **`useFocusContainment(true, …)`**; **`DelegationExpandedDrawer`** stays at **`z-[100]`** so urgent modals stack above hub overlay |
| Column | **`DelegationMonitoringColumn`** shows **Time-sensitive** chip when `payload.timeSensitive` |

---


### Task 10: Documentation and regression checklist — **documentation complete**

**Product acceptance criteria** (what “good” means): [spec §12 — Verification Criteria (UX acceptance)](../specs/2026-05-06-delegation-hub-ui-design.md#12-verification-criteria-ux-acceptance).

**Spec cross-link:** [spec §13 — Implementation notes](../specs/2026-05-06-delegation-hub-ui-design.md#13-implementation-notes) points back to this plan.

---

#### Automated smoke (run locally before manual QA)

```bash
npm test -- src/lib/delegationShellRules.test.ts src/lib/delegationMonitoringCounts.test.ts src/domain/hitlTimeSensitivity.test.ts src/lib/assistantActionParser.test.ts src/hermes/wrapInferenceEngineRetry.test.ts src/domain/hitlPayloadDedupe.test.ts
```

Optional full unit run: `npm test`

---

#### Manual regression checklist (execute in **Tauri** and **browser**, use viewport **under 1280px** inner width unless noted)

- [ ] **1. Hub & routing** — Log in, complete onboarding: **`/`** shows **Hermes + monitoring column + hub body** (not engine command center as default home).  
- [ ] **2. Engine** — **`/engine`** loads and functions; note whether it is focus-class in your build (strip optional).  
- [ ] **3. Tasks board + narrow** — **`/tasks`** in **board** layout, narrow window → **minimized strip** appears; **approval / SOP / jobs** badge counts match visible store/HITL/DAG state.  
- [ ] **4. Tasks list escape hatch** — Switch Tasks to **List** at same narrow width → **full** delegation chrome returns (no automatic minimize for list).  
- [ ] **5. SOP graph editor** — **`/agent-sop/edit/...`**, narrow → strip; **Expand** opens drawer overlay with full hub; **Collapse** returns to strip; underlying graph **stays mounted**.  
- [ ] **6. Other focus-class routes** — e.g. **`/playground`**, narrow → strip behavior consistent with `delegationShellRules`.  
- [ ] **7. Non–focus-class sanity** — e.g. **`/agent-sop`** (list), **`/settings`**, wide layout: **no spurious strip**; **`AuthenticatedWorkspaceFrame`** pages show **consistent header offset** (no double top padding vs hub).  
- [ ] **8. Time-sensitive HITL** — Event with **`timeSensitive: true`** → **elevated modal** (stronger backdrop, above drawer **z-index**); item also **Time-sensitive** in monitoring column when queued.  
- [ ] **9. Keyboard / a11y spot-check** — From minimized shell: **Expand** reachable without mouse-only traps; modal **focus containment** on open/close.  
- [ ] **10. Hermes inference retries** — After a transient failure (or simulated IPC flake), Hermes trace / audit log may include **`> inference_retry:`** lines and the request still completes when the backend succeeds on a later attempt (`wrapInferenceEngineWithRetry`).  
- [ ] **11. HITL dedupe** — If the backend emits the **same** pending HITL payload twice, the UI should **not** flicker; **SOP / Playground log** may show **`> HITL dedupe:`** once (`hitlPayloadDedupe` + `AgentHitlBridge`).

---

#### Commit (after edits)

```bash
git add docs/superpowers/plans/2026-05-06-delegation-hub-ui-implementation.md docs/superpowers/specs/2026-05-06-delegation-hub-ui-design.md
git commit -m "docs(delegation): QA checklist and spec/plan cross-links"
```

---

## Plan self-review (author, updated)

1. **Spec coverage:** §5–6 hub @ `/` + `/engine` — **`DelegationHubScreen`** + **`App.tsx`** routes; §7 hybrid minimize — **`DelegationShellChrome`** + breakpoint + **`tasksWorkspaceLayout`**; §8 column + escalated modal — **`DelegationMonitoringColumn`** + **`hitlTimeSensitivity`** + modal **`variant`**; Task 9 marked **implemented** above.
2. **Superseded material:** Outlet **`DelegationAppShell`** removed from active plan; archival note in Tasks 6–7 sections.
3. **Type consistency:** `TasksWorkspaceLayout` imported **`import type`** from `delegationShellRules` into `store.ts` — keep that pattern.

---

## Execution note

Prior **subagent-driven** execution proceeded on branch **`feat/delegation-hub-shell`**. **Task 8** (**`AuthenticatedWorkspaceFrame`**) and **Task 10** (this checklist + **spec §13** cross-links) are reflected in HEAD; rerun **manual** Task 10 checkboxes before each release candidate.

---

## Phase 2 — Brain Upgrade (tool reliability, offline-first)

Tracked on branch **`feat/brain-upgrade-tool-actions`** (stack PRs or merge to `main` when ready).

| Piece | Role |
| --- | --- |
| `src/lib/assistantActionParser.ts` | Unified parsing of assistant JSON/XML tool actions (ChatSidebar, ChatNode, TaskCard). |
| `src/hermes/wrapInferenceEngineRetry.ts` | Retries `InferenceEngine.executeInference` on likely-transient IPC/network errors; merges `> inference_retry:` lines into Hermes telemetry. |
| `OtonomeChat` + `NsdarCommandCenter` | Wrap real Tauri inference engines with **`wrapInferenceEngineWithRetry`**. |
| `src/domain/hitlPayloadDedupe.ts` | Stable deep-compare for HITL payloads; skip identical re-emits. |
| `AgentHitlBridge` | Uses dedupe before updating **`pendingActionApproval` / `pendingClarification` / `pendingHumanReview`** (logs **`> HITL dedupe:`**). |
