'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { barLength, compact, heatLevel, niceMax } from '../lib/format';

/**
 * The chart layer (TW-DASH-052): small SVG and CSS charts drawn from the page's colour tokens (so light, dark and a
 * re-branded theme all recolour them), each with a text alternative that Reference's charts lacked, and an empty state
 * instead of an error. No chart library: the API already returns chart-ready series.
 */

export interface Series {
  name: string;
  values: number[];
  /** A CSS colour, normally `var(--token)`. */
  color: string;
}

const W = 640;
const H = 220;
const PAD = { l: 40, r: 8, t: 8, b: 26 };

/** Grouped bars: one cluster per label, one bar per series. */
export function BarChart({
  labels,
  series,
  label,
  stacked = false,
}: {
  labels: string[];
  series: Series[];
  /** The accessible name of the chart. */
  label: string;
  stacked?: boolean;
}) {
  const t = useTranslations('dashboards-analytics-charts.chart');
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const rawMax = stacked ? Math.max(...totals, 0) : Math.max(...series.flatMap((s) => s.values), 0);
  const top = niceMax(rawMax);
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const slot = plotW / Math.max(labels.length, 1);
  const group = slot * 0.7;
  const bar = stacked ? group : group / Math.max(series.length, 1);
  const every = Math.max(1, Math.ceil(labels.length / 8));
  const y = (v: number) => PAD.t + plotH - barLength(v, top, plotH);

  if (rawMax === 0)
    return <p className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
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
              {compact(top * f)}
            </text>
          </g>
        ))}
        {labels.map((l, i) => {
          const x0 = PAD.l + slot * i + (slot - group) / 2;
          let acc = 0;
          return (
            <g key={`${l}-${i}`}>
              {series.map((s, k) => {
                const v = s.values[i] ?? 0;
                const h = barLength(v, top, plotH);
                const base = stacked ? acc : 0;
                if (stacked) acc += v;
                const x = stacked ? x0 : x0 + bar * k;
                const yy = stacked ? y(base + v) : y(v);
                const hh = stacked
                  ? barLength(base + v, top, plotH) - barLength(base, top, plotH)
                  : h;
                return (
                  <rect
                    key={s.name}
                    x={x}
                    y={yy}
                    width={Math.max(bar - 1, 1)}
                    height={hh}
                    rx="2"
                    fill={s.color}
                  >
                    <title>{`${l} · ${s.name}: ${v}`}</title>
                  </rect>
                );
              })}
              {i % every === 0 && (
                <text
                  x={PAD.l + slot * i + slot / 2}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--muted-foreground)"
                >
                  {l}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <Legend series={series} />
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{t('bucket')}</th>
            {series.map((s) => (
              <th key={s.name} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={`${l}-${i}`}>
              <th scope="row">{l}</th>
              {series.map((s) => (
                <td key={s.name}>{s.values[i] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function Legend({
  series,
}: {
  series: Array<Pick<Series, 'name' | 'color'> & { total?: number }>;
}) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-sm"
            style={{ backgroundColor: s.color }}
          />
          {s.name}
          {s.total !== undefined && (
            <span className="font-medium tabular-nums text-foreground">{compact(s.total)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A small area-less bar sparkline; zeros draw as a flat line, never an error. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const top = Math.max(...values, 1);
  const w = 100 / Math.max(values.length, 1);
  return (
    <svg
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="h-8 w-full"
    >
      {values.map((v, i) => {
        const h = Math.max(1, (v / top) * 22);
        return (
          <rect
            key={i}
            x={i * w + 0.5}
            y={24 - h}
            width={w - 1}
            height={h}
            fill={v >= 10 ? 'var(--success)' : 'var(--primary)'}
            opacity={v === 0 ? 0.3 : 1}
          />
        );
      })}
    </svg>
  );
}

/** Part-to-whole as a ring with a legend (TW-DASH-024 delivery rates, TW-DASH-027 types). */
export function Donut({
  slices,
  label,
  empty,
}: {
  slices: Array<{ name: string; value: number; color: string }>;
  label: string;
  empty: string;
}) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (total === 0) return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  const ends = slices.map((_, i) => slices.slice(0, i + 1).reduce((x, y) => x + y.value, 0));
  const stops = slices
    .map(
      (s, i) => `${s.color} ${((ends[i]! - s.value) / total) * 100}% ${(ends[i]! / total) * 100}%`,
    )
    .join(', ');
  return (
    <div className="flex items-center gap-5">
      <div
        role="img"
        aria-label={label}
        className="relative size-28 shrink-0 rounded-full"
        style={{ background: `conic-gradient(${stops})` }}
      >
        <div className="absolute inset-[22%] rounded-full bg-background" />
      </div>
      <ul className="space-y-1 text-sm">
        {slices.map((s) => (
          <li key={s.name} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block size-2.5 rounded-sm"
              style={{ backgroundColor: s.color }}
            />
            <span>{s.name}</span>
            <span className="tabular-nums text-muted-foreground">
              {Math.round((s.value / total) * 1000) / 10}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const HEAT = ['bg-muted', 'bg-primary/20', 'bg-primary/40', 'bg-primary/65', 'bg-primary'] as const;

/** Weekday by hour, darker is busier, scaled to the busiest cell. */
export function Heatmap({
  grid,
  dayLabels,
  label,
}: {
  grid: number[][];
  dayLabels: string[];
  label: string;
}) {
  const t = useTranslations('dashboards-analytics-charts.chart');
  const max = Math.max(...grid.flat(), 0);
  return (
    <div className="overflow-x-auto">
      <div
        role="img"
        aria-label={label}
        className="grid min-w-[34rem] gap-0.5"
        style={{ gridTemplateColumns: 'auto repeat(24, minmax(0, 1fr))' }}
      >
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="text-center text-[10px] text-muted-foreground">
            {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
          </span>
        ))}
        {grid.map((row, d) => (
          <div key={d} className="contents">
            <span className="pe-2 text-xs text-muted-foreground">{dayLabels[d]}</span>
            {row.map((v, h) => (
              <span
                key={h}
                title={t('cell', {
                  day: dayLabels[d] ?? '',
                  hour: String(h).padStart(2, '0'),
                  count: v,
                })}
                className={cn('aspect-square rounded-[3px]', HEAT[heatLevel(v, max)])}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
