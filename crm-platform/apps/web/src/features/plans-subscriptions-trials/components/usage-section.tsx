'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Spinner, cn } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { BILLING_KEYS, fetchBillingUsage } from '../api';
import { PLANS_SECTION_ID, USAGE_SECTION_ID } from '../lib/format';
import { LimitsSection } from './limits-section';
import { ValidityBanner } from './validity-banner';

const NS = 'plans-subscriptions-trials';

/**
 * "Your plan and usage" (TW-PLAN-014), the top of the Plans pane (`/account/plans#usage`): the current plan with its status, the
 * monthly reset and end date, the validity banner, the limits grouped with a meter per capped limit and the unlocked features. It
 * reads the billing usage query on its own, so a failure here never blanks the plan picker below it (nor the other way round).
 */
export function UsageSection() {
  const t = useTranslations(`${NS}.usage`);
  const tc = useTranslations(`${NS}.common`);
  const tf = useTranslations(`${NS}.features`);
  const ts = useTranslations(`${NS}.operator.state`);
  const locale = useLocale();
  const timeZone = useTimeZone();
  const q = useQuery({
    queryKey: BILLING_KEYS.usage,
    queryFn: ({ signal }) => fetchBillingUsage(signal),
    staleTime: 0,
  });

  const u = q.data;
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone }).format(new Date(iso));
  const locked = u ? u.features.filter((f) => !f.enabled).length : 0;

  return (
    <section
      id={USAGE_SECTION_ID}
      aria-labelledby="usage-section-title"
      className="scroll-mt-6 space-y-5"
      data-testid="usage-section"
    >
      <h2 id="usage-section-title" className="text-lg font-semibold">
        {t('sectionTitle')}
      </h2>

      {q.isPending ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner label={tc('loading')} /> {tc('loading')}
        </p>
      ) : q.isError || !u ? (
        <div className="space-y-3">
          <Alert tone="danger">{q.error instanceof ApiError ? q.error.message : tc('retry')}</Alert>
          <Button variant="secondary" onClick={() => void q.refetch()}>
            {tc('retry')}
          </Button>
        </div>
      ) : (
        <>
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
            {/* The plans are further down this same page: scroll to them instead of linking to the page we are on. */}
            <a
              href={`#${PLANS_SECTION_ID}`}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('upgrade')}
            </a>
          </Card>

          <ValidityBanner validity={u.validity} planName={u.planName} />

          <LimitsSection meters={u.meters} />

          <section aria-labelledby="features-title" className="space-y-3">
            <h3 id="features-title" className="text-base font-semibold">
              {t('featuresTitle')}
            </h3>
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
                <a
                  href={`#${PLANS_SECTION_ID}`}
                  className="font-medium text-primary hover:underline"
                >
                  {t('comparePlans')}
                </a>
              </p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
