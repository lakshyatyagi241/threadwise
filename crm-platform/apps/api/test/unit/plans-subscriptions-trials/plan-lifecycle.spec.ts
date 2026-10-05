import { HttpStatus, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, type PlanState } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { AppError } from '../../../src/common/errors/app-error';
import { viaFor } from '../../../src/modules/plans-subscriptions-trials/billing.service';
import {
  addCalendar,
  changeDirection,
  daysUntil,
  defaultPeriodEnd,
  monthStart,
  nextMonthStart,
  planStateOf,
  validityOf,
} from '../../../src/modules/plans-subscriptions-trials/plan-lifecycle';
import type { Entitlements } from '../../../src/modules/plans-subscriptions-trials/plan-entitlement.service';
import { meterPercent } from '../../../src/modules/plans-subscriptions-trials/plan-usage.service';
import { classifyPlanAction } from '../../../src/modules/plans-subscriptions-trials/plan-rules';
import {
  TrialGateGuard,
  firstSegment,
} from '../../../src/modules/plans-subscriptions-trials/trial-gate.guard';

const NOW = new Date('2026-10-02T12:00:00Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

const free = { isFree: true, isCustomQuote: false, amount: '0.00' };
const paid = (amount: string) => ({ isFree: false, isCustomQuote: false, amount });
const quote = { isFree: false, isCustomQuote: true, amount: '0.00' };

describe('planStateOf (TW-PLAN-016 state table)', () => {
  const cases: Array<[string, Parameters<typeof planStateOf>[0], PlanState]> = [
    ['no plan row', { plan: null, trialEndsAt: null, planEndsAt: null, now: NOW }, 'no_plan'],
    [
      'free, trial ahead',
      { plan: free, trialEndsAt: at(3), planEndsAt: null, now: NOW },
      'free_trial',
    ],
    [
      'free, trial behind',
      { plan: free, trialEndsAt: at(-1), planEndsAt: null, now: NOW },
      'free_trial_expired',
    ],
    ['free, no trial', { plan: free, trialEndsAt: null, planEndsAt: null, now: NOW }, 'free'],
    [
      'paid, no end date',
      { plan: paid('49.00'), trialEndsAt: null, planEndsAt: null, now: NOW },
      'paid_active',
    ],
    [
      'paid, end ahead',
      { plan: paid('49.00'), trialEndsAt: null, planEndsAt: at(10), now: NOW },
      'paid_active',
    ],
    [
      'paid, end passed',
      { plan: paid('49.00'), trialEndsAt: null, planEndsAt: at(-1), now: NOW },
      'paid_lapsed',
    ],
    [
      'paid with a stale trial date is never trial-gated',
      { plan: paid('49.00'), trialEndsAt: at(-5), planEndsAt: null, now: NOW },
      'paid_active',
    ],
    [
      'custom quote',
      { plan: quote, trialEndsAt: null, planEndsAt: at(-1), now: NOW },
      'custom_quote',
    ],
  ];
  it.each(cases)('%s', (_name, input, expected) => {
    expect(planStateOf(input)).toBe(expected);
  });
});

describe('daysUntil / validityOf (TW-PLAN-013)', () => {
  it('rounds up with a floor of 1: 36 hours reads 2 days, the last hours read 1 day', () => {
    expect(daysUntil(new Date(NOW.getTime() + 36 * 3_600_000), NOW)).toBe(2);
    expect(daysUntil(new Date(NOW.getTime() + 3_600_000), NOW)).toBe(1);
    expect(daysUntil(NOW, NOW)).toBe(0);
    expect(daysUntil(null, NOW)).toBeNull();
  });
  it('counts down a running trial and flags the renewal window only in the last 7 paid days', () => {
    expect(
      validityOf({ plan: free, trialEndsAt: at(2), planEndsAt: null, now: NOW }),
    ).toMatchObject({
      state: 'free_trial',
      daysLeft: 2,
      renewalWindow: false,
    });
    const five = validityOf({
      plan: paid('49.00'),
      trialEndsAt: null,
      planEndsAt: at(5),
      now: NOW,
    });
    expect(five).toMatchObject({ state: 'paid_active', daysLeft: 5, renewalWindow: true });
    expect(
      validityOf({ plan: paid('49.00'), trialEndsAt: null, planEndsAt: at(8), now: NOW })
        .renewalWindow,
    ).toBe(false);
    expect(
      validityOf({ plan: paid('49.00'), trialEndsAt: null, planEndsAt: null, now: NOW })
        .renewalWindow,
    ).toBe(false);
  });
  it('shows no countdown once the trial ended or the plan lapsed', () => {
    expect(
      validityOf({ plan: free, trialEndsAt: at(-1), planEndsAt: null, now: NOW }).daysLeft,
    ).toBeNull();
    expect(
      validityOf({ plan: paid('9.00'), trialEndsAt: null, planEndsAt: at(-2), now: NOW }).daysLeft,
    ).toBeNull();
  });
});

describe('changeDirection / classifyPlanAction for a workspace admin', () => {
  it('ranks by list price: free < paid by amount < custom quote', () => {
    expect(changeDirection(free, paid('10.00'))).toBe('upgrade');
    expect(changeDirection(paid('49.00'), free)).toBe('downgrade');
    expect(changeDirection(paid('49.00'), paid('19.00'))).toBe('downgrade');
    expect(changeDirection(paid('19.00'), paid('19.00'))).toBe('switch');
    expect(changeDirection(quote, paid('99.00'))).toBe('downgrade');
    expect(changeDirection(null, paid('9.00'))).toBe('upgrade');
  });
  it('lets the plans page offer a downgrade; onboarding keeps the Reference rule', () => {
    const current = { slug: 'pro', ...paid('49.00') };
    const cheaper = { slug: 'starter_paid', ...paid('19.00') };
    const freePlan = { slug: 'free', ...free };
    expect(classifyPlanAction(current, 'pro', cheaper)).toBe('downgrade_unavailable');
    expect(classifyPlanAction(current, 'pro', cheaper, true)).toBe('downgrade');
    expect(classifyPlanAction(current, 'pro', freePlan)).toBe('continue_free');
    expect(classifyPlanAction(current, 'pro', freePlan, true)).toBe('downgrade');
    expect(
      classifyPlanAction({ slug: 'free', ...free }, 'free', { slug: 'free2', ...free }, true),
    ).toBe('choose');
    expect(classifyPlanAction(current, 'pro', { slug: 'biz', ...paid('99.00') }, true)).toBe(
      'upgrade',
    );
    expect(classifyPlanAction(current, 'pro', { slug: 'ent', ...quote }, true)).toBe(
      'contact_sales',
    );
  });
  it('sends a dearer paid plan to checkout and everything else to an immediate change', () => {
    const f = (slug: string, p: { isFree: boolean; isCustomQuote: boolean; amount: string }) => ({
      slug,
      name: slug,
      subtitle: null,
      offerAmount: null,
      currency: 'USD',
      billingUnit: 'months' as const,
      billingDuration: 1,
      isLifetime: false,
      isActive: true,
      isDefault: false,
      isHighlighted: false,
      sortOrder: 0,
      ctaLabel: 'Go',
      limits: {},
      features: {},
      id: slug,
      ...p,
    });
    const cur = f('pro', paid('49.00'));
    expect(viaFor('upgrade', f('biz', paid('99.00')), cur)).toBe('checkout');
    expect(viaFor('downgrade', f('mini', paid('9.00')), cur)).toBe('change');
    expect(viaFor('downgrade', f('free', free), cur)).toBe('change');
    expect(viaFor('choose', f('free2', free), null)).toBe('change');
    expect(viaFor('choose', f('first', paid('9.00')), null)).toBe('checkout');
    expect(viaFor('contact_sales', f('ent', quote), cur)).toBe('sales');
    expect(viaFor('current', cur, cur)).toBe('none');
  });
});

describe('periods', () => {
  it('adds calendar months with end-of-month clamping', () => {
    expect(addCalendar(new Date('2026-01-31T00:00:00Z'), 'months', 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
    expect(addCalendar(new Date('2026-10-02T00:00:00Z'), 'years', 1).toISOString()).toBe(
      '2027-10-02T00:00:00.000Z',
    );
    expect(addCalendar(new Date('2026-10-02T00:00:00Z'), 'weeks', 2).toISOString()).toBe(
      '2026-10-16T00:00:00.000Z',
    );
  });
  it('stamps a period for a paid plan but never for free, lifetime or custom quotes', () => {
    const term = { billingUnit: 'months' as const, billingDuration: 3, isLifetime: false };
    expect(defaultPeriodEnd(NOW, { ...paid('9.00'), ...term })?.toISOString()).toBe(
      '2027-01-02T12:00:00.000Z',
    );
    expect(defaultPeriodEnd(NOW, { ...free, ...term })).toBeNull();
    expect(defaultPeriodEnd(NOW, { ...paid('9.00'), ...term, isLifetime: true })).toBeNull();
    expect(defaultPeriodEnd(NOW, { ...quote, ...term })).toBeNull();
  });
  it('resets monthly meters on the first of the calendar month, not the purchase anniversary', () => {
    expect(monthStart(NOW).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(nextMonthStart(NOW).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(nextMonthStart(new Date('2026-12-15T00:00:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
  it('shows a percent only for capped meters and caps it at 100', () => {
    expect(meterPercent(400, 1000)).toBe(40);
    expect(meterPercent(1500, 1000)).toBe(100);
    expect(meterPercent(5, 0)).toBeNull();
  });
});

describe('TrialGateGuard (TW-PLAN-015)', () => {
  it('reads the first path segment after /api and the version', () => {
    expect(firstSegment('/v2/billing/plans?x=1')).toBe('billing');
    expect(firstSegment('/api/v2/contacts')).toBe('contacts');
    expect(firstSegment('/health')).toBe('health');
  });

  const ctx = (url: string, meta: Record<string, boolean> = {}) =>
    ({
      getType: () => 'http',
      getHandler: () => ({ meta }),
      getClass: () => ({ meta: {} }),
      switchToHttp: () => ({ getRequest: () => ({ originalUrl: url }) }),
    }) as never;
  const reflector = {
    getAllAndOverride: (key: string, targets: Array<{ meta?: Record<string, boolean> }>) =>
      targets.some((t) => t.meta?.[key]) || undefined,
  } as unknown as Reflector;
  const entitlements = (state: PlanState, platformOwned = false) => {
    const forOrg = vi.fn(async () => ({ state, platformOwned }) as unknown as Entitlements);
    return { forOrg } as never;
  };
  const run = <T>(actorType: 'user' | 'platform_operator' | 'api_key', fn: () => Promise<T>) =>
    RequestContextStore.run({ requestId: 'r', orgId: 7, actorType, actorId: 1, userId: 1 }, fn);

  it('blocks a feature route with 402 and the upgrade link once the trial has ended', async () => {
    const guard = new TrialGateGuard(reflector, entitlements('free_trial_expired'));
    const err = await run('user', () => guard.canActivate(ctx('/v2/contacts'))).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
    expect((err as AppError).code).toBe(ERROR_CODES.PLAN_TRIAL_EXPIRED);
    expect((err as AppError).details).toEqual([
      { path: 'upgradeUrl', message: '/account/plans' },
      { path: 'trial', message: 'expired' },
    ]);
  });
  it('gates API keys too (the Reference leak is closed) but never platform operators', async () => {
    const guard = new TrialGateGuard(reflector, entitlements('free_trial_expired'));
    await expect(
      run('api_key', () => guard.canActivate(ctx('/v2/contacts'))),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      run('platform_operator', () => guard.canActivate(ctx('/v2/contacts'))),
    ).resolves.toBe(true);
  });
  it('keeps billing, checkout, account, support and sign-in reachable', async () => {
    const guard = new TrialGateGuard(reflector, entitlements('free_trial_expired'));
    for (const url of [
      '/v2/billing/plans',
      '/v2/billing/checkout/plans/pro/orders',
      '/v2/plans',
      '/v2/auth/switch',
      '/v2/account/me',
      '/v2/support/tickets',
      '/v2/payments/return',
    ]) {
      await expect(run('user', () => guard.canActivate(ctx(url)))).resolves.toBe(true);
    }
    await expect(
      run('user', () =>
        guard.canActivate(ctx('/v2/contacts', { 'plan:allow-when-trial-expired': true })),
      ),
    ).resolves.toBe(true);
  });
  it.each<PlanState>([
    'free_trial',
    'free',
    'paid_active',
    'paid_lapsed',
    'no_plan',
    'custom_quote',
  ])('lets %s through', async (state) => {
    const guard = new TrialGateGuard(reflector, entitlements(state));
    await expect(run('user', () => guard.canActivate(ctx('/v2/contacts')))).resolves.toBe(true);
  });
  it('never gates a workspace the platform owns', async () => {
    const guard = new TrialGateGuard(reflector, entitlements('free_trial_expired', true));
    await expect(run('user', () => guard.canActivate(ctx('/v2/contacts')))).resolves.toBe(true);
  });
  it('fails open when the plan cannot be read; reuses an open verdict but never an expired one', async () => {
    Logger.overrideLogger(false);
    const boom = {
      forOrg: vi.fn(async () => {
        throw new Error('db down');
      }),
    } as never;
    await expect(
      run('user', () => new TrialGateGuard(reflector, boom).canActivate(ctx('/v2/contacts'))),
    ).resolves.toBe(true);

    const open = entitlements('free');
    const g1 = new TrialGateGuard(reflector, open);
    await run('user', () => g1.canActivate(ctx('/v2/contacts')));
    await run('user', () => g1.canActivate(ctx('/v2/contacts')));
    expect((open as unknown as { forOrg: ReturnType<typeof vi.fn> }).forOrg).toHaveBeenCalledTimes(
      1,
    );

    const expired = entitlements('free_trial_expired');
    const g2 = new TrialGateGuard(reflector, expired);
    await run('user', () => g2.canActivate(ctx('/v2/contacts'))).catch(() => undefined);
    await run('user', () => g2.canActivate(ctx('/v2/contacts'))).catch(() => undefined);
    expect(
      (expired as unknown as { forOrg: ReturnType<typeof vi.fn> }).forOrg,
    ).toHaveBeenCalledTimes(2);
  });
});

describe('grace period (paid_grace)', () => {
  const base = { plan: paid('999.00'), trialEndsAt: null, now: NOW } as const;

  it('keeps a lapsed paid plan active while autopay is live and the grace days have not run out', () => {
    const input = { ...base, planEndsAt: at(-2), autopay: true, graceDays: 7 };
    expect(planStateOf(input)).toBe('paid_grace');
    const v = validityOf(input);
    expect(v.graceEndsAt).toBe(at(5).toISOString());
    expect(v.daysLeft).toBe(5);
    expect(v.renewalWindow).toBe(false);
  });

  it('lapses once the grace is over', () => {
    expect(planStateOf({ ...base, planEndsAt: at(-7), autopay: true, graceDays: 7 })).toBe(
      'paid_lapsed',
    );
    expect(planStateOf({ ...base, planEndsAt: at(-30), autopay: true, graceDays: 7 })).toBe(
      'paid_lapsed',
    );
  });

  it('gives no grace without a live autopay subscription, with 0 grace days, or when unset', () => {
    expect(planStateOf({ ...base, planEndsAt: at(-1), autopay: false, graceDays: 7 })).toBe(
      'paid_lapsed',
    );
    expect(planStateOf({ ...base, planEndsAt: at(-1), autopay: true, graceDays: 0 })).toBe(
      'paid_lapsed',
    );
    expect(planStateOf({ ...base, planEndsAt: at(-1) })).toBe('paid_lapsed');
  });

  it('is not a state of a plan inside its period, a free plan or a custom quote', () => {
    expect(planStateOf({ ...base, planEndsAt: at(3), autopay: true, graceDays: 7 })).toBe(
      'paid_active',
    );
    expect(
      planStateOf({
        plan: free,
        trialEndsAt: null,
        planEndsAt: at(-1),
        now: NOW,
        autopay: true,
        graceDays: 7,
      }),
    ).toBe('free');
  });
});
