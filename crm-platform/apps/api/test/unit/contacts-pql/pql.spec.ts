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
  it('finds the object inside a sentence around it', () => {
    const text =
      'Here is the filter you asked for: {"rules":null,"summary":"x","ignored":[]} Hope it helps.';
    expect(parsePql(text)).toEqual({ rules: null, summary: 'x', ignored: [] });
  });
  it('refuses text that is not a JSON object', () => {
    expect(parsePql('nope')).toBeNull();
    expect(parsePql('[1, 2]')).toBeNull();
  });
  it('passes a tree the schema would refuse on to pruneRules, which drops only that condition', () => {
    const rules = {
      type: 'group',
      combinator: 'and',
      children: [cond('name', 'drop_table', 'x'), cond('name', 'contains', 'a')],
    };
    const answer = parsePql(JSON.stringify({ rules, summary: 's', ignored: [] }));
    expect(answer).not.toBeNull();
    const r = pruneRules(answer!.rules, catalog);
    expect(r.dropped).toEqual(['name']);
    expect(r.rules?.children).toEqual([cond('name', 'contains', 'a')]);
  });
  it('cuts a long summary and ignored list to the contract limits', () => {
    const answer = parsePql(
      JSON.stringify({ rules: null, summary: 'x'.repeat(400), ignored: ['y'.repeat(300), 3] }),
    );
    expect(answer?.summary).toHaveLength(300);
    expect(answer?.ignored).toEqual(['y'.repeat(120)]);
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
  it('drops a tag written as a name instead of its id, and keeps the rest', () => {
    const r = pruneRules(
      group(cond('tags', 'has_any', ['vip']), cond('custom.city', 'equals', 'Pune')),
      catalog,
    );
    expect(r.dropped).toEqual(['tags']);
    expect(r.rules?.children).toHaveLength(1);
  });
  it('drops a built-in condition with an operator its field does not have', () => {
    const r = pruneRules(
      group(cond('name', 'matches', 'vip'), cond('name', 'contains', 'vip')),
      catalog,
    );
    expect(r.dropped).toEqual(['name']);
    expect(r.rules?.children).toEqual([cond('name', 'contains', 'vip')]);
  });
  it('drops a condition with no value where one is needed', () => {
    const r = pruneRules(group(cond('name', 'contains')), catalog);
    expect(r.rules).toBeNull();
    expect(r.dropped).toEqual(['name']);
  });
  it('drops a group nested deeper than the schema allows, and the conditions under it', () => {
    const deep = group(group(group(group(cond('custom.city', 'equals', 'Pune')))));
    const r = pruneRules(deep, catalog);
    expect(r.rules).toBeNull();
    expect(r.dropped).toEqual(['group']);
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
