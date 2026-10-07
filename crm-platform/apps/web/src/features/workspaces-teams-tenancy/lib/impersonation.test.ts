import { describe, expect, it } from 'vitest';
import { consolePathFrom, minutesLeft } from './impersonation';

describe('impersonation helpers', () => {
  it('counts whole minutes left, rounding down, and stops at zero', () => {
    const now = Date.parse('2026-10-07T10:00:00Z');
    expect(minutesLeft('2026-10-07T10:30:00Z', now)).toBe(30);
    expect(minutesLeft('2026-10-07T10:01:30Z', now)).toBe(1);
    expect(minutesLeft('2026-10-07T10:00:59Z', now)).toBe(0);
    expect(minutesLeft('2026-10-07T09:59:00Z', now)).toBe(0);
    expect(minutesLeft(null, now)).toBe(0);
  });

  it('keeps only the path of the console address the API names, never another host', () => {
    expect(consolePathFrom('https://app.example.test/admin/workspaces')).toBe('/admin/workspaces');
    expect(consolePathFrom('https://evil.test//attacker.test')).toBe('/admin/workspaces');
    expect(consolePathFrom('//evil.test/x')).toBe('/x');
    expect(consolePathFrom(undefined)).toBe('/admin/workspaces');
    expect(consolePathFrom(42)).toBe('/admin/workspaces');
  });
});
