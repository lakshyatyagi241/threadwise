'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Badge, Button, Card, Spinner } from '@crm/ui';
import { ErrorNote } from '../../shared/error-note';
import { useGateRedirect } from '../../shared/use-gate-redirect';
import { authApi, keys } from '../api';
import { SUPPORT_PATH } from './plan-format';

/**
 * /account/plans: where every "upgrade" in the app lands (the plan picker of
 * WD-PLAN-011). Choosing and paying for a plan arrives with the billing
 * domain; until then this page says so plainly, shows which plan the workspace
 * is on, and points to support. There is deliberately no checkout here.
 */
export function PlansPlaceholder() {
  const t = useTranslations('auth-registration-security.account.plans');
  const c = useTranslations('auth-registration-security.account.common');
  const locale = useLocale();
  const query = useQuery({ queryKey: keys.plans, queryFn: authApi.plans, staleTime: 0 });
  useGateRedirect(query.error);

  const current = query.data?.data.find((p) => p.current) ?? null;
  const trialEnds = query.data?.trialEndsAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
        new Date(query.data.trialEndsAt),
      )
    : null;

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 id="account-pane-title" className="text-2xl font-semibold">
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>

      <Card className="space-y-4 p-5">
        {query.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner label={c('loading')} /> {c('loading')}
          </p>
        ) : query.isError ? (
          <div className="space-y-3">
            <ErrorNote error={query.error} />
            <Button variant="secondary" onClick={() => void query.refetch()}>
              {c('retry')}
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('currentPlan')}
            </p>
            <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
              {current?.name ?? query.data.currentSlug ?? t('noPlan')}
              {trialEnds && <Badge tone="warning">{t('trialEnds', { date: trialEnds })}</Badge>}
            </p>
          </div>
        )}

        <Alert tone="info">{t('comingSoon')}</Alert>

        <div className="flex flex-wrap gap-2">
          <Link
            href={SUPPORT_PATH}
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('contactSupport')}
          </Link>
          <Link
            href="/account/branding"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('back')}
          </Link>
        </div>
      </Card>
    </div>
  );
}
