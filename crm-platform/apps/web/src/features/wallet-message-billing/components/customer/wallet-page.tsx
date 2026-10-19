'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { WalletSummary } from '@crm/contracts';
import { Alert, Button, Card, EmptyState, Field, Input, StatTile } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, customerApi } from '../../api';
import { billingVariant } from '../../lib/billing-variant';
import {
  QUICK_ADD_UNITS,
  currencySymbol,
  formatAmount,
  formatMinor,
  parseTopupUnits,
  topupHref,
} from '../../lib/money';
import { ErrorState, LoadingBlock, PermissionDenied } from '../state';
import { ActivityTable } from './activity-table';
import { PagerBar } from './pager-bar';
import { usePager } from './use-pager';
import { useWalletBalance } from './use-wallet-balance';

const LEDGER_PAGE = 10;

/** The workspace's wallet home: balance, 30-day figures, add money, how billing works, and recent activity. */
export function WalletPage() {
  const t = useTranslations('wallet-message-billing.wallet');
  const canStatement = useCan('wallet.statement.read');
  const { allowed, summary, isPending, isError, error, refetch } = useWalletBalance();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canStatement && (
          <Link href="/billing/wallet/statement">
            <Button variant="secondary" size="sm">
              {t('fullStatement')}
            </Button>
          </Link>
        )}
      </header>
      {!allowed ? (
        <PermissionDenied permission="wallet.balance.read" />
      ) : isPending ? (
        <LoadingBlock />
      ) : isError || !summary ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <WalletBody summary={summary} canStatement={canStatement} />
      )}
    </div>
  );
}

export function WalletBody({
  summary,
  canStatement,
}: {
  summary: WalletSummary;
  canStatement: boolean;
}) {
  const t = useTranslations('wallet-message-billing.wallet');
  const locale = useLocale();
  const money = (minor: number, exact?: string) =>
    formatAmount(minor, exact, summary.currency, locale);
  return (
    <>
      {summary.lowBalance && (
        <Alert tone="warning" className="space-y-0.5">
          <p className="font-medium">{t('lowBalanceTitle')}</p>
          <p>{t('lowBalanceBody', { threshold: money(summary.lowBalanceThresholdMinor) })}</p>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label={t('kpi.balance')}
          value={money(summary.balanceMinor, summary.balanceExact)}
          tone={summary.lowBalance ? 'warning' : 'accent'}
          hint={
            summary.approxMessages !== null
              ? `${t('kpi.available')} · ${t('kpi.approx', { count: summary.approxMessages })}`
              : t('kpi.available')
          }
        />
        <StatTile
          label={t('kpi.spent')}
          value={money(summary.spent30dMinor, summary.spent30dExact)}
          hint={t('kpi.last30')}
        />
        <StatTile
          label={t('kpi.earned')}
          value={`+${money(summary.earned30dMinor, summary.earned30dExact)}`}
          hint={t('kpi.last30')}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <AddMoneyCard summary={summary} />
        <HowBillingCard summary={summary} />
      </div>
      {canStatement && <ActivityCard currency={summary.currency} />}
    </>
  );
}

function AddMoneyCard({ summary }: { summary: WalletSummary }) {
  const t = useTranslations('wallet-message-billing.wallet.add');
  const locale = useLocale();
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [touched, setTouched] = useState(false);
  const units = parseTopupUnits(amount);
  const invalid = touched && units === null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (units !== null) router.push(topupHref(summary.topupUrl, units));
  };

  return (
    <Card className="space-y-4">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field
          label={t('amount')}
          htmlFor="wallet-add-amount"
          hint={t('hint')}
          error={invalid ? t('invalid') : undefined}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground" aria-hidden="true">
              {currencySymbol(summary.currency, locale)}
            </span>
            <Input
              id="wallet-add-amount"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              required
              placeholder="1000"
              value={amount}
              invalid={invalid}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </Field>
        <Button type="submit">{t('submit')}</Button>
      </form>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{t('quick')}</p>
        <ul className="flex flex-wrap gap-2">
          {QUICK_ADD_UNITS.map((u) => (
            <li key={u}>
              <Link
                href={topupHref(summary.topupUrl, u)}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {formatMinor(u * 100, summary.currency, locale)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function HowBillingCard({ summary }: { summary: WalletSummary }) {
  const timeZone = useTimeZone();
  const t = useTranslations('wallet-message-billing.wallet.how');
  const locale = useLocale();
  const variant = billingVariant(summary);
  const num = new Intl.NumberFormat(locale);
  const ends = summary.plan.endsAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(
        new Date(summary.plan.endsAt),
      )
    : null;
  return (
    <Card className="space-y-3">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      {variant === 'wallet' && (
        <>
          <p className="text-sm">{t('wallet.body')}</p>
          <p className="text-sm text-muted-foreground">{t('wallet.funded')}</p>
        </>
      )}
      {variant === 'planLimited' && (
        <>
          <p className="text-sm">
            {t('plan.allowance', { limit: num.format(summary.plan.monthlyMessagesLimit) })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('plan.used', { used: num.format(summary.plan.usedThisMonth) })}
            {ends ? ` ${t('plan.ends', { date: ends })}` : ''}
          </p>
          <p className="text-sm text-muted-foreground">{t('plan.extra')}</p>
          {!summary.plan.active && (
            <Alert tone="danger">
              <p className="font-medium">{t('plan.ended')}</p>
            </Alert>
          )}
        </>
      )}
      {variant === 'planGeneric' && <p className="text-sm">{t('generic')}</p>}
    </Card>
  );
}

function ActivityCard({ currency }: { currency: string }) {
  const t = useTranslations('wallet-message-billing.wallet.activity');
  const pager = usePager();
  const q = useQuery({
    queryKey: KEYS.ledger(pager.cursor),
    queryFn: ({ signal }) => customerApi.ledger(pager.cursor, LEDGER_PAGE, signal),
    placeholderData: keepPreviousData,
  });
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <Link href="/billing/wallet/statement" className="text-sm text-primary hover:underline">
          {t('fullStatement')}
        </Link>
      </div>
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.data.length === 0 && !pager.hasPrev ? (
        <EmptyState title={t('emptyTitle')} message={t('emptyBody')} />
      ) : (
        <>
          <ActivityTable rows={q.data.data} currency={currency} label={t('title')} />
          {(pager.hasPrev || q.data.page.hasMore) && (
            <PagerBar
              page={pager.page}
              hasPrev={pager.hasPrev}
              hasNext={q.data.page.hasMore && q.data.page.nextCursor !== null}
              busy={q.isPlaceholderData}
              onPrev={pager.prev}
              onNext={() => q.data.page.nextCursor && pager.next(q.data.page.nextCursor)}
            />
          )}
        </>
      )}
    </Card>
  );
}
