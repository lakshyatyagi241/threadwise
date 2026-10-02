'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReferralBucket, ReferralHistoryResponse } from '@crm/contracts';
import { cn } from '@crm/ui';
import { BUCKETS, compactNumber, formatMoney, labelIndexes, niceScale } from '../lib/format';

type Volume = ReferralHistoryResponse['volume'];

const W = 640;
const H = 260;
const PAD = { l: 44, r: 52, t: 14, b: 34 };

/**
 * Signups (bars, left axis) and money earned (line, right axis) over time, drawn as SVG from the colour tokens. No chart
 * library. At most 10 x labels however many points the bucket has; the full series is kept in each point's tooltip.
 */
export function VolumeChart({ volume, currency }: { volume: Volume; currency: string }) {
  const t = useTranslations('coupons-credits-referral-currency.affiliate.chart');
  const locale = useLocale();
  const count = volume.labels.length;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const left = niceScale(Math.max(0, ...volume.signups), 4, true);
  const right = niceScale(Math.max(0, ...volume.creditsMinor));
  const slot = plotW / Math.max(count, 1);
  const barW = Math.max(Math.min(slot * 0.52, 36), 1);
  const cx = (i: number) => PAD.l + slot * i + slot / 2;
  const yLeft = (v: number) => PAD.t + plotH - (v / left.max) * plotH;
  const yRight = (v: number) => PAD.t + plotH - (v / right.max) * plotH;
  const line = volume.creditsMinor
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${cx(i).toFixed(1)} ${yRight(v).toFixed(1)}`)
    .join(' ');
  const empty = volume.signups.every((v) => v === 0) && volume.creditsMinor.every((v) => v === 0);

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('label')} className="h-auto w-full">
        {left.ticks.map((tick, i) => {
          const y = PAD.t + plotH - (plotH * i) / (left.ticks.length - 1);
          return (
            <g key={tick}>
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeDasharray="3 3"
              />
              <text
                x={PAD.l - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="10"
                fill="var(--muted-foreground)"
              >
                {compactNumber(tick, locale)}
              </text>
              <text
                x={W - PAD.r + 6}
                y={y + 3}
                textAnchor="start"
                fontSize="10"
                fill="var(--muted-foreground)"
              >
                {compactNumber(right.ticks[i]! / 100, locale)}
              </text>
            </g>
          );
        })}
        {volume.signups.map((v, i) => (
          <rect
            key={`b${i}`}
            data-bar
            x={cx(i) - barW / 2}
            y={yLeft(v)}
            width={barW}
            height={Math.max(PAD.t + plotH - yLeft(v), 0)}
            rx="3"
            fill="var(--primary)"
          >
            <title>
              {`${volume.labels[i]} · ${t('signups')}: ${v} · ${t('credits')}: ${formatMoney(
                volume.creditsMinor[i] ?? 0,
                currency,
                locale,
              )}`}
            </title>
          </rect>
        ))}
        {count > 0 && (
          <path
            data-line
            d={line}
            fill="none"
            stroke="var(--warning)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        )}
        {labelIndexes(count).map((i) => (
          <text
            key={`x${i}`}
            data-x-label
            x={cx(i)}
            y={H - 12}
            textAnchor="middle"
            fontSize="10"
            fill="var(--muted-foreground)"
          >
            {volume.labels[i]}
          </text>
        ))}
        <text x={PAD.l - 6} y={9} textAnchor="end" fontSize="9" fill="var(--muted-foreground)">
          {t('signups')}
        </text>
        <text
          x={W - PAD.r + 6}
          y={9}
          textAnchor="start"
          fontSize="9"
          fill="var(--muted-foreground)"
        >
          {t('credits')}
        </text>
      </svg>
      <figcaption className="mt-1 flex items-center justify-end gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-primary" />
          {t('signups')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-0.5 w-3 bg-warning" />
          {t('credits')}
        </span>
        {empty && <span>{t('empty')}</span>}
      </figcaption>
    </figure>
  );
}

/** The Volume card: heading, Daily / Weekly / Monthly tabs and the chart. */
export function VolumePanel({
  volume,
  currency,
  bucket,
  onBucket,
}: {
  volume: Volume;
  currency: string;
  bucket: ReferralBucket;
  onBucket: (b: ReferralBucket) => void;
}) {
  const t = useTranslations('coupons-credits-referral-currency.affiliate.chart');
  return (
    <div className="rounded-lg border border-border bg-background p-5 lg:col-span-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-muted-foreground">{t('eyebrow')}</div>
          <h2 className="mt-0.5 text-lg font-semibold leading-tight">{t('title')}</h2>
        </div>
        <div role="group" aria-label={t('bucketLabel')} className="flex items-center gap-1 text-xs">
          {BUCKETS.map((b) => (
            <button
              key={b}
              type="button"
              data-bucket={b}
              aria-pressed={bucket === b}
              onClick={() => onBucket(b)}
              className={cn(
                'rounded-full px-2.5 py-1 font-medium',
                bucket === b
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {t(`bucket.${b}`)}
            </button>
          ))}
        </div>
      </div>
      <VolumeChart volume={volume} currency={currency} />
    </div>
  );
}
