import { PgDialect } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { propertyPredicate, propertySort } from '../../../src/modules/crm/property-predicates';

const dialect = new PgDialect();
const render = (q: SQL) => dialect.sqlToQuery(q);
const DATA = sql`c.data`;

describe('propertyPredicate (BL-196)', () => {
  it('binds the key and the operand, never splices them into the SQL text', () => {
    const attack = "'; DROP TABLE companies; --";
    const q = render(propertyPredicate(DATA, 'tier', 'text', 'equals', attack)!);
    expect(q.sql).toContain('->>');
    expect(q.sql).not.toContain('tier');
    expect(q.sql).not.toContain('DROP');
    expect(q.params).toContain('tier');
    expect(q.params).toContain(attack);
  });

  it('an option compares as written, text ignores case', () => {
    const option = render(propertyPredicate(DATA, 'tier', 'option', 'equals', 'Gold')!);
    const text = render(propertyPredicate(DATA, 'tier', 'text', 'equals', 'Gold')!);
    expect(option.sql).not.toContain('lower(');
    expect(text.sql).toContain('lower(');
    expect(option.params).toContain('Gold');
    expect(text.params).toContain('Gold');
  });

  it('a number goes through the safe numeric cast, a date through the safe timestamp cast', () => {
    expect(render(propertyPredicate(DATA, 'seats', 'number', 'gt', 10)!).sql).toContain(
      'segment_safe_numeric',
    );
    expect(
      render(propertyPredicate(DATA, 'renewal', 'date', 'before', '2026-12-31')!).sql,
    ).toContain('segment_safe_timestamptz');
  });

  it('a list property uses the jsonb operators on the property itself', () => {
    const q = render(propertyPredicate(DATA, 'channels', 'multi', 'has_any', ['email'])!);
    expect(q.sql).toContain('?|');
    expect(q.params).toContain('email');
  });

  it('a kind with no property predicate answers undefined, never SQL', () => {
    expect(propertyPredicate(DATA, 'x', 'user', 'equals', 'a')).toBeUndefined();
    expect(propertyPredicate(DATA, 'x', 'tags', 'has_any', ['a'])).toBeUndefined();
  });
});

describe('propertySort (BL-196)', () => {
  it('text and option sort ignoring case, a missing value as the empty string', () => {
    const by = propertySort(DATA, 'tier', 'option')!;
    expect(by.type).toBe('text');
    expect(render(by.expr).sql).toContain('lower(coalesce(');
  });

  it('numbers, dates and checkboxes sort by value, with a floor for the missing one', () => {
    expect(propertySort(DATA, 'seats', 'number')?.type).toBe('numeric');
    expect(propertySort(DATA, 'renewal', 'date')?.type).toBe('timestamptz');
    expect(propertySort(DATA, 'vip', 'boolean')?.type).toBe('numeric');
    expect(render(propertySort(DATA, 'renewal', 'date')!.expr).sql).toContain('-infinity');
  });

  it('a list of values has no order', () => {
    expect(propertySort(DATA, 'channels', 'multi')).toBeUndefined();
  });
});
