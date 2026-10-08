import { describe, expect, it } from 'vitest';
import type { NavItem } from '@/features/_registry/types';
import {
  OWN_TABS,
  buildHubTabs,
  currentTab,
  resolveTabParam,
  tabRedirect,
  tabsFromNav,
} from './hub-tabs';

const wallet: NavItem = {
  id: 'wallet',
  group: 'settings',
  labelKey: 'wallet.nav.account',
  href: '/account/wallet',
  order: 30,
};
const apiKeys: NavItem = {
  id: 'api-keys',
  group: 'settings',
  labelKey: 'integrations.nav.keys',
  href: '/account/api-keys',
  order: 105,
};

describe('tabsFromNav', () => {
  it('turns another domain’s /account/<name> entry into a hub pane, placed by order', () => {
    const [w, k] = tabsFromNav([wallet, apiKeys]);
    expect(w).toMatchObject({ id: 'wallet', href: '/account/wallet', group: 'account', order: 30 });
    expect(k).toMatchObject({ id: 'api-keys', group: 'security' });
  });

  it('ignores entries that are not a single /account/<name> segment', () => {
    const items: NavItem[] = [
      { id: 'a', group: 'audience', labelKey: 'x', href: '/contacts' },
      { id: 'b', group: 'settings', labelKey: 'x', href: '/account' },
      { id: 'c', group: 'settings', labelKey: 'x', href: '/account/a/b' },
      { id: 'd', group: 'settings', labelKey: 'x', href: '/accounting/x' },
    ];
    expect(tabsFromNav(items)).toEqual([]);
  });

  it('never shadows one of this domain’s own panes', () => {
    const clash: NavItem = { ...wallet, id: 'profile2', href: '/account/profile' };
    const clashId: NavItem = { ...wallet, id: 'security', href: '/account/other' };
    expect(tabsFromNav([clash, clashId])).toEqual([]);
  });

  it('carries the lock state of a plan-gated entry', () => {
    const [w] = tabsFromNav([{ ...wallet, locked: true }]);
    expect(w?.locked).toBe(true);
  });
});

describe('buildHubTabs', () => {
  it('orders the rail like Reference: profile, plan, other panes, then the Security group', () => {
    const tabs = buildHubTabs(tabsFromNav([wallet, apiKeys]));
    expect(tabs.map((t) => t.id)).toEqual([
      'profile',
      'plan',
      'wallet',
      'security',
      'api-keys',
      'delete',
    ]);
    expect(tabs.filter((t) => t.group === 'security').map((t) => t.id)).toEqual([
      'security',
      'api-keys',
      'delete',
    ]);
  });
});

describe('currentTab', () => {
  const tabs = buildHubTabs(tabsFromNav([wallet]));
  it('matches the pane the path is on, including sub-paths', () => {
    expect(currentTab('/account/security', tabs)?.id).toBe('security');
    expect(currentTab('/account/wallet/top-up', tabs)?.id).toBe('wallet');
  });
  it('is undefined outside the hub', () => {
    expect(currentTab('/contacts', tabs)).toBeUndefined();
    expect(currentTab('/account/walletx', tabs)).toBeUndefined();
  });
});

describe('resolveTabParam', () => {
  const tabs = buildHubTabs(tabsFromNav([wallet]));
  it('maps Reference tab names, including the password alias', () => {
    expect(resolveTabParam('password', tabs).href).toBe('/account/security');
    expect(resolveTabParam('delete', tabs).href).toBe('/account/delete');
    expect(resolveTabParam('profile', tabs).href).toBe('/account/profile');
    expect(resolveTabParam('plan', tabs).href).toBe('/account/plans');
  });
  it('finds a pane another domain registered', () => {
    expect(resolveTabParam('wallet', tabs).href).toBe('/account/wallet');
  });
  it('ignores case and spaces', () => {
    expect(resolveTabParam('  PASSWORD ', tabs).id).toBe('security');
  });
  it('falls back to the profile for unknown, empty or missing names', () => {
    expect(resolveTabParam('nope', tabs).id).toBe('profile');
    expect(resolveTabParam('', tabs).id).toBe('profile');
    expect(resolveTabParam(undefined, tabs).id).toBe('profile');
    expect(resolveTabParam(null, tabs).id).toBe('profile');
  });
  it('takes the first of a repeated parameter', () => {
    expect(resolveTabParam(['delete', 'password'], tabs).id).toBe('delete');
  });
});

describe('tabRedirect', () => {
  const tabs = buildHubTabs([]);
  it('goes to the pane route and keeps the other parameters', () => {
    expect(tabRedirect({ tab: 'password', required: 'mfa' }, tabs)).toBe(
      '/account/security?required=mfa',
    );
    expect(tabRedirect({ tab: 'delete' }, tabs)).toBe('/account/delete');
  });
  it('lands on the profile without a usable tab', () => {
    expect(tabRedirect({}, tabs)).toBe('/account/profile');
    expect(tabRedirect({ tab: 'zzz' }, tabs)).toBe('/account/profile');
  });
  it('sends the old Branding tab to the Message footer Settings page', () => {
    expect(tabRedirect({ tab: 'branding' }, tabs)).toBe('/settings/message-footer');
    expect(tabRedirect({ tab: ' Branding ', x: '1' }, tabs)).toBe('/settings/message-footer?x=1');
  });
  it('the rail no longer lists Branding or Plan and usage', () => {
    const ids = buildHubTabs(tabsFromNav([])).map((t) => t.id);
    expect(ids).not.toContain('branding');
    expect(ids).not.toContain('plan-usage');
    expect(OWN_TABS.map((t) => t.href)).not.toContain('/account/branding');
  });
  it('every own pane is reachable by its own id', () => {
    for (const tab of OWN_TABS) {
      expect(tabRedirect({ tab: tab.id }, tabs)).toBe(tab.href);
    }
  });
});
