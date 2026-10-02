import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES_UNKNOWN,
  compareNav,
  isHubPane,
  mergePlanned,
  resolveNav,
  resolveNavAll,
} from './resolve';
import type { NavItem } from './types';

const items: NavItem[] = [
  {
    id: 'inbox',
    group: 'inbox',
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
    group: 'inbox',
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
    expect(r.every((i) => !i.locked && !i.comingSoon)).toBe(true);
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

describe('resolveNav with planned screens', () => {
  const planned: NavItem[] = [
    { id: 'flows', group: 'automation', labelKey: 'soon-flows', href: '/flows', order: 0 },
    { id: 'deals', group: 'audience', labelKey: 'soon-deals', href: '/deals', order: 5 },
    { id: 'quick', group: 'inbox', labelKey: 'soon-quick', href: '/chat', order: 5 },
  ];
  const real: NavItem[] = [
    { id: 'contacts', group: 'audience', labelKey: 'c', href: '/contacts', order: 0 },
    { id: 'flows', group: 'automation', labelKey: 'real-flows', href: '/flows', order: 3 },
  ];

  it('adds planned entries marked comingSoon and never locked', () => {
    const r = resolveNav(real, CAPABILITIES_UNKNOWN, { planned });
    expect(r.find((i) => i.id === 'deals')).toMatchObject({ comingSoon: true, locked: false });
    expect(r.find((i) => i.id === 'contacts')?.comingSoon).toBe(false);
  });

  it('lets a real item replace the planned one with the same id (flipping a screen on)', () => {
    const r = resolveNav(real, CAPABILITIES_UNKNOWN, { planned });
    const flows = r.filter((i) => i.id === 'flows');
    expect(flows).toHaveLength(1);
    expect(flows[0]).toMatchObject({ labelKey: 'real-flows', comingSoon: false });
  });

  it('also drops a planned entry whose address a real item already serves', () => {
    const merged = mergePlanned(
      [{ id: 'chat', group: 'inbox', labelKey: 'x', href: '/chat' }],
      planned,
    );
    expect(merged.map((m) => m.item.id)).toEqual(['chat', 'flows', 'deals']);
  });

  it('keeps the group order, then order, across real and planned items', () => {
    const ids = resolveNav(real, CAPABILITIES_UNKNOWN, { planned }).map((i) => i.id);
    expect(ids).toEqual(['quick', 'contacts', 'deals', 'flows']);
  });

  it('applies gates to planned entries too', () => {
    const gated: NavItem[] = [
      {
        id: 'tg',
        group: 'channels',
        labelKey: 't',
        href: '/telegram',
        gates: { channel: 'telegram' },
      },
    ];
    expect(resolveNav([], caps([], [], []), { planned: gated })).toEqual([]);
    expect(resolveNav([], caps([], [], ['telegram']), { planned: gated })).toHaveLength(1);
  });

  it('puts settings last and sorts overview first', () => {
    const list: NavItem[] = [
      { id: 'a', group: 'settings', labelKey: 'a', href: '/a' },
      { id: 'b', group: 'help', labelKey: 'b', href: '/b' },
      { id: 'c', group: 'overview', labelKey: 'c', href: '/c' },
    ];
    expect([...list].sort(compareNav).map((i) => i.group)).toEqual([
      'overview',
      'help',
      'settings',
    ]);
  });
});
