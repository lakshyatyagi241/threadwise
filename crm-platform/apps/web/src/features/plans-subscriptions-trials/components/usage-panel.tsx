'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { UsageMeter } from '@crm/contracts';
import { Alert, Badge, Button, Card, Spinner, cn } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { BILLING_KEYS, fetchBillingUsage } from '../api';
import { PLANS_PATH } from '../lib/format';
import { ValidityBanner } from './validity-banner';

const NS = 'plans-subscriptions-trials';

/** Plan and usage (TW-PLAN-014): the plan, validity, one meter per capped key (this month or in total) and the unlocked features. */
export function UsagePanel() {
  const t = useTranslations(`${NS}.usage`);
  const tc = useTranslations(`${NS}.common`);
  const tf = useTranslations(`${NS}.features`);
  const ts = useTranslations(`${NS}.operator.state`);
  const locale = useLocale();
  const q = useQuery({
    queryKey: BILLING_KEYS.usage,
    queryFn: ({ signal }) => fetchBillingUsage(signal),
    staleTime: 0,
  });

  if (q.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner label={tc('loading')} /> {tc('loading')}
      </p>
    );
  }
  if (q.isError) {
    return (
      <div className="space-y-3">
        <Alert tone="danger">{q.error instanceof ApiError ? q.error.message : tc('retry')}</Alert>
        <Button variant="secondary" onClick={() => void q.refetch()}>
          {tc('retry')}
        </Button>
      </div>
    );
  }

  const u = q.data;
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(iso));
  const locked = u.features.filter((f) => !f.enabled).length;
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 id="account-pane-title" className="text-2xl font-semibold">
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('currentPlan')}
          </p>
          <p
            className="flex flex-wrap items-center gap-2 text-xl font-semibold"
            data-testid="usage-plan"
          >
            {u.planName ?? u.planSlug}
            <Badge
              tone={
                u.validity.state === 'paid_lapsed' || u.validity.state === 'free_trial_expired'
                  ? 'danger'
                  : 'success'
              }
            >
              {ts(u.validity.state)}
            </Badge>
          </p>
          <p className="text-sm text-muted-foreground">
            {t('resets', { date: date(u.cycleResetsAt) })}
          </p>
          {u.validity.planEndsAt && (
            <p className="text-sm text-muted-foreground">
              {t('validUntil', { date: date(u.validity.planEndsAt) })}
            </p>
          )}
        </div>
        <Link
          href={PLANS_PATH}
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('upgrade')}
        </Link>
      </Card>

      <ValidityBanner validity={u.validity} planName={u.planName} />

      <section aria-labelledby="meters-title" className="space-y-3">
        <h2 id="meters-title" className="text-lg font-semibold">
          {t('meters')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {u.meters.map((m) => (
            <Meter key={m.key} meter={m} />
          ))}
        </div>
      </section>

      <section aria-labelledby="features-title" className="space-y-3">
        <h2 id="features-title" className="text-lg font-semibold">
          {t('featuresTitle')}
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {u.features.map((f) => (
            <li
              key={f.key}
              data-enabled={f.enabled}
              className={cn(
                'flex items-center gap-2 text-sm',
                !f.enabled && 'text-muted-foreground',
              )}
            >
              <span aria-hidden="true" className={f.enabled ? 'text-success' : ''}>
                {f.enabled ? '✓' : '—'}
              </span>
              {tf(f.key)}
              <span className="sr-only">{f.enabled ? t('unlocked') : t('locked')}</span>
            </li>
          ))}
        </ul>
        {locked > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('moreOnHigher', { count: locked })}{' '}
            <Link href={PLANS_PATH} className="font-medium text-primary hover:underline">
              {t('comparePlans')}
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}

function Meter({ meter }: { meter: UsageMeter }) {
  const t = useTranslations(`${NS}.usage`);
  const tl = useTranslations(`${NS}.limits`);
  const unlimited = meter.limit === 0;
  const hot = meter.percent !== null && meter.percent >= 90;
  return (
    <Card className="space-y-2 p-4" data-testid={`meter-${meter.key}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{tl(meter.key)}</p>
        <p className="text-xs text-muted-foreground">
          {t(meter.window === 'month' ? 'month' : 'total')}
        </p>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={meter.percent ?? 0}
        aria-label={tl(meter.key)}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            'h-full rounded-full',
            hot ? 'bg-danger' : 'bg-primary',
            unlimited && 'opacity-30',
          )}
          style={{ width: `${unlimited ? 8 : (meter.percent ?? 0)}%` }}
        />
      </div>
      <p className="text-sm">
        {unlimited
          ? t('ofUnlimited', { used: meter.used })
          : t('ofLimit', { used: meter.used, limit: meter.limit })}
      </p>
    </Card>
  );
}
