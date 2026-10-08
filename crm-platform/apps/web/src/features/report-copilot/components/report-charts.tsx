'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { cn } from '@crm/ui';
import type { ChartBlock } from '../lib/blocks';
import { arcPath, axisModel, hasData, sliceModel, type AxisModel } from '../lib/chart-geometry';
import { formatExact, formatNumber, type NumberStyle } from '../lib/number-format';
import { colorAt } from '../lib/palette';

const W = 640;
const H = 260;
const PAD = { l: 52, r: 12, t: 12, b: 34 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;

/** A legend: one swatch (a square, with a distinct shape cue per series for readers who cannot tell the colours apart), name, and value. */
function Legend({ items }: { items: Array<{ name: string; color: string; note?: string }> }) {
  return (
    <ul
      className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
      data-testid="chart-legend"
    >
      {items.map((it) => (
        <li key={it.name} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-sm"
            style={{ backgroundColor: it.color }}
          />
          <span className="text-foreground">{it.name}</span>
          {it.note && <span className="tabular-nums">{it.note}</span>}
        </li>
      ))}
    </ul>
  );
}

function Tooltip({
  x,
  y,
  title,
  rows,
}: {
  x: number;
  y: number;
  title: string;
  rows: Array<{ color: string; name: string; value: string }>;
}) {
  const left = Math.min(Math.max(x, 12), 88);
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 min-w-32 -translate-x-1/2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs shadow-md"
      style={{ left: `${left}%`, top: `${y}%` }}
      data-testid="chart-tooltip"
    >
      <p className="mb-1 font-medium text-foreground">{title}</p>
      {rows.map((r) => (
        <p key={r.name} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span
              aria-hidden
              className="inline-block size-2 rounded-sm"
              style={{ backgroundColor: r.color }}
            />
            {r.name}
          </span>
          <span className="font-medium tabular-nums text-foreground">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Bar, line and area charts on one axis, with a hover read-out of every series at that label. */
function AxisChart({ chart, label }: { chart: ChartBlock; label: string }) {
  const t = useTranslations('report-copilot.chart');
  const locale = useLocale();
  const [hover, setHover] = useState<number | null>(null);
  const m: AxisModel = axisModel(chart);
  const style: NumberStyle = { unit: chart.unit, prefix: chart.prefix, suffix: chart.suffix };
  const n = m.labels.length;
  const slot = PLOT_W / Math.max(n, 1);
  const y = (v: number) => PAD.t + PLOT_H - ((v - m.lo) / (m.hi - m.lo)) * PLOT_H;
  const xMid = (i: number) => PAD.l + slot * i + slot / 2;
  const xLine = (i: number) => (n <= 1 ? PAD.l + PLOT_W / 2 : PAD.l + (i / (n - 1)) * PLOT_W);
  const every = Math.max(1, Math.ceil(n / 8));
  const isBar = chart.type === 'bar';
  const stacked = isBar && !!chart.stacked;
  const group = slot * 0.72;
  const barW = stacked ? group : group / Math.max(m.series.length, 1);
  const single = m.series.length === 1 && isBar && n <= 8;
  const zero = y(0);

  const rows = (i: number) =>
    m.series.map((s) => ({
      color: s.color,
      name: s.name,
      value: s.values[i] === null ? '–' : formatExact(s.values[i] as number, locale, style),
    }));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        className="h-auto w-full"
        onMouseLeave={() => setHover(null)}
      >
        {m.ticks.map((tv) => (
          <g key={tv}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(tv)}
              y2={y(tv)}
              stroke="var(--border)"
              strokeDasharray={tv === 0 ? undefined : '3 3'}
            />
            <text
              x={PAD.l - 6}
              y={y(tv) + 3}
              textAnchor="end"
              fontSize="10"
              fill="var(--muted-foreground)"
            >
              {formatNumber(tv, locale, { prefix: chart.prefix }, { compact: true })}
            </text>
          </g>
        ))}
        {chart.yLabel && (
          <text
            x={12}
            y={PAD.t + PLOT_H / 2}
            fontSize="10"
            fill="var(--muted-foreground)"
            textAnchor="middle"
            transform={`rotate(-90 12 ${PAD.t + PLOT_H / 2})`}
          >
            {chart.yLabel}
          </text>
        )}

        {isBar &&
          m.labels.map((l, i) => {
            const x0 = PAD.l + slot * i + (slot - group) / 2;
            let pos = 0;
            let neg = 0;
            return (
              <g key={`${l}-${i}`} opacity={hover === null || hover === i ? 1 : 0.55}>
                {m.series.map((s, k) => {
                  const v = s.values[i];
                  if (v === null || v === undefined) return null;
                  const color = single ? colorAt(i) : s.color;
                  let top: number;
                  let bottom: number;
                  if (stacked) {
                    const from = v >= 0 ? pos : neg;
                    if (v >= 0) pos += v;
                    else neg += v;
                    top = y(Math.max(from, from + v));
                    bottom = y(Math.min(from, from + v));
                  } else {
                    top = y(Math.max(0, v));
                    bottom = y(Math.min(0, v));
                  }
                  const h = Math.max(bottom - top, v === 0 ? 0 : 2);
                  return (
                    <rect
                      key={s.name}
                      x={stacked ? x0 : x0 + barW * k + 1}
                      y={top}
                      width={Math.max(barW - 2, 2)}
                      height={h}
                      rx="3"
                      fill={color}
                      stroke="var(--background)"
                      strokeWidth="1"
                    />
                  );
                })}
              </g>
            );
          })}

        {!isBar && (
          <>
            {m.series.map((s) => {
              const pts = s.values.map((v, i) => (v === null ? null : ([xLine(i), y(v)] as const)));
              const segments: Array<Array<readonly [number, number]>> = [[]];
              for (const p of pts) {
                if (p === null) segments.push([]);
                else segments[segments.length - 1]!.push(p);
              }
              return (
                <g key={s.name}>
                  {segments
                    .filter((seg) => seg.length > 0)
                    .map((seg, si) => {
                      const d = seg
                        .map(
                          (p, k) => `${k === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`,
                        )
                        .join(' ');
                      return (
                        <g key={si}>
                          {chart.type === 'area' && seg.length > 1 && (
                            <path
                              d={`${d} L ${seg[seg.length - 1]![0].toFixed(1)} ${zero} L ${seg[0]![0].toFixed(1)} ${zero} Z`}
                              fill={s.color}
                              opacity="0.18"
                            />
                          )}
                          <path
                            d={d}
                            fill="none"
                            stroke={s.color}
                            strokeWidth="2"
                            strokeLinejoin="round"
                            strokeLinecap="round"
                          />
                        </g>
                      );
                    })}
                  {n <= 24 &&
                    pts.map((p, i) =>
                      p === null ? null : (
                        <circle
                          key={i}
                          cx={p[0]}
                          cy={p[1]}
                          r={hover === i ? 5 : 3.5}
                          fill={s.color}
                          stroke="var(--background)"
                          strokeWidth="2"
                        />
                      ),
                    )}
                </g>
              );
            })}
          </>
        )}

        {m.labels.map((l, i) =>
          i % every === 0 ? (
            <text
              key={`${l}-${i}`}
              x={isBar ? xMid(i) : xLine(i)}
              y={H - 12}
              textAnchor="middle"
              fontSize="10"
              fill="var(--muted-foreground)"
            >
              {l.length > 14 ? `${l.slice(0, 13)}…` : l}
            </text>
          ) : null,
        )}
        {chart.xLabel && (
          <text
            x={PAD.l + PLOT_W / 2}
            y={H - 1}
            textAnchor="middle"
            fontSize="10"
            fill="var(--muted-foreground)"
          >
            {chart.xLabel}
          </text>
        )}

        {hover !== null && !isBar && (
          <line
            x1={xLine(hover)}
            x2={xLine(hover)}
            y1={PAD.t}
            y2={PAD.t + PLOT_H}
            stroke="var(--border)"
          />
        )}
        {/* hit areas are whole columns, much larger than the marks */}
        {m.labels.map((l, i) => (
          <rect
            key={`hit-${l}-${i}`}
            x={isBar ? PAD.l + slot * i : xLine(i) - (n <= 1 ? PLOT_W : PLOT_W / (n - 1)) / 2}
            y={PAD.t}
            width={isBar ? slot : n <= 1 ? PLOT_W : PLOT_W / (n - 1)}
            height={PLOT_H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
          />
        ))}
      </svg>
      {hover !== null && (
        <Tooltip
          x={((isBar ? xMid(hover) : xLine(hover)) / W) * 100}
          y={4}
          title={m.labels[hover] ?? ''}
          rows={rows(hover)}
        />
      )}
      {m.series.length > 1 || single ? (
        <Legend
          items={
            single
              ? m.labels.map((l, i) => ({ name: l, color: colorAt(i) }))
              : m.series.map((s) => ({ name: s.name, color: s.color }))
          }
        />
      ) : null}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{t('category')}</th>
            {m.series.map((s) => (
              <th key={s.name} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {m.labels.map((l, i) => (
            <tr key={`${l}-${i}`}>
              <th scope="row">{l}</th>
              {m.series.map((s) => (
                <td key={s.name}>
                  {s.values[i] === null ? '' : formatExact(s.values[i] as number, locale, style)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Pie and donut: one slice per point of the first series, with a legend that carries each value and share. */
function SliceChart({ chart, label }: { chart: ChartBlock; label: string }) {
  const t = useTranslations('report-copilot.chart');
  const locale = useLocale();
  const [hover, setHover] = useState<number | null>(null);
  const style: NumberStyle = { unit: chart.unit, prefix: chart.prefix, suffix: chart.suffix };
  const { slices, total } = sliceModel(chart, t('other'));
  const donut = chart.type === 'donut';
  const R = 100;
  const pct = (s: number) =>
    `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(s * 100)}%`;
  if (slices.length === 0)
    return <p className="py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>;
  const active = hover === null ? null : slices[hover];

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative size-48 shrink-0">
        <svg
          viewBox="0 0 220 220"
          role="img"
          aria-label={label}
          className="size-full"
          onMouseLeave={() => setHover(null)}
        >
          {slices.map((s, i) => (
            <path
              key={s.label}
              d={arcPath(110, 110, hover === i ? R + 6 : R, donut ? 58 : 0, s.start, s.end)}
              fill={s.color}
              stroke="var(--background)"
              strokeWidth="2"
              onMouseEnter={() => setHover(i)}
            />
          ))}
          {donut && (
            <>
              <text
                x="110"
                y="106"
                textAnchor="middle"
                fontSize="11"
                fill="var(--muted-foreground)"
              >
                {active ? active.label : t('total')}
              </text>
              <text
                x="110"
                y="126"
                textAnchor="middle"
                fontSize="16"
                fontWeight="600"
                fill="var(--foreground)"
              >
                {formatNumber(active ? active.value : total, locale, style)}
              </text>
            </>
          )}
        </svg>
        {!donut && active && (
          <Tooltip
            x={50}
            y={0}
            title={active.label}
            rows={[
              {
                color: active.color,
                name: pct(active.share),
                value: formatExact(active.value, locale, style),
              },
            ]}
          />
        )}
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5 self-stretch text-sm" data-testid="chart-legend">
        {slices.map((s, i) => (
          <li
            key={s.label}
            className={cn(
              'grid grid-cols-[1fr_auto_auto] items-center gap-x-3',
              hover === i && 'font-medium',
            )}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="inline-block size-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: s.color }}
              />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="text-end tabular-nums">{formatExact(s.value, locale, style)}</span>
            <span className="min-w-12 text-end tabular-nums text-muted-foreground">
              {pct(s.share)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Any chart block. Data that cannot be drawn gets a plain message, never a blank plot or "NaN". */
export function ReportChart({ chart }: { chart: ChartBlock }) {
  const t = useTranslations('report-copilot.chart');
  const label = chart.title ?? t('chart');
  if (!hasData(chart))
    return <p className="py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>;
  return chart.type === 'pie' || chart.type === 'donut' ? (
    <SliceChart chart={chart} label={label} />
  ) : (
    <AxisChart chart={chart} label={label} />
  );
}
