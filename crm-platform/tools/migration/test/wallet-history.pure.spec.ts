import { describe, expect, it } from 'vitest';
import { HistoryError, planHistory, text4, to4, type HistoryInput } from '../credits/history';
import { oracleHistory } from '../reconcile/oracle-history';

/**
 * wallet-history: the planner (credits/history.ts) and the verifier's independent oracle (reconcile/oracle-history.ts) on synthetic
 * documents. No database. The two implementations must produce the same rows.
 */
const ASOF = Date.parse('2026-10-15T12:00:00Z');
const base = (over: Partial<HistoryInput> = {}): HistoryInput => ({
  client: 'c1',
  targetMinor: to4('100')!,
  asOfMs: ASOF,
  timezone: 'Asia/Kolkata',
  creditLogs: [],
  charges: [],
  events: [],
  workspaceId: null,
  ...over,
});
const charge = (id: string, at: string, amount: number, extra: Record<string, unknown> = {}) => ({
  _id: id,
  created_time: at,
  amount,
  template_category: 'utility',
  ...extra,
});

describe('to4', () => {
  it('rounds half away from zero at four decimals, on the text', () => {
    expect(to4(1.525)).toBe(15250n);
    expect(to4('0.00005')).toBe(1n);
    expect(to4('-0.00005')).toBe(-1n);
    expect(to4(0.8500000000000001)).toBe(8500n);
    expect(to4('x')).toBeNull();
    expect(text4(-5956n)).toBe('-0.5956');
  });
});

describe('planHistory', () => {
  it('groups non-reverted charges per local day and category; the day is the workspace zone, not UTC', () => {
    // 2026-10-13T20:00Z is already 2026-10-14 in Kolkata
    const p = planHistory(
      base({
        charges: [
          charge('a', '2026-10-13T20:00:00Z', 1.525),
          charge('b', '2026-10-14T05:00:00Z', 1.525),
          charge('c', '2026-10-14T05:00:00Z', 5.956, { template_category: 'marketing' }),
        ],
      }),
    );
    const keys = p.rows.map((r) => r.key).filter((k) => k.includes(':wa:chg:'));
    expect(keys.sort()).toEqual(
      ['waboo:c1:wa:chg:2026-10-14:marketing', 'waboo:c1:wa:chg:2026-10-14:utility'].sort(),
    );
    expect(p.rows.find((r) => r.key.endsWith('2026-10-14:utility'))!.minor).toBe(-30500n);
    expect(p.rows.find((r) => r.key.endsWith('2026-10-14:marketing'))!.description).toBe(
      'Balance Deducted For Whatsapp Marketing',
    );
  });

  it('a reverted charge is a deduction and a refund; without reverted_at it is worth nothing', () => {
    const p = planHistory(
      base({
        charges: [
          charge('r1', '2026-10-10T05:00:00Z', 2, {
            revert: true,
            reverted_at: '2026-10-12T05:00:00Z',
          }),
          charge('r2', '2026-10-10T05:00:00Z', 3, { revert: true }),
        ],
      }),
    );
    expect(p.stats.neutralReverted).toBe(1);
    const net = p.rows.filter((r) => r.key.includes(':wa:')).reduce((s, r) => s + r.minor, 0n);
    expect(net).toBe(0n);
    expect(p.rows.some((r) => r.type === 'refund' && r.minor === 20000n)).toBe(true);
  });

  it('chains from a derived opening to exactly the live balance', () => {
    const p = planHistory(
      base({
        targetMinor: to4('90')!,
        charges: [charge('a', '2026-10-10T05:00:00Z', 10)],
        events: [{ src: 'reseller', id: 'e1', at: '2026-10-11T05:00:00Z', delta: 40, prev: 50 }],
      }),
    );
    // opening = 90 - (-10 + 40) = 60
    expect(p.openingMinor).toBe(to4('60')!);
    expect(p.rows[0]!.key).toBe('waboo:c1:opening');
    expect(p.rows.at(-1)!.balanceAfter).toBe(to4('90')!);
    expect(p.checkpoints).toBe(1);
    expect(p.checkpointMisses).toHaveLength(0); // 60 - 10 = 50 logged
  });

  it('reports a checkpoint that does not match the balance Waboo logged', () => {
    const p = planHistory(
      base({
        targetMinor: to4('90')!,
        charges: [charge('a', '2026-10-10T05:00:00Z', 10)],
        events: [{ src: 'reseller', id: 'e1', at: '2026-10-11T05:00:00Z', delta: 40, prev: 80 }],
      }),
    );
    expect(p.checkpointMisses).toHaveLength(1);
  });

  it('leaves out what happened after the balance was read', () => {
    const p = planHistory(
      base({
        targetMinor: to4('90')!,
        charges: [
          charge('late', '2026-10-16T05:00:00Z', 7),
          charge('a', '2026-10-10T05:00:00Z', 10),
        ],
      }),
    );
    expect(p.stats.skippedAfterAsOf).toBe(1);
    expect(p.openingMinor).toBe(to4('100')!);
  });

  it('refuses an opening below zero, and a dive deeper than any overdraft; a small overdraft is kept', () => {
    expect(() =>
      planHistory(
        base({ targetMinor: to4('10')!, charges: [charge('a', '2026-10-10T05:00:00Z', 50)] }),
      ),
    ).not.toThrow(); // opening 60
    expect(() =>
      planHistory(
        base({
          targetMinor: to4('0')!,
          events: [{ src: 'reseller', id: 'x', at: '2026-10-10T05:00:00Z', delta: 5 }],
        }),
      ),
    ).toThrow(HistoryError); // opening -5
    const small = planHistory(
      base({
        targetMinor: to4('10')!,
        charges: [charge('a', '2026-10-10T05:00:00Z', 15)],
        events: [{ src: 'reseller', id: 'e', at: '2026-10-11T05:00:00Z', delta: 20 }],
      }),
    );
    expect(small.belowZero).toBe(1); // opening 5, then -15 = -10 (an overdraft, kept), then +20 = 10
    expect(small.lowest).toBe(to4('-10')!);
    const dips = planHistory(
      base({
        targetMinor: to4('10')!,
        charges: [charge('a', '2026-10-10T05:00:00Z', 15)],
        events: [{ src: 'reseller', id: 'e', at: '2026-10-11T05:00:00Z', delta: 0.5 }],
      }),
    );
    expect(dips.rows.at(-1)!.balanceAfter).toBe(to4('10')!);
    expect(() =>
      planHistory(
        base({
          targetMinor: to4('5000')!,
          charges: [charge('a', '2026-10-10T05:00:00Z', 3000)],
          events: [{ src: 'reseller', id: 'e', at: '2026-10-11T05:00:00Z', delta: 8000 }],
        }),
      ),
    ).toThrow(HistoryError);
  });

  it('the verifier oracle produces the same rows as the planner', () => {
    const input = base({
      targetMinor: to4('1116.17')!,
      charges: [
        charge('a', '2026-10-13T20:00:00Z', 1.525),
        charge('b', '2026-10-14T05:00:00Z', 5.956, { template_category: 'marketing' }),
        charge('r', '2026-10-10T05:00:00Z', 2.1, {
          revert: true,
          reverted_at: '2026-10-12T05:00:00Z',
        }),
        charge('n', '2026-10-10T05:00:00Z', 3, { revert: true }),
        charge('z', '2026-10-10T05:00:00Z', 0),
        charge('o', '2026-10-09T05:00:00Z', 0.8500000000000001, {
          template_category: undefined,
          origin: 'marketing',
        }),
      ],
      creditLogs: [
        {
          _id: 'ai1',
          created_time: '2026-04-05T20:59:52Z',
          credits_deducted: 0.004132,
          description: 'AI',
        },
      ],
      events: [
        { src: 'reseller', id: 'e1', at: '2026-02-11T12:59:48Z', delta: 70 },
        { src: 'expense', id: 'x1', at: '2026-02-09T14:44:53Z', delta: 500, invoice: 'INV1' },
        { src: 'reseller', id: 'e2', at: '2026-02-12T06:32:53Z', delta: -83, reason: 'test' },
      ],
    });
    const p = planHistory(input);
    const o = oracleHistory({
      client: 'c1',
      balanceText: '1116.17',
      asOf: new Date(ASOF).toISOString(),
      timezone: 'Asia/Kolkata',
      creditLogs: input.creditLogs,
      charges: input.charges,
      events: input.events as unknown as Array<Record<string, unknown>>,
      workspaceId: null,
    });
    expect(o.rows.map((r) => [r.key, r.atMs, r.type, r.amount, r.balanceAfter])).toEqual(
      p.rows.map((r) => [r.key, r.atMs, r.type, r.minor, r.balanceAfter]),
    );
    expect(o.opening).toBe(p.openingMinor);
  });

  // Tirupati Bank: top-ups since 2025-03 with the balance Waboo recorded before each, but message charges logged only since 2026-08-25
  const AS_OF2 = Date.parse('2026-10-30T09:46:31Z');
  const tops = [
    ['t1', '2025-03-28T08:00:00Z', 5000, 2687.100000000071],
    ['t2', '2025-03-31T08:00:00Z', 554, 7124.599999996822],
    ['t3', '2025-04-04T08:00:00Z', 5000, 2697.099999996972],
    ['t4', '2025-05-14T08:00:00Z', 10000, 1340.3999999971597],
    ['t5', '2025-08-14T08:00:00Z', 5000, 5736.99999999625],
    ['t6', '2025-10-24T08:00:00Z', 10000, 1801.2499999998706],
    ['t7', '2026-09-19T08:00:00Z', 10000, 4811.682000000013],
    ['t8', '2026-09-22T08:00:00Z', 50000, 14811.682000000013],
  ] as const;
  const tiru = (target: string) => {
    const events = tops.map(([id, at, delta, prev]) => ({
      src: 'reseller' as const,
      id,
      at,
      delta,
      prev,
    }));
    const charges: ReturnType<typeof charge>[] = [];
    for (
      let d = new Date('2026-08-25T06:00:00Z');
      d.getTime() < AS_OF2;
      d = new Date(d.getTime() + 86_400_000)
    )
      charges.push(charge(`c${d.toISOString().slice(0, 10)}`, d.toISOString(), 50));
    return base({ targetMinor: to4(target)!, asOfMs: AS_OF2, events, charges });
  };

  it('logs that do not reach back to the start: usage before them is entered from the balances Waboo recorded', () => {
    const input = tiru('62900');
    const p = planHistory(input);
    // every real top-up stays; the chain starts at zero and ends at the live balance
    expect(p.rows.filter((r) => r.key.includes(':reseller:'))).toHaveLength(8);
    expect(p.openingMinor).toBe(0n);
    expect(p.rows.at(-1)!.balanceAfter).toBe(to4('62900')!);
    expect(p.unitemisedRows).toBeGreaterThan(0);
    // the balance before each top-up is the one Waboo recorded
    for (const [id, , , prev] of tops) {
      const k = p.rows.findIndex((r) => r.key === `waboo:c1:reseller:${id}`);
      expect(p.rows[k - 1]!.balanceAfter, id).toBe(to4(prev)!);
    }
    // the rows are entered as usage not itemised (or its opposite), one ms ahead of the top-up
    const u = p.rows.filter((r) => r.key.includes(':unitemised:'));
    expect(
      u.every((r) => r.source === 'waboo_migration' && r.actorType === 'platform_operator'),
    ).toBe(true);
    expect(u.find((r) => r.key.endsWith('unitemised:t3'))).toMatchObject({
      type: 'spend',
      description: "Usage not itemised in Waboo's logs",
    });
    // the verifier's independent oracle produces the same rows
    const o = oracleHistory({
      client: 'c1',
      balanceText: '62900',
      asOf: new Date(AS_OF2).toISOString(),
      timezone: 'Asia/Kolkata',
      creditLogs: [],
      charges: input.charges,
      events: input.events as unknown as Array<Record<string, unknown>>,
      workspaceId: null,
    });
    expect(o.rows.map((r) => [r.key, r.atMs, r.type, r.amount, r.balanceAfter])).toEqual(
      p.rows.map((r) => [r.key, r.atMs, r.type, r.minor, r.balanceAfter]),
    );
  });

  it('is refused when the logs after the last recorded balance are far from the live balance, and when no balance was recorded', () => {
    expect(() => planHistory(tiru('50000'))).toThrow(HistoryError);
    const noPrev = tiru('62900');
    noPrev.events = noPrev.events.map((e) => ({ ...e, prev: undefined }));
    expect(() => planHistory(noPrev)).toThrow(HistoryError);
  });

  it('a wallet whose logs reach back to its start is unchanged: no unitemised row', () => {
    const p = planHistory(base({ charges: [charge('a', '2026-10-13T20:00:00Z', 1.525)] }));
    expect(p.unitemisedRows).toBe(0);
    expect(p.rows.some((r) => r.key.includes('unitemised'))).toBe(false);
  });
});
