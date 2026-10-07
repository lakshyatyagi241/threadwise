'use client';

import { useTranslations } from 'next-intl';
import type { ChartData } from '../../lib/affiliate';

const W = 640;
const H = 240;
const PAD = { l: 36, r: 56, t: 10, b: 26 };
const MAX_TICKS = 10;

/** A round number at or above `max` for an axis top (1, 2, 2.5, 5 x 10^n). */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const base = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= max) return m * base;
  return 10 * base;
}

/**
 * Referrals per bucket as bars (left axis) with the credits earned as a line (right axis, in the platform currency). Drawn in
 * SVG from the colour tokens, no chart library; the same numbers are in a visually hidden table for screen readers.
 */
export function VolumeChart({
  data,
  label,
  formatMoney,
}: {
  data: ChartData;
  label: string;
  formatMoney: (minor: number) => string;
}) {
  const t = useTranslations('coupons-credits-referral-currency.affiliate.chart');
  const { labels, signups, creditsMinor } = data;
  const n = labels.length;
  const topSignups = niceMax(Math.max(...signups, 0));
  const topCredits = niceMax(Math.max(...creditsMinor, 0));
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const slot = plotW / Math.max(n, 1);
  const barW = Math.max(2, slot * 0.6);
  const every = Math.max(1, Math.ceil(n / MAX_TICKS));
  const yS = (v: number) => PAD.t + plotH - (v / topSignups) * plotH;
  const yC = (v: number) => PAD.t + plotH - (v / topCredits) * plotH;
  const cx = (i: number) => PAD.l + slot * i + slot / 2;
  const line = creditsMinor.map((v, i) => `${i === 0 ? 'M' : 'L'}${cx(i)},${yC(v)}`).join(' ');

  return (
    <figure className="m-0" dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={PAD.t + plotH * (1 - f)}
              y2={PAD.t + plotH * (1 - f)}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            <text
              x={PAD.l - 6}
              y={PAD.t + plotH * (1 - f) + 3}
              textAnchor="end"
              fontSize="10"
              fill="var(--muted-foreground)"
            >
              {Math.round(topSignups * f * 10) / 10}
            </text>
            <text
              x={W - PAD.r + 6}
              y={PAD.t + plotH * (1 - f) + 3}
              textAnchor="start"
              fontSize="10"
              fill="var(--muted-foreground)"
            >
              {formatMoney(Math.round(topCredits * f))}
            </text>
          </g>
        ))}
        {signups.map((v, i) =>
          v > 0 ? (
            <rect
              key={i}
              x={cx(i) - barW / 2}
              y={yS(v)}
              width={barW}
              height={PAD.t + plotH - yS(v)}
              rx={2}
              fill="var(--primary)"
              opacity={0.85}
            />
          ) : null,
        )}
        {n > 0 && (
          <path
            d={line}
            fill="none"
            stroke="var(--warning)"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {labels.map((l, i) =>
          i % every === 0 ? (
            <text
              key={i}
              x={cx(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize="10"
              fill="var(--muted-foreground)"
            >
              {l}
            </text>
          ) : null,
        )}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm bg-primary" aria-hidden="true" />
          {t('signups')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-warning" aria-hidden="true" />
          {t('credits')}
        </span>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{t('bucket')}</th>
            <th scope="col">{t('signups')}</th>
            <th scope="col">{t('credits')}</th>
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={i}>
              <th scope="row">{l}</th>
              <td>{signups[i] ?? 0}</td>
              <td>{formatMoney(creditsMinor[i] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
