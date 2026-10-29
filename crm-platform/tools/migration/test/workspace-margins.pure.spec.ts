import { describe, expect, it } from 'vitest';
import { priceFromMargin as appPriceFromMargin } from '../../../packages/contracts/src/wallet-message-billing/margins';
import {
  marginBpsFor,
  metaCostOf,
  planWorkspaceMargins,
  priceFromMargin,
  verifyWorkspaceMargins,
  type MetaCostRow,
} from '../pricing/workspace-margins';

type J = Record<string, unknown>;
const wa = (a: J, m: J, s: J, u: J): J => ({
  authentication: a,
  marketing: m,
  service: s,
  utility: u,
});
const doc = (name: string, code: string | undefined, w: J): J => ({
  name,
  ...(code ? { code } : {}),
  whatsapp: w,
});
const same = (p: number | string, m: number): J => ({ price: p, margin: m });
// Meta cost in micros: IN marketing 0.7846 INR, IN utility 0.115, default 1.0
const costs: MetaCostRow[] = [
  { country: 'IN', category: 'marketing', micros: 784_600 },
  { country: 'IN', category: 'utility', micros: 115_000 },
  { country: 'SG', category: '', micros: 5_366_000 },
  { country: '', category: '', micros: 1_000_000 },
];

describe('pricing-workspace planner', () => {
  it('uses the same price formula as the application', () => {
    for (const [m, b] of [
      [784_600, 1500],
      [115_000, 0],
      [5_366_000, 1099],
      [3_000, -10_000],
      [1, 5],
    ] as const)
      expect(priceFromMargin(m, b)).toBe(appPriceFromMargin(m, b));
  });

  it('reproduces round2(price + margin) exactly for each workspace row', () => {
    const plan = planWorkspaceMargins(
      [
        doc(
          'India',
          'IN',
          wa(same(0.115, 0.1), same(0.7846, 0.2154), same(0, 0), same(0.115, 0.03)),
        ),
        doc('Singapore', 'SG', wa(same(1, 0), same(5.366, 0.59), same(0, 0), same(1.173, 0.352))),
        doc('other', undefined, wa(same(1, 0), same(2.5, 0), same(0, 0), same(1, 0))),
      ],
      costs,
      '1',
    );
    expect(plan.issues).toEqual([]);
    const want = (c: string, k: string): number =>
      plan.rows.find((r) => r.country === c && r.category === k)!.chargeMinor;
    expect(want('SG', 'marketing')).toBe(596); // 5.366 + 0.59 = 5.956 -> 5.96
    expect(want('SG', 'utility')).toBe(153); // 1.173 + 0.352 = 1.525 -> 1.53 (half away from zero)
    expect(want('IN', 'marketing')).toBe(100);
    expect(want('', 'marketing')).toBe(250);
    for (const r of plan.rows)
      expect(appPriceFromMargin(r.metaCostMicros!, r.marginBps)).toBe(r.chargeMinor);
    // free stays free
    expect(plan.rows.find((r) => r.country === 'IN' && r.category === 'service')!.marginBps).toBe(
      -10_000,
    );
  });

  it('two workspaces with different markups get different margins', () => {
    const a = planWorkspaceMargins(
      [doc('India', 'IN', wa(same(1, 0), same(0.7846, 0.1), same(0, 0), same(0.115, 0)))],
      costs,
      '1',
    );
    const b = planWorkspaceMargins(
      [doc('India', 'IN', wa(same(1, 0), same(0.7846, 0.9), same(0, 0), same(0.115, 0)))],
      costs,
      '1',
    );
    const m = (p: typeof a): number =>
      p.rows.find((r) => r.country === 'IN' && r.category === 'marketing')!.marginBps;
    expect(m(b)).toBeGreaterThan(m(a));
  });

  it('applies the factor and reports what it cannot make exact instead of guessing', () => {
    const plan = planWorkspaceMargins(
      [
        doc('Brazil', 'BR', wa(same(1, 0), same('abc', 0), same(0, 0), same(1, 0))),
        doc('Narnia', undefined, wa(same(1, 0), same(1, 0), same(0, 0), same(1, 0))),
        doc('India again', 'IN', wa(same(1, 0), same(1, 0), same(0, 0), same(1, 0))),
        doc('India', 'IN', wa(same(1, 0), same(1, 0), same(0, 0), same(1, 0))),
      ],
      [{ country: 'IN', category: 'marketing', micros: 784_600 }],
      '0.5',
    );
    const codes = plan.issues.map((i) => i.code);
    expect(codes).toContain('BAD_PRICE');
    expect(codes).toContain('NO_COUNTRY_CODE');
    expect(codes).toContain('NO_META_COST'); // BR has no cost, India has only marketing
    expect(plan.rows.map((r) => `${r.country}|${r.category}|${r.chargeMinor}`)).toEqual([
      'IN|marketing|50',
    ]);
  });

  it('marginBpsFor finds a value inside the range or none', () => {
    expect(marginBpsFor(1_000_000, 100)).toBe(0);
    expect(marginBpsFor(1_000_000, 0)).toBe(-10_000);
    expect(marginBpsFor(0, 5)).toBeNull();
    expect(marginBpsFor(1_000, 100_000)).toBeNull(); // a 0.001 cost cannot reach 1000.00 inside +1000%
  });

  it('metaCostOf follows the application lookup order and skips rows without a cost', () => {
    const rows: MetaCostRow[] = [
      { country: 'IN', category: 'marketing', micros: null },
      { country: 'IN', category: '', micros: 5 },
      { country: '', category: '', micros: 9 },
    ];
    expect(metaCostOf(rows, 'IN', 'marketing')).toBe(5);
    expect(metaCostOf(rows, 'US', 'marketing')).toBe(9);
    expect(metaCostOf([], 'US', 'marketing')).toBeNull();
  });

  it('the read-back catches a missing, extra, changed or no-longer-exact row', () => {
    const plan = planWorkspaceMargins(
      [doc('India', 'IN', wa(same(1, 0), same(0.7846, 0.2154), same(0, 0), same(0.115, 0)))],
      costs,
      '1',
    );
    const good = plan.rows.map((r) => ({
      country: r.country,
      category: r.category,
      marginBps: r.marginBps,
    }));
    expect(verifyWorkspaceMargins(plan, good, costs).ok).toBe(true);
    expect(verifyWorkspaceMargins(plan, good.slice(1), costs).missing).toHaveLength(1);
    expect(
      verifyWorkspaceMargins(
        plan,
        [...good, { country: 'FR', category: 'utility', marginBps: 1 }],
        costs,
      ).extra,
    ).toHaveLength(1);
    expect(
      verifyWorkspaceMargins(
        plan,
        good.map((g, i) => (i === 0 ? { ...g, marginBps: g.marginBps + 500 } : g)),
        costs,
      ).ok,
    ).toBe(false);
    // Meta changed its price since the load: the stored margin no longer charges what Waboo charged
    const moved = costs.map((c) =>
      c.country === 'IN' && c.category === 'marketing' ? { ...c, micros: 900_000 } : c,
    );
    expect(verifyWorkspaceMargins(plan, good, moved).wrongCharge.length).toBeGreaterThan(0);
  });
});
