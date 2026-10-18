import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_FIELDS } from '@crm/contracts';
import type { FieldDef } from '@/features/segments';
import { companyCatalog, contactCatalog, dealCatalog, originField } from './catalog';

const origin = originField('Arrived through', (o) => `origin:${o}`);
const label = (id: string) => `L:${id}`;

describe('originField', () => {
  it('offers every way a record can arrive', () => {
    expect(origin.kind).toBe('option');
    expect(origin.options?.map((o) => o.value)).toEqual([
      'manual',
      'import',
      'inbound',
      'form',
      'lead',
      'api',
    ]);
  });
});

describe('contactCatalog', () => {
  const field = (id: string, group: FieldDef['group'] = 'who'): FieldDef => ({
    id,
    group,
    kind: 'text',
    label: { key: id },
    operators: ['equals'],
  });
  it('drops the owner and the free-text search, keeps properties, and adds origin', () => {
    const out = contactCatalog(
      [
        field('name'),
        field('owner'),
        field('search'),
        field('custom.tier', 'properties'),
        field('company.size', 'company'),
        field('nonsense'),
      ],
      origin,
    );
    expect(out.map((f) => f.id)).toEqual(['name', 'custom.tier', 'company.size', 'origin']);
  });
});

describe('companyCatalog', () => {
  const out = companyCatalog({
    label,
    origin,
    properties: [
      { key: 'tier', label: 'Tier', fieldType: 'select', options: [{ value: 'a', label: 'A' }] },
      { key: 'score', label: 'Computed', fieldType: 'formula', options: [] },
    ],
  });
  it('has every company field of the contract plus the workspace properties as custom.<key>', () => {
    const ids = out.map((f) => f.id);
    for (const id of Object.keys(ASSIGNMENT_FIELDS.company)) expect(ids).toContain(id);
    expect(ids).toContain('custom.tier');
    expect(ids).not.toContain('custom.score'); // formulas are computed, never stored
  });
  it('groups own fields as record and properties apart, with labels from the caller', () => {
    expect(out.find((f) => f.id === 'name')).toMatchObject({
      group: 'record',
      label: { text: 'L:name' },
    });
    expect(out.find((f) => f.id === 'custom.tier')).toMatchObject({
      group: 'properties',
      kind: 'option',
    });
  });
  it('never offers "is empty" on created and updated, which are always set', () => {
    const created = out.find((f) => f.id === 'createdAt')!;
    expect(created.operators).not.toContain('is_empty');
    expect(out.find((f) => f.id === 'address')!.operators).toContain('is_empty');
  });
});

describe('dealCatalog', () => {
  const out = dealCatalog({
    label,
    statusLabel: (s) => `S:${s}`,
    origin,
    pipelines: [
      {
        id: 'p1',
        name: 'Sales',
        stages: [
          { id: 's1', name: 'New' },
          { id: 's2', name: 'Won' },
        ],
      },
      { id: 'p2', name: 'Renewals', stages: [{ id: 's3', name: 'Due' }] },
    ],
  });
  const byId = (id: string) => out.find((f) => f.id === id)!;
  it('has every deal field of the contract', () => {
    expect(out.map((f) => f.id).sort()).toEqual(Object.keys(ASSIGNMENT_FIELDS.deal).sort());
  });
  it('feeds pipeline and stage with uuids, stages labelled under their pipeline', () => {
    expect(byId('pipeline').options).toEqual([
      { value: 'p1', label: 'Sales' },
      { value: 'p2', label: 'Renewals' },
    ]);
    expect(byId('stage').options?.map((o) => [o.value, o.label])).toEqual([
      ['s1', 'Sales › New'],
      ['s2', 'Sales › Won'],
      ['s3', 'Renewals › Due'],
    ]);
  });
  it('offers open, won and lost, and the right kinds for the rest', () => {
    expect(byId('status').options?.map((o) => o.value)).toEqual(['open', 'won', 'lost']);
    expect(byId('value').kind).toBe('number');
    expect(byId('currency').kind).toBe('text');
    expect(byId('hasContact').kind).toBe('boolean');
    expect(byId('expectedCloseDate').kind).toBe('date');
  });
  it('has no pipeline choices before the pipelines load', () => {
    const none = dealCatalog({ label, statusLabel: String, origin, pipelines: [] });
    expect(none.find((f) => f.id === 'stage')!.options).toEqual([]);
  });
});
