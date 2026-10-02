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
    expect(groups).toHaveLength(4);
    expect(groups.length).toBeGreaterThanOrEqual(3);
    expect(groups[3]!.items.map((i) => i.id)).toEqual(['system']);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['security', 'security-events']);
    expect(groups[1]!.items.map((i) => i.id)).toEqual([
      'registration',
      'social-login',
      'auth-pages',
    ]);
    expect(groups[2]!.items.map((i) => i.id)).toEqual(['plans']);
    expect(groups[3]!.items[0]!.id).toBe('settings-hub');
    // other domains append their own groups after these three
    expect(groups[3]!.items.map((i) => i.id)).toEqual([
      'i18n-languages',
      'i18n-providers',
      'i18n-usage',
    ]);
    expect(groups[3]!.items.map((i) => i.id)).toEqual(['addon-packs', 'extensions']);
    expect(groups[3]!.items.map((i) => i.id)).toEqual(['support-inbox']);
    expect(groups[3]!.items.map((i) => i.id)).toEqual(['ai-keys', 'ai-dashboard']);
    expect(groups[3]!.items.map((i) => i.id)).toEqual([
      'cms-frontend',
      'cms-blog',
      'cms-legal',
      'cms-contact',
    ]);
  });
});
