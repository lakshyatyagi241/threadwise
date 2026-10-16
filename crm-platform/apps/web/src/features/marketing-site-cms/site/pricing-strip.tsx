'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { PublicPricingResponse } from '@crm/contracts';
import { formatMoney } from '@/features/plans-subscriptions-trials/lib/format';
import { toPricingCard, withPeriod, type CardRow, type PricingCard } from './pricing-cards';

const NS = 'plans-subscriptions-trials';

/** A card made of the editable fallback copy, shown when the catalogue has no active plan (Reference's prototype tiers). */
export interface FallbackTier {
  num: string;
  name: string;
  badge: string;
  tagline: string;
  price: string;
  period: string;
  overage: string;
  ctaLabel: string;
  volume: string[];
  features: string[];
  support: string[];
}

const rows = (xs: string[]): CardRow[] =>
  xs.filter(Boolean).map((label) => ({ label, included: true }));

function Card({ card, yearly, href }: { card: PricingCard; yearly: boolean; href: string }) {
  const hl = card.highlighted;
  const heading = useTranslations('marketing-site-cms.site.priceCard');
  const sections: Array<[string, CardRow[]]> = [
    [heading('volume'), card.volume],
    [heading('features'), card.features],
    [heading('support'), card.support],
  ];
  return (
    <div
      data-testid={`site-plan-${card.slug}`}
      className={`col-span-12 flex flex-col rounded-3xl p-8 lg:col-span-4 ${
        hl
          ? 'relative overflow-hidden bg-wa-deep text-paper-0 shadow-[0_40px_80px_-40px_rgba(7,94,84,0.6)] lg:-mt-4 lg:mb-4'
          : 'hairline bg-white'
      }`}
    >
      {hl && (
        <>
          <div className="dot-pattern absolute inset-0 opacity-15" />
          <div className="blur-bub absolute -right-32 -top-32 h-[300px] w-[300px] rounded-full bg-wa-green/20" />
        </>
      )}
      <div className="relative flex flex-1 flex-col">
        <div className={`${hl ? 'border-b border-paper-0/15' : 'hairline-b'} pb-5`}>
          <div className="mb-3 flex items-center justify-between">
            <div
              className={`mono text-[10px] uppercase tracking-[0.22em] ${hl ? 'text-paper-0/60' : 'text-ink-500'}`}
            >
              — {card.num}
            </div>
            {card.badge &&
              (hl ? (
                <span className="pill bg-wa-green text-[10px] text-ink-900">
                  <span className="h-1.5 w-1.5 rounded-full bg-wa-deep" />
                  {card.badge}
                </span>
              ) : (
                <span className="badge-num">{card.badge}</span>
              ))}
          </div>
          <h3 className={`serif mt-3 leading-none ${hl ? 'text-[44px]' : 'text-[40px]'}`}>
            {card.name}
          </h3>
          {card.tagline && (
            <p
              className={`mt-3 text-[12.5px] leading-relaxed ${hl ? 'text-paper-0/75' : 'text-ink-600'}`}
            >
              {card.tagline}
            </p>
          )}
        </div>
        <div className={`${hl ? 'border-b border-paper-0/15' : 'hairline-b'} py-6`}>
          <div className="flex items-baseline gap-2">
            <span
              className={`serif tabular leading-none ${hl ? 'text-[76px]' : 'text-[72px]'}`}
              data-testid="site-plan-price"
            >
              {yearly ? card.priceYearly : card.price}
            </span>
            <span className={`mono text-[11px] ${hl ? 'text-paper-0/60' : 'text-ink-500'}`}>
              {card.period}
            </span>
          </div>
          {card.overage && (
            <div className="mt-3">
              <span
                className={`pill text-[10px] ${hl ? 'border border-paper-0/15 bg-paper-0/10 text-paper-0' : 'bg-paper-100 text-ink-700'}`}
              >
                {card.overage}
              </span>
            </div>
          )}
        </div>
        <div className="flex-1 space-y-5 py-5">
          {sections.map(
            ([title, list]) =>
              list.length > 0 && (
                <div key={title}>
                  <div
                    className={`mono mb-2 text-[9.5px] uppercase tracking-widest ${hl ? 'text-wa-green' : 'text-wa-deep'}`}
                  >
                    {title}
                  </div>
                  <ul
                    className={`space-y-1.5 text-[12.5px] ${hl ? 'text-paper-0/90' : 'text-ink-700'}`}
                  >
                    {list.map((r) =>
                      r.included ? (
                        <li key={r.label} className="flex gap-2">
                          <span className="mt-0.5 text-wa-green">✓</span>
                          {r.label}
                        </li>
                      ) : (
                        <li key={r.label} className="flex gap-2 text-ink-400">
                          <span className="mt-0.5">—</span>
                          {r.label}
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ),
          )}
        </div>
        <Link
          href={href}
          className={`block w-full rounded-full py-3 text-center text-[13px] font-semibold transition ${
            hl
              ? 'glow-green bg-wa-green text-ink-900 hover:bg-[#1ec05a]'
              : 'hairline font-medium hover:bg-paper-50'
          }`}
        >
          {card.ctaLabel}
        </Link>
      </div>
    </div>
  );
}

/**
 * The plan cards of the public site (TW-CMS-003), in Reference's editorial layout: the cards are the PLAN catalogue's own; the
 * Monthly/Yearly switch (Yearly selected first, as in Reference) appears only when the platform allows it and some plan has a
 * yearly price. With no active plan the three editable fallback tiers are shown instead.
 */
export function PricingCards({
  pricing,
  tiers,
  labels,
}: {
  pricing: PublicPricingResponse | null;
  tiers: FallbackTier[];
  labels: { monthly: string; yearly: string; save: string };
}) {
  const locale = useLocale();
  const t = useTranslations(`${NS}.public`);
  const tp = useTranslations(`${NS}.plans`);
  const tl = useTranslations(`${NS}.limits`);
  const tf = useTranslations(`${NS}.features`);
  const tc = useTranslations(`${NS}.common`);
  const tw = useTranslations('marketing-site-cms.site.priceCard');
  const [yearly, setYearly] = useState(true);

  const plans = pricing?.plans ?? [];
  const cards = plans.map((p, i) =>
    toPricingCard(p, i, {
      planNum: (n) => tw('planNum', { n }),
      limit: (k) => tl(k as 'devices'),
      feature: (k) => tf(k as 'automation'),
      unlimited: tc('unlimited'),
      free: tp('free'),
      custom: tp('customQuote'),
      popular: tw('popular'),
      forever: tw('forever'),
      contactSales: tw('contactSales'),
      oneTime: tp('oneTime'),
      talkToSales: t('talkToSales'),
      startFree: t('startFree'),
      getStarted: tw('getStarted'),
      docsCommunity: tw('docsCommunity'),
      prioritySupport: tw('prioritySupport'),
      perUnit: (unit, count) => tp(`perUnit.${unit}` as 'perUnit.months', { count }),
      money: (a, c) => formatMoney(a, c, locale),
      number: (n) => new Intl.NumberFormat(locale).format(n),
    }),
  );
  const showSwitch = !!pricing?.yearlyToggle && cards.some((c) => c.hasYearly);
  const isYearly = showSwitch && yearly;

  return (
    <>
      {showSwitch && (
        <div className="mb-10 flex justify-center">
          <div
            role="radiogroup"
            aria-label={`${labels.monthly} / ${labels.yearly}`}
            className="inline-flex items-center gap-1 rounded-full border border-paper-200 bg-paper-50 p-1"
          >
            {[false, true].map((y) => (
              <button
                key={String(y)}
                type="button"
                role="radio"
                aria-checked={isYearly === y}
                onClick={() => setYearly(y)}
                className={`rounded-full px-4 py-1.5 text-[12px] font-semibold ${
                  isYearly === y ? 'bg-wa-deep text-paper-0' : 'text-ink-600'
                }`}
              >
                {y ? labels.yearly : labels.monthly}
                {y && pricing && pricing.yearlyDiscountPct > 0 && (
                  <span className="mono ms-1 text-[10px] opacity-90">
                    {labels.save.replace('{pct}', String(pricing.yearlyDiscountPct))}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
      <div
        className="reveal grid grid-cols-1 gap-5 lg:grid-cols-12"
        style={{ ['--d' as string]: '120ms' }}
        data-testid="site-plans"
      >
        {cards.length > 0
          ? cards.map((c) => (
              <Card
                key={c.slug}
                card={c}
                yearly={isYearly}
                href={withPeriod(c.ctaHref, c.kind, isYearly)}
              />
            ))
          : tiers.map((tier, i) => (
              <Card
                key={i}
                card={{
                  slug: `fallback-${i + 1}`,
                  kind: 'free',
                  num: tier.num,
                  name: tier.name,
                  badge: tier.badge,
                  tagline: tier.tagline,
                  price: tier.price,
                  priceYearly: tier.price,
                  period: tier.period,
                  overage: tier.overage,
                  ctaLabel: tier.ctaLabel,
                  ctaHref: i === 0 ? '/register' : '/contact',
                  highlighted: i === 1,
                  hasYearly: false,
                  volume: rows(tier.volume),
                  features: rows(tier.features),
                  support: rows(tier.support),
                }}
                yearly={false}
                href={i === 0 ? '/register' : '/contact'}
              />
            ))}
      </div>
    </>
  );
}
