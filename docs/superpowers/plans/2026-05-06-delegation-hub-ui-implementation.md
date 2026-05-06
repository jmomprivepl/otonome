# Delegation Hub UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved [Delegation Hub UI spec](../specs/2026-05-06-delegation-hub-ui-design.md): global delegation shell (Hermes + monitoring) on logged-in workspace routes, hybrid minimized strip on focus-class routes below **1280px**, engine remains at **`/engine`**, and time-sensitive human-in-the-loop modals layered on existing HITL infrastructure.

**Architecture:** Introduce **pure routing rules** (`delegationShellRules`) tested with Vitest. Add a **delegation layout** above authenticated routes that renders **full three-region workspace** (Hermes column + monitoring column + page `Outlet`) or a **minimized top strip** with approval + count badges when rules fire. Lift **Hermes chat** (`OtonomeChat`) and **monitoring** (`DelegationMonitoringColumn`) into that layout so `/` only supplies “home workspace” chrome. Persist **Tasks board vs list** in the Kanban store so `/tasks` focus-class detection matches the spec. Extend HITL payloads or **wrappers** with a **`timeSensitive`** flag consumed by modal host to meet **§8** without duplicating queues.

**Tech Stack:** React 18, react-router-dom 7, TypeScript, Vite, Vitest (Node environment), Zustand, Tailwind 4, Tauri events for HITL.

---

## File structure map (target)

| File | Responsibility |
| --- | --- |
| `src/lib/delegationShellRules.ts` | Pure functions: focus-class route detection, minimize decision, badge count inputs. |
| `src/lib/delegationShellRules.test.ts` | Vitest coverage for all rule branches. |
| `src/store.ts` | New slices: `tasksWorkspaceLayout`, optional `delegationShellExpandedOverride`, HITL `timeSensitive` fields if needed. |
| `src/components/delegation/DelegationAppShell.tsx` | Observes `pathname`, viewport width, store; renders full vs minimized chrome; hosts `Outlet` for page body. |
| `src/components/delegation/DelegationMinimizedStrip.tsx` | Top strip UI: expand, approval signal, SOP/job counts. |
| `src/components/delegation/DelegationHubHomeBody.tsx` | Replace inline hub body: short intro / empty state inside workspace region only. |
| `src/components/delegation/DelegationHubScreen.tsx` | Thin wrapper or deleted after shell owns layout (keep route target stable during migration). |
| `src/App.tsx` | Nest authenticated routes under `DelegationAppShell`; keep `Landing`, `Onboarding`, `Auth` outside. |
| `src/components/TasksScreen.tsx` | Read/write `tasksWorkspaceLayout` in store when toggling Board/List. |
| `src/components/AgentHitlBridge.tsx` (or modal components) | Gate **extra** prominence for `timeSensitive` approvals (§8.2). |
| `src/types/agentDag.ts` | Optional `timeSensitive?: boolean` on pending payload types (backward compatible). |

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

### Task 6: Delegation expanded override in store

**Files:**
- Modify: `src/store.ts`

- [ ] **Step 1: Add persisted session flag**

Add `delegationShellExpanded: boolean` default `false` and `setDelegationShellExpanded: (v: boolean) => void`.

When **true**, `DelegationAppShell` passes `userExpandedOverride: true` into `shouldMinimizeDelegationShell` (Task 7).

Alternatively use **sessionStorage** in the shell component only — store is simpler for prototyping.

- [ ] **Step 2: Commit**

```bash
git add src/store.ts
git commit -m "feat(delegation): allow user-expanded shell override"
```

---

### Task 7: DelegationAppShell layout + App.tsx nesting

**Files:**
- Create: `src/components/delegation/DelegationAppShell.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/delegation/DelegationHubScreen.tsx` (reduce to workspace-only body)
- Create: `src/components/delegation/DelegationHubHomeBody.tsx`

- [ ] **Step 1: Extract home body**

Move the intro paragraphs from `DelegationHubScreen.tsx` into `DelegationHubHomeBody.tsx` — static content component.

- [ ] **Step 2: Implement `DelegationAppShell`**

Skeleton structure:

```typescript
import { Outlet, useLocation } from 'react-router-dom';
import { useKanbanStore } from '@/store';
import { Header } from '@/components/Header';
import { OtonomeChat } from '@/components/OtonomeChat';
import { DelegationMonitoringColumn } from '@/components/delegation/DelegationMonitoringColumn';
import { DelegationMinimizedStrip } from '@/components/delegation/DelegationMinimizedStrip';
import { useViewportInnerWidth } from '@/hooks/useViewportInnerWidth';
import {
  shouldMinimizeDelegationShell,
} from '@/lib/delegationShellRules';
import { computeDelegationStripCounts } from '@/lib/delegationMonitoringCounts';

export function DelegationAppShell({
  sidebarCollapsed,
}: {
  sidebarCollapsed: boolean;
}) {
  const { pathname } = useLocation();
  const vw = useViewportInnerWidth();
  const tasksWorkspaceLayout = useKanbanStore((s) => s.tasksWorkspaceLayout);
  const delegationShellExpanded = useKanbanStore((s) => s.delegationShellExpanded);
  const setDelegationShellExpanded = useKanbanStore((s) => s.setDelegationShellExpanded);

  /* derive pending approvals count from existing HITL selectors — same predicates as DelegationMonitoringColumn uses */
  const pendingAction = useKanbanStore((s) => s.pendingActionApproval);
  const pendingClarification = useKanbanStore((s) => s.pendingClarification);
  const pendingHuman = useKanbanStore((s) => s.pendingHumanReview);
  const hermesActivity = useKanbanStore((s) => s.delegationHermesActivity);
  const dag = useKanbanStore((s) => s.activeDagRun);

  let pendingApprovalsCount = 0;
  if (pendingAction != null) pendingApprovalsCount += 1;
  if (pendingClarification != null) pendingApprovalsCount += 1;
  if (pendingHuman != null) pendingApprovalsCount += 1;

  const stripCounts = computeDelegationStripCounts({
    pendingApprovalsCount,
    hermesActivity: hermesActivity,
    dag,
  });

  const minimized =
    vw != null &&
    shouldMinimizeDelegationShell(pathname, tasksWorkspaceLayout, vw, delegationShellExpanded);

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900">
      <Header sidebarCollapsed={sidebarCollapsed} />
      <div className={`pt-[73px] transition-all duration-300 ${sidebarCollapsed ? 'pl-16' : 'pl-64'}`}>
        {minimized ? (
          <div className="flex min-h-[calc(100vh-73px)] min-w-0 flex-col">
            <DelegationMinimizedStrip
              {...stripCounts}
              onExpand={() => setDelegationShellExpanded(true)}
            />
            <main className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
              <Outlet />
            </main>
          </div>
        ) : (
          <div className="mx-auto flex min-h-[calc(100vh-73px)] max-w-[1920px] min-w-0 flex-col gap-0 lg:flex-row lg:items-stretch">
            <section className="flex min-h-0 min-w-0 flex-1 flex-col p-3 sm:p-4">
              <div className="mb-2 px-1">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Delegate</p>
              </div>
              <div className="min-h-0 flex-1">
                <OtonomeChat />
              </div>
            </section>
            <aside className="min-h-0 w-full shrink-0 overflow-y-auto border-t border-violet-200/40 dark:border-violet-800/30 lg:w-auto lg:max-w-md lg:border-l lg:border-t-0 lg:pb-4 lg:pr-4">
              <DelegationMonitoringColumn />
            </aside>
            <main className="hidden min-h-0 flex-1 min-w-[240px] flex-col gap-4 border-l border-violet-200/30 bg-white/40 p-3 dark:border-violet-800/20 dark:bg-slate-950/40 lg:flex lg:max-w-[min(920px,50vw)]">
              <Outlet />
            </main>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Important layout correction:** The spec wants **Hermes center + monitoring + workspace**. On **wide screens**, typical order is **[Hermes | Monitoring | Outlet]** OR **[Hermes | stacked Monitoring+Outlet]** — align with designer QA. The snippet above puts **Outlet as third column** on `lg`; adjust Tailwind breakpoints if cramped.

Provide **Collapse** control when expanded on narrow routes: add button in Hermes header area calling `setDelegationShellExpanded(false)`.

Wire `DelegationHubScreen` route to render only `<DelegationHubHomeBody />` inside the shell Outlet.

- [ ] **Step 3: Refactor `App.tsx` routes**

Nest post-onboarding authenticated routes inside a wrapper:

```typescript
<Route element={isLoggedIn && showDashboard ? <DelegationAppShell sidebarCollapsed={sidebarCollapsed} /> : <Navigate to="/" />} >
  <Route path="/" element={<DelegationHubHomeBody />} />
  <Route path="/engine" element={<NsdarCommandCenter ... />} />
  <Route path="/overview" element={<Dashboard ... />} />
  {/* move remaining logged-in routes here */}
</Route>
```

**Route props (office manager, chat toggles):** `App` cannot pass props through `<Outlet />` by default. Use **`<Outlet context={{ officeManager, setOfficeManager, chatSidebarOpen, setChatSidebarOpen }} />`** in `DelegationAppShell` and **`useOutletContext()`** in `NsdarCommandCenter`, `Dashboard`, and `SettingsScreen` (or a tiny typed hook `useAppShellOutletContext()`). Alternatively lift those into an existing React context provider — pick one pattern and use it consistently.

**Reset expand override on navigation:** When `pathname` changes, set `delegationShellExpanded` back to `false` so each new screen re-evaluates minimize rules unless the user re-expands.

**`/` home column:** If the three-column `lg` layout feels cramped for the hub, hide the third **Outlet** column on `pathname === '/'` and let **Hermes + monitoring** span as today; keep three columns for operational routes.

**Floating ChatSidebar:** `hideFloatingChatRoutes` should expand to suppress duplicate chat wherever `OtonomeChat` appears in shell (likely **all routes inside shell**). Set `hideFloatingChatRoutes` to always hide when redesign complete, except verify `Landing`/`Auth`.

- [ ] **Step 4: Run dev smoke**

Run: `npm run dev`  
Navigate `/`, `/tasks`, `/agent-sop/edit/x`, resize below 1280 — confirm strip toggles.

- [ ] **Step 5: Run tests**

Run: `npm test`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/delegation/DelegationAppShell.tsx src/components/delegation/DelegationHubHomeBody.tsx src/components/delegation/DelegationHubScreen.tsx src/App.tsx
git commit -m "feat(delegation): add global DelegationAppShell with hybrid minimize"
```

---

### Task 8: Header duplication and onboarding guard

**Files:**
- Modify: `src/components/TasksScreen.tsx`, `ProjectsScreen.tsx`, `SopGraphScreen.tsx`, `PlaygroundScreen.tsx`, etc.

- [ ] **Step 1: Remove per-screen `Header` + outer `pl-64/pt` wrappers**

Once `DelegationAppShell` renders `Header` and padding, delete duplicate layout framing from children **only where the route is nested under the shell**. Keep `Landing`/`Onboarding` unaffected.

Do this incrementally route-by-route to avoid breakage.

- [ ] **Step 2: Commit per cluster**

Prefer one commit per screen family (Tasks, Projects, SOP suite).

---

### Task 9: Time-sensitive approvals (§8.3 wiring)

**Files:**
- Modify: `src/types/agentDag.ts`
- Modify: `src/components/AgentHitlBridge.tsx` or individual modals (`ActionApprovalModal.tsx`, etc.)

- [ ] **Step 1: Extend payload types**

```typescript
/** When true, show additional lightweight blocking modal prominence (Delegation spec §8.2). */
timeSensitive?: boolean;
```

Attach to `ActionPendingPayload`, `ClarificationPayload`, `HumanReviewPayload` optionally.

Rust side can default absent field to undefined — frontend treats falsy as non-urgent.

- [ ] **Step 2: Modal behavior**

When `timeSensitive === true`, add **`modal` + `backdrop` semantics** (`aria-modal="true"` already if present): ensure **`role="dialog"`** traps focus briefly; stacking over minimized strip.

When `false`, keep existing modals (still shown) but skip extra **backdrop blur / ring** affordance reserved for urgent class.

Implement as a **`variant`** prop forwarded from bridge.

- [ ] **Step 3: Product policy stub**

Centralize heuristic in **`src/domain/hitlTimeSensitivity.ts`**:

```typescript
export function inferTimeSensitiveFromPayload(p: {
  destructive?: boolean;
  category?: string;
  slaSecondsRemaining?: number;
  riskScore?: number;
}): boolean {
  if (p.destructive) return true;
  if (p.slaSecondsRemaining != null && p.slaSecondsRemaining < 120) return true;
  if (p.riskScore != null && p.riskScore >= 0.85) return true;
  if (p.category === 'regulated') return true;
  return false;
}
```

Call from event listeners **before** storing into Zustand when backend does not supply `timeSensitive`.

- [ ] **Step 4: Test helper**

Create `src/domain/hitlTimeSensitivity.test.ts` with table-driven expectations for `inferTimeSensitiveFromPayload`.

- [ ] **Step 5: Commit**

```bash
git add src/types/agentDag.ts src/domain/hitlTimeSensitivity.ts src/domain/hitlTimeSensitivity.test.ts src/components/AgentHitlBridge.tsx
git commit -m "feat(hitl): add time-sensitive approval highlighting"
```

---

### Task 10: Documentation and regression checklist

**Files:**
- Modify: `docs/superpowers/specs/2026-05-06-delegation-hub-ui-design.md` (add “Implementation notes” link to this plan if desired)

- [ ] **Step 1: Manual QA script** (execute in Tauri + browser)

1. Log in, complete onboarding: `/` shows Hermes + monitoring + home body.  
2. Visit `/engine`: engine works; on narrow width **if** treated as focus in future, verify strip (optional).  
3. `/tasks` board + narrow window → minimized strip; counts match visible HITL state.  
4. Switch Tasks to **List** at narrow width → shell **full** returns.  
5. `/agent-sop/edit/...` + narrow → strip; **Expand** restores columns; **Collapse** returns.  
6. Trigger HITL event with `timeSensitive: true` → modal prominence.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-05-06-delegation-hub-ui-implementation.md
git commit -m "docs(delegation): link implementation plan QA checklist"
```

---

## Plan self-review (author)

1. **Spec coverage:** §5 routing (`/` hub, `/engine`) — Task 7; §6 full shell — Task 7; §7 hybrid minimize — Tasks 1–7; §8 approvals — existing column + Task 9; §9 tasks board vs list — Task 2; §10 a11y — ensure `DelegationMinimizedStrip` buttons have labels (add `aria-label` on Expand in Task 4 before merge).  
2. **Placeholder scan:** No `TBD` steps; counts helper notes explicit limitation for multi-run future.  
3. **Type consistency:** `TasksWorkspaceLayout` duplicated in `delegationShellRules` and store — **export type from rules file** and `import type` in `store.ts` in implementation to avoid drift.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-06-delegation-hub-ui-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach do you want?**
