import { PLAN_FEATURE_KEYS, type PublicPlanCard } from '@crm/contracts';

export interface CardRow {
  label: string;
  included: boolean;
}

/** One card of the public pricing strip, in the shape WaDesk's `Package::toPricingCard` hands its component. */
export interface PricingCard {
  slug: string;
  kind: PublicPlanCard['kind'];
  num: string;
  name: string;
  badge: string;
  tagline: string;
  price: string;
  /** The price a yearly subscriber pays per month; the same as `price` when the plan has no yearly price. */
  priceYearly: string;
  period: string;
  overage: string;
  ctaLabel: string;
  ctaHref: string;
  highlighted: boolean;
  hasYearly: boolean;
  volume: CardRow[];
  features: CardRow[];
  support: CardRow[];
}

/** The words the cards use; the caller resolves them from its translations so this stays pure. */
export interface CardWords {
  planNum: (n: string) => string;
  limit: (key: string) => string;
  feature: (key: string) => string;
  unlimited: string;
  free: string;
  custom: string;
  popular: string;
  forever: string;
  contactSales: string;
  oneTime: string;
  talkToSales: string;
  startFree: string;
  getStarted: string;
  docsCommunity: string;
  prioritySupport: string;
  perUnit: (unit: string, count: number) => string;
  money: (amount: string, currency: string) => string;
  number: (n: number) => string;
}

/** WaDesk's volume lines: devices, messages, seats, contacts, broadcasts, at most four, "0" meaning unlimited. */
const VOLUME_KEYS = ['devices', 'monthly_messages', 'users', 'contacts', 'broadcasts'] as const;
const lcfirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** Whether a flag is a visible plan feature: the capability rows of WaDesk's card, enabled ones first, a few greyed. */
const FEATURE_ON_MAX = 7;
const FEATURE_OFF_MAX = 3;

export function toPricingCard(p: PublicPlanCard, index: number, w: CardWords): PricingCard {
  const limits = p.limits as unknown as Record<string, number>;
  const flags = p.features as unknown as Record<string, boolean>;
  const base = p.price.offerAmount ?? p.price.amount;
  const yearlyMonthly =
    p.kind === 'paid' && !p.lifetime && p.yearlyAmount !== null
      ? (Math.round((Number(p.yearlyAmount) * 100) / 12) / 100).toFixed(2)
      : null;

  const price =
    p.kind === 'custom_quote'
      ? w.custom
      : p.kind === 'free'
        ? w.free
        : w.money(base, p.price.currency);
  const priceYearly = yearlyMonthly !== null ? w.money(yearlyMonthly, p.price.currency) : price;
  const period =
    p.kind === 'custom_quote'
      ? w.contactSales
      : p.kind === 'free'
        ? p.lifetime
          ? w.forever
          : w.perUnit('months', 1)
        : p.lifetime
          ? w.oneTime
          : p.price.period
            ? w.perUnit(p.price.period.unit, p.price.period.count)
            : '';

  const volume: CardRow[] = [];
  for (const key of VOLUME_KEYS) {
    const v = limits[key];
    if (v === undefined) continue;
    volume.push({
      label: `${v === 0 ? w.unlimited : w.number(v)} ${lcfirst(w.limit(key))}`,
      included: true,
    });
    if (volume.length >= 4) break;
  }

  const on: CardRow[] = [];
  const off: CardRow[] = [];
  for (const key of PLAN_FEATURE_KEYS) {
    if (flags[key]) {
      if (on.length < FEATURE_ON_MAX) on.push({ label: w.feature(key), included: true });
    } else if (off.length < FEATURE_OFF_MAX) off.push({ label: w.feature(key), included: false });
  }

  const support: CardRow[] = [{ label: w.docsCommunity, included: true }];
  if (p.highlighted || flags.inbox_sla) support.push({ label: w.prioritySupport, included: true });

  const fallbackCta =
    p.kind === 'custom_quote' ? w.talkToSales : p.kind === 'free' ? w.startFree : w.getStarted;
  const href = p.ctaUrl;

  return {
    slug: p.slug,
    kind: p.kind,
    num: w.planNum(String(index + 1).padStart(2, '0')),
    name: p.name,
    badge: p.kind === 'free' ? w.free.toLowerCase() : p.highlighted ? w.popular : '',
    tagline: p.subtitle ?? '',
    price,
    priceYearly,
    period,
    overage: '',
    ctaLabel: `${(p.kind === 'free' ? '' : p.ctaLabel) || fallbackCta} →`,
    ctaHref: href,
    highlighted: p.highlighted,
    hasYearly: yearlyMonthly !== null,
    volume,
    features: [...on, ...off],
    support,
  };
}

/** The checkout link of a card for the chosen billing period (paid plans only; register and contact links stay put). */
export function withPeriod(href: string, kind: PublicPlanCard['kind'], yearly: boolean): string {
  if (!yearly || kind !== 'paid' || href.startsWith('#')) return href;
  return `${href}${href.includes('?') ? '&' : '?'}period=yearly`;
}
