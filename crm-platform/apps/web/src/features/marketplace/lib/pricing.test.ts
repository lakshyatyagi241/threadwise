import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import {
  ID,
  PACK_PATH,
  card,
  installation,
  paidPricing,
  pricing,
  subscription,
} from '../test-fixtures';
import { MKT_ERROR_KINDS, isRetryable, mktError } from './errors';
import { cardCta, installGate, installationChips } from './install-state';
import { manageView } from './manage';
import {
  acquireFor,
  cardAvailability,
  formatMoney,
  needsPurchase,
  priceChip,
  priceLine,
  pricingView,
  resumeBlocked,
  safeCheckoutPath,
  subscribeBody,
  subscribeNext,
  subscriptionChip,
  subscriptionPause,
  subscriptionSection,
  subscriptionView,
  uninstallRenewal,
} from './pricing';

const problem = (
  status: number,
  code: string,
  errors: Array<{ path: string; message: string }> = [],
) => new ApiError(status, code, 'text that must never be branched on', 'req-1', errors);

const ALL = { read: true, install: true, manage: true };
const OPTS = { hasTestPayload: true };

describe('money', () => {
  it('writes a whole amount without cents and a fractional one with two places, in the person language', () => {
    expect(formatMoney('9.00', 'USD', 'en')).toBe('$9');
    expect(formatMoney('9', 'USD', 'en')).toBe('$9');
    expect(formatMoney('9.50', 'USD', 'en')).toBe('$9.50');
    expect(formatMoney('0.99', 'USD', 'en')).toBe('$0.99');
    expect(formatMoney('1234.00', 'USD', 'en')).toBe('$1,234');
    expect(formatMoney('9.00', 'INR', 'en')).toContain('9');
    expect(formatMoney('9.00', 'USD', 'ar')).not.toBe(formatMoney('9.00', 'USD', 'en'));
  });

  it('prints plainly what the runtime cannot format, never throws', () => {
    expect(formatMoney('9.00', 'XX', 'en')).toBe('9.00 XX');
    expect(formatMoney('9.00', 'USD', 'not a locale')).toBe('9.00 USD');
    expect(formatMoney('abc', 'USD', 'en')).toBe('abc USD');
  });
});

describe('price line', () => {
  it('says Free for a free app, whatever else the answer holds', () => {
    expect(priceLine(pricing(), 'en')).toEqual({ key: 'free', price: null, trialDays: null });
    expect(priceLine(pricing({ trialAvailable: true, trialDays: 14 }), 'en').trialDays).toBeNull();
  });

  it('says "$9 a month" for a paid app with no subscription, with the trial chip while a trial is on offer', () => {
    expect(priceLine(paidPricing(), 'en')).toEqual({ key: 'monthly', price: '$9', trialDays: 14 });
    // The trial was used (or never offered): no chip, even though the listing has trial days.
    expect(priceLine(paidPricing({ trialAvailable: false }), 'en').trialDays).toBeNull();
    expect(
      priceLine(paidPricing({ trialDays: 0, trialAvailable: false }), 'en').trialDays,
    ).toBeNull();
  });

  it('says Included, Subscribed and Not for sale for the other access states', () => {
    expect(priceLine(paidPricing({ access: 'included', includedBy: 'min_plan' }), 'en').key).toBe(
      'included',
    );
    const entitled = priceLine(paidPricing({ access: 'entitled', trialAvailable: false }), 'en');
    expect(entitled).toEqual({ key: 'subscribed', price: '$9', trialDays: null });
    expect(priceLine(paidPricing({ access: 'not_for_sale', trialAvailable: false }), 'en')).toEqual(
      {
        key: 'notForSale',
        price: null,
        trialDays: null,
      },
    );
  });

  it('falls back to "Paid app" when a paid listing carries no price', () => {
    expect(priceLine(paidPricing({ amount: null, currency: null }), 'en').key).toBe('paid');
  });

  it('chooses the notes of the app page block', () => {
    const view = (over: object) => pricingView(paidPricing(over), 'en');
    expect(view({}).prepaidNote).toBe(true);
    expect(view({ access: 'entitled' }).prepaidNote).toBe(true);
    expect(view({ access: 'not_for_sale' }).prepaidNote).toBe(false);
    expect(pricingView(pricing(), 'en')).toMatchObject({ prepaidNote: false, includedNote: null });
    expect(view({ access: 'included', includedBy: 'plan_feature' }).includedNote).toBe(
      'planFeature',
    );
    expect(view({ access: 'included', includedBy: 'min_plan' }).includedNote).toBe('minPlan');
    expect(view({ access: 'included', includedBy: null }).includedNote).toBe('plan');
    expect(view({}).includedNote).toBeNull();
  });
});

describe('what to offer for getting the app', () => {
  it('goes straight to the install flow for a free, an included and an entitled app', () => {
    for (const access of ['free', 'included', 'entitled'] as const) {
      expect(acquireFor(paidPricing({ access }), 'en')).toEqual({ kind: 'install' });
    }
  });

  it('offers Subscribe with the price, and the trial only while it is available', () => {
    expect(acquireFor(paidPricing(), 'en')).toEqual({
      kind: 'subscribe',
      price: '$9',
      trialDays: 14,
    });
    expect(acquireFor(paidPricing({ trialAvailable: false }), 'en')).toMatchObject({
      kind: 'subscribe',
      trialDays: null,
    });
  });

  it('offers nothing but a note for an app that is not for sale', () => {
    expect(acquireFor(paidPricing({ access: 'not_for_sale' }), 'en')).toEqual({
      kind: 'notForSale',
    });
  });

  it('sends the trial flag as the contract names it', () => {
    expect(subscribeBody(true)).toEqual({ startTrial: true });
    expect(subscribeBody(false)).toEqual({ startTrial: false });
  });
});

describe('where Subscribe may send the browser', () => {
  it('follows the add-on checkout page only', () => {
    expect(safeCheckoutPath(PACK_PATH)).toBe(PACK_PATH);
    expect(safeCheckoutPath(`${PACK_PATH}?period=monthly`)).toBe(`${PACK_PATH}?period=monthly`);
    for (const bad of [
      'https://evil.test/billing/checkout/mkt_x',
      '//evil.test',
      '/account/plans',
      '/billing/checkout/',
      '/billing/checkout/../x',
      '/billing/checkout/a b',
      'javascript:alert(1)',
      '',
      null,
      undefined,
    ]) {
      expect(safeCheckoutPath(bad as string | null | undefined), String(bad)).toBeNull();
    }
  });

  it('rebuilds the address from the pack slug when the sent one is not usable', () => {
    expect(safeCheckoutPath('//evil.test', 'mkt_0123456789abcdef0123')).toBe(PACK_PATH);
    expect(safeCheckoutPath(null, 'not-a-pack')).toBeNull();
  });

  it('turns the answer of Subscribe into one next step', () => {
    expect(
      subscribeNext({
        outcome: 'checkout',
        checkout: { packSlug: 'mkt_0123456789abcdef0123', path: PACK_PATH },
      }),
    ).toEqual({ kind: 'checkout', href: PACK_PATH });
    expect(subscribeNext({ outcome: 'checkout', checkout: null })).toEqual({ kind: 'noCheckout' });
    expect(
      subscribeNext({
        outcome: 'checkout',
        checkout: { packSlug: 'x', path: 'https://evil.test' },
      }),
    ).toEqual({ kind: 'noCheckout' });
    for (const outcome of ['trial_started', 'included', 'already_entitled', 'free'] as const) {
      expect(subscribeNext({ outcome, checkout: null })).toEqual({ kind: 'refresh', outcome });
    }
  });
});

describe('a subscription as it is shown', () => {
  it('an active paid subscription: paid until, the last payment, and Cancel only', () => {
    const v = subscriptionView(subscription(), 'en');
    expect(v).toMatchObject({
      status: 'active',
      tone: 'success',
      date: { kind: 'paidUntil', iso: '2026-10-31T00:00:00.000Z' },
      lastPayment: '$9',
      nextPayment: null,
      comp: false,
      actions: { cancel: true, resume: false, renew: null },
    });
  });

  it('a free trial: when it ends, nothing paid yet, and Subscribe once it can be paid for', () => {
    const trial = subscription({
      status: 'trialing',
      source: 'trial',
      amount: null,
      currency: null,
      trialEndsAt: '2026-10-14T00:00:00.000Z',
      currentPeriodEnd: '2026-10-14T00:00:00.000Z',
    });
    const v = subscriptionView(trial, 'en');
    expect(v).toMatchObject({
      tone: 'neutral',
      date: { kind: 'trialEnds', iso: '2026-10-14T00:00:00.000Z' },
      lastPayment: null,
    });
    expect(v.actions.renew).toBeNull();
    const near = subscriptionView(
      { ...trial, actions: { canCancel: true, canResume: false, canRenew: true } },
      'en',
    );
    expect(near.actions.renew).toBe('subscribe');
  });

  it('a comp: no end date to show, and nothing here can end it', () => {
    const comp = subscription({
      status: 'comped',
      source: 'comp',
      amount: null,
      currency: null,
      currentPeriodEnd: null,
      actions: { canCancel: false, canResume: false, canRenew: false },
    });
    expect(subscriptionView(comp, 'en')).toMatchObject({
      comp: true,
      date: { kind: 'compOpen', iso: null },
      actions: { cancel: false, resume: false, renew: null },
    });
    expect(
      subscriptionView({ ...comp, currentPeriodEnd: '2027-01-01T00:00:00.000Z' }, 'en').date,
    ).toEqual({ kind: 'compUntil', iso: '2027-01-01T00:00:00.000Z' });
  });

  it('a subscription that is not renewing: active until the date, with Resume and, near the end, Renew', () => {
    const canceling = subscription({
      status: 'canceling',
      canceledAt: '2026-10-10T00:00:00.000Z',
      actions: { canCancel: false, canResume: true, canRenew: false },
    });
    expect(subscriptionView(canceling, 'en')).toMatchObject({
      tone: 'warning',
      date: { kind: 'cancelingUntil', iso: '2026-10-31T00:00:00.000Z' },
      actions: { cancel: false, resume: true, renew: null },
    });
    expect(
      subscriptionView(
        { ...canceling, actions: { canCancel: false, canResume: true, canRenew: true } },
        'en',
      ).actions.renew,
    ).toBe('renew');
  });

  it('an ended subscription: when, and Resubscribe (Subscribe after a trial) only while the app is on sale', () => {
    const ended = subscription({
      status: 'ended',
      lapsedAt: '2026-11-01T00:00:00.000Z',
      actions: { canCancel: false, canResume: false, canRenew: true },
    });
    expect(subscriptionView(ended, 'en')).toMatchObject({
      tone: 'danger',
      date: { kind: 'endedOn', iso: '2026-11-01T00:00:00.000Z' },
      actions: { cancel: false, resume: false, renew: 'resubscribe' },
      cannotRenew: false,
    });
    expect(subscriptionView({ ...ended, source: 'trial' }, 'en').actions.renew).toBe('subscribe');
    const notSold = subscriptionView(
      { ...ended, actions: { canCancel: false, canResume: false, canRenew: false } },
      'en',
    );
    expect(notSold.actions.renew).toBeNull();
    expect(notSold.cannotRenew).toBe(true);
    expect(
      subscriptionView({ ...ended, lapsedAt: null, currentPeriodEnd: null }, 'en').date.kind,
    ).toBe('endedNoDate');
  });

  it('says what the next payment will be only when the listing price moved', () => {
    const view = (over: object) => subscriptionView(subscription(over), 'en').nextPayment;
    expect(view({ nextAmount: '12.00', nextCurrency: 'USD' })).toBe('$12');
    expect(view({ nextAmount: '9', nextCurrency: 'USD' })).toBeNull();
    expect(view({ nextAmount: '9.00', nextCurrency: 'USD' })).toBeNull();
    expect(view({ nextAmount: '9.00', nextCurrency: 'EUR' })).toContain('9');
    expect(view({ nextAmount: null, nextCurrency: null })).toBeNull();
    expect(view({ nextAmount: '12.00', nextCurrency: null })).toBeNull();
    // A trial or a comp paid nothing, so there is nothing to compare with: the price is the next payment.
    expect(view({ amount: null, currency: null, nextAmount: '9.00', nextCurrency: 'USD' })).toBe(
      '$9',
    );
  });
});

describe('subscription chips and the pause', () => {
  it('adds one chip for the subscription after the installation chips, and none for a free app', () => {
    expect(installationChips(installation()).map((c) => c.key)).toEqual(['installed', 'healthy']);
    const keys = (over: object) => installationChips(installation(over)).map((c) => c.key);
    expect(keys({ subscription: subscription() })).toEqual(['installed', 'healthy', 'subscribed']);
    expect(keys({ subscription: subscription({ status: 'trialing', source: 'trial' }) })).toEqual([
      'installed',
      'healthy',
      'trialing',
    ]);
    expect(keys({ subscription: subscription({ status: 'comped', source: 'comp' }) })).toEqual([
      'installed',
      'healthy',
      'comped',
    ]);
    expect(keys({ subscription: subscription({ status: 'canceling' }) })).toEqual([
      'installed',
      'healthy',
      'canceling',
    ]);
  });

  it('marks a subscription-paused installation as ended next to Paused, and never decorates a killed one', () => {
    const ended = installation({
      status: 'disabled',
      pauseReason: 'subscription_ended',
      subscription: subscription({ status: 'ended' }),
    });
    expect(installationChips(ended).map((c) => c.key)).toEqual(['paused', 'subscriptionEnded']);
    expect(subscriptionChip({ pauseReason: 'subscription_ended', subscription: null })?.key).toBe(
      'subscriptionEnded',
    );
    const killed = installation({
      status: 'killed',
      pauseReason: 'subscription_ended',
      subscription: subscription(),
    });
    expect(installationChips(killed).map((c) => c.key)).toEqual(['killed']);
  });

  it('says what an installation paused by its subscription offers, by what the workspace can do now', () => {
    const paused = (access: 'subscription_required' | 'not_for_sale' | 'entitled' | 'included') =>
      subscriptionPause(
        installation({
          status: 'disabled',
          pauseReason: 'subscription_ended',
          pricing: paidPricing({ access }),
        }),
      );
    expect(paused('subscription_required')).toEqual({ kind: 'resubscribe' });
    expect(paused('not_for_sale')).toEqual({ kind: 'notForSale' });
    expect(paused('entitled')).toEqual({ kind: 'resumable' });
    expect(paused('included')).toEqual({ kind: 'resumable' });
    expect(subscriptionPause(installation({ status: 'disabled' }))).toBeNull();
    expect(
      subscriptionPause(
        installation({
          status: 'killed',
          pauseReason: 'subscription_ended',
          pricing: paidPricing(),
        }),
      ),
    ).toBeNull();
  });

  it('keeps Resume away while the app has to be paid for again, and offers Resubscribe to whoever may install', () => {
    const paused = installation({
      status: 'disabled',
      pauseReason: 'subscription_ended',
      pricing: paidPricing({ trialAvailable: false }),
      subscription: subscription({
        status: 'ended',
        actions: { canCancel: false, canResume: false, canRenew: true },
      }),
    });
    expect(resumeBlocked({ kind: 'resubscribe' })).toBe(true);
    expect(resumeBlocked({ kind: 'notForSale' })).toBe(true);
    expect(resumeBlocked({ kind: 'resumable' })).toBe(false);
    expect(resumeBlocked(null)).toBe(false);
    const v = manageView(paused, ALL, OPTS);
    expect(v).toMatchObject({
      paused: true,
      canToggle: false,
      canResubscribe: true,
      subscriptionPause: { kind: 'resubscribe' },
      subscriptionSection: 'panel',
    });
    // Someone who may manage but not install sees the banner but cannot pay.
    expect(manageView(paused, { read: true, install: false, manage: true }, OPTS)).toMatchObject({
      canToggle: false,
      canResubscribe: false,
    });
    // Once the workspace has access again (its plan includes the app) the ordinary Resume works.
    const back = manageView(
      { ...paused, pricing: paidPricing({ access: 'included', includedBy: 'min_plan' }) },
      ALL,
      OPTS,
    );
    expect(back).toMatchObject({ canToggle: true, canResubscribe: false });
    expect(back.subscriptionPause).toEqual({ kind: 'resumable' });
    // A pause the admin made by hand has no subscription story.
    expect(manageView(installation({ status: 'disabled' }), ALL, OPTS)).toMatchObject({
      subscriptionPause: null,
      canToggle: true,
      canResubscribe: false,
    });
  });

  it('chooses the subscription section of the manage page', () => {
    const section = (over: object) => subscriptionSection(installation(over));
    expect(section({ subscription: subscription() })).toBe('panel');
    expect(section({})).toBeNull();
    expect(section({ pricing: paidPricing() })).toBe('subscribe');
    expect(section({ pricing: paidPricing({ access: 'included' }) })).toBe('included');
    expect(section({ pricing: paidPricing({ access: 'not_for_sale' }) })).toBe('notForSale');
    expect(
      manageView(installation({ status: 'killed', subscription: subscription() }), ALL, OPTS),
    ).toMatchObject({ subscriptionSection: null });
  });
});

describe('uninstalling a paid app', () => {
  it('warns only when the subscription runs on its own payments, and carries the date', () => {
    expect(uninstallRenewal(subscription())).toEqual({ paidUntil: '2026-10-31T00:00:00.000Z' });
    expect(uninstallRenewal(subscription({ currentPeriodEnd: null }))).toEqual({ paidUntil: null });
    expect(uninstallRenewal(subscription({ status: 'trialing', source: 'trial' }))).toBeNull();
    expect(uninstallRenewal(subscription({ status: 'comped', source: 'comp' }))).toBeNull();
    expect(uninstallRenewal(subscription({ status: 'canceling' }))).toBeNull();
    expect(uninstallRenewal(subscription({ status: 'ended' }))).toBeNull();
    expect(uninstallRenewal(null)).toBeNull();
  });
});

describe('what the card and the app page offer for a paid app', () => {
  const can = { install: true };

  it('turns the card button into Subscribe for a paid app with no subscription', () => {
    expect(cardCta(card({ pricing: paidPricing() }), can)).toEqual({
      kind: 'subscribe',
      href: '/marketplace/app/webhook/install',
      upgradeHref: null,
      needsPurchase: true,
    });
  });

  it('keeps Install for a free, an included and an entitled app', () => {
    for (const access of ['free', 'included', 'entitled'] as const) {
      expect(cardCta(card({ pricing: paidPricing({ access }) }), can).kind).toBe('install');
    }
  });

  it('offers details only for an app that is not for sale and for someone who may not subscribe', () => {
    const notForSale = card({ pricing: paidPricing({ access: 'not_for_sale' }) });
    expect(cardCta(notForSale, can)).toMatchObject({
      kind: 'view',
      href: '/marketplace/app/webhook',
    });
    expect(cardCta(card({ pricing: paidPricing() }), { install: false }).kind).toBe('view');
  });

  it('lets a lock and an existing installation outrank the price', () => {
    const locked = { reason: 'plan_feature' as const, key: 'k', upgradeUrl: null };
    expect(cardCta(card({ pricing: paidPricing(), locked }), can).kind).toBe('locked');
    const install = {
      installationId: ID(50),
      status: 'active' as const,
      health: 'healthy' as const,
      needsReconsent: false,
    };
    expect(cardCta(card({ pricing: paidPricing(), install }), can).kind).toBe('manage');
  });

  it('puts Subscribe where Install was on the app page, and a note for an app not for sale', () => {
    expect(installGate(card({ pricing: paidPricing() }), can)).toEqual({
      kind: 'subscribe',
      href: '/marketplace/app/webhook/install',
      needsPurchase: true,
    });
    expect(installGate(card({ pricing: paidPricing({ access: 'entitled' }) }), can).kind).toBe(
      'allowed',
    );
    expect(installGate(card({ pricing: paidPricing({ access: 'not_for_sale' }) }), can)).toEqual({
      kind: 'notForSale',
    });
    // Subscribing needs the install permission, like installing does.
    expect(installGate(card({ pricing: paidPricing() }), { install: false }).kind).toBe(
      'noPermission',
    );
    const locked = { reason: 'plan_feature' as const, key: 'k', upgradeUrl: null };
    expect(installGate(card({ pricing: paidPricing(), locked }), can).kind).toBe('locked');
  });
});

describe('error mapping for paid apps', () => {
  const kind = (e: unknown) => mktError(e).kind;

  it('maps every new code to its own kind, and every kind has a message key', () => {
    expect(kind(problem(422, ERROR_CODES.MKT_SUBSCRIPTION_REQUIRED))).toBe('subscriptionRequired');
    expect(kind(problem(409, ERROR_CODES.MKT_NOT_FOR_SALE))).toBe('notForSale');
    expect(kind(problem(422, ERROR_CODES.MKT_TRIAL_UNAVAILABLE))).toBe('trialUnavailable');
    expect(kind(problem(404, ERROR_CODES.MKT_SUBSCRIPTION_NOT_FOUND))).toBe('subscriptionNotFound');
    expect(kind(problem(409, ERROR_CODES.MKT_SUBSCRIPTION_STATE))).toBe('subscriptionState');
    for (const k of [
      'subscriptionRequired',
      'notForSale',
      'trialUnavailable',
      'subscriptionNotFound',
      'subscriptionState',
    ]) {
      expect(MKT_ERROR_KINDS).toContain(k);
    }
  });

  it('carries the checkout address of MKT_SUBSCRIPTION_REQUIRED, and only when it is the checkout page', () => {
    const e = mktError(
      problem(422, ERROR_CODES.MKT_SUBSCRIPTION_REQUIRED, [
        { path: 'reason', message: 'subscription_required' },
        { path: 'checkoutPath', message: PACK_PATH },
      ]),
    );
    expect(e.checkoutPath).toBe(PACK_PATH);
    const hostile = mktError(
      problem(422, ERROR_CODES.MKT_SUBSCRIPTION_REQUIRED, [
        { path: 'checkoutPath', message: 'https://evil.test' },
      ]),
    );
    expect(hostile.checkoutPath).toBeNull();
    expect(mktError(problem(422, ERROR_CODES.MKT_SUBSCRIPTION_REQUIRED)).checkoutPath).toBeNull();
    // Another code never carries a checkout address, even if the details hold one.
    expect(
      mktError(
        problem(409, ERROR_CODES.MKT_NOT_FOR_SALE, [{ path: 'checkoutPath', message: PACK_PATH }]),
      ).checkoutPath,
    ).toBeNull();
    expect(mktError(new Error('x')).checkoutPath).toBeNull();
  });

  it('retries nothing a person has to decide about', () => {
    for (const code of [
      ERROR_CODES.MKT_SUBSCRIPTION_REQUIRED,
      ERROR_CODES.MKT_NOT_FOR_SALE,
      ERROR_CODES.MKT_TRIAL_UNAVAILABLE,
      ERROR_CODES.MKT_SUBSCRIPTION_NOT_FOUND,
      ERROR_CODES.MKT_SUBSCRIPTION_STATE,
    ]) {
      expect(isRetryable(mktError(problem(409, code))), code).toBe(false);
    }
  });
});

describe('add-on availability', () => {
  it('reads the three states from availability, and from access when an older answer has none', () => {
    expect(cardAvailability(pricing())).toBe('open');
    expect(cardAvailability(paidPricing())).toBe('visible');
    expect(cardAvailability(paidPricing({ availability: 'purchased', access: 'entitled' }))).toBe(
      'purchased',
    );
    expect(cardAvailability({ access: 'free' })).toBe('open');
    expect(cardAvailability({ access: 'included' })).toBe('open');
    expect(cardAvailability({ access: 'entitled' })).toBe('purchased');
    expect(cardAvailability({ access: 'subscription_required' })).toBe('visible');
    // never sent by the API; if it came it can never be installed
    expect(cardAvailability(paidPricing({ availability: 'not_visible' }))).toBe('visible');
  });

  it('needs a purchase only while an add-on on offer is not bought and still for sale', () => {
    expect(needsPurchase(paidPricing())).toBe(true);
    expect(needsPurchase(paidPricing({ access: 'not_for_sale' }))).toBe(false);
    expect(needsPurchase(paidPricing({ access: 'entitled', availability: 'purchased' }))).toBe(
      false,
    );
    expect(needsPurchase(pricing())).toBe(false);
  });

  it('chips an add-on with its price, and nothing else', () => {
    expect(priceChip(paidPricing(), 'en')).toEqual({ key: 'addOn', price: '$9' });
    expect(priceChip(paidPricing({ amount: null, currency: null }), 'en')).toEqual({
      key: 'addOn',
      price: null,
    });
    expect(priceChip(pricing(), 'en')).toBeNull();
    expect(
      priceChip(paidPricing({ access: 'entitled', availability: 'purchased' }), 'en'),
    ).toBeNull();
  });

  it('never offers Install for an add-on the workspace has not bought', () => {
    const c = card({ pricing: paidPricing() });
    expect(cardCta(c, { install: true })).toMatchObject({ kind: 'subscribe', needsPurchase: true });
    expect(installGate(c, { install: true })).toMatchObject({
      kind: 'subscribe',
      needsPurchase: true,
    });
    // even if the access said otherwise, a visible add-on is not installable
    const odd = card({
      pricing: paidPricing({ access: 'free' as never, availability: 'visible' }),
    });
    expect(installGate(odd, { install: true }).kind).toBe('subscribe');
    // purchased: install as today
    const bought = card({
      pricing: paidPricing({ access: 'entitled', availability: 'purchased' }),
    });
    expect(cardCta(bought, { install: true }).kind).toBe('install');
    expect(installGate(bought, { install: true }).kind).toBe('allowed');
  });
});
