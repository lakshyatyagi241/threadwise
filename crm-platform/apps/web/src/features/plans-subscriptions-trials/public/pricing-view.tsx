'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { PublicFaqListResponse, PublicPlanCard, PublicPricingResponse } from '@crm/contracts';
import { cn } from '@crm/ui';
import { FaqList } from '../components/faq-list';
import { PeriodSwitch } from '../components/period-switch';
import { formatMoney, type Period } from '../lib/format';
import { PLATFORM_DEFAULT_KEY, groupedPlanLimits } from '../lib/limits';

const NS = 'plans-subscriptions-trials';
const VOLUME_KEYS = ['devices', 'monthly_messages', 'users', 'contacts', 'broadcasts'] as const;

/**
 * The public pricing page (TW-PLAN-010): a card per active plan with a Monthly/Yearly switch, volume and feature lists and the plan's call to
 * action, then the FAQ. Add-ons are not listed here (Reference listed them by accident). The cards come from the same catalogue the in-app picker reads.
 */
export function PricingView({
  pricing,
  faqs,
}: {
  pricing: PublicPricingResponse;
  faqs: PublicFaqListResponse;
}) {
  const t = useTranslations(`${NS}.public`);
  const [period, setPeriod] = useState<Period>('yearly');
  const effective: Period = pricing.yearlyToggle ? period : 'monthly';

  return (
    <div className="space-y-10">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('lead')}</p>
      </header>

      {pricing.yearlyToggle && (
        <div className="flex justify-center">
          <PeriodSwitch
            value={period}
            onChange={setPeriod}
            discountPct={pricing.yearlyDiscountPct}
          />
        </div>
      )}

      {pricing.plans.length === 0 ? (
        <p className="text-center text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="public-plans">
          {pricing.plans.map((p) => (
            <Card key={p.slug} plan={p} period={effective} />
          ))}
        </div>
      )}

      <FaqList faqs={faqs.data} />
    </div>
  );
}

function Card({ plan, period }: { plan: PublicPlanCard; period: Period }) {
  const t = useTranslations(`${NS}.public`);
  const tp = useTranslations(`${NS}.plans`);
  const tl = useTranslations(`${NS}.limits`);
  const tf = useTranslations(`${NS}.features`);
  const tc = useTranslations(`${NS}.common`);
  const tg = useTranslations(`${NS}.limitGroups`);
  const locale = useLocale();
  const [allLimits, setAllLimits] = useState(false);
  const limitText = (k: string, v: number) =>
    v > 0
      ? `${new Intl.NumberFormat(locale).format(v)} ${tl(k)}`
      : k === PLATFORM_DEFAULT_KEY
        ? `${tl(k)}: ${tc('platformDefault')}`
        : `${tc('unlimited')} ${tl(k)}`;

  const yearly = period === 'yearly' && plan.yearlyAmount !== null;
  const base = plan.price.offerAmount ?? plan.price.amount;
  // Yearly mode shows the per-month equivalent of the yearly price (the API gives the yearly total).
  const perMonth = yearly
    ? (Math.round((Number(plan.yearlyAmount) * 100) / 12) / 100).toFixed(2)
    : base;
  const href =
    yearly && plan.kind === 'paid'
      ? `${plan.ctaUrl}${plan.ctaUrl.includes('?') ? '&' : '?'}period=yearly`
      : plan.ctaUrl;
  const volume = VOLUME_KEYS.map((k) => ({
    k,
    v: (plan.limits as Record<string, number>)[k] ?? 0,
  }));
  const flags = Object.entries(plan.features)
    .filter(([, on]) => on)
    .map(([k]) => k);

  return (
    <div
      data-testid={`public-plan-${plan.slug}`}
      className={cn(
        'relative flex flex-col gap-4 rounded-xl border p-6',
        plan.highlighted ? 'border-primary bg-primary/5 ring-2 ring-primary/15' : 'border-border',
      )}
    >
      {plan.highlighted && (
        <span className="absolute -top-2.5 start-4 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
          {tp('mostPopular')}
        </span>
      )}
      <div>
        <h2 className="text-lg font-semibold">{plan.name}</h2>
        {plan.subtitle && <p className="text-sm text-muted-foreground">{plan.subtitle}</p>}
      </div>
      <p className="flex flex-wrap items-baseline gap-x-2">
        {plan.kind === 'free' ? (
          <span className="text-3xl font-semibold">{tp('free')}</span>
        ) : plan.kind === 'custom_quote' ? (
          <span className="text-3xl font-semibold">{tp('customQuote')}</span>
        ) : (
          <>
            <span className="text-3xl font-semibold">
              {formatMoney(perMonth, plan.price.currency, locale)}
            </span>
            {plan.lifetime ? (
              <span className="text-sm text-muted-foreground">{tp('oneTime')}</span>
            ) : yearly ? (
              <span className="text-sm text-muted-foreground">
                {tp('perUnit.months', { count: 1 })}
              </span>
            ) : plan.price.period ? (
              <span className="text-sm text-muted-foreground">
                {tp(`perUnit.${plan.price.period.unit}`, { count: plan.price.period.count })}
              </span>
            ) : null}
          </>
        )}
      </p>
      {yearly && (
        <p className="text-xs text-muted-foreground">
          {t('billedYearly', {
            amount: formatMoney(plan.yearlyAmount!, plan.price.currency, locale),
          })}
        </p>
      )}
      <Link
        href={href}
        className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary"
      >
        {plan.kind === 'custom_quote'
          ? t('talkToSales')
          : plan.kind === 'free'
            ? t('startFree')
            : plan.ctaLabel}
      </Link>
      <div className="space-y-1.5 text-sm">
        <p className="font-medium">{t('volume')}</p>
        <ul className="space-y-1">
          {volume.map(({ k, v }) => (
            <li key={k} className="flex gap-2">
              <span aria-hidden="true" className="text-success">
                ✓
              </span>
              {limitText(k, v)}
            </li>
          ))}
        </ul>
        <button
          type="button"
          aria-expanded={allLimits}
          onClick={() => setAllLimits((v) => !v)}
          className="text-sm font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary"
        >
          {allLimits ? t('hideAllLimits') : t('showAllLimits')}
        </button>
        {allLimits &&
          groupedPlanLimits(plan).map((g) => (
            <div key={g.group} data-testid={`public-limits-${plan.slug}-${g.group}`}>
              <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tg(g.group)}
              </p>
              <ul className="space-y-1">
                {g.rows.map((r) => (
                  <li key={r.key} className="flex gap-2">
                    <span aria-hidden="true" className="text-success">
                      ✓
                    </span>
                    {limitText(r.key, r.value)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        {flags.length > 0 && (
          <>
            <p className="pt-2 font-medium">{t('features')}</p>
            <ul className="space-y-1">
              {flags.slice(0, 7).map((k) => (
                <li key={k} className="flex gap-2">
                  <span aria-hidden="true" className="text-success">
                    ✓
                  </span>
                  {tf(k)}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
