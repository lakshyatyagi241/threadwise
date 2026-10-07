'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { ReferralListResponse, ReferralRow } from '@crm/contracts';
import { Alert, Badge, Button, Card, StatTile, cn } from '@crm/ui';
import { formatRelative } from '@/features/auth-registration-security/shared/relative-time';
import {
  affiliateErrorKind,
  barPercent,
  deltaTone,
  formatDelta,
  initials,
  money,
  requestIdOf,
  rewardLine,
  shortTxId,
  type DeltaTone,
} from '../../lib/affiliate';

const NS = 'coupons-credits-referral-currency.affiliate';

const DELTA_CLASS: Record<DeltaTone, string> = {
  success: 'text-success',
  danger: 'text-danger',
  neutral: 'text-muted-foreground',
};

/** A pulsing placeholder block. */
function Bone({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

/** The whole screen while the first answer is on its way. */
export function AffiliateSkeleton() {
  const t = useTranslations(`${NS}.states`);
  return (
    <div role="status" aria-busy="true" className="space-y-6">
      <span className="sr-only">{t('loading')}</span>
      <Bone className="h-28" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <Bone key={i} className="h-24" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Bone className="h-64 lg:col-span-2" />
        <Bone className="h-64" />
      </div>
      <Bone className="h-72" />
    </div>
  );
}

/** A failed call: the sentence is chosen from the problem `code`/status, the request id is for support, and retry is offered. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations(`${NS}.errors`);
  const requestId = requestIdOf(error);
  return (
    <Alert tone="danger" className="space-y-2">
      <p>{t(affiliateErrorKind(error))}</p>
      {requestId && (
        <p className="text-xs opacity-80">
          {t('requestId')}: <span className="font-mono">{requestId}</span>
        </p>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </Alert>
  );
}

type HeaderData = Pick<
  ReferralListResponse,
  'code' | 'link' | 'rewardMinor' | 'payPerMessage' | 'messagePriceMinor' | 'currency'
>;

/** The code, the copy-link button and what a referral earns. No percentage and no recurring promise: the reward is one fixed amount. */
export function ShareHeader({
  data,
  locale,
  onCopy,
}: {
  data: HeaderData;
  locale: string;
  onCopy: () => void;
}) {
  const t = useTranslations(`${NS}.header`);
  const reward = rewardLine(data);
  return (
    <Card className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{t('codeLabel')}</p>
        <p className="font-mono text-2xl font-semibold tracking-widest" dir="ltr">
          {data.code || t('noCode')}
        </p>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {reward.kind === 'none'
            ? t('rewardNone')
            : t('reward', { amount: money(reward.rewardMinor, data.currency, locale) })}
          {reward.kind === 'reward' && reward.messages !== null && (
            <> {t('rewardMessages', { count: reward.messages })}</>
          )}
        </p>
        <p className="break-all text-xs text-muted-foreground" dir="ltr">
          <span className="sr-only">{t('linkLabel')}: </span>
          {data.link}
        </p>
      </div>
      <Button onClick={onCopy} disabled={!data.code}>
        {t('copyLink')}
      </Button>
    </Card>
  );
}

/** The four figures of the range (the code itself is shown once, in the share card above). Search never changes them. */
export function KpiStrip({ data, locale }: { data: ReferralListResponse; locale: string }) {
  const t = useTranslations(`${NS}.kpi`);
  const { stats, currency } = data;
  const fmt = (minor: number) => money(minor, currency, locale);
  const nf = new Intl.NumberFormat(locale);
  return (
    <div aria-live="polite" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label={t('inRange')}
        value={nf.format(stats.signupsInRange)}
        hint={
          <span className={DELTA_CLASS[deltaTone(stats.deltaPercent)]}>
            {t('vsPrevious', { delta: formatDelta(stats.deltaPercent) })}
          </span>
        }
      />
      <StatTile label={t('earned')} value={fmt(stats.creditsEarnedMinor)} />
      <StatTile
        label={t('last30')}
        value={nf.format(stats.signups30d)}
        hint={t('last30Earned', { amount: fmt(stats.credits30dMinor) })}
      />
      <StatTile label={t('average')} value={fmt(stats.avgPerSignupMinor)} />
    </div>
  );
}

/** The five busiest codes of the range with a bar proportional to the leader (never thinner than 2%). */
export function TopCodes({ data }: { data: ReferralListResponse }) {
  const t = useTranslations(`${NS}.topCodes`);
  const locale = useLocale();
  const max = Math.max(...data.topCodes.map((c) => c.signups), 0);
  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">{t('title')}</h2>
      {data.topCodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="space-y-3">
          {data.topCodes.map((c) => (
            <li key={c.code} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-mono" dir="ltr">
                  {c.code}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('referrals', { count: c.signups })} ·{' '}
                  {money(c.creditsMinor, data.currency, locale)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${barPercent(c.signups, max)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The latest wallet payouts the referrals produced (up to 8). */
export function Payouts({ data, now }: { data: ReferralListResponse; now: number }) {
  const t = useTranslations(`${NS}.payouts`);
  const locale = useLocale();
  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">{t('title')}</h2>
      {data.payouts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {data.payouts.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div>
                <div className="font-medium text-success tabular-nums">
                  +{money(p.amountMinor, data.currency, locale)}
                </div>
                <div className="text-xs text-muted-foreground" suppressHydrationWarning>
                  {formatRelative(p.createdAt, now, locale)}
                </div>
              </div>
              <div className="text-end text-xs text-muted-foreground tabular-nums">
                {t('balanceAfter', { amount: money(p.balanceAfterMinor, data.currency, locale) })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Avatar({ row }: { row: ReferralRow }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary"
    >
      {initials(row)}
    </span>
  );
}

/** The referrals of the range, one page. Columns: when, referee, code used, credits earned, status, wallet transaction. */
export function ReferralsTable({
  rows,
  currency,
  locale,
  now,
}: {
  rows: readonly ReferralRow[];
  currency: string;
  locale: string;
  now: number;
}) {
  const t = useTranslations(`${NS}.table`);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const th = 'px-3 py-2 text-start font-medium';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-sm" aria-label={t('label')}>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className={th}>
              {t('when')}
            </th>
            <th scope="col" className={th}>
              {t('referee')}
            </th>
            <th scope="col" className={th}>
              {t('code')}
            </th>
            <th scope="col" className={cn(th, 'text-end')}>
              {t('credits')}
            </th>
            <th scope="col" className={th}>
              {t('status')}
            </th>
            <th scope="col" className={th}>
              {t('transaction')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border align-middle last:border-0">
              <td className="whitespace-nowrap px-3 py-2">
                <div>{date.format(new Date(r.createdAt))}</div>
                <div className="text-xs text-muted-foreground" suppressHydrationWarning>
                  {formatRelative(r.createdAt, now, locale)}
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <Avatar row={r} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {r.refereeName?.trim() || t('noName')}
                    </div>
                    <div className="truncate text-xs text-muted-foreground" dir="ltr">
                      {r.refereeEmail || '-'}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                {r.codeUsed}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-end tabular-nums">
                {r.creditsAwardedMinor > 0 ? (
                  <span className="font-medium text-success">
                    +{money(r.creditsAwardedMinor, currency, locale)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{money(0, currency, locale)}</span>
                )}
              </td>
              <td className="px-3 py-2">
                <Badge tone={r.status === 'paid' ? 'success' : 'neutral'}>
                  {t(r.status === 'paid' ? 'paid' : 'pending')}
                </Badge>
              </td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {r.walletTxId ? (
                  <span title={r.walletTxId} dir="ltr">
                    {shortTxId(r.walletTxId)}
                  </span>
                ) : (
                  <span aria-label={t('noTransaction')}>-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Showing 1-20 of 45" with Previous / Next over the cursor stack. Hidden by the caller when there are no rows. */
export function TableFooter({
  from,
  to,
  total,
  hasPrev,
  hasNext,
  busy,
  onPrev,
  onNext,
}: {
  from: number;
  to: number;
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  busy: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const t = useTranslations(`${NS}.table`);
  return (
    <nav
      aria-label={t('pagination')}
      className="flex flex-wrap items-center justify-between gap-2 pt-3"
    >
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {t('showing', { from, to, total })}
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={onPrev} disabled={!hasPrev || busy}>
          {t('previous')}
        </Button>
        <Button variant="secondary" size="sm" onClick={onNext} disabled={!hasNext || busy}>
          {t('next')}
        </Button>
      </div>
    </nav>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-semibold">{children}</h2>;
}
