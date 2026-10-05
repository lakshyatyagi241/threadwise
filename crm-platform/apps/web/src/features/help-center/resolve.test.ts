import { describe, expect, it } from 'vitest';
import { CAPABILITIES_UNKNOWN, resolveNavAll } from '@/features/_registry/resolve';
import { resolveSettings } from '@/features/_registry/settings-resolve';
import { settingsTile, type SettingsTile } from '@/features/_registry/settings-types';
import type { Capabilities, NavItem } from '@/features/_registry/types';
import { localized, resolveHelp, toIndex, visibleHelp } from './resolve';
import type { HelpDoc } from './types';

const nav = (id: string, over: Partial<NavItem> = {}): NavItem => ({
  id,
  group: 'sales',
  labelKey: `x.${id}`,
  href: `/${id}`,
  ...over,
});
const tile = (id: string, over: Partial<SettingsTile> = {}): SettingsTile =>
  settingsTile({ id, section: 'data', href: `/${id}`, icon: 'x', ...over });
const caps = (p: string[] | null, f: string[] | null, c: string[] | null = null): Capabilities => ({
  permissions: p && new Set(p),
  planFeatures: f && new Set(f),
  channels: c && new Set(c),
});
const doc = (id: string, over: Partial<HelpDoc> = {}): HelpDoc => ({
  id,
  area: 'sales',
  order: 100,
  documents: [],
  gates: {},
  keywords: [],
  routes: [],
  audience: 'workspace',
  domain: 'd',
  text: {
    en: {
      title: `Title ${id}`,
      summary: `About ${id}`,
      blocks: [
        { t: 'h', level: 2, id: 'one', text: 'One' },
        { t: 'p', inline: [{ t: 'text', v: 'Body' }] },
      ],
    },
  },
  ...over,
});

interface World {
  items?: NavItem[];
  planned?: NavItem[];
  tiles?: SettingsTile[];
  plannedTiles?: SettingsTile[];
}
/** Visible doc ids, with the menu and the Settings tiles resolved by the real resolvers (so locked/comingSoon are real). */
function visible(docs: HelpDoc[], c: Capabilities, w: World = {}) {
  const n = resolveNavAll(w.items ?? [], c, { planned: w.planned });
  const t = resolveSettings(w.tiles ?? [], c, { planned: w.plannedTiles });
  return resolveHelp(docs, n, t, c).map((d) => d.id);
}

describe('resolveHelp', () => {
  const open = caps([], []);

  it('shows a doc whose screen is built', () => {
    expect(
      visible([doc('a', { documents: ['nav:deals'] })], open, { items: [nav('deals')] }),
    ).toEqual(['a']);
    expect(
      visible([doc('a', { documents: ['tile:tax'] })], open, { tiles: [tile('tax')] }),
    ).toEqual(['a']);
  });

  it('hides a doc whose screen is only planned (coming soon)', () => {
    const d = doc('a', { documents: ['nav:deals', 'tile:tax'] });
    expect(visible([d], open, { planned: [nav('deals')], plannedTiles: [tile('tax')] })).toEqual(
      [],
    );
  });

  it('hides a doc whose screen is not declared at all', () => {
    expect(
      visible([doc('a', { documents: ['nav:ghost'] })], open, { items: [nav('deals')] }),
    ).toEqual([]);
  });

  it("removes (never locks) a doc when the plan lacks the screen's own feature", () => {
    const items = [nav('deals', { gates: { planFeature: 'sales_pipeline' } })];
    const d = doc('a', { documents: ['nav:deals'] });
    expect(visible([d], caps([], []), { items })).toEqual([]);
    expect(visible([d], caps([], ['sales_pipeline']), { items })).toEqual(['a']);
  });

  it('hides a doc whose own plan feature is missing', () => {
    const d = doc('a', { gates: { planFeature: 'automation' } });
    expect(visible([d], caps([], []))).toEqual([]);
    expect(visible([d], caps([], ['automation']))).toEqual(['a']);
  });

  it("hides a doc when the person lacks the screen's permission", () => {
    const items = [nav('deals', { gates: { permission: 'crm.deals.read' } })];
    const d = doc('a', { documents: ['nav:deals'] });
    expect(visible([d], caps([], []), { items })).toEqual([]);
    expect(visible([d], caps(['crm.deals.read'], []), { items })).toEqual(['a']);
  });

  it('hides a doc when the channel is unavailable', () => {
    const d = doc('a', { gates: { channel: 'telegram' } });
    expect(visible([d], caps([], [], []))).toEqual([]);
    expect(visible([d], caps([], [], ['telegram']))).toEqual(['a']);
  });

  it('is visible when at least one of its documented screens is available', () => {
    const items = [nav('deals', { gates: { permission: 'crm.deals.read' } })];
    const d = doc('a', { documents: ['nav:deals', 'tile:pipelines'] });
    expect(visible([d], caps([], []), { items, tiles: [tile('pipelines')] })).toEqual(['a']);
    expect(visible([d], caps([], []), { items })).toEqual([]);
  });

  it('keeps a guide with no documented screen unless its own gates fail', () => {
    expect(visible([doc('guide', { area: 'getting-started' })], open)).toEqual(['guide']);
    const gated = doc('g2', { area: 'getting-started', gates: { planFeature: 'automation' } });
    expect(visible([gated], open)).toEqual([]);
  });

  it('removes nothing when capabilities are unknown', () => {
    const items = [nav('deals', { gates: { planFeature: 'sales_pipeline', permission: 'x.y' } })];
    const docs = [
      doc('a', {
        documents: ['nav:deals'],
        gates: { planFeature: 'automation', channel: 'telegram' },
      }),
    ];
    expect(visible(docs, CAPABILITIES_UNKNOWN, { items })).toEqual(['a']);
  });

  it('hides operator-audience docs from the workspace', () => {
    expect(visible([doc('a', { audience: 'operator' })], open)).toEqual([]);
  });

  it('sorts by area, then order, then id', () => {
    const docs = [
      doc('z-guide', { area: 'getting-started', order: 1 }),
      doc('b', { area: 'sales', order: 5 }),
      doc('a', { area: 'sales', order: 5 }),
      doc('first', { area: 'sales', order: 1 }),
      doc('inbox', { area: 'inbox', order: 99 }),
    ];
    expect(visible(docs, open)).toEqual(['inbox', 'first', 'a', 'b', 'z-guide']);
  });
});

describe('localized', () => {
  const d = doc('a', {
    text: {
      en: { title: 'Contacts', summary: 'EN', blocks: [] },
      ar: {
        title: 'جهات الاتصال',
        summary: 'AR',
        blocks: [{ t: 'p', inline: [{ t: 'text', v: 'x' }] }],
      },
    },
  });

  it('returns the translation when there is one', () => {
    expect(localized(d, 'ar')).toMatchObject({
      title: 'جهات الاتصال',
      summary: 'AR',
      fallback: false,
    });
  });

  it('falls back to English, and says so, when the language has no translation', () => {
    expect(localized(d, 'fr')).toMatchObject({ title: 'Contacts', summary: 'EN', fallback: true });
  });

  it('is not a fallback when English is asked for', () => {
    expect(localized(d, 'en')).toMatchObject({ title: 'Contacts', fallback: false });
  });
});

describe('toIndex and visibleHelp', () => {
  const c = caps([], []);
  const world = {
    n: resolveNavAll([nav('a')], c, { planned: [nav('b')] }),
    t: resolveSettings([tile('c')], c),
  };

  it('collects the addresses of available screens plus explicit routes, without duplicates', () => {
    const d = doc('x', {
      documents: ['nav:a', 'nav:b', 'tile:c'],
      routes: ['/extra', '/a'],
      keywords: ['k'],
    });
    const [entry] = toIndex([d], world.n, world.t, 'en');
    expect(entry!.routes).toEqual(['/a', '/c', '/extra']);
    expect(entry).toMatchObject({
      id: 'x',
      title: 'Title x',
      summary: 'About x',
      keywords: ['k'],
      fallback: false,
      headings: [{ id: 'one', text: 'One', level: 2 }],
    });
  });

  it('localizes the entry and flags the fallback', () => {
    const [entry] = toIndex([doc('x')], world.n, world.t, 'fr');
    expect(entry!.fallback).toBe(true);
    expect(entry!.title).toBe('Title x');
  });

  it('visibleHelp returns the visible docs and their entries together', () => {
    const docs = [doc('a', { documents: ['nav:a'] }), doc('b', { documents: ['nav:b'] })];
    const view = visibleHelp(docs, world.n, world.t, c, 'en');
    expect(view.docs.map((x) => x.id)).toEqual(['a']);
    expect(view.entries.map((x) => x.id)).toEqual(['a']);
  });
});
