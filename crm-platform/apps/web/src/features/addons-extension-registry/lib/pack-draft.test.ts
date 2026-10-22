import { describe, expect, it } from 'vitest';
import { buildPackRequest, newPackDraft, packToDraft } from './pack-draft';

const draft = (over: Partial<ReturnType<typeof newPackDraft>> = {}) => ({
  ...newPackDraft(),
  name: 'Extra seats',
  amount: '9',
  ...over,
});

describe('buildPackRequest', () => {
  it('builds a request, normalising the price and dropping blank limits', () => {
    const r = buildPackRequest(
      draft({ limits: { users: '5', tags: '' }, features: ['analytics'] }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.amount).toBe('9.00');
      expect(r.body.limits).toEqual({ users: 5 });
      expect(r.body.features).toEqual(['analytics']);
    }
  });

  it('flags a missing name and a bad price by field', () => {
    const r = buildPackRequest(draft({ name: ' ', amount: 'abc' }));
    expect(r).toEqual({ ok: false, problems: { name: true, amount: true } });
  });

  it('refuses an offer at or above the price', () => {
    const r = buildPackRequest(draft({ offerAmount: '9' }));
    expect(r).toEqual({ ok: false, problems: { offerAmount: true } });
  });

  it('refuses a non-numeric limit and accepts -1 as unlimited', () => {
    expect(buildPackRequest(draft({ limits: { users: '5x' } }))).toEqual({
      ok: false,
      problems: { limits: true },
    });
    const ok = buildPackRequest(draft({ limits: { users: '-1' } }));
    expect(ok.ok && ok.body.limits).toEqual({ users: -1 });
  });

  it('a new pack is a recurring monthly subscription: period picker only, never one-time or lifetime', () => {
    const d = newPackDraft();
    expect(d.billingMode).toBe('recurring');
    expect(d.legacy).toBe(false);
    const r = buildPackRequest({
      ...draft({
        billingUnit: 'weeks',
        billingDuration: '7',
        isLifetime: true,
        billingMode: 'one_time',
      }),
    });
    expect(r.ok && r.body).toMatchObject({
      billingMode: 'recurring',
      isLifetime: false,
      billingUnit: 'months',
      billingDuration: 1,
    });
    const yearly = buildPackRequest(draft({ billingUnit: 'years' }));
    expect(yearly.ok && yearly.body).toMatchObject({ billingUnit: 'years', billingDuration: 1 });
  });

  it('a new pack needs a price above zero (a free add-on cannot renew)', () => {
    expect(buildPackRequest(draft({ amount: '0' }))).toEqual({
      ok: false,
      problems: { amountPositive: true },
    });
  });

  it('a legacy pack keeps its own billing exactly as it is (one-time, lifetime, odd period)', () => {
    const stored = {
      id: '00000000-0000-4000-8000-000000000002',
      slug: 'old',
      name: 'Old pack',
      subtitle: null,
      detail: null,
      amount: '50.00',
      offerAmount: null,
      currency: 'USD',
      billingUnit: 'days' as const,
      billingDuration: 90,
      billingMode: 'one_time' as const,
      isFree: false,
      isLifetime: false,
      isActive: true,
      sortOrder: 0,
      grants: { features: ['analytics'], limits: {} },
      activePurchases: 3,
      rowVersion: 4,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const d = packToDraft(stored);
    expect(d.legacy).toBe(true);
    const r = buildPackRequest(d);
    expect(r.ok && r.body).toMatchObject({
      billingMode: 'one_time',
      billingUnit: 'days',
      billingDuration: 90,
    });
    const life = buildPackRequest(
      packToDraft({ ...stored, isLifetime: true, billingUnit: 'months', billingDuration: 1 }),
    );
    expect(life.ok && life.body).toMatchObject({ billingMode: 'one_time', isLifetime: true });
    const free = buildPackRequest(packToDraft({ ...stored, amount: '0.00' }));
    expect(free.ok).toBe(true);
    const monthly = packToDraft({
      ...stored,
      billingUnit: 'months',
      billingDuration: 1,
      billingMode: 'recurring',
    });
    expect(monthly.legacy).toBe(false);
  });

  it('round-trips a stored pack through the draft', () => {
    const d = packToDraft({
      id: '00000000-0000-4000-8000-000000000001',
      slug: 'extra_seats',
      name: 'Extra seats',
      subtitle: null,
      detail: null,
      amount: '9.00',
      offerAmount: null,
      currency: 'USD',
      billingUnit: 'months',
      billingDuration: 1,
      billingMode: 'one_time',
      isFree: false,
      isLifetime: false,
      isActive: true,
      sortOrder: 0,
      grants: { features: ['analytics'], limits: { users: 5 } },
      activePurchases: 0,
      rowVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const r = buildPackRequest(d);
    expect(r.ok && r.body.limits).toEqual({ users: 5 });
  });
});
