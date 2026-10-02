import { describe, expect, it } from 'vitest';
import type { PlanValidity } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { buildOverrides } from '../operator/attach-dialog';
import { bannerFor, barFor, checkoutPath, compareRows, featureRows, priceView } from './format';
import { redirectOnTrialExpired } from './trial-redirect';

const v = (over: Partial<PlanValidity>): PlanValidity => ({
  state: 'free',
  trialEndsAt: null,
  planEndsAt: null,
  daysLeft: null,
  renewalWindow: false,
  ...over,
});

describe('top bar (TW-PLAN-013)', () => {
  it('shows the trial countdown, the ended notice or the renewal reminder, never two', () => {
    expect(barFor(v({ state: 'free_trial' }))).toBe('trial');
    expect(barFor(v({ state: 'free_trial_expired' }))).toBe('trialEnded');
    expect(barFor(v({ state: 'paid_active', renewalWindow: true }))).toBe('renew');
    expect(barFor(v({ state: 'paid_active' }))).toBeNull();
    expect(barFor(v({ state: 'paid_lapsed' }))).toBeNull();
    expect(barFor(v({ state: 'free' }))).toBeNull();
  });
});

describe('validity banner (TW-PLAN-011)', () => {
  it('reads the state: lapsed is red, a renewal window is a warning, no plan record shows nothing', () => {
    expect(bannerFor(v({ state: 'paid_lapsed' }))).toEqual({ tone: 'danger', key: 'expired' });
    expect(bannerFor(v({ state: 'paid_active', planEndsAt: 'x', renewalWindow: true }))?.tone).toBe(
      'warning',
    );
    expect(bannerFor(v({ state: 'paid_active' }))?.key).toBe('activeForever');
    expect(bannerFor(v({ state: 'no_plan' }))).toBeNull();
  });
});

describe('feature rows', () => {
  const plan = {
    limits: { contacts: 0, devices: 3 },
    features: { calling: true, shopify: false },
  } as never;
  it('lists every cap (0 = unlimited) then only the enabled flags', () => {
    expect(featureRows(plan)).toEqual([
      { kind: 'limit', key: 'contacts', value: 0 },
      { kind: 'limit', key: 'devices', value: 3 },
      { kind: 'flag', key: 'calling' },
    ]);
  });
  it('compares only flags at least one plan enables', () => {
    const a = { limits: { contacts: 1 }, features: { calling: false, shopify: false } } as never;
    const b = { limits: { contacts: 2 }, features: { calling: true, shopify: false } } as never;
    expect(compareRows([a, b])).toEqual({ limits: ['contacts'], flags: ['calling'] });
    expect(compareRows([])).toEqual({ limits: [], flags: [] });
  });
});

describe('operator overrides form', () => {
  it('leaves empty caps and default flags out, keeps 0 and -1', () => {
    expect(
      buildOverrides(
        { contacts: '', devices: '0', users: '-1', flows: 'abc', tags: ' 5 ' },
        { calling: 'on', shopify: 'off', analytics: 'default' },
      ),
    ).toEqual({
      limits: { devices: 0, users: -1, tags: 5 },
      features: { calling: true, shopify: false },
    });
  });
});

describe('trial-expired redirect (TW-PLAN-015)', () => {
  const expired = new ApiError(402, 'PLAN_TRIAL_EXPIRED', 'ended');
  it('sends a feature page to the plan picker once, but never loops from the pages that stay open', () => {
    const go: string[] = [];
    expect(redirectOnTrialExpired(expired, '/contacts', (t) => go.push(t))).toBe(true);
    expect(go).toEqual(['/account/plans']);
    for (const p of ['/account/plans', '/billing/checkout/pro', '/support/tickets']) {
      expect(redirectOnTrialExpired(expired, p, (t) => go.push(t))).toBe(false);
    }
    expect(
      redirectOnTrialExpired(new ApiError(500, 'INTERNAL', 'x'), '/contacts', (t) => go.push(t)),
    ).toBe(false);
    expect(go).toHaveLength(1);
  });
});

describe('yearly mode (TW-PLAN-011 rule 3 and 4)', () => {
  const paid = {
    kind: 'paid',
    lifetime: false,
    price: {
      amount: '49.00',
      offerAmount: null,
      currency: 'USD',
      period: { unit: 'months', count: 1 },
    },
    yearly: { perMonth: '39.20', perYear: '470.40' },
  } as never;
  it('shows the per-month equivalent with the monthly price struck through, and monthly mode is unchanged', () => {
    const y = priceView(paid, 'en-US', 'yearly');
    expect(y).toMatchObject({
      kind: 'paid',
      main: '$39.20',
      strike: '$49.00',
      period: { unit: 'months', count: 1 },
    });
    expect(priceView(paid, 'en-US', 'monthly')).toMatchObject({ main: '$49.00', strike: null });
  });
  it('leaves a plan without a yearly price alone in yearly mode', () => {
    const lifetime = { ...(paid as object), lifetime: true, yearly: null } as never;
    expect(priceView(lifetime, 'en-US', 'yearly')).toMatchObject({ main: '$49.00' });
  });
  it('carries the yearly choice to checkout only when it is yearly', () => {
    expect(checkoutPath('pro', 'yearly')).toBe('/billing/checkout/pro?period=yearly');
    expect(checkoutPath('pro')).toBe('/billing/checkout/pro');
  });
});
