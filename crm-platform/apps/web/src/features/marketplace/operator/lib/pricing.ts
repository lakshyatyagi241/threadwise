import {
  MARKET_MONEY_RE,
  MARKET_TRIAL_DAYS_MAX,
  PLAN_FEATURE_KEYS,
  PLAN_FEATURE_LABELS,
  marketMoneyIsPositive,
  normaliseMarketMoney,
  planFeatureOwnableByApp,
  type MarketAppPricingModel,
  type MarketBillingMode,
  type MarketPricingView,
  type SetMarketPricingRequest,
} from '@crm/contracts';
import type { ServerProblem } from './errors';

/**
 * The pricing panel's rules, kept pure: the form's text drafts, the request they become, the checks that mirror the contract's
 * `pricingIssues` (so a bad value is flagged before it is sent; the server stays the authority and a refusal still maps back to the
 * field), the confirmation a price change owes the operator, and how a price reads in the catalogue.
 *
 * Money stays a string end to end (`"9.00"`); a number is made only to draw a label, which is exact for two decimals at these sizes.
 */

// --- the draft ------------------------------------------------------------------------------------------------------------------------

export interface PricingDraft {
  model: MarketAppPricingModel;
  /** Monthly price as typed. */
  amount: string;
  /** ISO 4217 code as typed (the API upper-cases it and refuses one the platform has not enabled). */
  currency: string;
  /** Yearly price as typed; empty for none. */
  annualAmount: string;
  /** `recurring`: the card renews the app on its own; `one_time`: a prepaid month, renewed by paying again. */
  billingMode: MarketBillingMode;
  /** Keep each subscriber on the price they first paid until their subscription ends. */
  priceLock: boolean;
  /** Whole days as typed; empty counts as none. */
  trialDays: string;
  /** Off: no NEW subscriptions (existing subscribers may keep renewing). */
  purchasable: boolean;
  /** A plan feature key whose holders get the app free; empty for none. */
  includedPlanFeature: string;
  /** A plan slug: that plan and every plan above it get the app free; empty for none. */
  includedMinPlan: string;
  /** Plan feature keys a subscription grants (first-party apps only). */
  grantsPlanFeatures: string[];
  /** The operator may comp the workspaces that already have a granted feature (the "Comp existing users" action). */
  grandfatherExisting: boolean;
}

/** The core plan features an app may own: the ones whose registry default is off (an app cannot sell what every plan already has). */
export function ownableFeatureKeys(): string[] {
  return PLAN_FEATURE_KEYS.filter(planFeatureOwnableByApp).sort((a, b) =>
    PLAN_FEATURE_LABELS[a].localeCompare(PLAN_FEATURE_LABELS[b]),
  );
}

export const MAX_GRANTED_FEATURES = 10;

/** The codes an operator is most likely to price in. Only a suggestion: the field takes any code the platform has enabled. */
export const COMMON_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'INR',
  'AED',
  'SAR',
  'EGP',
  'TRY',
  'BRL',
  'MXN',
  'NGN',
  'ZAR',
  'IDR',
  'PKR',
  'BDT',
  'SGD',
  'AUD',
  'CAD',
  'JPY',
] as const;

export function draftFromPricing(p: MarketPricingView): PricingDraft {
  return {
    model: p.model,
    amount: p.amount ?? '',
    currency: p.currency ?? '',
    annualAmount: p.annualAmount ?? '',
    billingMode: p.billingMode,
    priceLock: p.priceLock,
    trialDays: String(p.trialDays),
    purchasable: p.purchasable,
    includedPlanFeature: p.includedPlanFeature ?? '',
    includedMinPlan: p.includedMinPlan ?? '',
    grantsPlanFeatures: [...p.grantsPlanFeatures],
    grandfatherExisting: p.grandfatherExisting,
  };
}

/** A price typed as `9` or `9.5` becomes `9.00` or `9.50`; text that is not a price is only trimmed (the check flags it). */
const cleanMoney = (text: string): string => {
  const t = text.trim();
  return MARKET_MONEY_RE.test(t) ? normaliseMarketMoney(t) : t;
};

/** `007` is 7; text that is not whole days stays as typed (the check flags it) and an empty field is none. */
const cleanDays = (text: string): string => {
  const t = text.trim();
  if (t === '') return '0';
  return /^\d{1,9}$/.test(t) ? String(Number(t)) : t;
};

const cleanCode = (text: string): string => text.trim();

/** The paid fields with every text in the form the API stores it, so two drafts that mean the same thing compare equal. */
function normalisedPaid(d: PricingDraft) {
  return {
    model: 'paid_monthly' as const,
    amount: cleanMoney(d.amount),
    currency: d.currency.trim().toUpperCase(),
    annualAmount: cleanMoney(d.annualAmount),
    billingMode: d.billingMode,
    priceLock: d.priceLock,
    trialDays: cleanDays(d.trialDays),
    purchasable: d.purchasable,
    includedPlanFeature: cleanCode(d.includedPlanFeature),
    includedMinPlan: cleanCode(d.includedMinPlan),
    // Sorted so the same set picked in another order is not a change.
    grantsPlanFeatures: d.grantsPlanFeatures.map(cleanCode).sort(),
    grandfatherExisting: d.grandfatherExisting,
  };
}

/** Whether the operator changed anything that would be saved (a free app's leftover paid fields do not count: they are never sent). */
export function isPricingDirty(initial: PricingDraft, draft: PricingDraft): boolean {
  const key = (d: PricingDraft) =>
    JSON.stringify(d.model === 'free' ? { model: 'free' } : normalisedPaid(d));
  return key(initial) !== key(draft);
}

// --- the request ----------------------------------------------------------------------------------------------------------------------

const orNull = (text: string): string | null => (text.trim() === '' ? null : text.trim());

/**
 * The PUT body. A free app carries none of the paid fields (the contract refuses a price on a free app); it is always on sale, since
 * the switch only means something for a paid one. The text fields are cleaned the same way `isPricingDirty` compares them.
 */
export function pricingPayload(d: PricingDraft, rowVersion: number): SetMarketPricingRequest {
  if (d.model === 'free')
    return {
      rowVersion,
      model: 'free',
      trialDays: 0,
      purchasable: true,
      grantsPlanFeatures: [],
      grandfatherExisting: false,
    };
  const n = normalisedPaid(d);
  return {
    rowVersion,
    model: 'paid_monthly',
    amount: n.amount,
    currency: n.currency,
    annualAmount: orNull(n.annualAmount),
    billingMode: n.billingMode,
    priceLock: n.priceLock,
    // An invalid text is NaN here, which the contract refuses: the form never sends it (`pricingProblems` blocks the save first).
    trialDays: /^\d+$/.test(n.trialDays) ? Number(n.trialDays) : Number.NaN,
    purchasable: n.purchasable,
    includedPlanFeature: orNull(n.includedPlanFeature),
    includedMinPlan: orNull(n.includedMinPlan),
    grantsPlanFeatures: n.grantsPlanFeatures,
    grandfatherExisting: n.grandfatherExisting,
  };
}

// --- the checks -----------------------------------------------------------------------------------------------------------------------

export const PRICING_FIELDS = [
  'amount',
  'currency',
  'annualAmount',
  'trialDays',
  'includedPlanFeature',
  'includedMinPlan',
  'grantsPlanFeatures',
  'grandfatherExisting',
] as const;
export type PricingField = (typeof PRICING_FIELDS)[number];

/** Message keys under `marketplace.operator.pricing.problems`. */
export type PricingProblemCode =
  | 'priceRequired'
  | 'priceFormat'
  | 'pricePositive'
  | 'currencyRequired'
  | 'currencyFormat'
  | 'yearlyFormat'
  | 'yearlyPositive'
  | 'trialRange'
  | 'featureFormat'
  | 'planFormat'
  | 'grantsInvalid'
  | 'grandfatherNeedsGrants'
  | 'includedGranted';

export const PRICING_PROBLEM_CODES: readonly PricingProblemCode[] = [
  'priceRequired',
  'priceFormat',
  'pricePositive',
  'currencyRequired',
  'currencyFormat',
  'yearlyFormat',
  'yearlyPositive',
  'trialRange',
  'featureFormat',
  'planFormat',
  'grantsInvalid',
  'grandfatherNeedsGrants',
  'includedGranted',
];

export type PricingProblems = Partial<Record<PricingField, PricingProblemCode>>;

/**
 * What is wrong with the draft, by field: the contract's own rules (`pricingIssues` and the field schemas of `setMarketPricingSchema`),
 * one code per field. A free app has nothing to check. Field-level, so the form can say where.
 */
export function pricingProblems(d: PricingDraft): PricingProblems {
  if (d.model === 'free') return {};
  const out: PricingProblems = {};
  const amount = d.amount.trim();
  if (amount === '') out.amount = 'priceRequired';
  else if (!MARKET_MONEY_RE.test(amount)) out.amount = 'priceFormat';
  else if (!marketMoneyIsPositive(amount)) out.amount = 'pricePositive';

  const currency = d.currency.trim().toUpperCase();
  if (currency === '') out.currency = 'currencyRequired';
  else if (!/^[A-Z]{3}$/.test(currency)) out.currency = 'currencyFormat';

  const yearly = d.annualAmount.trim();
  if (yearly !== '') {
    if (!MARKET_MONEY_RE.test(yearly)) out.annualAmount = 'yearlyFormat';
    else if (!marketMoneyIsPositive(yearly)) out.annualAmount = 'yearlyPositive';
  }

  const days = cleanDays(d.trialDays);
  if (!/^\d+$/.test(days) || Number(days) > MARKET_TRIAL_DAYS_MAX) out.trialDays = 'trialRange';

  const feature = d.includedPlanFeature.trim();
  if (feature !== '' && !/^[a-z][a-z0-9_]{0,63}$/.test(feature))
    out.includedPlanFeature = 'featureFormat';
  const plan = d.includedMinPlan.trim();
  if (plan !== '' && !/^[a-z0-9_]{1,32}$/.test(plan)) out.includedMinPlan = 'planFormat';

  const grants = d.grantsPlanFeatures.map(cleanCode);
  if (
    grants.length > MAX_GRANTED_FEATURES ||
    new Set(grants).size !== grants.length ||
    grants.some((g) => !/^[a-z][a-z0-9_]{0,63}$/.test(g))
  )
    out.grantsPlanFeatures = 'grantsInvalid';
  if (d.grandfatherExisting && grants.length === 0)
    out.grandfatherExisting = 'grandfatherNeedsGrants';
  if (feature !== '' && grants.includes(feature)) out.includedPlanFeature ??= 'includedGranted';
  return out;
}

export const hasPricingProblems = (p: PricingProblems): boolean => Object.keys(p).length > 0;

/**
 * The server's refusals, by form field: a 422 names the paths it did not accept (`amount`, `currency`, `includedMinPlan`...). Whatever it
 * names that is not a form field is returned apart so the banner can still list it. The text is the API's, shown beside the field.
 */
export function pricingServerFields(problems: readonly ServerProblem[]): {
  fields: Partial<Record<PricingField, string>>;
  rest: ServerProblem[];
} {
  const fields: Partial<Record<PricingField, string>> = {};
  const rest: ServerProblem[] = [];
  for (const p of problems) {
    // `grantsPlanFeatures.2` (one element of the list) belongs to the list's field.
    const field = PRICING_FIELDS.find((f) => f === p.path || p.path.startsWith(`${f}.`));
    if (p.target === 'field' && field) {
      if (!fields[field]) fields[field] = p.message;
    } else rest.push(p);
  }
  return { fields, rest };
}

// --- the confirmation -----------------------------------------------------------------------------------------------------------------

export type PricingConfirmation =
  /** A paid app whose monthly price or currency changes while workspaces subscribe. */
  | {
      kind: 'priceChange';
      subscribers: number;
      from: { amount: string | null; currency: string | null };
      to: { amount: string | null; currency: string | null };
    }
  /** A paid app put back to free while workspaces subscribe. */
  | { kind: 'toFree'; subscribers: number }
  | null;

/**
 * Whether saving needs a confirmation: only when workspaces subscribe now, and only for the two changes they would feel. A trial length,
 * the sale switch, the yearly price (not billed yet) and the inclusion rules change nothing about what a subscriber is charged.
 */
export function pricingConfirmation(
  before: Pick<MarketPricingView, 'model' | 'amount' | 'currency'>,
  payload: Pick<SetMarketPricingRequest, 'model' | 'amount' | 'currency'>,
  activeSubscriptions: number,
): PricingConfirmation {
  if (activeSubscriptions <= 0 || before.model !== 'paid_monthly') return null;
  if (payload.model === 'free') return { kind: 'toFree', subscribers: activeSubscriptions };
  const amount = payload.amount ?? null;
  const currency = payload.currency ?? null;
  if (before.amount !== amount || before.currency !== currency) {
    return {
      kind: 'priceChange',
      subscribers: activeSubscriptions,
      from: { amount: before.amount, currency: before.currency },
      to: { amount, currency },
    };
  }
  return null;
}

// --- how a price reads ----------------------------------------------------------------------------------------------------------------

/** Wraps a figure in a left-to-right isolate, so a price inside an Arabic sentence keeps its symbol and digits in order. */
export const isolateLtr = (text: string): string => `⁦${text}⁩`;

/** `9.00` + `USD` as the language writes it ("$9.00", "9,00 $"). A code the runtime does not know is shown as typed; no price is a dash. */
export function formatMoney(
  amount: string | null | undefined,
  currency: string | null | undefined,
  locale: string,
): string {
  if (amount == null || amount === '' || !currency) return '-';
  const value = Number(amount);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${Number.isFinite(value) ? value.toFixed(2) : amount}`;
  }
}

export type PriceLabel =
  | { kind: 'free' }
  | {
      kind: 'paid';
      /** The monthly price, formatted ("$9.00"); the screen adds "per month". */
      price: string;
      trialDays: number;
      /** False: no new subscriptions (the "not on sale" marker). */
      onSale: boolean;
      /** The stored yearly price, formatted, when there is one (annual billing is not built yet). */
      yearly: string | null;
    };

export function priceLabel(
  p: Pick<
    MarketPricingView,
    'model' | 'amount' | 'currency' | 'annualAmount' | 'trialDays' | 'purchasable'
  >,
  locale: string,
): PriceLabel {
  if (p.model === 'free') return { kind: 'free' };
  return {
    kind: 'paid',
    price: formatMoney(p.amount, p.currency, locale),
    trialDays: p.trialDays,
    onSale: p.purchasable,
    yearly: p.annualAmount ? formatMoney(p.annualAmount, p.currency, locale) : null,
  };
}

/** The money lines of an MRR figure, one per currency (never converted or added across currencies). */
export function formatMrr(
  entries: ReadonlyArray<{ currency: string; amount: string }>,
  locale: string,
): string[] {
  return entries.map((e) => formatMoney(e.amount, e.currency, locale));
}
