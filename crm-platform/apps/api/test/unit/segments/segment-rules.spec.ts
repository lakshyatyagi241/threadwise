import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SEGMENT_LIST_MAX,
  SEGMENT_MAX_CONDITIONS,
  SEGMENT_OPERATORS,
  SEGMENT_OPERATORS_BY_KIND,
  SEGMENT_VALUE_SHAPE,
  collectConditions,
  contactFilterToRules,
  createSegmentSchema,
  listContactsQuerySchema,
  parseDateValue,
  segmentFromFiltersSchema,
  segmentKindForFieldType,
  segmentRulesSchema,
  updateSegmentSchema,
  type SegmentGroup,
} from '@crm/contracts';

const cond = (field: string, operator: string, value?: unknown) => ({
  type: 'condition' as const,
  field,
  operator,
  ...(value === undefined ? {} : { value }),
});
const group = (combinator: 'and' | 'or', ...children: unknown[]) => ({
  type: 'group' as const,
  combinator,
  children,
});
const parse = (rules: unknown) => segmentRulesSchema.safeParse(rules);
const messages = (rules: unknown) => {
  const r = parse(rules);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('segment rules: the tree', () => {
  it('accepts nested AND/OR groups of valid conditions', () => {
    const rules = group(
      'and',
      cond('lifecycleStage', 'equals', 'qualified'),
      group('or', cond('createdAt', 'in_last_days', 7), cond('tags', 'has_any', [randomUUID()])),
    );
    expect(parse(rules).success).toBe(true);
  });

  it('allows three levels of groups and refuses a fourth', () => {
    const level3 = group('and', cond('name', 'contains', 'a'));
    const level2 = group('or', level3);
    const level1 = group('and', level2);
    expect(parse(level1).success).toBe(true);
    expect(
      parse(group('and', group('or', group('and', group('or', cond('name', 'contains', 'a'))))))
        .success,
    ).toBe(false);
  });

  it('a payload nested thousands deep is refused, not walked into a stack overflow', () => {
    let deep: unknown = cond('name', 'contains', 'a');
    for (let i = 0; i < 5000; i++) deep = group('and', deep);
    expect(parse(deep).success).toBe(false);
  });

  it('allows 50 conditions and refuses 51', () => {
    const many = (n: number) =>
      group('and', ...Array.from({ length: n }, (_, i) => cond('name', 'contains', `x${i}`)));
    expect(SEGMENT_MAX_CONDITIONS).toBe(50);
    expect(parse(many(50)).success).toBe(true);
    expect(parse(many(51)).success).toBe(false);
    // 51 spread over nested groups counts the same.
    expect(
      parse(
        group(
          'and',
          group('or', ...Array.from({ length: 26 }, (_, i) => cond('name', 'contains', `a${i}`))),
          group('or', ...Array.from({ length: 25 }, (_, i) => cond('name', 'contains', `b${i}`))),
        ),
      ).success,
    ).toBe(false);
  });

  it('an empty group, an empty tree and a bare condition at the root are refused', () => {
    expect(parse(group('and')).success).toBe(false);
    expect(parse(group('and', group('or'))).success).toBe(false);
    expect(parse(cond('name', 'contains', 'a')).success).toBe(false);
    expect(parse({}).success).toBe(false);
    expect(parse(null).success).toBe(false);
  });

  it('rejects unknown keys at every level (no smuggled properties)', () => {
    expect(parse({ ...group('and', cond('name', 'contains', 'a')), sql: '1=1' }).success).toBe(
      false,
    );
    expect(parse(group('and', { ...cond('name', 'contains', 'a'), raw: 'x' })).success).toBe(false);
  });

  it('rejects an unknown combinator', () => {
    expect(
      parse({ type: 'group', combinator: 'xor', children: [cond('name', 'contains', 'a')] })
        .success,
    ).toBe(false);
  });
});

describe('segment rules: fields and operators', () => {
  it('rejects an unknown field and an unknown operator', () => {
    expect(messages(group('and', cond('password_hash', 'equals', 'x')))[0]).toMatch(
      /unknown field/,
    );
    expect(parse(group('and', cond('name', 'regex', '.*'))).success).toBe(false);
    expect(parse(group('and', cond('name', 'DROP TABLE', 'x'))).success).toBe(false);
  });

  it('only accepts custom fields written custom.<snake_case key>', () => {
    expect(parse(group('and', cond('custom.plan', 'equals', 'gold'))).success).toBe(true);
    for (const bad of [
      'custom.',
      'custom.Plan',
      'custom.a-b',
      'custom.1x',
      'custom.a b',
      'custom."; --',
      'plan',
    ]) {
      expect(parse(group('and', cond(bad, 'equals', 'x'))).success, bad).toBe(false);
    }
    // prototype keys are not fields
    for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(parse(group('and', cond(bad, 'equals', 'x'))).success, bad).toBe(false);
    }
  });

  it('refuses an operator the field kind does not have', () => {
    expect(messages(group('and', cond('createdAt', 'contains', 'x')))[0]).toMatch(
      /not available for a date field/,
    );
    expect(parse(group('and', cond('unsubscribed', 'equals', true))).success).toBe(false);
    expect(parse(group('and', cond('leadScore', 'starts_with', '1'))).success).toBe(false);
    expect(parse(group('and', cond('tags', 'equals', 'x'))).success).toBe(false);
  });

  it('every operator belongs to a kind, and has a value shape', () => {
    const used = new Set(Object.values(SEGMENT_OPERATORS_BY_KIND).flat());
    for (const op of SEGMENT_OPERATORS) {
      expect(used.has(op), op).toBe(true);
      expect(SEGMENT_VALUE_SHAPE[op], op).toBeDefined();
    }
  });

  it('no-value operators take no value; value operators need one', () => {
    expect(parse(group('and', cond('source', 'is_empty'))).success).toBe(true);
    expect(parse(group('and', cond('source', 'is_empty', 'x'))).success).toBe(false);
    expect(parse(group('and', cond('source', 'equals'))).success).toBe(false);
    expect(parse(group('and', cond('unsubscribed', 'is_true'))).success).toBe(true);
    expect(parse(group('and', cond('unsubscribed', 'is_true', true))).success).toBe(false);
  });

  it('numbers must be numbers, dates must be real dates, ids must be uuids', () => {
    expect(parse(group('and', cond('leadScore', 'gt', 50))).success).toBe(true);
    expect(parse(group('and', cond('leadScore', 'gt', '50'))).success).toBe(false);
    expect(parse(group('and', cond('createdAt', 'before', '2026-02-31'))).success).toBe(false);
    expect(parse(group('and', cond('createdAt', 'before', '2026-02-28'))).success).toBe(true);
    expect(parse(group('and', cond('createdAt', 'before', "2026-01-01' OR 1=1 --"))).success).toBe(
      false,
    );
    expect(parse(group('and', cond('createdAt', 'before', '1500-01-01'))).success).toBe(false);
    expect(parse(group('and', cond('tags', 'has_any', ['not-a-uuid']))).success).toBe(false);
    expect(parse(group('and', cond('owner', 'equals', 'not-a-uuid'))).success).toBe(false);
  });

  it('between needs { from, to } in order; relative operators need whole days in range', () => {
    expect(parse(group('and', cond('leadScore', 'between', { from: 10, to: 20 }))).success).toBe(
      true,
    );
    expect(parse(group('and', cond('leadScore', 'between', { from: 20, to: 10 }))).success).toBe(
      false,
    );
    expect(parse(group('and', cond('leadScore', 'between', [10, 20]))).success).toBe(false);
    expect(
      parse(group('and', cond('createdAt', 'between', { from: '2026-01-01', to: '2026-02-01' })))
        .success,
    ).toBe(true);
    expect(
      parse(group('and', cond('createdAt', 'between', { from: '2026-03-01', to: '2026-02-01' })))
        .success,
    ).toBe(false);
    expect(parse(group('and', cond('createdAt', 'in_last_days', 30))).success).toBe(true);
    expect(parse(group('and', cond('createdAt', 'in_last_days', 0))).success).toBe(true);
    for (const bad of [-1, 1.5, 4000, '7', null]) {
      expect(
        parse(group('and', cond('createdAt', 'more_than_days_ago', bad))).success,
        String(bad),
      ).toBe(false);
    }
  });

  it('bounds list sizes and text lengths', () => {
    const ids = (n: number) => Array.from({ length: n }, () => randomUUID());
    expect(parse(group('and', cond('tags', 'has_any', ids(SEGMENT_LIST_MAX)))).success).toBe(true);
    expect(parse(group('and', cond('tags', 'has_any', ids(SEGMENT_LIST_MAX + 1)))).success).toBe(
      false,
    );
    expect(parse(group('and', cond('tags', 'has_any', []))).success).toBe(false);
    expect(parse(group('and', cond('name', 'contains', 'x'.repeat(256)))).success).toBe(false);
    expect(parse(group('and', cond('search', 'matches', 'x'.repeat(201)))).success).toBe(false);
  });

  it('custom fields: any operator in the shared set, with a value of the right shape (the type is checked by the API)', () => {
    expect(parse(group('and', cond('custom.budget', 'between', { from: 1, to: 5 }))).success).toBe(
      true,
    );
    expect(parse(group('and', cond('custom.budget', 'between', 5))).success).toBe(false);
    expect(parse(group('and', cond('custom.colors', 'has_all', ['red']))).success).toBe(true);
    expect(parse(group('and', cond('custom.colors', 'has_all', 'red'))).success).toBe(false);
    expect(parse(group('and', cond('custom.since', 'in_last_days', 'a'))).success).toBe(false);
  });

  it('maps registry types to filter kinds; a formula cannot be filtered', () => {
    expect(segmentKindForFieldType('text')).toBe('text');
    expect(segmentKindForFieldType('decimal')).toBe('number');
    expect(segmentKindForFieldType('datetime')).toBe('date');
    expect(segmentKindForFieldType('select')).toBe('option');
    expect(segmentKindForFieldType('multiselect')).toBe('multi');
    expect(segmentKindForFieldType('checkbox')).toBe('boolean');
    expect(segmentKindForFieldType('formula')).toBeUndefined();
  });

  it('collectConditions lists every condition with its path, in order', () => {
    const rules = group(
      'and',
      cond('name', 'contains', 'a'),
      group('or', cond('source', 'is_empty')),
    ) as SegmentGroup;
    expect(collectConditions(rules).map((c) => c.path)).toEqual([
      'children.0',
      'children.1.children.0',
    ]);
  });
});

describe('dates', () => {
  it('accepts a real day or an ISO instant with an offset, nothing else', () => {
    expect(parseDateValue('2026-10-03')).toEqual({ kind: 'day', iso: '2026-10-03' });
    expect(parseDateValue('2026-10-03T09:30:00+05:30')).toEqual({
      kind: 'instant',
      iso: '2026-10-03T04:00:00.000Z',
    });
    for (const bad of [
      '2026-13-01',
      '2026-02-30',
      '2026-10-03 09:30',
      '2026-10-03T09:30:00',
      'tomorrow',
      '',
      5,
      null,
    ]) {
      expect(parseDateValue(bad), String(bad)).toBeNull();
    }
  });
});

describe('create / update / from-filters schemas', () => {
  const rules = group('and', cond('name', 'contains', 'a'));

  it('a name is required and trimmed; visibility defaults to private', () => {
    expect(createSegmentSchema.safeParse({ rules }).success).toBe(false);
    const ok = createSegmentSchema.parse({ name: '  Hot leads ', rules });
    expect(ok.name).toBe('Hot leads');
    expect(ok.visibility).toBe('private');
    expect(createSegmentSchema.safeParse({ name: 'x', rules, visibility: 'public' }).success).toBe(
      false,
    );
    expect(createSegmentSchema.safeParse({ name: 'x', rules, color: 'green' }).success).toBe(false);
    expect(createSegmentSchema.safeParse({ name: 'x', rules, ownerId: randomUUID() }).success).toBe(
      false,
    );
  });

  it('an update carries rowVersion; the rest is optional', () => {
    expect(updateSegmentSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(updateSegmentSchema.safeParse({ name: 'x', rowVersion: 1 }).success).toBe(true);
    expect(updateSegmentSchema.safeParse({ description: null, rowVersion: 1 }).success).toBe(true);
  });

  it('the contacts filter becomes the same conditions, ANDed', () => {
    const tag = randomUUID();
    const owner = randomUUID();
    const filter = segmentFromFiltersSchema.parse({
      name: 'From list',
      filter: {
        q: 'sharma',
        ownerId: owner,
        lifecycleStage: 'qualified',
        source: 'import',
        tagIds: [tag],
        tagMode: 'all',
        unsubscribed: false,
        createdFrom: '2026-01-01',
        createdTo: '2026-01-31',
        lastActivityFrom: '2026-02-01',
      },
    }).filter;
    const out = contactFilterToRules(filter)!;
    expect(segmentRulesSchema.safeParse(out).success).toBe(true);
    expect(out.combinator).toBe('and');
    const by = Object.fromEntries(
      collectConditions(out as SegmentGroup).map((c) => [c.condition.field, c.condition]),
    );
    expect(by.search).toMatchObject({ operator: 'matches', value: 'sharma' });
    expect(by.owner).toMatchObject({ operator: 'equals', value: owner });
    expect(by.tags).toMatchObject({ operator: 'has_all', value: [tag] });
    expect(by.unsubscribed).toMatchObject({ operator: 'is_false' });
    expect(by.createdAt).toMatchObject({
      operator: 'between',
      value: { from: '2026-01-01', to: '2026-01-31' },
    });
    expect(by.lastActivityAt).toMatchObject({ operator: 'on_or_after', value: '2026-02-01' });
  });

  it('an empty filter has nothing to save; segmentId and archived rows cannot be part of a segment filter', () => {
    expect(
      contactFilterToRules(segmentFromFiltersSchema.parse({ name: 'x', filter: {} }).filter),
    ).toBeNull();
    expect(
      segmentFromFiltersSchema.safeParse({ name: 'x', filter: { segmentId: randomUUID() } })
        .success,
    ).toBe(false);
    expect(
      segmentFromFiltersSchema.safeParse({ name: 'x', filter: { includeArchived: true } }).success,
    ).toBe(false);
  });
});

describe('the contacts list query', () => {
  it('accepts segmentId and the date windows, and refuses bad ones', () => {
    const id = randomUUID();
    const q = listContactsQuerySchema.parse({
      segmentId: id,
      createdFrom: '2026-01-01',
      lastActivityTo: '2026-02-01T00:00:00Z',
    });
    expect(q.segmentId).toBe(id);
    expect(listContactsQuerySchema.safeParse({ segmentId: 'nope' }).success).toBe(false);
    expect(listContactsQuerySchema.safeParse({ createdFrom: '01/02/2026' }).success).toBe(false);
  });
});
