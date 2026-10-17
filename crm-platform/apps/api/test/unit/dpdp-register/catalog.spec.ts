import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DPDP_ATTESTABLE_CHECKS,
  DPDP_CATALOG,
  DPDP_CODE_CHECKS,
  DPDP_CODE_CHECK_RESULTS,
  DPDP_LIVE_CHECKS,
  dpdpAttestInputSchema,
  dpdpCheckSource,
} from '@crm/contracts';

// apps/api/test/unit/dpdp-register -> crm-platform
const PLAN_DOC = join(__dirname, '../../../../../docs/privacy/dpdpa-gap-analysis-and-plan.md');

const ALL_CHECKS: readonly string[] = [
  ...DPDP_LIVE_CHECKS,
  ...DPDP_ATTESTABLE_CHECKS,
  ...DPDP_CODE_CHECKS,
];

describe('DPDP register catalog', () => {
  it('has 47 unique ids r01..r47', () => {
    expect(DPDP_CATALOG.map((i) => i.id)).toEqual(
      Array.from({ length: 47 }, (_, n) => 'r' + String(n + 1).padStart(2, '0')),
    );
  });

  it('baseline totals match the plan', () => {
    const counts = { following: 0, partial: 0, not_following: 0, not_applicable: 0 };
    for (const item of DPDP_CATALOG) counts[item.baseline as keyof typeof counts] += 1;
    expect(counts).toEqual({ following: 1, partial: 26, not_following: 20, not_applicable: 0 });
  });

  it('every check key is known and every code check has a result', () => {
    for (const item of DPDP_CATALOG) {
      for (const key of item.checks) {
        expect(ALL_CHECKS, `${item.id} uses unknown check ${key}`).toContain(key);
      }
    }
    expect([...DPDP_CODE_CHECKS].sort()).toEqual(Object.keys(DPDP_CODE_CHECK_RESULTS).sort());
    // Every code check is a known gap today, so each one fails until the PR that ships its feature flips it.
    for (const key of DPDP_CODE_CHECKS) expect(DPDP_CODE_CHECK_RESULTS[key]).toBe('fail');
  });

  it('keeps the three check lists apart and gives each key its source', () => {
    expect(new Set(ALL_CHECKS).size).toBe(ALL_CHECKS.length);
    expect(DPDP_LIVE_CHECKS).toHaveLength(10);
    expect(DPDP_ATTESTABLE_CHECKS).toHaveLength(8);
    expect(DPDP_CODE_CHECKS).toHaveLength(8);
    for (const key of DPDP_LIVE_CHECKS) expect(dpdpCheckSource(key)).toBe('live');
    for (const key of DPDP_ATTESTABLE_CHECKS) expect(dpdpCheckSource(key)).toBe('attested');
    for (const key of DPDP_CODE_CHECKS) expect(dpdpCheckSource(key)).toBe('code');
  });

  it('puts every defined check on at least one item', () => {
    const used = new Set<string>(DPDP_CATALOG.flatMap((i) => i.checks));
    expect(ALL_CHECKS.filter((key) => !used.has(key))).toEqual([]);
  });

  it('every plan item id exists in the plan doc', () => {
    const plan = readFileSync(PLAN_DOC, 'utf8');
    const rows = new Set([...plan.matchAll(/^\| (DP-\d+[a-z]?) /gm)].map((m) => m[1]));
    for (const item of DPDP_CATALOG) {
      expect(item.planItems.length, `${item.id} has no plan items`).toBeGreaterThan(0);
      for (const id of item.planItems) {
        expect(rows.has(id), `${item.id} names ${id}, which is not a table row of the plan`).toBe(
          true,
        );
      }
    }
  });

  it('follows the penalty tier and conditional rules', () => {
    for (const item of DPDP_CATALOG) {
      const n = Number(item.id.slice(1));
      const tier =
        n >= 27 && n <= 35 ? '250' : n >= 36 && n <= 41 ? '200' : n === 44 ? '150' : '50';
      expect(item.penaltyTier, item.id).toBe(tier);
      expect(item.conditional === true, item.id).toBe(n === 44);
    }
  });
});

describe('dpdpAttestInputSchema', () => {
  const valid = { result: 'pass', note: 'Counsel engaged on 3 Oct.' };

  it('accepts a minimal input and defaults the expiry to 90 days', () => {
    const parsed = dpdpAttestInputSchema.parse(valid);
    expect(parsed.expiresInDays).toBe(90);
    expect(parsed.evidenceUrl).toBeUndefined();
  });

  it('rejects a note of 9 characters and accepts 10', () => {
    expect(dpdpAttestInputSchema.safeParse({ ...valid, note: '123456789' }).success).toBe(false);
    expect(dpdpAttestInputSchema.safeParse({ ...valid, note: '1234567890' }).success).toBe(true);
    expect(dpdpAttestInputSchema.safeParse({ ...valid, note: '          x' }).success).toBe(false);
  });

  it('rejects expiresInDays outside 1 to 365', () => {
    expect(dpdpAttestInputSchema.safeParse({ ...valid, expiresInDays: 0 }).success).toBe(false);
    expect(dpdpAttestInputSchema.safeParse({ ...valid, expiresInDays: 366 }).success).toBe(false);
    expect(dpdpAttestInputSchema.safeParse({ ...valid, expiresInDays: 1.5 }).success).toBe(false);
    expect(dpdpAttestInputSchema.parse({ ...valid, expiresInDays: 1 }).expiresInDays).toBe(1);
    expect(dpdpAttestInputSchema.parse({ ...valid, expiresInDays: 365 }).expiresInDays).toBe(365);
  });

  it('accepts only an https evidence url', () => {
    expect(
      dpdpAttestInputSchema.safeParse({ ...valid, evidenceUrl: 'http://example.com/dpa.pdf' })
        .success,
    ).toBe(false);
    expect(
      dpdpAttestInputSchema.safeParse({ ...valid, evidenceUrl: 'ftp://example.com/x' }).success,
    ).toBe(false);
    expect(
      dpdpAttestInputSchema.safeParse({ ...valid, evidenceUrl: 'javascript:alert(1)' }).success,
    ).toBe(false);
    expect(dpdpAttestInputSchema.safeParse({ ...valid, evidenceUrl: 'not a url' }).success).toBe(
      false,
    );
    expect(
      dpdpAttestInputSchema.safeParse({ ...valid, evidenceUrl: 'https://example.com/dpa.pdf' })
        .success,
    ).toBe(true);
  });

  it('accepts only pass or fail as the result', () => {
    expect(dpdpAttestInputSchema.safeParse({ ...valid, result: 'fail' }).success).toBe(true);
    expect(dpdpAttestInputSchema.safeParse({ ...valid, result: 'unknown' }).success).toBe(false);
  });
});
