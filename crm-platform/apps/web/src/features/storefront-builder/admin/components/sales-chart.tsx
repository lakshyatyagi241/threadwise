'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { StoreOverview } from '@crm/contracts';
import { buildSalesChart, labelIndexes } from '../lib/chart';
import { formatInt } from '../lib/format';

const BOX = { width: 720, height: 260, left: 52, right: 40, top: 12, bottom: 44 };

/**
 * Revenue per day as columns (left axis) with the order count as a smooth line (right axis), 30 days. Drawn as plain
 * SVG: the numbers are also available to assistive technology as a table, and hovering a day reads it out.
 */
export function SalesChart({
  data,
  symbol,
}: {
  data: StoreOverview['salesByDay'];
  symbol: string;
}) {
  const t = useTranslations('storefront-builder.admin.dashboard');
  const locale = useLocale();
  const [active, setActive] = useState<number | null>(null);
  const model = useMemo(() => buildSalesChart(data.revenue, data.orders, BOX), [data]);
  const n = data.labels.length;
  const slot = n > 0 ? model.plot.width / n : 0;
  const compact = (v: number) =>
    new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const yFor = (value: number, top: number) =>
    model.plot.y + model.plot.height - (value / top) * model.plot.height;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-4" aria-hidden="true">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-primary" /> {t('legendRevenue', { symbol })}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded bg-warning" /> {t('legendOrders')}
          </span>
        </div>
        <div className="min-h-4 tabular-nums text-muted-foreground" aria-hidden="true">
          {active !== null && data.labels[active] !== undefined
            ? t('dayReadout', {
                day: data.labels[active]!,
                revenue: `${symbol}${formatInt(data.revenue[active] ?? 0, locale)}`,
                orders: data.orders[active] ?? 0,
              })
            : null}
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${BOX.width} ${BOX.height}`}
          className="h-auto w-full min-w-[560px]"
          role="img"
          aria-label={t('chartLabel')}
          onPointerLeave={() => setActive(null)}
        >
          {model.revenueTicks.map((v, i) => {
            const y = yFor(v, model.revenueTop);
            return (
              <g key={`rt${i}`}>
                <line
                  x1={model.plot.x}
                  x2={model.plot.x + model.plot.width}
                  y1={y}
                  y2={y}
                  className="stroke-border"
                  strokeWidth="1"
                />
                <text
                  x={model.plot.x - 6}
                  y={y + 3.5}
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px]"
                >
                  {compact(v)}
                </text>
              </g>
            );
          })}
          {model.ordersTicks.map((v, i) => (
            <text
              key={`ot${i}`}
              x={model.plot.x + model.plot.width + 6}
              y={yFor(v, model.ordersTop) + 3.5}
              textAnchor="start"
              className="fill-muted-foreground text-[10px]"
            >
              {compact(v)}
            </text>
          ))}

          {model.bars.map((b, i) => (
            <rect
              key={`b${i}`}
              x={b.x}
              y={b.y}
              width={b.width}
              height={b.height}
              rx={1.5}
              className={active === i ? 'fill-primary' : 'fill-primary/80'}
            />
          ))}
          <path
            d={model.linePath}
            fill="none"
            className="stroke-warning"
            strokeWidth="2"
            strokeLinecap="round"
          />
          {model.points.map((p, i) =>
            (data.orders[i] ?? 0) > 0 ? (
              <circle key={`p${i}`} cx={p.x} cy={p.y} r={2.5} className="fill-warning" />
            ) : null,
          )}

          {labelIndexes(n).map((i) => {
            const x = model.plot.x + slot * i + slot / 2;
            const y = model.plot.y + model.plot.height + 14;
            return (
              <text
                key={`x${i}`}
                x={x}
                y={y}
                textAnchor="end"
                transform={`rotate(-35 ${x} ${y})`}
                className="fill-muted-foreground text-[10px]"
              >
                {data.labels[i]}
              </text>
            );
          })}

          {Array.from({ length: n }, (_, i) => (
            <rect
              key={`h${i}`}
              x={model.plot.x + slot * i}
              y={model.plot.y}
              width={slot}
              height={model.plot.height}
              fill="transparent"
              onPointerEnter={() => setActive(i)}
            />
          ))}
        </svg>
      </div>

      <table className="sr-only">
        <caption>{t('chartLabel')}</caption>
        <thead>
          <tr>
            <th>{t('tableDay')}</th>
            <th>{t('tableRevenue', { symbol })}</th>
            <th>{t('tableOrders')}</th>
          </tr>
        </thead>
        <tbody>
          {data.labels.map((label, i) => (
            <tr key={label + i}>
              <td>{label}</td>
              <td>{data.revenue[i] ?? 0}</td>
              <td>{data.orders[i] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
