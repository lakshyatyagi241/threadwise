import { describe, expect, it } from 'vitest';
import type { SegmentGroup } from '@crm/contracts';
import { parsePql, pqlPrompt, type PqlCatalog } from '../../../src/modules/contacts-pql/pql.prompt';
import { pruneRules } from '../../../src/modules/contacts-pql/pql.prune';

const TAG = '11111111-1111-4111-8111-111111111111';
const catalog: PqlCatalog = {
  tags: [{ id: TAG, name: 'vip' }],
  groups: [],
  owners: [],
  stages: [{ value: 'lead', label: 'Lead' }],
  statuses: [],
  customFields: [{ key: 'city', label: 'City', kind: 'text' }],
  companyFields: [{ key: 'tier', label: 'Tier', kind: 'option' }],
};
const cond = (field: string, operator: string, value?: unknown) =>
  ({ type: 'condition', field, operator, value }) as never;
const group = (...children: unknown[]) =>
  ({ type: 'group', combinator: 'and', children }) as unknown as SegmentGroup;

describe('pruneRules', () => {
  it('keeps conditions that point at things the workspace has', () => {
    const r = pruneRules(
      group(cond('tags', 'has_any', [TAG]), cond('custom.city', 'equals', 'Pune')),
      catalog,
    );
    expect(r.dropped).toEqual([]);
    expect(r.rules?.children).toHaveLength(2);
  });
  it('drops an invented tag id, an unknown custom field and an unknown stage, and the emptied group', () => {
    const bad = '22222222-2222-4222-8222-222222222222';
    const r = pruneRules(
      group(
        cond('tags', 'has_any', [bad]),
        cond('custom.nope', 'equals', 'x'),
        group(cond('lifecycleStage', 'equals', 'ghost')),
      ),
      catalog,
    );
    expect(r.rules).toBeNull();
    expect(r.dropped.sort()).toEqual(['custom.nope', 'lifecycleStage', 'tags']);
  });
});

describe('parsePql', () => {
  it('reads a fenced answer', () => {
    const text = '```json\n{"rules":null,"summary":"x","ignored":[]}\n```';
    expect(parsePql(text)).toEqual({ rules: null, summary: 'x', ignored: [] });
  });
  it('refuses a tree with an unknown operator or non JSON', () => {
    expect(parsePql('nope')).toBeNull();
    const rules = { type: 'group', combinator: 'and', children: [cond('name', 'drop_table', 'x')] };
    expect(parsePql(JSON.stringify({ rules, summary: 's', ignored: [] }))).toBeNull();
  });
});

describe('pqlPrompt', () => {
  it('lists catalog names and never needs contact data', () => {
    const p = pqlPrompt('vip in pune', catalog, '2026-10-14');
    expect(p.system).toContain(`${TAG} vip`);
    expect(p.system).toContain('custom.city');
    expect(p.user).toBe('vip in pune');
  });
});

describe('pruneRules kinds', () => {
  it('drops a custom condition whose operator does not fit the field kind', () => {
    const r = pruneRules(
      group(cond('custom.city', 'gt', 5), cond('custom.city', 'equals', 'Pune')),
      catalog,
    );
    expect(r.dropped).toEqual(['custom.city']);
    expect(r.rules?.children).toHaveLength(1);
  });
});

describe('company properties in plain English search (BL-196)', () => {
  it('the prompt lists the company property keys and the field prefix, and still no contact data', () => {
    const p = pqlPrompt('contacts at gold companies', catalog, '2026-10-14');
    expect(p.system).toContain('company.tier "Tier" (option)');
    expect(p.system).toContain('"company.<key>"');
  });

  it('keeps a company condition that fits its property and drops an invented or ill-fitting one', () => {
    const r = pruneRules(
      group(
        cond('company.tier', 'equals', 'gold'),
        cond('company.nope', 'equals', 'x'),
        cond('company.tier', 'gt', 5),
      ),
      catalog,
    );
    expect(r.dropped.sort()).toEqual(['company.nope', 'company.tier']);
    expect(r.rules?.children).toHaveLength(1);
  });
});
