import { describe, expect, it } from 'vitest';
import { OPERATOR_NAV, activeNavId, groupNav } from './operator-nav';

describe('activeNavId', () => {
  it('matches the exact page', () =>
    expect(activeNavId('/admin/security', OPERATOR_NAV)).toBe('security'));
  it('prefers the most specific entry', () =>
    expect(activeNavId('/admin/security/events', OPERATOR_NAV)).toBe('security-events'));
  it('matches nested paths', () =>
    expect(activeNavId('/admin/settings/auth-pages/anything', OPERATOR_NAV)).toBe('auth-pages'));
  it('does not match look-alike prefixes', () =>
    expect(activeNavId('/admin/securityx', OPERATOR_NAV)).toBeNull());
  it('returns null outside the menu', () =>
    expect(activeNavId('/admin/account/security', OPERATOR_NAV)).toBeNull());
});

describe('groupNav', () => {
  it('groups in first-seen order', () => {
    const groups = groupNav(OPERATOR_NAV);
    // The auth domain's own groups come first, in this order; other domains append theirs after them.
    expect(groups.slice(0, 3).map((g) => g.items.map((i) => i.id))).toEqual([
      ['security', 'security-events'],
      ['registration', 'social-login', 'auth-pages'],
      ['plans'],
    ]);
    expect(groups.length).toBeGreaterThan(3);
    const ids = OPERATOR_NAV.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(groups).toHaveLength(4);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['security', 'security-events']);
    expect(groups[1]!.items.map((i) => i.id)).toEqual([
      'registration',
      'social-login',
      'auth-pages',
    ]);
    expect(groups[2]!.items.map((i) => i.id)).toEqual(['plans']);
    expect(groups[3]!.items.map((i) => i.id)).toEqual(['system-health']);
    expect(groups[3]!.items.map((i) => i.id)).toEqual(['payment-gateways']);
    expect(groups[3]!.items.map((i) => i.id)).toEqual(['bsp-income', 'bsp-credit']);
  });
});
