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
