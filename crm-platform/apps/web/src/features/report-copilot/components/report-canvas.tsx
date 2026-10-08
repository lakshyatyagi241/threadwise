import { useLocale, useTranslations } from 'next-intl';
import type { ReportChart, ReportSpec, ReportTable } from '@crm/contracts';
import { cn } from '@crm/ui';
import { compact } from '@/features/dashboards-analytics-charts/lib/format';
import {
  BarChart,
  Donut,
  LineChart,
} from '@/features/dashboards-analytics-charts/components/charts';
import { toAxisChart, toPieSlices } from '../lib/chart-model';
import { SafeMarkdown } from './safe-markdown';

const TONE = {
  good: 'text-success',
  bad: 'text-danger',
  neutral: 'text-muted-foreground',
} as const;

function ChartBlock({ chart }: { chart: ReportChart }) {
  const t = useTranslations('report-copilot.report');
  const empty = useTranslations('dashboards-analytics-charts.chart')('empty');
  const label = chart.title ?? t('chart');
  const body = (() => {
    if (chart.type === 'pie') {
      const slices = toPieSlices(chart);
      return <Donut slices={slices} label={label} empty={empty} />;
    }
    const { labels, series } = toAxisChart(chart);
    return chart.type === 'line' ? (
      <LineChart labels={labels} series={series} label={label} format={compact} />
    ) : (
      <BarChart labels={labels} series={series} label={label} />
    );
  })();
  return (
    <figure className="m-0 space-y-1 break-inside-avoid">
      {chart.title && <figcaption className="text-sm font-medium">{chart.title}</figcaption>}
      {(chart.xLabel || chart.yLabel) && (
        <p className="text-xs text-muted-foreground">
          {[chart.yLabel, chart.xLabel].filter(Boolean).join(' / ')}
        </p>
      )}
      {body}
    </figure>
  );
}

function TableBlock({ table }: { table: ReportTable }) {
  const locale = useLocale();
  return (
    <div className="overflow-x-auto break-inside-avoid">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-start">
            {table.columns.map((c, i) => (
              <th key={i} scope="col" className="px-2 py-1.5 text-start font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r} className="border-b border-border last:border-0">
              {table.columns.map((_, c) => {
                const v = row[c];
                return (
                  <td
                    key={c}
                    className={cn('px-2 py-1.5', typeof v === 'number' && 'tabular-nums')}
                  >
                    {typeof v === 'number' ? v.toLocaleString(locale) : (v ?? '')}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Draws a validated report: title, summary, key figures, sections (markdown body, chart, table) and sources. It takes a
 * `ReportSpec` that already passed `reportSpecSchema`, and renders every string as text.
 */
export function ReportCanvas({ spec }: { spec: ReportSpec }) {
  const t = useTranslations('report-copilot.report');
  return (
    <article className="space-y-5" data-testid="report-canvas">
      <header className="space-y-2">
        <h2 className="font-serif text-2xl leading-tight">{spec.title}</h2>
        {spec.summary && (
          <p className="text-sm leading-relaxed text-muted-foreground">{spec.summary}</p>
        )}
      </header>

      {spec.kpis.length > 0 && (
        <section aria-label={t('keyFigures')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {spec.kpis.map((k, i) => (
            <div
              key={i}
              className="break-inside-avoid space-y-1 rounded-md border border-border p-3"
              data-testid="report-kpi"
            >
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="text-xl font-semibold tabular-nums">{k.value}</p>
              {k.delta && <p className={cn('text-xs', TONE[k.tone ?? 'neutral'])}>{k.delta}</p>}
            </div>
          ))}
        </section>
      )}

      {spec.sections.map((s, i) => (
        <section key={i} className="space-y-3">
          <h3 className="text-base font-semibold">{s.heading}</h3>
          {s.body.trim() && <SafeMarkdown source={s.body} />}
          {s.chart && <ChartBlock chart={s.chart} />}
          {s.table && <TableBlock table={s.table} />}
        </section>
      ))}

      {spec.sources.length > 0 && (
        <section className="space-y-1 border-t border-border pt-3">
          <h3 className="text-sm font-semibold">{t('sources')}</h3>
          <ul className="list-disc space-y-0.5 ps-5 text-xs text-muted-foreground">
            {spec.sources.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
