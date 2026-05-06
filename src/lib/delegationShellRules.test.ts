import { describe, expect, it } from 'vitest';
import {
  DELEGATION_SHELL_MINIMIZE_MAX_WIDTH_PX,
  isFocusClassRoute,
  shouldMinimizeDelegationShell,
} from './delegationShellRules';

describe('isFocusClassRoute', () => {
  it('treats SOP graph edit paths as focus-class', () => {
    expect(isFocusClassRoute('/agent-sop/edit/run-1', 'list')).toBe(true);
    expect(isFocusClassRoute('/agent-sop/edit/run-1/step', 'board')).toBe(true);
  });

  it('does not treat SOP list /agent-sop as focus-class', () => {
    expect(isFocusClassRoute('/agent-sop', 'board')).toBe(false);
    expect(isFocusClassRoute('/agent-sop/', 'list')).toBe(false);
  });

  it('treats playground routes as focus-class', () => {
    expect(isFocusClassRoute('/playground', 'list')).toBe(true);
    expect(isFocusClassRoute('/playground/extra', 'board')).toBe(true);
  });

  it('treats /tasks only as focus-class when tasks layout is board', () => {
    expect(isFocusClassRoute('/tasks', 'board')).toBe(true);
    expect(isFocusClassRoute('/tasks/', 'board')).toBe(true);
    expect(isFocusClassRoute('/tasks/item-1', 'board')).toBe(true);
    expect(isFocusClassRoute('/tasks', 'list')).toBe(false);
    expect(isFocusClassRoute('/tasks/foo', 'list')).toBe(false);
  });

  it('does not treat hub / as focus-class', () => {
    expect(isFocusClassRoute('/', 'board')).toBe(false);
    expect(isFocusClassRoute('/', 'list')).toBe(false);
  });
});

describe('shouldMinimizeDelegationShell', () => {
  it('returns false when viewport width is null', () => {
    expect(
      shouldMinimizeDelegationShell('/playground', 'board', null, false),
    ).toBe(false);
  });

  it('returns false when viewport is wider than the minimize breakpoint', () => {
    expect(
      shouldMinimizeDelegationShell(
        '/playground',
        'board',
        DELEGATION_SHELL_MINIMIZE_MAX_WIDTH_PX + 1,
        false,
      ),
    ).toBe(false);
  });

  it('minimizes at the breakpoint on a focus-class route', () => {
    expect(
      shouldMinimizeDelegationShell(
        '/playground',
        'list',
        DELEGATION_SHELL_MINIMIZE_MAX_WIDTH_PX,
        false,
      ),
    ).toBe(true);
  });

  it('does not minimize on non-focus routes when viewport is narrow', () => {
    expect(
      shouldMinimizeDelegationShell(
        '/overview',
        'board',
        DELEGATION_SHELL_MINIMIZE_MAX_WIDTH_PX - 1,
        false,
      ),
    ).toBe(false);
  });

  it('returns false when user expanded override is true', () => {
    expect(
      shouldMinimizeDelegationShell(
        '/playground',
        'board',
        400,
        true,
      ),
    ).toBe(false);
  });
});
