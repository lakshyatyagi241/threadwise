import { describe, expect, it } from 'vitest';
import { CAPABILITIES_UNKNOWN, compareNav, mergePlanned, resolveNav } from './resolve';
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
    const merged = mergePlanned([{ id: 'chat', group: 'inbox', labelKey: 'x', href: '/chat' }], planned);
    expect(merged.map((m) => m.item.id)).toEqual(['chat', 'flows', 'deals']);
  });

  it('keeps the group order, then order, across real and planned items', () => {
    const ids = resolveNav(real, CAPABILITIES_UNKNOWN, { planned }).map((i) => i.id);
    expect(ids).toEqual(['quick', 'contacts', 'deals', 'flows']);
  });

  it('applies gates to planned entries too', () => {
    const gated: NavItem[] = [
      { id: 'tg', group: 'store', labelKey: 't', href: '/telegram', gates: { channel: 'telegram' } },
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
    expect([...list].sort(compareNav).map((i) => i.group)).toEqual(['overview', 'help', 'settings']);
  });
});
