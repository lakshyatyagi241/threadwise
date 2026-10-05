'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { isPlanFeatureKey, type BillingPlan, type PlanFeatureKey } from '@crm/contracts';
import { fetchBillingPlans } from '../api';
import { PLANS_PATH, SALES_PATH, formatMoney } from '../lib/format';

export interface PaywallGate {
  /** A menu entry's path; the longest gate that prefixes the current path decides. */
  href: string;
  feature: string;
}

/** The feature a path needs: the longest gate whose path is a prefix of it (WD-PLAN-020: a page's feature comes from the route, not a separate map). */
export function gateFor(pathname: string, gates: readonly PaywallGate[]): PaywallGate | null {
  let best: PaywallGate | null = null;
  for (const g of gates) {
    if (pathname === g.href || pathname.startsWith(`${g.href}/`)) {
      if (!best || g.href.length > best.href.length) best = g;
    }
  }
  return best;
}

/**
 * The slide-up sheet over a feature page the plan does not include (WD-PLAN-020): "<Feature> is not on your plan", the plans that unlock it with a button
 * each, "Go back" and "Compare all plans". Shown only when the page's feature is known to be off (an unreadable plan shows nothing). It never blocks
 * the server: the API refuses the actions itself (WD-PLAN-019).
 */
export function PlanPaywall({
  gates,
  enabled,
}: {
  gates: readonly PaywallGate[];
  enabled: readonly string[] | null;
}) {
  const pathname = usePathname();
  const gate = gateFor(pathname, gates);
  const locked =
    gate !== null &&
    enabled !== null &&
    !enabled.includes(gate.feature) &&
    isPlanFeatureKey(gate.feature);
  if (!locked || !gate) return null;
  return <Sheet feature={gate.feature as PlanFeatureKey} />;
}

function Sheet({ feature }: { feature: PlanFeatureKey }) {
  const t = useTranslations('plans-subscriptions-trials.paywall');
  const tf = useTranslations('plans-subscriptions-trials.features');
  const locale = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ['billing', 'plans', 'unlocks', feature],
    queryFn: ({ signal }) => fetchBillingPlans(signal, feature),
    staleTime: 60_000,
  });
  useEffect(() => ref.current?.focus(), []);
  const plans: BillingPlan[] = q.data?.data ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/60 p-4"
      data-testid="plan-paywall"
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="paywall-title"
        tabIndex={-1}
        className="max-h-[94vh] w-full max-w-[920px] space-y-4 overflow-y-auto rounded-t-2xl bg-background p-6 shadow-xl"
      >
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-warning">
            <span aria-hidden="true">♛ </span>
            {t('premium')}
          </p>
          <h2 id="paywall-title" className="text-xl font-semibold">
            {t('title', { feature: tf(feature) })}
          </h2>
          <p className="text-sm text-muted-foreground">{t('lead')}</p>
        </div>
        {plans.length > 0 && (
          <div className="flex flex-wrap gap-3" data-testid="paywall-plans">
            {plans.map((p) => (
              <div
                key={p.slug}
                className="min-w-44 flex-1 space-y-2 rounded-xl border border-border p-4"
              >
                <p className="flex items-center gap-2 font-semibold">
                  {p.name}
                  {p.highlighted && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
                      {t('popular')}
                    </span>
                  )}
                </p>
                <p className="text-lg font-semibold">
                  {p.kind === 'paid'
                    ? formatMoney(p.price.offerAmount ?? p.price.amount, p.price.currency, locale)
                    : p.kind === 'free'
                      ? t('free')
                      : t('custom')}
                </p>
                {p.subtitle && (
                  <p className="text-xs text-muted-foreground">{p.subtitle.slice(0, 70)}</p>
                )}
                <Link
                  href={
                    p.via === 'sales'
                      ? SALES_PATH
                      : p.via === 'checkout'
                        ? `/billing/checkout/${p.slug}`
                        : PLANS_PATH
                  }
                  className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  {p.via === 'sales'
                    ? t('talk')
                    : p.kind === 'free'
                      ? t('continueFree')
                      : t('choose', { name: p.name })}
                </Link>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href="/dashboard" className="font-medium text-primary hover:underline">
            {t('back')}
          </Link>
          <Link href={PLANS_PATH} className="font-medium text-primary hover:underline">
            {t('compare')}
          </Link>
        </div>
      </div>
    </div>
  );
}
