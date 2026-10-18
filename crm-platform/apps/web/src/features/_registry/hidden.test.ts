import { describe, expect, it } from 'vitest';
import { CAPABILITIES_UNKNOWN, hiddenByPersona, resolveNav, resolveNavAll } from './resolve';
import { resolveSettings } from './settings-resolve';
import { settingsTile, type SettingsTile } from './settings-types';
import type { Capabilities, NavItem } from './types';

/** `Capabilities.hidden`: the persona's hidden ids, applied before the gates (docs/specs/persona-profiles.md, section 7.2). */

const nav = (id: string, over: Partial<NavItem> = {}): NavItem => ({
  id,
  group: 'sales',
  labelKey: `x.${id}`,
  href: `/${id}`,
  ...over,
});
const tile = (id: string, over: Partial<SettingsTile> = {}): SettingsTile =>
  settingsTile({ id, section: 'data', href: `/${id}`, icon: 'x', ...over });
const withHidden = (hidden: string[] | null, over: Partial<Capabilities> = {}): Capabilities => ({
  ...CAPABILITIES_UNKNOWN,
  ...over,
  hidden: hidden && new Set(hidden),
});

describe('hiddenByPersona', () => {
  it('is false for null, undefined and an empty set', () => {
    expect(hiddenByPersona({ hidden: null }, 'nav:a')).toBe(false);
    expect(hiddenByPersona({}, 'nav:a')).toBe(false);
    expect(hiddenByPersona({ hidden: new Set() }, 'nav:a')).toBe(false);
  });
  it('is true only for an id in the set', () => {
    expect(hiddenByPersona({ hidden: new Set(['nav:a']) }, 'nav:a')).toBe(true);
    expect(hiddenByPersona({ hidden: new Set(['nav:a']) }, 'nav:b')).toBe(false);
  });
});

describe('menu with hidden modules', () => {
  const items = [
    nav('a'),
    nav('b', { gates: { planFeature: 'pro' } }),
    nav('c', { gates: { permission: 'c.read' } }),
    nav('hub', { href: '/account/hub' }),
  ];

  it('is unchanged when nothing is hidden, whatever the way nothing is spelled', () => {
    const base = resolveNavAll(items, CAPABILITIES_UNKNOWN);
    for (const hidden of [null, [] as string[]])
      expect(resolveNavAll(items, withHidden(hidden))).toEqual(base);
    expect(resolveNavAll(items, { permissions: null, planFeatures: null, channels: null })).toEqual(
      base,
    );
  });

  it('drops a hidden entry, hub panes included, and keeps the rest', () => {
    const r = resolveNavAll(items, withHidden(['nav:a', 'nav:hub']));
    expect(r.map((i) => i.id)).toEqual(['b', 'c']);
    expect(resolveNav(items, withHidden(['nav:a'])).map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('draws a hidden entry that the plan would lock as nothing: no lock, no upsell', () => {
    const caps = withHidden(null, { planFeatures: new Set(), permissions: new Set(['c.read']) });
    expect(resolveNav(items, caps).find((i) => i.id === 'b')?.locked).toBe(true);
    expect(
      resolveNav(items, { ...caps, hidden: new Set(['nav:b']) }).find((i) => i.id === 'b'),
    ).toBeUndefined();
  });

  it('hides a planned "coming soon" entry by its id too', () => {
    const r = resolveNavAll([nav('a')], withHidden(['nav:later']), { planned: [nav('later')] });
    expect(r.map((i) => i.id)).toEqual(['a']);
  });

  it('a module id of another kind never hides a menu entry', () => {
    const r = resolveNavAll(items, withHidden(['tile:a', 'section:contact.a']));
    expect(r.map((i) => i.id)).toEqual(['a', 'b', 'c', 'hub']);
  });
});

describe('Settings tiles with hidden modules', () => {
  const tiles = [tile('x'), tile('y', { gates: { planFeature: 'pro' } }), tile('z')];

  it('drops a hidden tile and keeps the rest', () => {
    expect(resolveSettings(tiles, withHidden(['tile:x'])).map((t) => t.id)).toEqual(['y', 'z']);
  });
  it('is unchanged with nothing hidden', () => {
    expect(resolveSettings(tiles, withHidden([]))).toEqual(
      resolveSettings(tiles, CAPABILITIES_UNKNOWN),
    );
  });
  it('a hidden plan-gated tile draws no lock', () => {
    const caps = withHidden(['tile:y'], { planFeatures: new Set() });
    expect(resolveSettings(tiles, caps).map((t) => t.id)).toEqual(['x', 'z']);
  });
  it('a nav id never hides a tile', () => {
    expect(resolveSettings(tiles, withHidden(['nav:x'])).map((t) => t.id)).toEqual(['x', 'y', 'z']);
  });
});
