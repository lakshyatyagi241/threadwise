import {
  MARKET_PACK_SLUG_RE,
  marketCheckoutPath,
  type MarketBillingPeriod,
  type MarketCardPricing,
  type MarketInstallation,
  type MarketSubscribeResult,
  type MarketSubscription,
  type MarketSubscriptionStatus,
  type SubscribeAppRequest,
} from '@crm/contracts';
import type { Chip, ChipTone } from './install-state';

/**
 * What a workspace is told about price and subscription, and what it may do about it. Pure: the components only draw it. A paid app is a
 * monthly term sold as a billing add-on. By default it is PREPAID and renewed by paying again, and then every sentence says "paid until",
 * "renew" and "ended". Only where the operator made the listing `recurring` and the card really renews it (`autoRenew` on the subscription)
 * does a sentence say "renews on": the words follow what the payment provider will actually do.
 */

// --- money -----------------------------------------------------------------------------------------------------------------------

/**
 * "9.00" in USD as "$9", "9.50" as "$9.50", in the person's language. Amounts are decimal strings of at most ten whole digits and two
 * places, which a double holds exactly, so the parse loses nothing. A currency or a locale the runtime does not know is printed plainly.
 */
export function formatMoney(amount: string, currency: string, locale: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${currency}`.trim();
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${amount} ${currency}`.trim();
  }
}

/** What the workspace sees a card as: usable now, offered to buy (its plan lists the add-on), or already bought. */
export type CardAvailability = 'open' | 'visible' | 'purchased';

/**
 * The availability of a card. The API always sends `availability`; an older answer without it is read from `access`. `not_visible` is
 * never sent (the API hides those apps), and if one ever arrived it is treated as an add-on to buy, so it can never be installed.
 */
export function cardAvailability(
  p: Pick<MarketCardPricing, 'access'> & { availability?: MarketCardPricing['availability'] },
): CardAvailability {
  switch (p.availability) {
    case 'open':
    case 'purchased':
      return p.availability;
    case 'visible':
    case 'not_visible':
      return 'visible';
    default:
      return p.access === 'subscription_required' || p.access === 'not_for_sale'
        ? 'visible'
        : p.access === 'entitled'
          ? 'purchased'
          : 'open';
  }
}

/** A paid app the plan lists but the workspace has not bought: price and Subscribe are shown, Install and Open never are. */
export const needsPurchase = (
  p: Pick<MarketCardPricing, 'access'> & { availability?: MarketCardPricing['availability'] },
): boolean => cardAvailability(p) === 'visible' && p.access !== 'not_for_sale';

/** The "Add-on" chip of a not-yet-bought paid app, with its monthly price when it has one; null for every other card. */
export function priceChip(
  p: Pick<MarketCardPricing, 'access' | 'amount' | 'currency'> & {
    availability?: MarketCardPricing['availability'];
  },
  locale: string,
): { key: 'addOn'; price: string | null } | null {
  return needsPurchase(p) ? { key: 'addOn', price: priceOf(p, locale) } : null;
}

const sameMoney = (a: string, b: string): boolean => Number(a) === Number(b);

// --- the price line (card, app page) ---------------------------------------------------------------------------------------------

/** Message keys under `marketplace.card.pricing`. */
export const PRICE_LINE_KEYS = [
  'free',
  'included',
  'monthly',
  'subscribed',
  'notForSale',
  'paid',
] as const;
export type PriceLineKey = (typeof PRICE_LINE_KEYS)[number];

export interface PriceLine {
  key: PriceLineKey;
  /** The yearly price, formatted, when the app can also be bought for a year (only on the `monthly` line). */
  annualPrice: string | null;
  /** The monthly list price, formatted, whenever the app is paid and priced. */
  price: string | null;
  /** Set while the workspace may start the free trial (and only then): the days, for the chip. */
  trialDays: number | null;
}

type PricingFields = Pick<
  MarketCardPricing,
  'model' | 'access' | 'amount' | 'currency' | 'trialAvailable' | 'trialDays'
> &
  Partial<Pick<MarketCardPricing, 'billingMode' | 'annualAmount'>>;

const priceOf = (
  p: Pick<MarketCardPricing, 'amount' | 'currency'>,
  locale: string,
): string | null =>
  p.amount !== null && p.currency !== null ? formatMoney(p.amount, p.currency, locale) : null;

/** The yearly price, formatted, when the app can be bought for a year. */
const annualOf = (
  p: Partial<Pick<MarketCardPricing, 'annualAmount' | 'currency'>>,
  locale: string,
): string | null =>
  p.annualAmount != null && p.currency != null
    ? formatMoney(p.annualAmount, p.currency, locale)
    : null;

export function priceLine(p: PricingFields, locale: string): PriceLine {
  if (p.model === 'free' || p.access === 'free')
    return { key: 'free', price: null, annualPrice: null, trialDays: null };
  const price = priceOf(p, locale);
  switch (p.access) {
    case 'included':
      return { key: 'included', price: null, annualPrice: null, trialDays: null };
    case 'entitled':
      return { key: 'subscribed', price, annualPrice: null, trialDays: null };
    case 'not_for_sale':
      return { key: 'notForSale', price: null, annualPrice: null, trialDays: null };
    case 'subscription_required': {
      const trialDays = p.trialAvailable && p.trialDays > 0 ? p.trialDays : null;
      return price
        ? { key: 'monthly', price, annualPrice: annualOf(p, locale), trialDays }
        : { key: 'paid', price: null, annualPrice: null, trialDays };
    }
  }
}

/** Message keys under `marketplace.pricing.included`. */
export const INCLUDED_NOTE_KEYS = ['planFeature', 'minPlan', 'plan'] as const;
export type IncludedNote = (typeof INCLUDED_NOTE_KEYS)[number];

/** The app page's pricing block: the price line plus which notes apply. */
export interface PricingView {
  line: PriceLine;
  /** Paid and in play, renewed by paying again: the "one prepaid month, pay again to keep it" note applies. */
  prepaidNote: boolean;
  /** Paid and in play, renewed by the card: the "renews automatically every month until you cancel" note applies. */
  autoRenewNote: boolean;
  /** Under `included`: which rule made it free (`plan` when the server did not say). */
  includedNote: IncludedNote | null;
}

export function pricingView(
  p: PricingFields & Pick<MarketCardPricing, 'includedBy'>,
  locale: string,
): PricingView {
  const line = priceLine(p, locale);
  const inPlay = line.key === 'monthly' || line.key === 'paid' || line.key === 'subscribed';
  const automatic = p.billingMode === 'recurring';
  return {
    line,
    prepaidNote: inPlay && !automatic,
    autoRenewNote: inPlay && automatic,
    includedNote:
      line.key !== 'included'
        ? null
        : p.includedBy === 'plan_feature'
          ? 'planFeature'
          : p.includedBy === 'min_plan'
            ? 'minPlan'
            : 'plan',
  };
}

// --- what the person can do about getting the app --------------------------------------------------------------------------------

/**
 * The step before the install flow. Free, included and entitled apps go straight to the install flow (its consent step is unchanged);
 * a paid app with no subscription is Subscribed to first (and offers the free trial when there is one); one the platform stopped
 * selling to newcomers has nothing to offer but a note.
 */
export type Acquire =
  | { kind: 'install' }
  | {
      kind: 'subscribe';
      price: string | null;
      /** The price of a year, formatted, when the app can be bought yearly. */
      annualPrice: string | null;
      trialDays: number | null;
      automatic: boolean;
    }
  | { kind: 'notForSale' };

export function acquireFor(
  p: Pick<MarketCardPricing, 'access' | 'amount' | 'currency' | 'trialAvailable' | 'trialDays'> &
    Partial<Pick<MarketCardPricing, 'billingMode' | 'annualAmount'>>,
  locale: string,
): Acquire {
  switch (p.access) {
    case 'subscription_required':
      return {
        kind: 'subscribe',
        price: priceOf(p, locale),
        annualPrice: annualOf(p, locale),
        trialDays: p.trialAvailable && p.trialDays > 0 ? p.trialDays : null,
        automatic: p.billingMode === 'recurring',
      };
    case 'not_for_sale':
      return { kind: 'notForSale' };
    default:
      return { kind: 'install' };
  }
}

export const subscribeBody = (
  startTrial: boolean,
  period: MarketBillingPeriod = 'monthly',
): SubscribeAppRequest => ({
  startTrial,
  ...(period === 'yearly' && !startTrial ? { period } : {}),
});

/** Only the add-on checkout page is a place Subscribe may send the browser. */
const CHECKOUT_PATH = /^\/billing\/checkout\/[A-Za-z0-9_-]{1,64}(?:\?[^\s#]*)?$/;

/**
 * The checkout address to navigate to: the one the API sent when it is the add-on checkout page, else the one the pack's slug makes,
 * else none. A response can never point the browser anywhere else.
 */
export function safeCheckoutPath(
  path: string | null | undefined,
  packSlug?: string | null,
): string | null {
  const p = path?.trim();
  if (p && CHECKOUT_PATH.test(p)) return p;
  if (packSlug && MARKET_PACK_SLUG_RE.test(packSlug)) return marketCheckoutPath(packSlug);
  return null;
}

export type SubscribeOutcome = Exclude<MarketSubscribeResult['outcome'], 'checkout'>;

/** What the screen does with the answer of Subscribe: go and pay, or refresh because the access changed without payment. */
export type SubscribeNext =
  | { kind: 'checkout'; href: string }
  | { kind: 'refresh'; outcome: SubscribeOutcome }
  | { kind: 'noCheckout' };

export function subscribeNext(
  result: Pick<MarketSubscribeResult, 'outcome' | 'checkout'>,
): SubscribeNext {
  if (result.outcome === 'checkout') {
    const href = safeCheckoutPath(result.checkout?.path, result.checkout?.packSlug);
    return href ? { kind: 'checkout', href } : { kind: 'noCheckout' };
  }
  return { kind: 'refresh', outcome: result.outcome };
}

// --- a subscription as it is shown ------------------------------------------------------------------------------------------------

/** Which sentence carries the date: message keys under `marketplace.subscription.date`. */
export type SubscriptionDateKind =
  | 'paidUntil'
  | 'renewsOn'
  | 'graceUntil'
  | 'trialEnds'
  | 'compUntil'
  | 'compOpen'
  | 'cancelingUntil'
  | 'endedOn'
  | 'endedNoDate'
  | 'none';
export const SUBSCRIPTION_DATE_KINDS: readonly SubscriptionDateKind[] = [
  'paidUntil',
  'renewsOn',
  'graceUntil',
  'trialEnds',
  'compUntil',
  'compOpen',
  'cancelingUntil',
  'endedOn',
  'endedNoDate',
];

/** The pay button's wording: Renew while it runs, Resubscribe once it ended, Subscribe for a trial. Keys under `subscription.actions`. */
export const RENEW_KINDS = ['renew', 'resubscribe', 'subscribe', 'payNow'] as const;
export type RenewKind = (typeof RENEW_KINDS)[number];

export interface SubscriptionView {
  status: MarketSubscriptionStatus;
  tone: ChipTone;
  date: { kind: SubscriptionDateKind; iso: string | null };
  /** What the last payment was, for its period, formatted; null for a trial or a comp. */
  lastPayment: string | null;
  /** The period that payment bought: the sentence says "per month" or "per year". */
  period: MarketBillingPeriod;
  /** The listing's price now when it differs from the last payment: what the next payment will be (formatted). */
  nextPayment: string | null;
  actions: { cancel: boolean; resume: boolean; renew: RenewKind | null };
  /** The price is locked (grandfathered): the next payment is `lastPayment` whatever the app costs now, until the subscription ends. */
  priceLocked: boolean;
  /** The card renews it on its own: Cancel stops that, and the confirmation says the card will not be charged again. */
  autoRenew: boolean;
  /** The last card renewal failed and the app still works until `date` (the grace days): the page says to fix the payment. */
  paymentFailed: boolean;
  /** The platform team gave this access: nothing here can end it, and the person is told so. */
  comp: boolean;
  /** It ended and cannot be bought again: the platform stopped selling the app. A comp is the operator's, so it never says this. */
  cannotRenew: boolean;
}

const STATUS_TONE: Record<MarketSubscriptionStatus, ChipTone> = {
  active: 'success',
  trialing: 'neutral',
  comped: 'neutral',
  canceling: 'warning',
  past_due: 'warning',
  ended: 'danger',
};

function dateOf(sub: MarketSubscription): SubscriptionView['date'] {
  switch (sub.status) {
    case 'ended': {
      const iso = sub.lapsedAt ?? sub.currentPeriodEnd;
      return { kind: iso ? 'endedOn' : 'endedNoDate', iso };
    }
    case 'canceling':
      return sub.currentPeriodEnd
        ? { kind: 'cancelingUntil', iso: sub.currentPeriodEnd }
        : { kind: 'none', iso: null };
    case 'trialing': {
      const iso = sub.trialEndsAt ?? sub.currentPeriodEnd;
      return iso ? { kind: 'trialEnds', iso } : { kind: 'none', iso: null };
    }
    case 'comped':
      return sub.currentPeriodEnd
        ? { kind: 'compUntil', iso: sub.currentPeriodEnd }
        : { kind: 'compOpen', iso: null };
    case 'past_due': {
      const iso = sub.graceEndsAt ?? sub.currentPeriodEnd;
      return iso ? { kind: 'graceUntil', iso } : { kind: 'none', iso: null };
    }
    case 'active':
      return sub.currentPeriodEnd
        ? { kind: sub.autoRenew ? 'renewsOn' : 'paidUntil', iso: sub.currentPeriodEnd }
        : { kind: 'none', iso: null };
  }
}

function renewKind(sub: MarketSubscription): RenewKind | null {
  if (!sub.actions.canRenew) return null;
  if (sub.status === 'ended') return sub.source === 'trial' ? 'subscribe' : 'resubscribe';
  if (sub.status === 'past_due') return 'payNow';
  return sub.status === 'trialing' ? 'subscribe' : 'renew';
}

export function subscriptionView(sub: MarketSubscription, locale: string): SubscriptionView {
  const next =
    sub.nextAmount !== null &&
    sub.nextCurrency !== null &&
    (sub.amount === null || sub.currency === null
      ? true
      : !sameMoney(sub.nextAmount, sub.amount) || sub.nextCurrency !== sub.currency)
      ? formatMoney(sub.nextAmount, sub.nextCurrency, locale)
      : null;
  const renew = renewKind(sub);
  return {
    status: sub.status,
    tone: STATUS_TONE[sub.status],
    date: dateOf(sub),
    lastPayment:
      sub.amount !== null && sub.currency !== null
        ? formatMoney(sub.amount, sub.currency, locale)
        : null,
    nextPayment: next,
    period: sub.period,
    actions: { cancel: sub.actions.canCancel, resume: sub.actions.canResume, renew },
    autoRenew: sub.autoRenew,
    priceLocked: sub.priceLocked,
    paymentFailed: sub.paymentFailedAt !== null && sub.status === 'past_due',
    comp: sub.source === 'comp',
    cannotRenew: sub.source !== 'comp' && sub.status === 'ended' && !sub.actions.canRenew,
  };
}

// --- chips on installed rows and the manage header ---------------------------------------------------------------------------------

/** Message keys under `marketplace.chips`. */
export const SUBSCRIPTION_CHIP_KEYS = [
  'subscribed',
  'trialing',
  'comped',
  'canceling',
  'pastDue',
  'subscriptionEnded',
] as const;

export function subscriptionChip(i: {
  pauseReason?: MarketInstallation['pauseReason'];
  subscription?: Pick<MarketSubscription, 'status'> | null;
}): Chip | null {
  const status = i.subscription?.status;
  if (i.pauseReason === 'subscription_ended' || status === 'ended')
    return { key: 'subscriptionEnded', tone: 'danger' };
  switch (status) {
    case 'active':
      return { key: 'subscribed', tone: 'success' };
    case 'trialing':
      return { key: 'trialing', tone: 'neutral' };
    case 'comped':
      return { key: 'comped', tone: 'neutral' };
    case 'canceling':
      return { key: 'canceling', tone: 'warning' };
    case 'past_due':
      return { key: 'pastDue', tone: 'warning' };
    default:
      return null;
  }
}

// --- an installation paused because its subscription ended -----------------------------------------------------------------------

/**
 * What the manage page says and offers when the subscription ended and paused the app (its data and settings are kept):
 * `resubscribe`: pay again at checkout, which switches it back on; `notForSale`: it can no longer be bought, so it stays paused;
 * `resumable`: the workspace has access again (its plan now includes the app), so the ordinary Resume works.
 */
export type SubscriptionPause =
  { kind: 'resubscribe' } | { kind: 'notForSale' } | { kind: 'resumable' };
/** Message keys under `marketplace.manage.subscriptionEnded.message`. */
export const PAUSE_KINDS = ['resubscribe', 'notForSale', 'resumable'] as const;

export function subscriptionPause(
  i: Pick<MarketInstallation, 'pauseReason' | 'status'> & {
    pricing: Pick<MarketCardPricing, 'access'>;
  },
): SubscriptionPause | null {
  if (i.pauseReason !== 'subscription_ended' || i.status === 'killed') return null;
  switch (i.pricing.access) {
    case 'subscription_required':
      return { kind: 'resubscribe' };
    case 'not_for_sale':
      return { kind: 'notForSale' };
    default:
      return { kind: 'resumable' };
  }
}

/** Resume is refused by the server until the workspace pays again, so the page does not offer it. */
export const resumeBlocked = (pause: SubscriptionPause | null): boolean =>
  pause?.kind === 'resubscribe' || pause?.kind === 'notForSale';

/**
 * The subscription section of the manage page: the panel when a subscription exists; the Subscribe offer when the app is paid and the
 * workspace has none (the operator priced it after it was installed); a note when its plan includes it or it is no longer sold.
 */
export type SubscriptionSection = 'panel' | 'subscribe' | 'included' | 'notForSale' | null;

export function subscriptionSection(
  i: Pick<MarketInstallation, 'subscription'> & { pricing: Pick<MarketCardPricing, 'access'> },
): SubscriptionSection {
  if (i.subscription) return 'panel';
  switch (i.pricing.access) {
    case 'subscription_required':
      return 'subscribe';
    case 'included':
      return 'included';
    case 'not_for_sale':
      return 'notForSale';
    default:
      return null;
  }
}

// --- uninstalling a paid app -----------------------------------------------------------------------------------------------------

/**
 * Uninstalling a paid app stops its renewal; the period already paid for stays the workspace's (reinstalling inside it costs nothing).
 * Only a subscription that is running on its own payments needs the warning: a trial, a comp and one already not renewing do not.
 */
export interface UninstallRenewal {
  paidUntil: string | null;
}

export function uninstallRenewal(
  sub: Pick<MarketSubscription, 'status' | 'source' | 'currentPeriodEnd'> | null | undefined,
): UninstallRenewal | null {
  if (!sub || sub.source === 'comp' || (sub.status !== 'active' && sub.status !== 'past_due'))
    return null;
  return { paidUntil: sub.currentPeriodEnd };
}
