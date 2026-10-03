'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { PublicPlanCard, PublicPricingResponse } from '@crm/contracts';
import { formatMoney } from '@/features/plans-subscriptions-trials/lib/format';

const NS = 'plans-subscriptions-trials';
const VOLUME_KEYS = ['devices', 'monthly_messages', 'users', 'contacts', 'broadcasts'] as const;

export interface Tier {
  name: string;
  badge: string;
  tagline: string;
  price: string;
  period: string;
  ctaLabel: string;
}

/**
 * The plan cards of the public site (WD-CMS-003). The cards are the PLAN catalogue's own (price, limits, features, call to
 * action); the Monthly/Yearly switch appears only when the platform allows it and some plan has a yearly price. With no active
 * plan the three editable fallback tiers are shown instead. The switch labels are editable copy.
 */
export function PricingStrip({
  pricing,
  tiers,
  labels,
}: {
  pricing: PublicPricingResponse | null;
  tiers: Tier[];
  labels: { monthly: string; yearly: string; save: string };
}) {
  const [yearly, setYearly] = useState(true);
  const plans = pricing?.plans ?? [];
  const showSwitch = !!pricing?.yearlyToggle && plans.length > 0;
  const isYearly = showSwitch && yearly;

  return (
    <div>
      {showSwitch && (
        <div
          role="radiogroup"
          aria-label={`${labels.monthly} / ${labels.yearly}`}
          style={{ display: 'inline-flex', gap: '0.25rem', marginTop: '1.5rem' }}
          className="cms-chips"
        >
          {[false, true].map((y) => (
            <button
              key={String(y)}
              type="button"
              role="radio"
              aria-checked={isYearly === y}
              className="cms-btn"
              data-variant={isYearly === y ? undefined : 'ghost'}
              onClick={() => setYearly(y)}
            >
              {y ? labels.yearly : labels.monthly}
              {y && pricing && pricing.yearlyDiscountPct > 0 && (
                <span style={{ marginInlineStart: '0.5rem', opacity: 0.85 }}>
                  {labels.save.replace('{pct}', String(pricing.yearlyDiscountPct))}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="cms-grid" data-testid="site-plans">
        {plans.length > 0
          ? plans.map((p) => <PlanCard key={p.slug} plan={p} yearly={isYearly} />)
          : tiers.map((tier, i) => (
              <div key={i} className="cms-card cms-plan" data-highlight={i === 1}>
                {tier.badge && <span className="cms-badge">{tier.badge}</span>}
                <h3 style={{ marginTop: '0.5rem' }}>{tier.name}</h3>
                <p className="cms-small">{tier.tagline}</p>
                <p className="cms-price">{tier.price}</p>
                {tier.period && <p className="cms-small">{tier.period}</p>}
                <div className="cms-btns">
                  <Link href={i === 0 ? '/register' : '/contact'} className="cms-btn">
                    {tier.ctaLabel}
                  </Link>
                </div>
              </div>
            ))}
      </div>
    </div>
  );
}

function PlanCard({ plan, yearly }: { plan: PublicPlanCard; yearly: boolean }) {
  const t = useTranslations(`${NS}.public`);
  const tp = useTranslations(`${NS}.plans`);
  const tl = useTranslations(`${NS}.limits`);
  const tf = useTranslations(`${NS}.features`);
  const tc = useTranslations(`${NS}.common`);
  const locale = useLocale();
  const showYearly = yearly && plan.yearlyAmount !== null;
  const base = plan.price.offerAmount ?? plan.price.amount;
  const perMonth = showYearly
    ? (Math.round((Number(plan.yearlyAmount) * 100) / 12) / 100).toFixed(2)
    : base;
  const href =
    showYearly && plan.kind === 'paid'
      ? `${plan.ctaUrl}${plan.ctaUrl.includes('?') ? '&' : '?'}period=yearly`
      : plan.ctaUrl;
  const flags = Object.entries(plan.features)
    .filter(([, on]) => on)
    .map(([k]) => k);
  return (
    <div
      className="cms-card cms-plan"
      data-highlight={plan.highlighted}
      data-testid={`site-plan-${plan.slug}`}
    >
      {plan.highlighted && <span className="cms-badge">{tp('mostPopular')}</span>}
      <h3 style={{ marginTop: '0.5rem' }}>{plan.name}</h3>
      {plan.subtitle && <p className="cms-small">{plan.subtitle}</p>}
      <p className="cms-price">
        {plan.kind === 'free'
          ? tp('free')
          : plan.kind === 'custom_quote'
            ? tp('customQuote')
            : formatMoney(perMonth, plan.price.currency, locale)}
      </p>
      {plan.kind === 'paid' && (
        <p className="cms-small">
          {plan.lifetime
            ? tp('oneTime')
            : showYearly
              ? tp('perUnit.months', { count: 1 })
              : plan.price.period
                ? tp(`perUnit.${plan.price.period.unit}`, { count: plan.price.period.count })
                : null}
        </p>
      )}
      {showYearly && (
        <p className="cms-small">
          {t('billedYearly', {
            amount: formatMoney(plan.yearlyAmount!, plan.price.currency, locale),
          })}
        </p>
      )}
      <div className="cms-btns" style={{ marginTop: '1rem' }}>
        <Link href={href} className="cms-btn">
          {plan.kind === 'custom_quote'
            ? t('talkToSales')
            : plan.kind === 'free'
              ? t('startFree')
              : plan.ctaLabel}
        </Link>
      </div>
      <ul className="cms-list">
        {VOLUME_KEYS.map((k) => {
          const v = (plan.limits as Record<string, number>)[k] ?? 0;
          return (
            <li key={k}>
              {v > 0
                ? `${new Intl.NumberFormat(locale).format(v)} ${tl(k)}`
                : `${tc('unlimited')} ${tl(k)}`}
            </li>
          );
        })}
        {flags.slice(0, 7).map((k) => (
          <li key={k}>{tf(k)}</li>
        ))}
      </ul>
    </div>
  );
}
