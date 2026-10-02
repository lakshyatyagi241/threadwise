import { describe, expect, it } from 'vitest';
import { ruleReducer } from './builder';
import { buildCatalog, type Lookups } from './fields';
import { conditionsOf, emptyRoot, type Condition, type Group } from './model';
import { leavingTarget } from './guard';

const lookups: Lookups = {
  stages: [{ value: 'new', label: 'New' }],
  statuses: [],
  tags: [{ value: 't1', label: 'VIP' }],
  groups: [],
  users: [],
  properties: [],
};
const catalog = buildCatalog(lookups);
const run = (root: Group, ...actions: Parameters<typeof ruleReducer>[1][]) =>
  actions.reduce((r, a) => ruleReducer(r, a, catalog), root);

describe('rule reducer', () => {
  it('adds a condition on the first field and a group seeded the same way', () => {
    const r0 = emptyRoot();
    const r = run(
      r0,
      { type: 'addCondition', groupId: r0.id },
      { type: 'addGroup', groupId: r0.id },
    );
    expect(conditionsOf(r).map((c) => c.field)).toEqual(['lifecycleStage', 'lifecycleStage']);
    expect(r.children[1]?.kind).toBe('group');
  });

  it('changing the field resets operator and value; changing the operator converts the value', () => {
    const r0 = emptyRoot();
    let r = run(r0, { type: 'addCondition', groupId: r0.id });
    const id = (r.children[0] as Condition).id;
    r = run(r, { type: 'field', id, field: 'tags' });
    expect(conditionsOf(r)[0]).toMatchObject({ field: 'tags', operator: 'has_any', value: [] });
    r = run(r, { type: 'value', id, value: ['t1'] }, { type: 'operator', id, operator: 'has_all' });
    expect(conditionsOf(r)[0]).toMatchObject({ operator: 'has_all', value: ['t1'] });
    r = run(r, { type: 'operator', id, operator: 'is_empty' });
    expect(conditionsOf(r)[0]?.value).toBeNull();
  });

  it('ignores an unknown field, and a missing condition', () => {
    const r0 = emptyRoot();
    let r = run(r0, { type: 'addCondition', groupId: r0.id });
    const id = (r.children[0] as Condition).id;
    expect(run(r, { type: 'field', id, field: 'custom.gone' })).toBe(r);
    expect(run(r, { type: 'operator', id: 'nope', operator: 'in' })).toBe(r);
    r = run(r, { type: 'remove', id });
    expect(r.children).toHaveLength(0);
  });

  it('drops deleted values (the fix of a stale reference) and can reset to a newer tree', () => {
    const r0 = emptyRoot();
    let r = run(r0, { type: 'addCondition', groupId: r0.id });
    const id = (r.children[0] as Condition).id;
    r = run(
      r,
      { type: 'field', id, field: 'tags' },
      { type: 'value', id, value: ['t1', 'gone'] },
      {
        type: 'dropMissing',
        id,
        missing: ['gone'],
      },
    );
    expect(conditionsOf(r)[0]?.value).toEqual(['t1']);
    const fresh = emptyRoot();
    expect(run(r, { type: 'reset', root: fresh })).toBe(fresh);
  });

  it('does nothing without a catalog (lookups not loaded)', () => {
    const r0 = emptyRoot();
    expect(ruleReducer(r0, { type: 'addCondition', groupId: r0.id }, [])).toBe(r0);
  });
});

describe('unsaved-changes guard: which clicks leave the page', () => {
  const here = { origin: 'http://localhost:3001', pathname: '/segments/new', search: '' };
  const click = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };
  const a = (href: string, extra: Partial<{ target: string; download: boolean }> = {}) => ({
    href,
    target: extra.target ?? '',
    hasAttribute: (n: string) => n === 'download' && Boolean(extra.download),
  });

  it('holds a click on another page of the app and names where it goes', () => {
    expect(leavingTarget(click, a('http://localhost:3001/contacts?x=1#top'), here)).toBe(
      '/contacts?x=1#top',
    );
  });

  it('lets through everything that does not leave: same page, other site, new tab, modified click, download', () => {
    expect(leavingTarget(click, a('http://localhost:3001/segments/new'), here)).toBeNull();
    expect(leavingTarget(click, a('https://example.com/x'), here)).toBeNull();
    expect(
      leavingTarget(click, a('http://localhost:3001/contacts', { target: '_blank' }), here),
    ).toBeNull();
    expect(
      leavingTarget({ ...click, ctrlKey: true }, a('http://localhost:3001/contacts'), here),
    ).toBeNull();
    expect(
      leavingTarget({ ...click, button: 1 }, a('http://localhost:3001/contacts'), here),
    ).toBeNull();
    expect(
      leavingTarget(
        { ...click, defaultPrevented: true },
        a('http://localhost:3001/contacts'),
        here,
      ),
    ).toBeNull();
    expect(
      leavingTarget(click, a('http://localhost:3001/f.csv', { download: true }), here),
    ).toBeNull();
    expect(leavingTarget(click, null, here)).toBeNull();
    expect(leavingTarget(click, a('not a url'), here)).toBeNull();
  });
});
