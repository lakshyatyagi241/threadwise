'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RECIPIENT_FILTERS, type ScheduleFunnel } from '@crm/contracts';
import { EmptyState, Input, Spinner, cn } from '@crm/ui';
import { AreaChart } from '@/features/broadcasts/components/charts';
import { useScheduleFunnel, useScheduleRecipients } from '../api/schedules';
import { phoneText } from '../lib/schedule-model';
import { formatWhen } from '../lib/time';
import { ErrorNotice } from './error-notice';
import { useErrorText } from './use-error-text';

const fmt = (n: number) => n.toLocaleString('en-US');
const PAGE = 50;

/** The funnel's steps in the order of the legend, with the token each is drawn in. */
export const FUNNEL_STEPS = [
  { key: 'queued', color: 'var(--muted-foreground)' },
  { key: 'sent', color: 'var(--brand)' },
  { key: 'delivered', color: 'var(--primary)' },
  { key: 'read', color: 'var(--warning)' },
  { key: 'failed', color: 'var(--danger)' },
] as const;

/** An axis label for a bucket start, in the schedule's own timezone: the hour for an hourly chart, the day for a daily one. */
export function bucketLabel(iso: string, bucket: ScheduleFunnel['bucket'], tz: string): string {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      ...(bucket === 'hour'
        ? { hour: '2-digit', minute: '2-digit', hour12: false }
        : { day: 'numeric', month: 'short' }),
    }).format(d);
  } catch {
    return iso.slice(bucket === 'hour' ? 11 : 5, bucket === 'hour' ? 16 : 10);
  }
}

/** Delivery over time (TW-SCHED-012): how many recipients were queued, sent, delivered, read and failed at each point, from the stored statuses. */
export function EngagementChart({ id, timezone }: { id: string; timezone: string }) {
  const t = useTranslations('scheduled-queue-warmer.detail.engagement');
  const errorText = useErrorText();
  const q = useScheduleFunnel(id);
  return (
    <section className="rounded-md border border-border bg-background p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('eyebrow')}
          </div>
          <h2 className="text-lg font-semibold">{t('title')}</h2>
        </div>
        <ul className="flex flex-wrap gap-3 text-xs" aria-label={t('legend')}>
          {FUNNEL_STEPS.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ background: s.color }} />
              {t(`steps.${s.key}`)}
            </li>
          ))}
        </ul>
      </div>
      {q.isPending ? (
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      ) : q.isError || !q.data ? (
        <ErrorNotice error={errorText(q.error)} />
      ) : q.data.points.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground" data-testid="funnel-empty">
          {t('empty')}
        </p>
      ) : (
        <div data-testid="funnel-chart">
          <AreaChart
            label={t('title')}
            labels={q.data.points.map((p) => bucketLabel(p.at, q.data.bucket, timezone))}
            series={FUNNEL_STEPS.map((s) => ({
              name: t(`steps.${s.key}`),
              color: s.color,
              data: q.data.points.map((p) => p[s.key]),
            }))}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t(q.data.bucket === 'hour' ? 'perHour' : 'perDay', { zone: timezone })}
          </p>
        </div>
      )}
    </section>
  );
}

/** A value that follows `value` after the person stops typing. */
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setV(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return v;
}

const STATUS_TONE = (status: string) =>
  status === 'failed'
    ? 'bg-danger/15 text-danger'
    : status === 'delivered' || status === 'read'
      ? 'bg-success/15 text-success'
      : status === 'sent'
        ? 'bg-warning/15 text-warning'
        : 'bg-muted text-muted-foreground';

/** Who got the message and how it went: filter by status, search by name or number, a page at a time (TW-SCHED-012). */
export function RecipientsTable({
  id,
  timezone,
  totalRecipients,
}: {
  id: string;
  timezone: string;
  totalRecipients: number;
}) {
  const t = useTranslations('scheduled-queue-warmer.detail');
  const errorText = useErrorText();
  const [status, setStatus] = useState<(typeof RECIPIENT_FILTERS)[number]>('all');
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(text.trim());
  const q = useScheduleRecipients(id, {
    status,
    q: search,
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });
  const counts = q.data?.counts ?? {};
  const chip = (k: (typeof RECIPIENT_FILTERS)[number]): number => {
    const n = (s: string) => counts[s] ?? 0;
    switch (k) {
      case 'all':
        return totalRecipients || Object.values(counts).reduce((a, b) => a + b, 0);
      case 'pending':
        return n('pending') + n('processing');
      default:
        return n(k);
    }
  };
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <section className="rounded-md border border-border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('recipients.eyebrow')}
          </div>
          <h2 className="text-lg font-semibold">{t('recipients.title')}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPage(1);
            }}
            placeholder={t('recipients.search')}
            aria-label={t('recipients.search')}
            className="h-8 w-56 text-xs"
          />
          <div role="tablist" className="flex flex-wrap gap-1 rounded-full bg-muted p-1">
            {RECIPIENT_FILTERS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={status === k}
                data-rec-tab={k}
                onClick={() => {
                  setStatus(k);
                  setPage(1);
                }}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-semibold',
                  status === k
                    ? 'bg-brand text-brand-foreground'
                    : 'text-muted-foreground hover:bg-background',
                )}
              >
                {t(`recipients.tabs.${k}`)}{' '}
                <span className="font-mono text-[10px] opacity-80">· {fmt(chip(k))}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {q.isPending ? (
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      ) : q.isError || !q.data ? (
        <div className="p-4">
          <ErrorNotice error={errorText(q.error)} />
        </div>
      ) : totalRecipients === 0 && total === 0 && status === 'all' && !search ? (
        <div className="p-4">
          <EmptyState title={t('recipients.none')} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="border-b border-border bg-muted/50 text-muted-foreground">
              <tr>
                {(['recipient', 'phone', 'status', 'when', 'note'] as const).map((c) => (
                  <th
                    key={c}
                    className="px-4 py-2.5 text-start font-mono text-[10px] font-normal uppercase tracking-[0.14em]"
                  >
                    {t(`recipients.cols.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data.items.map((r) => {
                const when = r.readAt ?? r.deliveredAt ?? r.sentAt;
                return (
                  <tr key={r.phone} data-status={r.status}>
                    <td className="px-4 py-2.5 font-medium">{r.contactName ?? '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-[11.5px]" dir="ltr">
                      {phoneText(r.phone)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 font-mono text-[10.5px]',
                          STATUS_TONE(r.status),
                        )}
                      >
                        {t(`recipients.status.${r.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11.5px]">
                      {when ? formatWhen(when, timezone) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-[11.5px] text-muted-foreground">
                      {r.error ?? '—'}
                    </td>
                  </tr>
                );
              })}
              {q.data.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-xs text-muted-foreground">
                    {t('recipients.emptyTab')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {q.data && total > PAGE && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span>
            {t('recipients.range', {
              from: fmt((page - 1) * PAGE + 1),
              to: fmt(Math.min(total, page * PAGE)),
              total: fmt(total),
            })}
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="rounded-full border border-border px-3 py-1 font-semibold disabled:opacity-40"
            >
              {t('recipients.prev')}
            </button>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
              className="rounded-full border border-border px-3 py-1 font-semibold disabled:opacity-40"
            >
              {t('recipients.next')}
            </button>
          </span>
        </div>
      )}
    </section>
  );
}
