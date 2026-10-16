import { describe, expect, it } from 'vitest';
import { settingsTile, type SettingsTile } from '@/features/_registry/settings-types';
import type { NavItem } from '@/features/_registry/types';
import { coverage, unitsOf, type PendingEntry } from './coverage';
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
const doc = (id: string, over: Partial<HelpDoc> = {}): HelpDoc => ({
  id,
  area: 'sales',
  order: 1,
  documents: [],
  gates: {},
  keywords: [],
  routes: [],
  features: [],
  audience: 'workspace',
  domain: 'd',
  text: { en: { title: id, summary: id, blocks: [] } },
  ...over,
});
const pending = (unit: string, over: Partial<PendingEntry> = {}): PendingEntry => ({
  unit,
  owner: 'lakshya',
  reason: 'screen is mid-port',
  ...over,
});
const base = {
  nav: [nav('deals')],
  tiles: [tile('tax')],
  docs: [],
  planFeatureKeys: [],
  pending: [],
};

describe('unitsOf', () => {
  it('lists nav items, tiles and plan features, deduped and sorted', () => {
    expect(
      unitsOf([nav('b'), nav('a'), nav('a')], [tile('t')], ['zeta', 'alpha', 'alpha']),
    ).toEqual(['feature:alpha', 'feature:zeta', 'nav:a', 'nav:b', 'tile:t']);
  });
});

describe('coverage', () => {
  it('reports an undocumented nav item and tile as nav:<id> and tile:<id>', () => {
    expect(coverage(base).undocumented).toEqual(['nav:deals', 'tile:tax']);
  });

  it('covers a unit that some doc lists in documents', () => {
    const r = coverage({ ...base, docs: [doc('d1', { documents: ['nav:deals', 'tile:tax'] })] });
    expect(r.undocumented).toEqual([]);
  });

  it('covers feature:K through a doc gated on it', () => {
    const input = { ...base, nav: [], tiles: [], planFeatureKeys: ['automation'] };
    expect(coverage(input).undocumented).toEqual(['feature:automation']);
    const withDoc = coverage({
      ...input,
      docs: [doc('d', { gates: { planFeature: 'automation' } })],
    });
    expect(withDoc.undocumented).toEqual([]);
  });

  it('covers feature:K through a documented screen whose own gates carry it', () => {
    const r = coverage({
      nav: [nav('deals', { gates: { planFeature: 'sales_pipeline' } })],
      tiles: [],
      planFeatureKeys: ['sales_pipeline'],
      docs: [doc('d', { documents: ['nav:deals'] })],
      pending: [],
    });
    expect(r.undocumented).toEqual([]);
  });

  it('covers feature:K through a doc that only explains it (features), with no gate', () => {
    const input = { ...base, nav: [], tiles: [], planFeatureKeys: ['personal_history_full'] };
    expect(coverage(input).undocumented).toEqual(['feature:personal_history_full']);
    const withDoc = coverage({ ...input, docs: [doc('d', { features: ['personal_history_full'] })] });
    expect(withDoc.undocumented).toEqual([]);
  });

  it('leaves a pending unit out of undocumented', () => {
    const r = coverage({ ...base, pending: [pending('nav:deals')] });
    expect(r.undocumented).toEqual(['tile:tax']);
    expect(r.stalePending).toEqual([]);
    expect(r.badPending).toEqual([]);
  });

  it('calls a pending unit stale once it is documented', () => {
    const r = coverage({
      ...base,
      docs: [doc('d', { documents: ['nav:deals'] })],
      pending: [pending('nav:deals')],
    });
    expect(r.stalePending).toEqual(['nav:deals']);
  });

  it('calls a pending entry stale when it names no unit at all', () => {
    expect(coverage({ ...base, pending: [pending('nav:ghost')] }).stalePending).toEqual([
      'nav:ghost',
    ]);
  });

  it('flags an unknown owner, a blank reason and a duplicate entry', () => {
    const r = coverage({
      ...base,
      pending: [
        pending('nav:deals', { owner: 'someone' as PendingEntry['owner'] }),
        pending('tile:tax', { reason: '   ' }),
        pending('tile:tax'),
      ],
    });
    expect(r.badPending).toEqual(['nav:deals', 'tile:tax', 'tile:tax']);
  });
});
