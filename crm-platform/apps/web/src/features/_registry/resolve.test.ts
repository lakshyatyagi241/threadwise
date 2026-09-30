import { describe, expect, it } from 'vitest';
import { CAPABILITIES_UNKNOWN, resolveNav } from './resolve';
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
