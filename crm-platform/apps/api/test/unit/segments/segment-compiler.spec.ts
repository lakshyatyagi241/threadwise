import { randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { FieldType, SegmentGroup } from '@crm/contracts';
import {
  collectRuleRefs,
  compileRules,
  emptyRuleContext,
  type RuleContext,
} from '../../../src/modules/crm/segments/segment-compiler';
import { segmentContactsWhere } from '../../../src/modules/crm/segments/segment-count';
import {
  datePredicate,
  escapeLike,
  numberPredicate,
  textPredicate,
} from '../../../src/modules/crm/contacts/contact-predicates';
import { segmentsUsing } from '../../../src/modules/crm/segments/segment-usage';
import type { SegmentRow } from '../../../src/modules/crm/segments/segments.repository';

const dialect = new PgDialect();
const render = (q: SQL) => dialect.sqlToQuery(q);

const cond = (field: string, operator: string, value?: unknown) => ({
  type: 'condition' as const,
  field,
  operator,
  ...(value === undefined ? {} : { value }),
});
const group = (combinator: 'and' | 'or', ...children: unknown[]) =>
  ({ type: 'group', combinator, children }) as unknown as SegmentGroup;

function ctx(over: Partial<RuleContext> = {}): RuleContext {
  return { ...emptyRuleContext(), ...over };
}
const compile = (rules: SegmentGroup, rc = ctx()) => {
  const out = compileRules(7, rules, rc);
  return { ...out, ...render(out.where) };
};

describe('the compiler binds every operand', () => {
  const attacks = [
    "'; DROP TABLE contacts; --",
    "x' OR '1'='1",
    '"; DELETE FROM contacts; --',
    '$1; SELECT pg_sleep(10)',
    '%_\\',
    'a\u0000b',
    '${process.env.SECRET}',
  ];

  it.each(attacks)('text operand %j never reaches the SQL text', (attack) => {
    for (const op of ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with']) {
      const { sql, params } = compile(group('and', cond('name', op, attack)));
      for (const bad of ['DROP', 'DELETE', 'pg_sleep', "'1'='1", 'process.env']) {
        expect(sql).not.toContain(bad);
      }
      // it is there, as data
      const bound = ['equals', 'not_equals'].includes(op) ? attack : escapeLike(attack);
      expect(
        params.some((p) => typeof p === 'string' && p.includes(bound)),
        op,
      ).toBe(true);
    }
    const { sql } = compile(group('and', cond('name', 'in', [attack, 'b'])));
    expect(sql).not.toContain(attack);
  });

  it('LIKE wildcards in the operand are escaped, so % is text, not "match everything"', () => {
    const { params } = compile(group('and', cond('name', 'contains', '100%_off')));
    expect(params).toContain('%100\\%\\_off%');
  });

  it('a custom field key is a parameter, never part of the SQL text', () => {
    const rc = ctx({ fields: new Map([['plan', { type: 'text' as FieldType }]]) });
    const { sql, params } = compile(group('and', cond('custom.plan', 'equals', 'gold')), rc);
    expect(sql).toContain('->>');
    expect(sql).not.toContain('plan');
    expect(params).toContain('plan');
    expect(params).toContain('gold');
  });

  it('every kind of condition produces SQL with the values only in params', () => {
    const tag = randomUUID();
    const grp = randomUUID();
    const owner = randomUUID();
    const rc = ctx({
      tags: new Map([[tag, 11]]),
      groups: new Map([[grp, 22]]),
      users: new Map([[owner, 33]]),
      stages: new Set(['qualified']),
      statuses: new Set(['waiting']),
      fields: new Map<string, { type: FieldType }>([
        ['budget', { type: 'decimal' }],
        ['since', { type: 'date' }],
        ['colors', { type: 'multiselect' }],
        ['vip', { type: 'checkbox' }],
        ['tier', { type: 'select' }],
      ]),
    });
    const rules = group(
      'and',
      cond('lifecycleStage', 'in', ['qualified']),
      cond('status', 'equals', 'waiting'),
      cond('owner', 'in', [owner]),
      cond('tags', 'has_all', [tag]),
      cond('groups', 'has_none', [grp]),
      cond('leadScore', 'between', { from: 10, to: 90 }),
      cond('createdAt', 'in_last_days', 14),
      cond('lastActivityAt', 'more_than_days_ago', 30),
      cond('updatedAt', 'between', { from: '2026-01-01', to: '2026-02-01' }),
      cond('search', 'matches', 'sharma 9812'),
      cond('unsubscribed', 'is_false'),
      cond('imported', 'is_true'),
      cond('custom.budget', 'gte', 1000),
      cond('custom.since', 'before', '2026-06-01'),
      cond('custom.colors', 'has_any', ['red', 'blue']),
      cond('custom.vip', 'is_true'),
      cond('custom.tier', 'not_in', ['a', 'b']),
    );
    const { invalid, sql, params } = compile(rules, rc);
    expect(invalid).toEqual([]);
    expect(sql).toContain('make_interval');
    expect(sql).toContain('segment_safe_numeric');
    expect(sql).toContain('segment_safe_timestamptz');
    expect(sql).toContain('?|');
    // the tree is parenthesised and every value is a $n
    expect(sql).not.toMatch(/qualified|waiting|sharma|red|blue|2026/);
    expect(params).toEqual(
      expect.arrayContaining(['qualified', 'waiting', 14, 30, 11, 22, 33, '2026-06-01']),
    );
  });

  it('AND / OR keep their grouping', () => {
    const { sql } = compile(
      group(
        'or',
        cond('source', 'is_empty'),
        group('and', cond('name', 'contains', 'a'), cond('email', 'contains', 'b')),
      ),
    );
    expect(sql).toMatch(/^\(.*\) OR \(.* AND .*\)\)$/s);
  });
});

describe('relative dates', () => {
  it('"in the last N days" is bounded on both sides; "more than N days ago" only on the old side', () => {
    const last = render(datePredicate(sqlCol(), 'in_last_days', 7));
    expect(last.sql).toContain('>= now() - make_interval(days => $1::int)');
    expect(last.sql).toContain('<= now()');
    expect(last.params).toEqual([7]);
    const older = render(datePredicate(sqlCol(), 'more_than_days_ago', 90));
    expect(older.sql).toContain('< now() - make_interval(days => $1::int)');
    expect(older.params).toEqual([90]);
  });

  it('a bare day covers the whole day in UTC; an instant is exact', () => {
    const on = render(datePredicate(sqlCol(), 'on_or_before', '2026-10-03'));
    expect(on.sql).toContain("AT TIME ZONE 'UTC'");
    expect(on.sql).toContain("interval '1 day'");
    expect(on.sql).not.toContain('<=');
    const exact = render(datePredicate(sqlCol(), 'on_or_before', '2026-10-03T09:30:00Z'));
    expect(exact.sql).toContain('<=');
    expect(exact.params[0]).toBe('2026-10-03T09:30:00.000Z');
    const equals = render(datePredicate(sqlCol(), 'equals', '2026-10-03T23:59:00Z'));
    expect(equals.params[0]).toBe('2026-10-03');
  });

  it('an unparseable date fails closed instead of being cast', () => {
    expect(render(datePredicate(sqlCol(), 'before', "2026'; DROP")).sql).toBe('false');
  });
});

describe('predicates on their own', () => {
  it('"not" operators include the contacts with no value', () => {
    expect(render(textPredicate(sqlCol(), 'not_equals', 'a')).sql).toContain('IS NULL OR');
    expect(render(textPredicate(sqlCol(), 'not_contains', 'a')).sql).toContain('IS NULL OR');
    expect(render(numberPredicate(sqlCol(), 'not_in', [1, 2])).sql).toContain('IS NULL OR');
  });

  it('equality ignores case for text and not for option identifiers', () => {
    expect(render(textPredicate(sqlCol(), 'equals', 'A')).sql).toContain('lower(');
    expect(render(textPredicate(sqlCol(), 'equals', 'A', { exact: true })).sql).not.toContain(
      'lower(',
    );
  });

  it('numbers are bound as numbers', () => {
    expect(render(numberPredicate(sqlCol(), 'gt', 5)).params).toEqual([5]);
  });
});

describe('references that were deleted', () => {
  const tag = randomUUID();

  it('a missing tag becomes false and is reported, the rest of the rules still apply', () => {
    const rules = group('and', cond('tags', 'has_any', [tag]), cond('source', 'equals', 'import'));
    const { invalid, sql } = compile(rules);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatchObject({
      path: 'children.0',
      field: 'tags',
      reason: 'tag_deleted',
      refs: [tag],
    });
    expect(sql).toMatch(/^\(false AND /);
  });

  it('reports each kind of missing reference with its path', () => {
    const owner = randomUUID();
    const grp = randomUUID();
    const rules = group(
      'or',
      cond('groups', 'has_all', [grp]),
      group('and', cond('lifecycleStage', 'equals', 'gone'), cond('status', 'equals', 'gone2')),
      cond('owner', 'equals', owner),
      cond('custom.removed', 'equals', 'x'),
    );
    const { invalid } = compile(rules);
    expect(invalid.map((i) => [i.path, i.reason])).toEqual([
      ['children.0', 'group_deleted'],
      ['children.1.children.0', 'stage_deleted'],
      ['children.1.children.1', 'status_deleted'],
      ['children.2', 'user_deleted'],
      ['children.3', 'field_deleted'],
    ]);
  });

  it('"is empty" on tags or groups points at nothing, so it never goes invalid', () => {
    const { invalid } = compile(
      group(
        'and',
        cond('tags', 'is_empty'),
        cond('groups', 'is_not_empty'),
        cond('owner', 'is_empty'),
      ),
    );
    expect(invalid).toEqual([]);
  });

  it('a negated condition on a deleted tag still matches nothing (false, not "everyone")', () => {
    const { sql, invalid } = compile(group('and', cond('tags', 'has_none', [tag])));
    expect(invalid).toHaveLength(1);
    expect(sql).toBe('(false)');
  });

  it('a property whose type no longer has the operator, and a computed property, are flagged', () => {
    const rc = ctx({
      fields: new Map<string, { type: FieldType }>([
        ['was_text', { type: 'decimal' }],
        ['calc', { type: 'formula' }],
      ]),
    });
    const { invalid } = compile(
      group('and', cond('custom.was_text', 'contains', 'x'), cond('custom.calc', 'equals', '1')),
      rc,
    );
    expect(invalid.map((i) => i.reason)).toEqual([
      'operator_unsupported',
      'field_type_unsupported',
    ]);
  });

  it('collects everything a rule tree points at, once', () => {
    const t = randomUUID();
    const refs = collectRuleRefs(
      group(
        'and',
        cond('tags', 'has_any', [t, t]),
        cond('lifecycleStage', 'equals', 'a'),
        cond('custom.k', 'is_empty'),
        cond('status', 'in', ['s1', 's2']),
      ),
    );
    expect([...refs.tagUuids]).toEqual([t]);
    expect([...refs.stageValues]).toEqual(['a']);
    expect([...refs.statusValues]).toEqual(['s1', 's2']);
    expect([...refs.fieldKeys]).toEqual(['k']);
  });
});

describe('the contact filter around a segment', () => {
  it('the segment is one more AND next to the org, archived and scope conditions', () => {
    const { where } = compileRules(7, group('and', cond('source', 'equals', 'import')), ctx());
    const q = render(segmentContactsWhere(7, where));
    expect(q.sql).toContain('"contacts"."org_id" = $');
    expect(q.sql).toContain('"is_archived" = $');
    expect(q.params).toContain(7);
    expect(q.params).toContain('import');
  });
});

describe('segment usage', () => {
  const row = (name: string, rules: unknown): SegmentRow =>
    ({ name, rules }) as unknown as SegmentRow;
  const tag = randomUUID();
  const rows = [
    row('A', group('and', cond('tags', 'has_any', [tag]))),
    row(
      'B',
      group('and', cond('custom.plan', 'equals', 'x'), cond('lifecycleStage', 'equals', 'won')),
    ),
    row('C', group('and', cond('source', 'is_empty'))),
  ];

  it('finds the segments that point at a tag, a property or a stage', () => {
    expect(segmentsUsing(rows, 'tag', tag).map((r) => r.name)).toEqual(['A']);
    expect(segmentsUsing(rows, 'field', 'plan').map((r) => r.name)).toEqual(['B']);
    expect(segmentsUsing(rows, 'stage', 'won').map((r) => r.name)).toEqual(['B']);
    expect(segmentsUsing(rows, 'stage', 'lost')).toEqual([]);
    expect(segmentsUsing(rows, 'group', tag)).toEqual([]);
  });
});

import { sql } from 'drizzle-orm';
function sqlCol(): SQL {
  return sql`c.col`;
}
