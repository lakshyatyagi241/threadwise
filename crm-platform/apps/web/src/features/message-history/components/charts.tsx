'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type { MessageHistoryInsights } from '@crm/contracts';
import { BUCKETS, type Bucket } from '../lib/filters';
import { bucketLabel, formatCount, timeLabel } from '../lib/format';
import { Avatar } from './parts';

const SERIES = [
  { key: 'sent', bar: 'bg-brand', dot: 'bg-brand' },
  { key: 'received', bar: 'bg-primary', dot: 'bg-primary' },
  { key: 'failed', bar: 'bg-danger', dot: 'bg-danger' },
] as const;

/**
 * "Messages over time": stacked bars of sent, received and failed per bucket, with the Daily / Hourly / Weekly tabs. Drawn with
 * plain elements (no chart library): the bar heights are shares of the busiest bucket, and the same numbers are in a table for
 * screen readers.
 */
export function VolumeChart({
  insights,
  bucket,
  days,
  tz,
  onBucket,
}: {
  insights: MessageHistoryInsights | undefined;
  bucket: Bucket;
  days: number;
  tz: string;
  onBucket: (b: Bucket) => void;
}) {
  const t = useTranslations('message-history.charts');
  const locale = useLocale();
  const points = insights?.volume ?? [];
  const max = Math.max(1, ...points.map((p) => p.sent + p.received + p.failed));
  const step = Math.max(1, Math.ceil(points.length / 12));
  return (
    <div className="rounded-md border border-border bg-background p-5 lg:col-span-2">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('volume')}
          </div>
          <h2 className="mt-0.5 text-lg font-semibold leading-tight">{t('volumeTitle')}</h2>
        </div>
        <div
          role="group"
          aria-label={t('bucketLabel')}
          className="flex items-center gap-1 font-mono text-[11px]"
        >
          {BUCKETS.map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={bucket === b}
              onClick={() => onBucket(b)}
              className={cn(
                'rounded-full px-2.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                bucket === b
                  ? 'bg-brand text-brand-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {t(`bucket.${b}`)}
            </button>
          ))}
        </div>
      </div>
      <div
        data-testid="volume-chart"
        role="img"
        aria-label={t('volumeAria', {
          sent: formatCount(
            points.reduce((n, p) => n + p.sent, 0),
            locale,
          ),
          received: formatCount(
            points.reduce((n, p) => n + p.received, 0),
            locale,
          ),
          failed: formatCount(
            points.reduce((n, p) => n + p.failed, 0),
            locale,
          ),
        })}
        className="flex h-[260px] items-end gap-px"
      >
        {points.map((p, i) => {
          const total = p.sent + p.received + p.failed;
          return (
            <div
              key={p.at}
              className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
              title={`${bucketLabel(p.at, bucket, days, locale, tz)}: ${total}`}
            >
              <div
                className="flex w-full flex-col-reverse overflow-hidden rounded-t-sm"
                style={{ height: `${(total / max) * 92}%` }}
              >
                {SERIES.map((s) => {
                  const v = p[s.key];
                  return v === 0 ? null : (
                    <div
                      key={s.key}
                      className={s.bar}
                      style={{ height: `${(v / total) * 100}%` }}
                    />
                  );
                })}
              </div>
              <span className="mt-1 h-3 truncate text-center font-mono text-[9px] text-muted-foreground">
                {i % step === 0 ? bucketLabel(p.at, bucket, days, locale, tz) : ''}
              </span>
            </div>
          );
        })}
      </div>
      <table className="sr-only">
        <caption>{t('volumeTitle')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('when')}</th>
            {SERIES.map((s) => (
              <th key={s.key} scope="col">
                {t(`series.${s.key}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.at}>
              <th scope="row">{bucketLabel(p.at, bucket, days, locale, tz)}</th>
              <td>{p.sent}</td>
              <td>{p.received}</td>
              <td>{p.failed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DONUT = 2 * Math.PI * 42;

/** "Sent vs received": the share of each in the filtered feed, as a ring with the total in the middle. */
export function DirectionDonut({ insights }: { insights: MessageHistoryInsights | undefined }) {
  const t = useTranslations('message-history.charts');
  const locale = useLocale();
  const sum = (k: 'sent' | 'received' | 'failed') =>
    (insights?.volume ?? []).reduce((n, p) => n + p[k], 0);
  const parts = SERIES.map((s) => ({ ...s, n: sum(s.key) }));
  const total = parts.reduce((n, p) => n + p.n, 0);
  let offset = 0;
  const color = {
    sent: 'var(--brand)',
    received: 'var(--primary)',
    failed: 'var(--danger)',
  } as const;
  return (
    <div className="rounded-md border border-border bg-background p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {t('direction')}
      </div>
      <h2 className="mb-3 mt-0.5 text-lg font-semibold leading-tight">{t('directionTitle')}</h2>
      <svg
        viewBox="0 0 120 120"
        className="mx-auto size-[200px]"
        role="img"
        aria-label={t('directionAria', { total: formatCount(total, locale) })}
      >
        <circle cx="60" cy="60" r="42" fill="none" stroke="var(--border)" strokeWidth="16" />
        {total > 0 &&
          parts.map((p) => {
            const len = (p.n / total) * DONUT;
            const el = (
              <circle
                key={p.key}
                cx="60"
                cy="60"
                r="42"
                fill="none"
                stroke={color[p.key]}
                strokeWidth="16"
                strokeDasharray={`${len} ${DONUT - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 60 60)"
              />
            );
            offset += len;
            return p.n === 0 ? null : el;
          })}
        <text
          x="60"
          y="64"
          textAnchor="middle"
          className="fill-foreground text-[16px] font-semibold"
        >
          {formatCount(total, locale)}
        </text>
      </svg>
      <ul className="mt-3 space-y-1.5 text-xs">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className={cn('size-2.5 rounded-full', p.dot)} aria-hidden="true" />
              {t(`series.${p.key}`)}
            </span>
            <span className="font-mono text-foreground/80">{formatCount(p.n, locale)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const MIX: ReadonlyArray<{ key: keyof MessageHistoryInsights['typeMix']; label: string }> = [
  { key: 'text', label: 'text' },
  { key: 'autoReply', label: 'auto_reply' },
  { key: 'campaign', label: 'campaign' },
  { key: 'broadcast', label: 'broadcast' },
  { key: 'scheduled', label: 'scheduled' },
  { key: 'media', label: 'media' },
];

/** "By message type": Reference's six buckets as horizontal bars. */
export function TypeMixChart({ insights }: { insights: MessageHistoryInsights | undefined }) {
  const t = useTranslations('message-history.charts');
  const ty = useTranslations('message-history.type');
  const locale = useLocale();
  const mix = insights?.typeMix;
  const max = Math.max(1, ...MIX.map((m) => mix?.[m.key] ?? 0));
  return (
    <div className="rounded-md border border-border bg-background p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {t('types')}
      </div>
      <h2 className="mb-3 mt-0.5 text-lg font-semibold leading-tight">{t('typesTitle')}</h2>
      <ul className="space-y-2" data-testid="type-mix">
        {MIX.map((m) => {
          const v = mix?.[m.key] ?? 0;
          return (
            <li key={m.key} className="text-xs">
              <div className="mb-1 flex items-center justify-between">
                <span>{m.label === 'media' ? t('media') : ty(m.label as 'text')}</span>
                <span className="font-mono text-foreground/80">{formatCount(v, locale)}</span>
              </div>
              <div className="h-2 rounded-full bg-muted" aria-hidden="true">
                <div
                  className="h-2 rounded-full bg-brand"
                  style={{ width: `${(v / max) * 100}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** "Most active threads": up to four conversations of the window, each a link into the inbox. */
export function TopConversations({
  insights,
  windowLabel,
  tz,
}: {
  insights: MessageHistoryInsights | undefined;
  windowLabel: string;
  tz: string;
}) {
  const t = useTranslations('message-history.charts');
  const locale = useLocale();
  const top = insights?.topConversations ?? [];
  return (
    <div className="rounded-md border border-border bg-background p-5 lg:col-span-2">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('top')}
          </div>
          <h2 className="mt-0.5 text-lg font-semibold leading-tight">
            {t('topTitle', { range: windowLabel })}
          </h2>
        </div>
        <Link href="/inbox" className="text-[11px] font-semibold text-primary hover:underline">
          {t('openInbox')}
        </Link>
      </div>
      {top.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-xs italic text-muted-foreground">
          {t('topEmpty')}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {top.map((c) => (
            <li key={c.conversationId}>
              <Link
                href={`/inbox?c=${c.conversationId}`}
                className="flex items-center gap-3 rounded-md border border-border p-3 transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Avatar name={c.name} seed={c.conversationId} className="size-9 text-[11px]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold">
                    <span data-agent-ignore>{c.name}</span>
                  </div>
                  <div className="font-mono text-[10.5px] text-muted-foreground">
                    {t('topMeta', { n: c.messages, time: timeLabel(c.lastAt, locale, tz) })}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
