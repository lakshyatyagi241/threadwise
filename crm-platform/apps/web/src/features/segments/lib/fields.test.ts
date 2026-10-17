import { describe, expect, it } from 'vitest';
import {
  buildCatalog,
  dropMissingValues,
  fieldsByGroup,
  findField,
  invalidConditions,
  propertyFieldId,
  type Lookups,
} from './fields';
import { addCondition, conditionsOf, emptyRoot, newCondition, type Condition } from './model';

const lookups: Lookups = {
  stages: [
    { value: 'new', label: 'New' },
    { value: 'won', label: 'Won' },
  ],
  statuses: [{ value: 'open', label: 'Open' }],
  tags: [{ value: 't1', label: 'VIP' }],
  groups: [{ value: 'g1', label: 'Customers' }],
  users: [{ value: 'u1', label: 'Asha' }],
  properties: [
    { key: 'plan', label: 'Plan', fieldType: 'select', options: [{ value: 'pro', label: 'Pro' }] },
    {
      key: 'interests',
      label: 'Interests',
      fieldType: 'multiselect',
      options: [{ value: 'golf', label: 'Golf' }],
    },
    { key: 'visits', label: 'Visits', fieldType: 'integer', options: [] },
    { key: 'joined', label: 'Joined', fieldType: 'date', options: [] },
    { key: 'vip', label: 'VIP', fieldType: 'checkbox', options: [] },
    { key: 'calc', label: 'Calc', fieldType: 'formula', options: [] },
  ],
};
const catalog = buildCatalog(lookups);

describe('the field catalog', () => {
  it('groups fields as Journey, Who, Activity, Properties', () => {
    const groups = fieldsByGroup(catalog);
    expect(groups.map((g) => g.group)).toEqual(['journey', 'who', 'activity', 'properties']);
    const ids = (g: string) => groups.find((x) => x.group === g)!.fields.map((f) => f.id);
    expect(ids('journey')).toEqual(['lifecycleStage', 'status', 'leadScore']);
    expect(ids('who')).toEqual(
      expect.arrayContaining(['tags', 'groups', 'owner', 'source', 'unsubscribed', 'search']),
    );
    expect(ids('activity')).toEqual(['createdAt', 'updatedAt', 'lastActivityAt']);
  });

  it('does not offer the Lead score field while lead scoring is off, but still knows it for rules that use it', () => {
    const off = buildCatalog({ ...lookups, leadScoring: false });
    const journey = fieldsByGroup(off)
      .find((g) => g.group === 'journey')!
      .fields.map((f) => f.id);
    expect(journey).toEqual(['lifecycleStage', 'status']);
    // a saved segment that tests the score still reads: the field is not flagged as deleted
    expect(findField(off, 'leadScore')?.hidden).toBe(true);
    const r = emptyRoot();
    const tree = addCondition(
      r,
      r.id,
      newCondition({ id: 'leadScore', kind: 'number', operators: ['gte'] }),
    );
    expect(invalidConditions(tree, off, true).size).toBe(0);
    // on (or not said): offered as before
    for (const l of [lookups, { ...lookups, leadScoring: true }]) {
      const on = buildCatalog(l);
      expect(findField(on, 'leadScore')?.hidden).toBeUndefined();
    }
  });

  it('has only fields the contract knows (so the API accepts every rule the builder draws)', () => {
    for (const f of catalog) expect(f.kind, f.id).toBeTruthy();
  });

  it('hands each system field its choices', () => {
    expect(findField(catalog, 'lifecycleStage')?.options?.map((o) => o.label)).toEqual([
      'New',
      'Won',
    ]);
    expect(findField(catalog, 'tags')?.options?.[0]?.value).toBe('t1');
    expect(findField(catalog, 'owner')?.options?.[0]?.label).toBe('Asha');
    expect(findField(catalog, 'source')?.options).toBeUndefined();
  });

  it('created and updated are never empty, so they offer no "is empty"; last activity does ("never")', () => {
    expect(findField(catalog, 'createdAt')?.operators).not.toContain('is_empty');
    expect(findField(catalog, 'updatedAt')?.operators).not.toContain('is_not_empty');
    expect(findField(catalog, 'lastActivityAt')?.operators).toContain('is_empty');
  });

  it('turns custom properties into fields by type and leaves out computed ones', () => {
    expect(findField(catalog, propertyFieldId('plan'))).toMatchObject({
      kind: 'option',
      group: 'properties',
    });
    expect(findField(catalog, propertyFieldId('interests'))?.kind).toBe('multi');
    expect(findField(catalog, propertyFieldId('visits'))?.kind).toBe('number');
    expect(findField(catalog, propertyFieldId('joined'))?.kind).toBe('date');
    expect(findField(catalog, propertyFieldId('vip'))?.kind).toBe('boolean');
    expect(findField(catalog, propertyFieldId('calc'))).toBeUndefined();
    expect(propertyFieldId('plan')).toBe('custom.plan');
    expect(findField(catalog, 'custom.plan')?.options?.map((o) => o.value)).toEqual(['pro']);
  });
});

describe('references to things that were deleted', () => {
  const root = (c: Condition) => {
    const r = emptyRoot();
    return addCondition(r, r.id, c);
  };
  const cond = (
    field: string,
    operator: Condition['operator'],
    value: Condition['value'],
  ): Condition => ({
    ...newCondition({ id: field, kind: 'tags', operators: [operator] }),
    field,
    operator,
    value,
  });

  it('flags a deleted tag among the chosen ones, and names it', () => {
    const c = cond('tags', 'has_any', ['t1', 'gone']);
    const bad = invalidConditions(root(c), catalog, true);
    expect(bad.get(c.id)).toEqual({ type: 'values', missing: ['gone'] });
  });

  it('flags a deleted stage, group and owner the same way', () => {
    for (const [field, op, value] of [
      ['lifecycleStage', 'equals', 'old'],
      ['groups', 'has_all', ['g1', 'g9']],
      ['owner', 'in', ['u1', 'u9']],
    ] as const) {
      const c = cond(field, op, value as Condition['value']);
      expect(invalidConditions(root(c), catalog, true).get(c.id)?.type, field).toBe('values');
    }
  });

  it('flags a field that is not in the catalog (a deleted custom property)', () => {
    const c = cond('custom.deleted', 'equals', 'x');
    expect(invalidConditions(root(c), catalog, true).get(c.id)).toEqual({ type: 'field' });
  });

  it('flags nothing while the lookups are still loading, or when everything exists', () => {
    const c = cond('tags', 'has_any', ['gone']);
    expect(invalidConditions(root(c), catalog, false).size).toBe(0);
    const ok = cond('tags', 'has_any', ['t1']);
    expect(invalidConditions(root(ok), catalog, true).size).toBe(0);
  });

  it('dropMissingValues keeps the values that still exist', () => {
    const c = cond('tags', 'has_any', ['t1', 'gone']);
    expect(dropMissingValues(c, ['gone']).value).toEqual(['t1']);
    expect(dropMissingValues(cond('lifecycleStage', 'equals', 'old'), ['old']).value).toBe('');
    expect(conditionsOf(root(c))).toHaveLength(1);
  });
});
