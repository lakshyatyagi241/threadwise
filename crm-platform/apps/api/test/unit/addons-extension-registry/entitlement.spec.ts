import { describe, expect, it } from 'vitest';
import { addonEndsAt } from '../../../src/modules/addons-extension-registry/addon-grants';
import {
  mergeFeature,
  mergeLimit,
  type PlanFacts,
} from '../../../src/modules/addons-extension-registry/entitlement-merge';

const plan = (over: Partial<PlanFacts> = {}): PlanFacts => ({
  platformOwned: false,
  planKnown: true,
  overrides: {},
  planFeatures: { automation: false },
  planLimits: { devices: 3 },
  ...over,
});
const grant = (features: string[] = [], limits: Record<string, number> = {}) => ({
  features,
  limits,
});

describe('add-on entitlement merge (TW-ADD-031)', () => {
  it('a granting add-on turns a flag the plan lacks on; an unlisted key grants nothing', () => {
    expect(mergeFeature(plan(), 'automation', [])).toBe(false);
    expect(mergeFeature(plan(), 'automation', [grant(['automation'])])).toBe(true);
    expect(mergeFeature(plan(), 'automation', [grant(['analytics'])])).toBe(false);
  });

  it('adds the deltas of every active add-on onto the plan cap (3 + 1 + 2 = 6)', () => {
    expect(
      mergeLimit(plan(), 'devices', [grant([], { devices: 1 }), grant([], { devices: 2 })]),
    ).toBe(6);
    expect(mergeLimit(plan(), 'devices', [grant([], { users: 5 })])).toBe(3); // key not declared: ignored
  });

  it('any -1 delta makes the cap unlimited (0 in the plan domain)', () => {
    expect(
      mergeLimit(plan(), 'devices', [grant([], { devices: 2 }), grant([], { devices: -1 })]),
    ).toBe(0);
  });

  it('an unlimited plan stays unlimited: a boost never lowers it (Reference quirk fixed)', () => {
    expect(
      mergeLimit(plan({ planLimits: { devices: 0 } }), 'devices', [grant([], { devices: 2 })]),
    ).toBe(0);
  });

  it('an override wins outright, whatever the add-ons say', () => {
    const p = plan({ overrides: { limits: { devices: 10 }, features: { automation: false } } });
    expect(mergeLimit(p, 'devices', [grant([], { devices: 5 })])).toBe(10);
    expect(mergeFeature(p, 'automation', [grant(['automation'])])).toBe(false);
  });

  it('a platform-owned organization is never limited', () => {
    const p = plan({ platformOwned: true });
    expect(mergeFeature(p, 'automation', [])).toBe(true);
    expect(mergeLimit(p, 'devices', [])).toBe(0);
  });

  it('a feature of a module that is switched off grants nothing, even through an add-on', () => {
    expect(mergeFeature(plan(), 'automation', [grant(['automation'])], { dormant: true })).toBe(
      false,
    );
  });
});

describe('add-on end date (TW-ADD-032)', () => {
  const now = new Date('2026-01-31T10:00:00.000Z');
  const month = {
    isFree: false,
    isLifetime: false,
    billingUnit: 'months' as const,
    billingDuration: 1,
  };

  it('one month ends one month later, clamped to the shorter month', () => {
    expect(addonEndsAt(now, month)?.toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addonEndsAt(new Date('2026-03-15T00:00:00Z'), month)?.toISOString()).toBe(
      '2026-04-15T00:00:00.000Z',
    );
  });

  it('lifetime and free packs never end', () => {
    expect(addonEndsAt(now, { ...month, isLifetime: true })).toBeNull();
    expect(addonEndsAt(now, { ...month, isFree: true })).toBeNull();
  });

  it('days, weeks and years count in their unit; a duration below 1 counts as 1', () => {
    expect(
      addonEndsAt(now, { ...month, billingUnit: 'days', billingDuration: 10 })?.toISOString(),
    ).toBe('2026-02-10T10:00:00.000Z');
    expect(
      addonEndsAt(now, { ...month, billingUnit: 'weeks', billingDuration: 2 })?.toISOString(),
    ).toBe('2026-02-14T10:00:00.000Z');
    expect(
      addonEndsAt(now, { ...month, billingUnit: 'years', billingDuration: 1 })?.toISOString(),
    ).toBe('2027-01-31T10:00:00.000Z');
    expect(addonEndsAt(now, { ...month, billingDuration: 0 })?.toISOString()).toBe(
      '2026-02-28T10:00:00.000Z',
    );
  });
});
