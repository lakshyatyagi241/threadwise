import { describe, expect, it } from 'vitest';
import type { AddonPlanOffer } from '@crm/contracts';
import {
  buildPackRequest,
  buildPlanOffersRequest,
  changedPlanOfferCount,
  newPackDraft,
  packToDraft,
  planOfferModes,
  planOfferSummary,
  planOffersToDraft,
  setPlanOfferAmount,
  setPlanOfferMode,
} from './pack-draft';

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
      kind: 'feature' as const,
      planOffers: [],
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
    // an inactive draft nobody holds can be converted to a subscription
    expect(packToDraft({ ...stored, isActive: false, activePurchases: 0 }).legacy).toBe(false);
    expect(packToDraft({ ...stored, isActive: false, activePurchases: 2 }).legacy).toBe(true);
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
      kind: 'feature',
      planOffers: [],
      rowVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const r = buildPackRequest(d);
    expect(r.ok && r.body.limits).toEqual({ users: 5 });
  });
});

describe('plan offers of a pack (Plans section and list column)', () => {
  const PID = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
  const offer = (n: number, over: Partial<AddonPlanOffer> = {}): AddonPlanOffer => ({
    planId: PID(n),
    planSlug: `plan_${n}`,
    planName: `Plan ${n}`,
    planIsActive: true,
    planIsFree: false,
    mode: 'paid',
    amount: null,
    stored: false,
    ...over,
  });
  const pack = {
    planOffers: [
      offer(1, { planName: 'Free', planIsFree: true, mode: 'hidden', stored: true }),
      offer(2, { planName: 'Basic', amount: '199.00', stored: true }),
      offer(3, { planName: 'Growth', mode: 'included', stored: true }),
      offer(4, { planName: 'Enterprise', mode: 'included', stored: true }),
      offer(5, { planName: 'Starter' }),
    ],
  };

  it('summarises the plans by mode, in plan order; no row counts as paid at the default price', () => {
    const s = planOfferSummary(pack);
    expect(s.included.map((o) => o.planName)).toEqual(['Growth', 'Enterprise']);
    expect(s.paid.map((o) => [o.planName, o.amount])).toEqual([
      ['Basic', '199.00'],
      ['Starter', null],
    ]);
    expect(s.hidden.map((o) => o.planName)).toEqual(['Free']);
  });

  it('a capacity pack offers Paid | Hidden only', () => {
    expect(planOfferModes({ grants: { features: ['analytics'], limits: {} } })).toEqual([
      'included',
      'paid',
      'hidden',
    ]);
    expect(planOfferModes({ grants: { features: [], limits: { users: 1 } } })).toEqual([
      'paid',
      'hidden',
    ]);
  });

  it('sends only the plans that changed, with a blank price as null', () => {
    const d = planOffersToDraft(pack);
    expect(d[PID(2)]).toEqual({ mode: 'paid', amount: '199.00' });
    expect(buildPlanOffersRequest(pack, d)).toEqual({ ok: true, body: { offers: [] } });
    expect(changedPlanOfferCount(pack, d)).toBe(0);
    // retyping the same price is not a change
    expect(changedPlanOfferCount(pack, setPlanOfferAmount(d, PID(2), '199'))).toBe(0);
    const next = setPlanOfferMode(
      setPlanOfferAmount(setPlanOfferMode(d, PID(1), 'paid'), PID(5), '49.5'),
      PID(3),
      'hidden',
    );
    expect(changedPlanOfferCount(pack, next)).toBe(3);
    expect(buildPlanOffersRequest(pack, next)).toEqual({
      ok: true,
      body: {
        offers: [
          { planId: PID(1), mode: 'paid', amount: null },
          { planId: PID(3), mode: 'hidden', amount: null },
          { planId: PID(5), mode: 'paid', amount: '49.50' },
        ],
      },
    });
  });

  it('leaving Paid forgets the price; a bad or zero price is refused on its row', () => {
    const d = setPlanOfferMode(planOffersToDraft(pack), PID(2), 'included');
    expect(d[PID(2)]).toEqual({ mode: 'included', amount: '' });
    expect(
      buildPlanOffersRequest(pack, setPlanOfferAmount(planOffersToDraft(pack), PID(5), 'abc')),
    ).toEqual({ ok: false, problems: { [PID(5)]: 'money' } });
    expect(
      buildPlanOffersRequest(pack, setPlanOfferAmount(planOffersToDraft(pack), PID(5), '0')),
    ).toEqual({ ok: false, problems: { [PID(5)]: 'zero' } });
  });
});
