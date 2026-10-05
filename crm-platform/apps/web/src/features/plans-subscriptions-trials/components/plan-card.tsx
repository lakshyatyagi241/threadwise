'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { BillingPlan } from '@crm/contracts';
import { Badge, Button, cn } from '@crm/ui';
import { checkoutPath, priceView, SALES_PATH, type Period } from '../lib/format';
import { PLATFORM_DEFAULT_KEY, cardRows } from '../lib/limits';

const NS = 'plans-subscriptions-trials';
const VISIBLE = 7;

/**
 * One plan as the workspace's admin sees it (WD-PLAN-011): name, price and period, the feature checklist (the headline volumes and
 * capabilities, the rest behind "Show all"), and ONE button whose meaning the server decided (`via`): a payment (checkout), an immediate switch, sales, or
 * nothing for the current plan.
 */
export function PlanCard({
  plan,
  canManage,
  busy,
  period,
  onSwitch,
}: {
  plan: BillingPlan;
  canManage: boolean;
  busy: boolean;
  period: Period;
  onSwitch: (plan: BillingPlan) => void;
}) {
  const t = useTranslations(`${NS}.plans`);
  const tl = useTranslations(`${NS}.limits`);
  const tf = useTranslations(`${NS}.features`);
  const tc = useTranslations(`${NS}.common`);
  const locale = useLocale();
  const titleId = useId();
  const [expanded, setExpanded] = useState(false);
  const price = priceView(plan, locale, period);
  const { highlights, all: rows } = cardRows(plan, VISIBLE);
  const shown = expanded ? rows : highlights;

  const label =
    plan.action === 'upgrade'
      ? t('action.upgrade', { name: plan.name })
      : plan.action === 'downgrade'
        ? t('action.downgrade', { name: plan.name })
        : plan.action === 'contact_sales'
          ? t('action.contactSales')
          : plan.action === 'continue_free'
            ? t('action.continueFree')
            : plan.ctaLabel && plan.action === 'choose' && plan.ctaLabel !== 'Get started'
              ? plan.ctaLabel
              : t('action.choose', { name: plan.name });

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      data-testid={`plan-card-${plan.slug}`}
      data-action={plan.action}
      data-via={plan.via}
      className={cn(
        'relative flex flex-col gap-4 rounded-xl border p-5',
        plan.highlighted
          ? 'border-primary bg-primary/5 ring-2 ring-primary/15'
          : 'border-border bg-background',
        plan.current && 'border-success/50',
      )}
    >
      {plan.highlighted && (
        <span className="absolute -top-2.5 start-4 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
          {t('mostPopular')}
        </span>
      )}
      <div className="space-y-1">
        <h2 id={titleId} className="text-lg font-semibold">
          {plan.name}
        </h2>
        {plan.subtitle && <p className="text-sm text-muted-foreground">{plan.subtitle}</p>}
      </div>

      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {price.kind === 'free' && <span className="text-3xl font-semibold">{t('free')}</span>}
        {price.kind === 'custom' && (
          <span className="text-3xl font-semibold">{t('customQuote')}</span>
        )}
        {price.kind === 'paid' && (
          <>
            <span className="text-3xl font-semibold">{price.main}</span>
            {price.strike && <s className="text-sm text-muted-foreground">{price.strike}</s>}
            <span className="text-sm text-muted-foreground">
              {price.lifetime
                ? t('oneTime')
                : price.period
                  ? t(`perUnit.${price.period.unit}`, { count: price.period.count })
                  : null}
            </span>
          </>
        )}
      </p>

      {plan.current ? (
        <Badge tone="success" className="self-start px-3 py-1.5 text-sm">
          {t('action.current')}
        </Badge>
      ) : plan.via === 'sales' ? (
        <Link
          href={SALES_PATH}
          className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
        >
          {label}
        </Link>
      ) : plan.via === 'checkout' ? (
        canManage ? (
          <Link
            href={checkoutPath(plan.slug, period)}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary"
          >
            {label}
          </Link>
        ) : (
          <Button disabled variant="secondary">
            {label}
          </Button>
        )
      ) : (
        <Button
          variant={plan.action === 'downgrade' ? 'secondary' : 'primary'}
          disabled={!canManage || busy}
          onClick={() => onSwitch(plan)}
        >
          {busy ? t('action.working') : label}
        </Button>
      )}

      <ul className="space-y-1.5 text-sm" aria-label={plan.name}>
        {shown.map((row) => (
          <li key={`${row.kind}-${row.key}`} className="flex gap-2">
            <span aria-hidden="true" className="text-success">
              ✓
            </span>
            {row.kind === 'limit' ? (
              <span>
                {t('feature.limit', {
                  label: tl(row.key),
                  value:
                    row.value > 0
                      ? new Intl.NumberFormat(locale).format(row.value)
                      : row.key === PLATFORM_DEFAULT_KEY
                        ? tc('platformDefault')
                        : tc('unlimited'),
                })}
              </span>
            ) : (
              <span>{tf(row.key)}</span>
            )}
          </li>
        ))}
      </ul>
      {rows.length > highlights.length && (
        <button
          type="button"
          className="self-start text-sm font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? t('showLess') : t('showAll', { count: rows.length })}
        </button>
      )}
    </div>
  );
}
