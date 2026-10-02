import { describe, expect, it } from 'vitest';
import { buildCatalog, type FieldDef, type Lookups } from './fields';
import {
  addCondition,
  addGroup,
  emptyRoot,
  newCondition,
  setCombinator,
  type Condition,
} from './model';
import { operatorKey, summarize, summarizeConditions, type Translate } from './summary';

const lookups: Lookups = {
  stages: [
    { value: 'new', label: 'New' },
    { value: 'won', label: 'Won' },
  ],
  statuses: [],
  tags: [
    { value: 't1', label: 'VIP' },
    { value: 't2', label: 'Hot' },
  ],
  groups: [],
  users: [],
  properties: [{ key: 'visits', label: 'Visits', fieldType: 'integer', options: [] }],
};
const catalog = buildCatalog(lookups);
const field = (id: string) => catalog.find((f) => f.id === id)!;

/** English templates, the same shape as the messages. */
const TEMPLATES: Record<string, string> = {
  and: 'and',
  or: 'or',
  deleted: '(deleted)',
  unknownField: '(unknown field)',
  more: '+{count} more',
  group: '({rules})',
  'op.equals': '{field} is {value}',
  'op.equals_date': '{field} is on {value}',
  'op.in': '{field} is any of {value}',
  'op.has_any': '{field} include any of {value}',
  'op.has_all': '{field} include all of {value}',
  'op.gt': '{field} is greater than {value}',
  'op.between': '{field} is between {from} and {to}',
  'op.in_last_days': '{field} is within the last {days} days',
  'op.more_than_days_ago': '{field} is more than {days} days ago',
  'op.is_empty': '{field} is empty',
  'op.contains': '{field} contains {value}',
};
const t: Translate = (key, values = {}) =>
  (TEMPLATES[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
const labelOf = (f: FieldDef) =>
  'text' in f.label
    ? f.label.text
    : ({
        lifecycleStage: 'Stage',
        tags: 'Tags',
        lastActivityAt: 'Last activity',
        source: 'Source',
        createdAt: 'Created',
      }[f.id] ?? f.id);
const ctx = { catalog, t, fieldLabel: labelOf };

const cond = (
  id: string,
  operator: Condition['operator'],
  value: Condition['value'],
): Condition => ({
  ...newCondition(field(id)),
  operator,
  value,
});

describe('summary sentence', () => {
  it('is empty for no conditions', () => {
    expect(summarize(emptyRoot(), ctx)).toBe('');
  });

  it('reads one condition with option labels, not ids', () => {
    let r = emptyRoot();
    r = addCondition(r, r.id, cond('lifecycleStage', 'in', ['new', 'won']));
    expect(summarize(r, ctx)).toBe('Stage is any of New, Won');
  });

  it('joins conditions with the combinator', () => {
    let r = emptyRoot();
    r = addCondition(r, r.id, cond('lifecycleStage', 'equals', 'won'));
    r = addCondition(r, r.id, cond('tags', 'has_any', ['t1', 't2']));
    expect(summarize(r, ctx)).toBe('Stage is Won and Tags include any of VIP, Hot');
    expect(summarize(setCombinator(r, r.id, 'or'), ctx)).toBe(
      'Stage is Won or Tags include any of VIP, Hot',
    );
  });

  it('wraps a nested group in brackets', () => {
    let r = emptyRoot();
    r = addCondition(r, r.id, cond('lifecycleStage', 'equals', 'won'));
    r = addGroup(r, r.id, cond('tags', 'has_all', ['t1']));
    const inner = r.children[1]!.id;
    r = addCondition(r, inner, cond('source', 'contains', 'web'));
    expect(summarize(r, ctx)).toBe(
      'Stage is Won and (Tags include all of VIP or Source contains web)',
    );
  });

  it('writes relative dates in days, ranges with both ends, and an empty check without a value', () => {
    let r = emptyRoot();
    r = addCondition(r, r.id, cond('lastActivityAt', 'more_than_days_ago', '30'));
    r = addCondition(r, r.id, cond('custom.visits', 'between', { from: '2', to: '10' }));
    r = addCondition(r, r.id, cond('lastActivityAt', 'is_empty', null));
    expect(summarizeConditions(r, ctx)).toEqual([
      'Last activity is more than 30 days ago',
      'Visits is between 2 and 10',
      'Last activity is empty',
    ]);
  });

  it('says a date equals as "is on" and formats dates with the given formatter', () => {
    expect(operatorKey('date', 'equals')).toBe('op.equals_date');
    expect(operatorKey('option', 'equals')).toBe('op.equals');
    let r = emptyRoot();
    r = addCondition(r, r.id, cond('createdAt', 'equals', '2026-03-01'));
    expect(summarize(r, { ...ctx, formatDate: (s) => `<${s}>` })).toBe(
      'Created is on <2026-03-01>',
    );
  });

  it('marks a deleted value, an unknown field, and long lists', () => {
    let r = emptyRoot();
    r = addCondition(r, r.id, cond('tags', 'has_any', ['t1', 'gone']));
    r = addCondition(r, r.id, { ...cond('source', 'contains', 'x'), field: 'custom.deleted' });
    const many = cond('tags', 'has_any', ['t1', 't2', 't1', 't2', 't1', 't2']);
    r = addCondition(r, r.id, many);
    const [a, b, c] = summarizeConditions(r, ctx);
    expect(a).toBe('Tags include any of VIP, (deleted)');
    expect(b).toContain('(unknown field)');
    expect(c).toBe('Tags include any of VIP, Hot, VIP, Hot +2 more');
  });
});
