import { describe, expect, it } from 'vitest';
import { isSidebarNavActive } from './sidebarNav';

describe('isSidebarNavActive', () => {
  it('matches / only exactly', () => {
    expect(isSidebarNavActive('/', '/')).toBe(true);
    expect(isSidebarNavActive('/', '/tasks')).toBe(false);
  });

  it('matches agent-sop prefix', () => {
    expect(isSidebarNavActive('/agent-sop', '/agent-sop')).toBe(true);
    expect(isSidebarNavActive('/agent-sop', '/agent-sop/edit/x')).toBe(true);
  });
});
