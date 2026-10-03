'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';

const NS = 'platform-payment-gateways.billing.common';
const W = 640;
const H = 240;
const PAD = { l: 44, r: 10, t: 10, b: 28 };

export interface ChartSeries {
  name: string;
  values: number[];
  /** A CSS colour, normally `var(--token)`. */
  color: string;
}

/** 0, 100, 250, 500, 1000...: a round top for the y axis. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

const compact = (n: number) =>
  new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** At most ~8 x labels, always including the first and the last. */
function labelIndexes(n: number): Set<number> {
  const step = Math.max(1, Math.ceil(n / 8));
  const out = new Set<number>();
  for (let i = 0; i < n; i += step) out.add(i);
  if (n > 0) out.add(n - 1);
  return out;
}

/** Area/line chart of one or more series over the same labels (WaDesk's "Daily charges & refunds"). */
export function TrendChart({
  labels,
  series,
  label,
}: {
  labels: string[];
  series: ChartSeries[];
  label: string;
}) {
  const t = useTranslations(NS);
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const show = labelIndexes(labels.length);
  const empty = series.every((s) => s.values.every((v) => v === 0));
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-[260px] w-full">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(max * f)}
              y2={y(max * f)}
              stroke="var(--border)"
              strokeDasharray={f === 0 ? undefined : '3 4'}
            />
            <text
              x={PAD.l - 6}
              y={y(max * f) + 3}
              textAnchor="end"
              fontSize="10"
              fill="var(--muted-foreground)"
            >
              {compact(max * f)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          show.has(i) ? (
            <text
              key={`${l}${i}`}
              x={x(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize="10"
              fill="var(--muted-foreground)"
            >
              {l}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          const pts = s.values.map((v, i) => `${x(i)},${y(v)}`);
          if (pts.length === 0) return null;
          const area = `${x(0)},${y(0)} ${pts.join(' ')} ${x(s.values.length - 1)},${y(0)}`;
          return (
            <g key={s.name}>
              <polygon points={area} fill={s.color} opacity="0.12" />
              <polyline
                points={pts.join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </g>
          );
        })}
      </svg>
      {empty && (
        <figcaption className="text-center text-xs text-muted-foreground">
          {t('chartEmpty')}
        </figcaption>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col" />
            {series.map((s) => (
              <th scope="col" key={s.name}>
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={`${l}${i}`}>
              <th scope="row">{l}</th>
              {series.map((s) => (
                <td key={s.name}>{s.values[i]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Stacked bars: the first series above the axis, the second drawn below it (new orders against cancellations). */
export function MotionBars({
  labels,
  up,
  down,
  upColor,
  downColor,
  label,
  upName,
  downName,
}: {
  labels: string[];
  up: number[];
  down: number[];
  upColor: string;
  downColor: string;
  label: string;
  upName: string;
  downName: string;
}) {
  const t = useTranslations(NS);
  const top = niceMax(Math.max(0, ...up));
  const bottom = niceMax(Math.max(0, ...down));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const zero = PAD.t + (ih * top) / (top + bottom);
  const unit = ih / (top + bottom);
  const slot = iw / Math.max(1, labels.length);
  const bw = Math.max(2, Math.min(24, slot * 0.6));
  const show = labelIndexes(labels.length);
  const empty = up.every((v) => v === 0) && down.every((v) => v === 0);
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-[260px] w-full">
        <line x1={PAD.l} x2={W - PAD.r} y1={zero} y2={zero} stroke="var(--border)" />
        <text
          x={PAD.l - 6}
          y={PAD.t + 8}
          textAnchor="end"
          fontSize="10"
          fill="var(--muted-foreground)"
        >
          {top}
        </text>
        <text
          x={PAD.l - 6}
          y={H - PAD.b}
          textAnchor="end"
          fontSize="10"
          fill="var(--muted-foreground)"
        >
          -{bottom}
        </text>
        {labels.map((l, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          return (
            <g key={`${l}${i}`}>
              <rect
                x={cx - bw / 2}
                y={zero - (up[i] ?? 0) * unit}
                width={bw}
                height={(up[i] ?? 0) * unit}
                fill={upColor}
                rx="2"
              />
              <rect
                x={cx - bw / 2}
                y={zero}
                width={bw}
                height={(down[i] ?? 0) * unit}
                fill={downColor}
                rx="2"
              />
              {show.has(i) && (
                <text
                  x={cx}
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
      {empty && (
        <figcaption className="text-center text-xs text-muted-foreground">
          {t('chartEmpty')}
        </figcaption>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">{upName}</th>
            <th scope="col">{downName}</th>
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={`${l}${i}`}>
              <th scope="row">{l}</th>
              <td>{up[i]}</td>
              <td>{down[i]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export interface DonutItem {
  label: string;
  value: number;
  color: string;
}

/** A donut with its legend; the legend carries the numbers, so colour is never the only signal. */
export function Donut({
  items,
  label,
  format,
}: {
  items: DonutItem[];
  label: string;
  format?: (v: number) => string;
}) {
  const t = useTranslations(NS);
  const total = items.reduce((a, i) => a + i.value, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg
        viewBox="0 0 140 140"
        role="img"
        aria-label={label}
        className="size-40 shrink-0 -rotate-90"
      >
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--muted)" strokeWidth="18" />
        {total > 0 &&
          items.map((i) => {
            const len = (i.value / total) * C;
            const dash = `${len} ${C - len}`;
            const el = (
              <circle
                key={i.label}
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={i.color}
                strokeWidth="18"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
      </svg>
      <ul className="min-w-40 flex-1 space-y-1.5 text-sm">
        {items.length === 0 && <li className="text-muted-foreground">{t('chartEmpty')}</li>}
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: i.color }} aria-hidden />
            <span className="flex-1">{i.label}</span>
            <span className="font-mono text-xs tabular-nums">
              {format ? format(i.value) : i.value}
              {total > 0 && (
                <span className="ms-1 text-muted-foreground">
                  ({Math.round((i.value / total) * 100)}%)
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Retention heat-map: each cell's shade follows its percentage. */
export function Heatmap({
  rows,
  monthLabel,
}: {
  rows: Array<{ label: string; size: number; cells: Array<number | null> }>;
  monthLabel: (k: number) => string;
}) {
  const cols = rows[0]?.cells.length ?? 0;
  return (
    <div className="thin-scrollbar overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th scope="col" className="py-1 pe-2 text-left font-medium" />
            {Array.from({ length: cols }, (_, k) => (
              <th scope="col" key={k} className="px-1 py-1 text-center font-mono font-medium">
                {monthLabel(k)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="whitespace-nowrap py-1 pe-2 text-left font-medium">
                {r.label} <span className="font-mono text-muted-foreground">({r.size})</span>
              </th>
              {r.cells.map((c, k) => (
                <td key={k} className="p-0.5">
                  <div
                    className={cn(
                      'rounded px-2 py-1.5 text-center font-mono tabular-nums',
                      c === null ? 'bg-muted/40 text-muted-foreground' : 'text-foreground',
                    )}
                    style={
                      c === null
                        ? undefined
                        : {
                            background: `color-mix(in srgb, var(--primary) ${Math.max(6, c)}%, transparent)`,
                          }
                    }
                  >
                    {c === null ? '' : `${c}%`}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const CHART_COLORS = [
  'var(--primary)',
  'var(--brand)',
  'var(--warning)',
  'var(--danger)',
  'var(--muted-foreground)',
  'var(--success)',
];
