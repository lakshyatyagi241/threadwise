import type { PlanAction, PlanBillingUnit, PlanCard } from '@crm/contracts';

/**
 * What a plan card shows, decided away from React so it can be unit tested:
 * the price lines, the billing-period parts, the messages line, and what the
 * card's button does (WD-AUTH-009, WD-PLAN-011).
 */

/** Where "talk to us" and "choose a paid plan" lead. Checkout arrives with the billing domain. */
export const SUPPORT_PATH = '/support';
export const PLANS_PATH = '/account/plans';

/** Display only: the wire keeps money as a decimal string; a double is exact for two decimals at these sizes. */
export function formatMoney(amount: string, currency: string, locale: string): string {
  const value = Number(amount);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    // An unknown currency code (the operator typed one the runtime lacks): show the code, not a crash.
    return `${currency} ${value.toFixed(2)}`;
  }
}

export type PriceView =
  | { kind: 'free' }
  | { kind: 'custom' }
  | {
      kind: 'paid';
      /** What is charged: the offer when there is one, else the list price. */
      main: string;
      /** The list price, struck through, only when an offer applies. */
      strike: string | null;
      period: { unit: PlanBillingUnit; count: number } | null;
      lifetime: boolean;
    };

export function priceView(card: PlanCard, locale: string): PriceView {
  if (card.kind === 'free') return { kind: 'free' };
  if (card.kind === 'custom_quote') return { kind: 'custom' };
  const { amount, offerAmount, currency, period } = card.price;
  const hasOffer = offerAmount !== null;
  return {
    kind: 'paid',
    main: formatMoney(hasOffer ? offerAmount : amount, currency, locale),
    strike: hasOffer ? formatMoney(amount, currency, locale) : null,
    period,
    lifetime: card.lifetime,
  };
}

/** Messages per month; 0 is "unlimited". */
export type MessagesView = { kind: 'unlimited' } | { kind: 'limited'; count: number };
export const messagesView = (card: Pick<PlanCard, 'monthlyMessages'>): MessagesView =>
  card.monthlyMessages > 0
    ? { kind: 'limited', count: card.monthlyMessages }
    : { kind: 'unlimited' };

/** What the card's button does for each action the API reports. */
export type CardCta =
  /** A marker, not a button. */
  | { kind: 'current' }
  /** Finish onboarding on the plan the workspace already has. */
  | { kind: 'continue-free' }
  | { kind: 'link'; href: string; label: 'talkToSales' | 'upgrade' | 'choose' }
  /** A paid plan cheaper than the current one: shown, not clickable. */
  | { kind: 'disabled'; label: 'downgradeUnavailable' };

export function ctaFor(action: PlanAction): CardCta {
  switch (action) {
    case 'current':
      return { kind: 'current' };
    case 'continue_free':
      return { kind: 'continue-free' };
    case 'contact_sales':
      return { kind: 'link', href: SUPPORT_PATH, label: 'talkToSales' };
    case 'upgrade':
      return { kind: 'link', href: PLANS_PATH, label: 'upgrade' };
    // Only the plans page's own view model carries `downgrade`; the onboarding step reads the same link as a plain choice.
    case 'choose':
    case 'downgrade':
      return { kind: 'link', href: PLANS_PATH, label: 'choose' };
    case 'downgrade_unavailable':
      return { kind: 'disabled', label: 'downgradeUnavailable' };
  }
}
