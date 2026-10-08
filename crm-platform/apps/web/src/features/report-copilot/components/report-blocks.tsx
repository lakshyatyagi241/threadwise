'use client';

import { useLocale, useTranslations } from 'next-intl';
import { createContext, useContext } from 'react';
import type { ReportScope, ReportWindow } from '@crm/contracts';
import { cn } from '@crm/ui';
import { useLiveAnalytics, useLiveOverview, useLiveSummary, useLiveWidgets } from '../api/hooks';
import {
  SHOW_CHART,
  SHOW_KPIS,
  SHOW_SUMMARY,
  SHOW_TABLE,
  type Block,
  sourcesOf,
  type Kpi,
} from '../lib/blocks';
import {
  analyticsDaysFor,
  dashRangeFor,
  isLiveKey,
  liveSourceOf,
  liveUnitOf,
  readLive,
} from '../lib/live';
import { formatDelta, formatNumber } from '../lib/number-format';
import { RC_CSS } from '../lib/palette';
import { ReportChart } from './report-charts';
import { SafeMarkdown } from './safe-markdown';

/** The scope and period of the page the blocks are on, for the figures that are bound to live numbers. */
export const LiveContext = createContext<{ scope: ReportScope; window: ReportWindow }>({
  scope: 'workspace',
  window: '30d',
});

const TONE = {
  good: { cls: 'text-success', glyph: '▲' },
  bad: { cls: 'text-danger', glyph: '▼' },
  neutral: { cls: 'text-muted-foreground', glyph: '■' },
} as const;

/** Colour variables for the charts. Rendered once per report; the CSS is tiny and identical each time. */
export function ReportColors() {
  return <style>{RC_CSS}</style>;
}

function Caption({ sources }: { sources: readonly string[] | undefined }) {
  const t = useTranslations('report-copilot.blocks');
  const list = (sources ?? []).filter(Boolean);
  return (
    <p className="mt-2 text-xs text-muted-foreground" data-testid="block-source">
      {list.length > 0 ? t('source', { sources: list.join(', ') }) : t('noSource')}
    </p>
  );
}

/**
 * A figure bound to a live number. It reads the same API hooks the Dashboard (or the operator overview) uses, so it is the number
 * those screens show right now, and it refreshes while the report is open. Until it loads, or when the key is not one the screen can
 * show for this scope or window, the figure the model wrote stays: nothing is guessed.
 */
function LiveValue({ kpi, fallback }: { kpi: Kpi; fallback: string }) {
  const t = useTranslations('report-copilot.blocks');
  const locale = useLocale();
  const { scope, window } = useContext(LiveContext);
  const source = liveSourceOf(scope, kpi.live);
  const summary = useLiveSummary(source === 'summary' ? dashRangeFor(window) : null);
  const widgets = useLiveWidgets(source === 'widgets');
  const overview = useLiveOverview(source === 'overview' ? window : null);
  const analytics = useLiveAnalytics(source === 'analytics' ? analyticsDaysFor(window) : null);
  const value = readLive(scope, kpi.live, {
    summary: summary.data,
    widgets: widgets.data,
    overview: overview.data,
    analytics: analytics.data,
  });
  if (value === null || !kpi.live) return <>{fallback}</>;
  const kind = liveUnitOf(scope, kpi.live);
  const style = {
    prefix: kpi.prefix,
    suffix: kpi.suffix,
    unit:
      kpi.unit ??
      (kind === 'percent'
        ? '%'
        : kind === 'money'
          ? (overview.data?.currency ?? analytics.data?.currency)
          : undefined),
  };
  return (
    <>
      {formatNumber(value, locale, style)}
      <span
        className="ms-1.5 align-middle text-[10px] font-medium uppercase tracking-wide text-success"
        title={t('liveHint')}
      >
        {t('live')}
      </span>
    </>
  );
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const t = useTranslations('report-copilot.blocks');
  const { scope } = useContext(LiveContext);
  const locale = useLocale();
  const tone = TONE[kpi.tone ?? 'neutral'];
  const delta = formatDelta(kpi.delta, locale);
  const text = formatNumber(kpi.value, locale, kpi);
  return (
    <div
      className="break-inside-avoid space-y-1 rounded-md border border-border p-3"
      data-testid="report-kpi"
    >
      <p className="text-xs text-muted-foreground">{kpi.label}</p>
      <p className="text-xl font-semibold tabular-nums">
        {isLiveKey(scope, kpi.live) ? <LiveValue kpi={kpi} fallback={text} /> : text}
      </p>
      {delta && (
        <p className={cn('flex items-center gap-1 text-xs font-medium', tone.cls)}>
          <span aria-hidden>{tone.glyph}</span>
          <span className="sr-only">{t(`tone.${kpi.tone ?? 'neutral'}`)}</span>
          {delta}
        </p>
      )}
    </div>
  );
}

function TableView({
  columns,
  rows,
}: {
  columns: string[];
  rows: Array<Array<string | number | null>>;
}) {
  const locale = useLocale();
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((c, i) => (
              <th key={i} scope="col" className="px-2 py-1.5 text-start font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-border last:border-0 even:bg-muted/40">
              {columns.map((_, c) => {
                const v = row[c];
                return (
                  <td
                    key={c}
                    className={cn('px-2 py-1.5', typeof v === 'number' && 'text-end tabular-nums')}
                  >
                    {typeof v === 'number'
                      ? formatNumber(v, locale, {}, { compact: false })
                      : (v ?? '')}
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

/** One block of a report, with its title and the sources its figures came from. */
export function BlockView({ block }: { block: Block }) {
  const body = (() => {
    switch (block.tool) {
      case SHOW_SUMMARY:
        return (
          <>
            {block.data.title && <h3 className="text-base font-semibold">{block.data.title}</h3>}
            <SafeMarkdown source={block.data.markdown} />
          </>
        );
      case SHOW_KPIS:
        return (
          <>
            {block.data.title && <h3 className="text-sm font-semibold">{block.data.title}</h3>}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {block.data.items.map((k, i) => (
                <KpiCard key={i} kpi={k} />
              ))}
            </div>
          </>
        );
      case SHOW_CHART:
        return (
          <>
            {block.data.title && <h3 className="text-sm font-semibold">{block.data.title}</h3>}
            <ReportChart chart={block.data} />
          </>
        );
      case SHOW_TABLE:
        return (
          <>
            {block.data.title && <h3 className="text-sm font-semibold">{block.data.title}</h3>}
            <TableView columns={block.data.columns} rows={block.data.rows} />
          </>
        );
    }
  })();
  return (
    <section className="rc break-inside-avoid space-y-2" data-testid={`block-${block.tool}`}>
      {body}
      <Caption sources={sourcesOf(block)} />
    </section>
  );
}

/** The whole report: its blocks in the order the assistant showed them. */
export function BlocksCanvas({ blocks }: { blocks: readonly Block[] }) {
  return (
    <article className="rc space-y-5" data-testid="report-blocks">
      <ReportColors />
      {blocks.map((b) => (
        <BlockView key={b.id} block={b} />
      ))}
    </article>
  );
}
