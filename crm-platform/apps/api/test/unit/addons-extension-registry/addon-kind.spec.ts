import { describe, expect, it } from 'vitest';
import { createAddonRequestSchema, derivedAddonKind, includedBy } from '@crm/contracts';

/** The add-on kind the operator chooses (docs/specs/addons-plan-offers.md 1) and the new "plan offer" way an app is included. */
const base = { name: 'Pack', amount: '9', currency: 'USD' };

describe('the add-on kind', () => {
  it('a client that names none keeps creating packs as before; the kind is then derived from the grants', () => {
    const empty = createAddonRequestSchema.safeParse({ ...base, features: [], limits: {} });
    expect(empty.success).toBe(true);
    expect(empty.success && empty.data.kind).toBe('feature');
    const seats = createAddonRequestSchema.safeParse({
      ...base,
      features: [],
      limits: { users: 5 },
    });
    expect(seats.success && seats.data.kind).toBe('capacity');
    expect(derivedAddonKind({ features: ['inbox_routing'], limits: { teams: 3 } })).toBe('feature');
  });

  it('a named kind is held to its grants: a feature add-on unlocks a feature, a capacity add-on only adds to limits', () => {
    const issues = (v: unknown) => {
      const r = createAddonRequestSchema.safeParse({ ...base, ...(v as object) });
      return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
    };
    expect(issues({ kind: 'feature', features: [], limits: { users: 1 } })).toEqual(['features']);
    expect(issues({ kind: 'feature', features: ['inbox_routing'], limits: { teams: 3 } })).toEqual(
      [],
    );
    expect(issues({ kind: 'capacity', features: ['inbox_routing'], limits: { users: 1 } })).toEqual(
      ['features'],
    );
    expect(issues({ kind: 'capacity', features: [], limits: {} })).toEqual(['limits']);
    expect(issues({ kind: 'capacity', features: [], limits: { users: 1 } })).toEqual([]);
  });
});

describe('an app the operator set to Included on the plan', () => {
  const f = {
    includedPlanFeature: null,
    planFeatureOn: false,
    includedMinPlan: null,
    orgPlanSlug: 'pro',
    planLapsed: false,
    catalogue: ['free', 'pro'],
  };
  it('is included by the plan offer, after the operator rules and before the plan-grants rule', () => {
    expect(includedBy({ ...f, planOfferIncluded: true })).toBe('plan_offer');
    expect(includedBy({ ...f, planOfferIncluded: false })).toBeNull();
    expect(includedBy({ ...f, planOfferIncluded: true, planCarriesGrants: true })).toBe(
      'plan_offer',
    );
    expect(
      includedBy({ ...f, includedPlanFeature: 'x', planFeatureOn: true, planOfferIncluded: true }),
    ).toBe('plan_feature');
  });
});
