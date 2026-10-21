import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AIAG_SOURCE_KINDS, AIAG_SOURCE_STATUSES } from '@crm/contracts';

/**
 * The CHECK constraints of 20270131090000_con_enum_checks_closed_sets.sql repeat value sets that live in code. For the one set that has a
 * shared contract (AI training sources) the two must not drift: a new kind added to the contract without the migration would be rejected
 * by Postgres on insert. Rerun: pnpm --filter @crm/api exec vitest run test/unit/common/enum-check-migration.spec.ts
 */
const sql = readFileSync(
  resolve(
    __dirname,
    '../../../../../packages/db/migrations/20270131090000_con_enum_checks_closed_sets.sql',
  ),
  'utf8',
);
const setOf = (constraint: string): string[] => {
  const m = new RegExp(`${constraint} CHECK \\(\\w+ IN \\(([^)]*)\\)\\)`).exec(sql);
  if (!m) throw new Error(`${constraint} not found in the migration`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
};

describe('con-enum migration matches the contracts', () => {
  it('ai_training_sources.kind equals AIAG_SOURCE_KINDS', () => {
    expect(setOf('chk_ai_training_sources_kind').sort()).toEqual([...AIAG_SOURCE_KINDS].sort());
  });
  it('ai_training_sources.status equals AIAG_SOURCE_STATUSES', () => {
    expect(setOf('chk_ai_training_sources_status').sort()).toEqual(
      [...AIAG_SOURCE_STATUSES].sort(),
    );
  });
  it('every constraint is NOT VALID, so old rows cannot fail the migration', () => {
    const adds = sql.split('\n').filter((l) => l.startsWith('ALTER TABLE'));
    expect(adds).toHaveLength(8);
    for (const l of adds) expect(l).toMatch(/NOT VALID;$/);
  });
});
