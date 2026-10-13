'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import {
  TEAM_ANALYTICS_RANGES,
  type TeamAnalyticsAgent,
  type TeamAnalyticsRange,
} from '@crm/contracts';
import { Alert, EmptyState, Spinner, StatTile, cn } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { PlanPaywall } from '@/features/plans-subscriptions-trials/components/plan-paywall';
import { useAnalyticsChannels, useTeamAnalytics } from '../api/analytics';
import { formatMinutes } from '../lib/analytics';

const STATUS_TONE: Record<string, string> = {
  online: 'bg-success/10 text-success',
  away: 'bg-warning/10 text-warning',
  busy: 'bg-danger/10 text-danger',
  offline: 'bg-muted text-muted-foreground',
};

const parseRange = (v: string | null): TeamAnalyticsRange =>
  (TEAM_ANALYTICS_RANGES as readonly string[]).includes(v ?? '')
    ? (v as TeamAnalyticsRange)
    : 'today';

/**
 * `/inbox/analytics/team` (TW-TIB2-034): how fast the team responded. Range tabs, a channel filter (shown when the workspace has two or
 * more channels; kept in the address as `?channel=`), four tiles and a table per agent. Needs `inbox.analytics.view`; a plan without Team
 * performance sees the paywall sheet over the page.
 */
export function TeamPerformanceScreen() {
  const t = useTranslations('team-inbox-routing-sla.performance');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const canView = useCan('inbox.analytics.view');
  const range = parseRange(params.get('range'));
  const channelId = params.get('channel') ?? undefined;
  const q = useTeamAnalytics(range, channelId, canView);
  const channels = useAnalyticsChannels(canView);
  const locked = q.error instanceof ApiError && q.error.code === 'PLAN_FEATURE_LOCKED';

  function go(next: { range?: TeamAnalyticsRange; channel?: string | null }) {
    const sp = new URLSearchParams(params.toString());
    if (next.range) {
      if (next.range === 'today') sp.delete('range');
      else sp.set('range', next.range);
    }
    if (next.channel !== undefined) {
      if (next.channel) sp.set('channel', next.channel);
      else sp.delete('channel');
    }
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  if (!canView) {
    return <Alert tone="warning">{t('noAccess')}</Alert>;
  }

  const data = q.data;
  const list = channels.data?.data ?? [];
  const when = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone,
        }).format(new Date(iso))
      : '—';

  return (
    <section className="space-y-5" aria-labelledby="tp-title">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('eyebrow')}
          </div>
          <h1 id="tp-title" className="text-2xl font-semibold tracking-tight">
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
            {data
              ? t('summary', {
                  replies: data.totals.replies,
                  resolved: data.totals.resolved,
                  avg: formatMinutes(data.totals.avgFirstResponseMin),
                })
              : t('subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 text-success">
            <span className="size-1.5 animate-pulse rounded-full bg-success" aria-hidden />
            {t('live')}
          </span>
          <Link
            href="/inbox"
            className="rounded-full border border-border px-3 py-1.5 font-medium hover:bg-muted"
          >
            {t('backToInbox')}
          </Link>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div
          role="tablist"
          aria-label={t('rangeLabel')}
          className="inline-flex rounded-full border border-border p-0.5"
        >
          {TEAM_ANALYTICS_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={range === r}
              onClick={() => go({ range: r })}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-xs font-semibold',
                range === r
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {t(`ranges.${r}`)}
            </button>
          ))}
        </div>
        {list.length >= 2 && (
          <select
            aria-label={t('channelLabel')}
            value={channelId ?? ''}
            onChange={(e) => go({ channel: e.target.value || null })}
            className="h-9 rounded-full border border-border bg-background px-4 text-xs font-medium"
          >
            <option value="">{t('allChannels')}</option>
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {q.isError && !locked && (
        <Alert tone="danger" role="alert">
          {t('loadFailed')}
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={t('tiles.replies')}
          value={data ? data.totals.replies.toLocaleString(locale) : '…'}
          tone="accent"
        />
        <StatTile
          label={t('tiles.resolved')}
          value={data ? data.totals.resolved.toLocaleString(locale) : '…'}
        />
        <StatTile
          label={t('tiles.inbounds')}
          value={data ? data.totals.inbounds.toLocaleString(locale) : '…'}
        />
        <StatTile
          label={t('tiles.avgFirstReply')}
          value={data ? formatMinutes(data.totals.avgFirstResponseMin) : '…'}
        />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50 text-start">
            <tr>
              {(
                ['agent', 'status', 'load', 'replies', 'resolved', 'avgReply', 'lastSeen'] as const
              ).map((k) => (
                <th
                  key={k}
                  scope="col"
                  className={cn(
                    'px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground',
                    ['load', 'replies', 'resolved', 'avgReply'].includes(k)
                      ? 'text-end'
                      : 'text-start',
                  )}
                >
                  {t(`columns.${k}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {q.isPending && canView ? (
              <tr>
                <td colSpan={7} className="p-8 text-center">
                  <Spinner label={t('loading')} />
                </td>
              </tr>
            ) : data && data.agents.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState title={t('empty')} />
                </td>
              </tr>
            ) : (
              data?.agents.map((a: TeamAnalyticsAgent) => (
                <tr key={a.userId}>
                  <td className="px-4 py-2.5 font-medium">{a.name ?? t('unknown')}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs',
                        STATUS_TONE[a.status] ?? STATUS_TONE.offline,
                      )}
                    >
                      {t(`statuses.${a.status in STATUS_TONE ? a.status : 'offline'}`)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{a.currentLoad}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{a.replies}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{a.resolved}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">
                    {formatMinutes(a.avgResponseMin)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                    {when(a.lastSeenAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {locked && <PlanPaywall />}
    </section>
  );
}
