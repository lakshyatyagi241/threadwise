import { describe, expect, it } from 'vitest';
import { FormSubmitService } from '../../../src/modules/forms-builder/form-submit.service';

/**
 * Issue #1167: the monthly submission cap was read in its own transaction, before the claim, so concurrent posts all counted the same
 * last free place and overshot. The cap is now counted under a per-workspace lock inside the claim transaction.
 */
describe('monthly submission cap is counted under the claim lock (#1167)', () => {
  const build = (accepted: number) => {
    const statements: string[] = [];
    const tx = {
      execute: async (q: { queryChunks?: unknown[] } | string) => {
        statements.push(
          typeof q === 'string' ? q : JSON.stringify(q.queryChunks ?? q).slice(0, 80),
        );
        return { rows: [] };
      },
    };
    const subs = {
      countAccepted: async () => {
        statements.push('count');
        return accepted;
      },
    };
    const service = Object.assign(Object.create(FormSubmitService.prototype), { subs });
    return {
      statements,
      capReached: (cap: number) =>
        (service as { capReachedInTx: (...a: unknown[]) => Promise<boolean> }).capReachedInTx(
          tx,
          7,
          cap,
          new Date('2026-10-15T00:00:00Z'),
        ),
    };
  };

  it('takes the workspace lock before it counts this month', async () => {
    const h = build(0);
    await h.capReached(5);
    const lockAt = h.statements.findIndex((s) => s.includes('pg_advisory_xact_lock'));
    const countAt = h.statements.indexOf('count');
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(countAt).toBeGreaterThan(lockAt);
  });

  it('reaches the cap at the cap, and never with no cap set', async () => {
    expect(await build(4).capReached(5)).toBe(false);
    expect(await build(5).capReached(5)).toBe(true);
    expect(await build(999).capReached(0)).toBe(false);
  });
});
