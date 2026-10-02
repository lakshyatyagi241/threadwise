'use client';

import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { ReferralSummaryResponse } from '@crm/contracts';
import { Button, EmptyState, ToastProvider } from '@crm/ui';
import { KEYS, affiliateApi } from '../api';
import { formatMoney, plusMoney } from '../lib/format';
import { useCopyLink } from './hooks';
import { StatusPill } from './referrals-table';
import { ErrorState, LoadingBlock } from './state';

/** The account hub's Affiliate pane (TW-CPN-037). The history page and this pane read the same API and show money alike. */
export function AffiliatePane() {
  const tc = useTranslations('coupons-credits-referral-currency.affiliate.common');
  const q = useQuery({
    queryKey: KEYS.summary,
    queryFn: ({ signal }) => affiliateApi.summary(signal),
  });
  return (
    <ToastProvider dismissLabel={tc('dismiss')}>
      <AffiliatePaneShell>
        {q.isPending ? (
          <LoadingBlock />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <AffiliatePaneBody summary={q.data} />
        )}
      </AffiliatePaneShell>
    </ToastProvider>
  );
}

export function AffiliatePaneShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('coupons-credits-referral-currency.affiliate.pane');
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 id="account-pane-title" className="text-2xl font-semibold">
            {t('title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <Link href="/affiliate-history">
          <Button variant="secondary" size="sm">
            {t('fullHistory')}
          </Button>
        </Link>
      </header>
      {children}
    </div>
  );
}

export function AffiliatePaneBody({
  summary,
  onCopy,
}: {
  summary: ReferralSummaryResponse;
  /** Overridden by tests; the page copies through the clipboard and toasts. */
  onCopy?: (url: string) => void;
}) {
  const t = useTranslations('coupons-credits-referral-currency.affiliate.pane');
  const format = useFormatter();
  const locale = useLocale();
  const copy = useCopyLink('copiedClipboard');
  const { me } = summary;
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);
  const messages = Math.floor(summary.earnedMinor / Math.max(1, me.creditsPerMessage));

  return (
    <>
      <div className="rounded-2xl border border-border bg-background p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-medium text-muted-foreground">{t('codeTitle')}</div>
            <h2 data-code className="mt-1 font-mono text-3xl font-semibold">
              {me.code || t('noCode')}
            </h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              {t.rich('codeBody', {
                reward: formatMoney(me.rewardMinor, me.currency, locale),
                money: (chunks) => <span className="font-semibold text-primary">{chunks}</span>,
              })}
            </p>
          </div>
          {me.link && (
            <Button variant="secondary" size="sm" onClick={() => (onCopy ?? copy)(me.link)}>
              {t('copyLink')}
            </Button>
          )}
        </div>
        {me.link && (
          <div className="mt-4 break-all rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs">
            {me.link}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-background p-4">
          <div className="text-xs font-medium text-muted-foreground">{t('signups30d')}</div>
          <div data-stat="signups30d" className="mt-1 text-3xl font-semibold leading-none">
            {n(summary.signups30d)}
          </div>
          <div className="mt-2 text-xs text-primary">{t('viaLink')}</div>
        </div>
        <div className="rounded-2xl border border-success/40 bg-background p-4">
          <div className="text-xs font-medium text-muted-foreground">{t('signupsTotal')}</div>
          <div data-stat="signupsTotal" className="mt-1 text-3xl font-semibold leading-none">
            {n(summary.signupsLifetime)}
          </div>
          <div className="mt-2 text-xs text-primary">{t('lifetime')}</div>
        </div>
        <div className="rounded-2xl border border-warning/40 bg-background p-4">
          <div className="text-xs font-medium text-muted-foreground">{t('earned')}</div>
          <div data-stat="earned" className="mt-1 text-3xl font-semibold leading-none">
            {formatMoney(summary.earnedMinor, me.currency, locale)}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {t('earnedMessages', { count: messages })}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-lg font-semibold">{t('recentTitle')}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">
                  {t('user')}
                </th>
                <th scope="col" className="px-2 py-2.5 text-start font-medium">
                  {t('codeUsed')}
                </th>
                <th scope="col" className="px-2 py-2.5 text-start font-medium">
                  {t('joined')}
                </th>
                <th scope="col" className="px-2 py-2.5 text-start font-medium">
                  {t('status')}
                </th>
                <th scope="col" className="px-4 py-2.5 text-end font-medium">
                  {t('earnedColumn')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {summary.recent.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-4">
                    <EmptyState title={t('empty')} />
                  </td>
                </tr>
              ) : (
                summary.recent.map((r) => (
                  <tr key={r.id} data-row={r.id}>
                    <td className="px-4 py-2.5 font-medium">{r.refereeName}</td>
                    <td className="px-2 py-2.5 font-mono text-xs">{r.codeUsed}</td>
                    <td className="px-2 py-2.5 font-mono text-xs">
                      {format.dateTime(new Date(r.createdAt), { dateStyle: 'medium' })}
                    </td>
                    <td className="px-2 py-2.5">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="px-4 py-2.5 text-end font-semibold">
                      {plusMoney(r.creditsAwardedMinor, me.currency, locale)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
