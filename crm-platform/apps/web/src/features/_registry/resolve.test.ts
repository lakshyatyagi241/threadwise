import { describe, expect, it } from 'vitest';
import { CAPABILITIES_UNKNOWN, isHubPane, resolveNav, resolveNavAll } from './resolve';
import type { NavItem } from './types';

const items: NavItem[] = [
  {
    id: 'inbox',
    group: 'messaging',
    labelKey: 'a',
    href: '/inbox',
    gates: { permission: 'inbox.conversation.read' },
  },
  {
    id: 'flows',
    group: 'automation',
    labelKey: 'b',
    href: '/flows',
    gates: { planFeature: 'access_flows' },
  },
  {
    id: 'tiktok',
    group: 'messaging',
    labelKey: 'c',
    href: '/tiktok',
    gates: { channel: 'tiktok' },
  },
  { id: 'home', group: 'overview', labelKey: 'd', href: '/dashboard' },
];
const caps = (p: string[], f: string[], c: string[]) => ({
  permissions: new Set(p),
  planFeatures: new Set(f),
  channels: new Set(c),
});

describe('resolveNav', () => {
  it('shows everything, unlocked, while capabilities are unknown', () => {
    const r = resolveNav(items, CAPABILITIES_UNKNOWN);
    expect(r).toHaveLength(4);
    expect(r.every((i) => !i.locked)).toBe(true);
  });

  it('removes items the user lacks a permission or channel for', () => {
    const ids = resolveNav(items, caps([], ['access_flows'], [])).map((i) => i.id);
    expect(ids).toEqual(['home', 'flows']);
  });

  it('keeps plan-gated items visible but locked', () => {
    const flows = resolveNav(items, caps(['inbox.conversation.read'], [], ['tiktok'])).find(
      (i) => i.id === 'flows',
    );
    expect(flows?.locked).toBe(true);
  });

  it('orders by group, then order, then id', () => {
    const ids = resolveNav(items, CAPABILITIES_UNKNOWN).map((i) => i.id);
    expect(ids).toEqual(['home', 'inbox', 'tiktok', 'flows']);
  });
});

describe('account hub panes', () => {
  const panes: NavItem[] = [
    { id: 'account', group: 'settings', labelKey: 'a', href: '/account', order: 90 },
    { id: 'plan', group: 'settings', labelKey: 'b', href: '/account/plans', order: 10 },
    { id: 'wallet', group: 'settings', labelKey: 'c', href: '/account/wallet', order: 20 },
    { id: 'settings', group: 'settings', labelKey: 'd', href: '/settings/general' },
    { id: 'deep', group: 'settings', labelKey: 'e', href: '/account/wallet/history' },
  ];

  it('recognises a pane by its address: /account/<one segment>', () => {
    expect(panes.map((p) => isHubPane(p))).toEqual([false, true, true, false, false]);
    expect(isHubPane({ href: '/account/Wallet' })).toBe(false);
    expect(isHubPane({ href: '/accounts/plans' })).toBe(false);
  });

  it('keeps hub panes out of the sidebar but leaves the Account entry and everything else', () => {
    const ids = resolveNav(panes, CAPABILITIES_UNKNOWN).map((i) => i.id);
    expect(ids).toContain('account');
    expect(ids).toContain('settings');
    expect(ids).toContain('deep');
    expect(ids).not.toContain('plan');
    expect(ids).not.toContain('wallet');
  });

  it('hands the hub every entry, panes included, with the same gating', () => {
    const gated: NavItem[] = [
      ...panes,
      {
        id: 'orders',
        group: 'settings',
        labelKey: 'f',
        href: '/account/orders',
        gates: { permission: 'orders.read' },
      },
    ];
    expect(resolveNavAll(gated, caps([], [], [])).map((i) => i.id)).not.toContain('orders');
    expect(resolveNavAll(gated, caps(['orders.read'], [], [])).map((i) => i.id)).toEqual(
      expect.arrayContaining(['plan', 'wallet', 'orders']),
    );
  });
});
