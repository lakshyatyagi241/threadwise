'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  FLOW_RUN_LOG_MAX_STEPS,
  FLOW_RUN_LOG_RETENTION_DAYS,
  type FlowRunDetail,
  type FlowRunStep,
} from '@crm/contracts';
import { detailPairs } from '../lib/model';
import {
  formatMs,
  outcomeTone,
  pathOf,
  timelineRows,
  type TimelineFilter,
} from '../lib/timeline-model';
import { CARD, KICKER, useDateTime } from './parts';

const DOT: Record<ReturnType<typeof outcomeTone>, string> = {
  success: 'bg-success',
  danger: 'bg-danger',
  warning: 'bg-warning',
  neutral: 'bg-muted-foreground',
};
const TEXT: Record<ReturnType<typeof outcomeTone>, string> = {
  success: 'text-success',
  danger: 'text-danger',
  warning: 'text-warning',
  neutral: 'text-muted-foreground',
};

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className={KICKER}>{label}</div>
      <div className={`mt-1 text-2xl tabular-nums ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

function StepRow({ s, removed }: { s: FlowRunStep; removed: boolean }) {
  const t = useTranslations('flr');
  const when = useDateTime();
  const tone = outcomeTone(s.outcome);
  const title = s.nodeLabel ?? s.nodeId ?? t(`event.${s.event}`);
  const pairs = detailPairs(s.detail);
  return (
    <li className="relative pl-7">
      <span aria-hidden className={`absolute left-0 top-3 h-3 w-3 rounded-full ${DOT[tone]}`} />
      <details className="group rounded-xl border border-border bg-background open:bg-muted/40">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
          <span className="min-w-0 break-words text-sm font-semibold">{title}</span>
          {s.nodeType && (
            <span className="font-mono text-[11px] text-muted-foreground">{s.nodeType}</span>
          )}
          {removed && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10.5px] text-warning">
              {t('run.removed')}
            </span>
          )}
          <span className="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {s.outcome && (
              <span className={`font-semibold ${TEXT[tone]}`}>{t(`outcome.${s.outcome}`)}</span>
            )}
            {s.port !== null && <span>{t('run.exit', { port: s.port })}</span>}
            {s.attempt !== null && s.attempt > 1 && <span>{t('run.visit', { n: s.attempt })}</span>}
            {s.durationMs !== null && (
              <span className="tabular-nums">{formatMs(s.durationMs)}</span>
            )}
          </span>
        </summary>
        <div className="space-y-1.5 border-t border-border px-4 py-3 text-[12.5px]">
          <div className="text-muted-foreground">
            {when(s.at)} · {t.has(`event.${s.event}`) ? t(`event.${s.event}`) : s.event}
          </div>
          {s.summary && <p className="break-words">{s.summary}</p>}
          {s.error && <p className="break-words text-danger">{s.error}</p>}
          {pairs.map(([k, v]) => (
            <div key={k} className="break-words">
              <span className="text-muted-foreground">{k}:</span> {v}
            </div>
          ))}
        </div>
      </details>
    </li>
  );
}

/**
 * The run's execution timeline (TW-FLR-083): one row per node execution with its outcome, exit and time, the path through the flow, and
 * what changed since. The rows carry the node as it was when it ran, so editing the flow later never rewrites them.
 */
export function RunTimeline({ run }: { run: FlowRunDetail }) {
  const t = useTranslations('flr');
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const rows = timelineRows(run.log, filter);
  const removed = new Set(run.removedNodeIds);
  const path = pathOf(run);

  return (
    <section className={`${CARD} mb-5 overflow-hidden`}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <div className={KICKER}>{t('run.kicker')}</div>
          <h2 className="mt-0.5 text-xl leading-tight">{t('run.tlTitle')}</h2>
        </div>
        <div className="flex gap-1 rounded-full border border-border p-1 text-xs" role="group">
          {(['all', 'errors'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 font-semibold ${filter === f ? 'bg-brand text-brand-foreground' : 'hover:bg-muted'}`}
            >
              {f === 'all' ? t('run.filterAll') : t('run.filterErrors')}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 px-5 py-4">
        <Stat label={t('run.tlNodes')} value={run.nodeCount} />
        <Stat
          label={t('run.tlErrors')}
          value={run.errorCount}
          tone={run.errorCount > 0 ? 'text-danger' : ''}
        />
        <Stat label={t('run.tlTime')} value={formatMs(run.durationMs) || '0 ms'} />
      </div>

      {run.flowChanged && (
        <div
          className="mx-5 mb-4 rounded-lg border border-border bg-muted px-4 py-3 text-sm"
          role="status"
        >
          <div className="font-semibold">{t('run.changedTitle')}</div>
          <p className="text-muted-foreground">{t('run.changedBody')}</p>
        </div>
      )}

      {path.reached.length > 0 && (
        <div className="px-5 pb-4">
          <div className={`mb-2 ${KICKER}`}>{t('run.pathTitle')}</div>
          <ol className="flex flex-wrap items-center gap-1.5 text-xs">
            {path.reached.map((n, i) => (
              <li key={n.id} className="flex items-center gap-1.5">
                {i > 0 && (
                  <span aria-hidden className="text-muted-foreground">
                    ›
                  </span>
                )}
                <span
                  className={`rounded-full border px-2.5 py-1 ${n.removed ? 'border-warning text-warning' : 'border-border bg-muted font-semibold'}`}
                  title={n.type}
                >
                  {n.label}
                  {n.visits > 1 ? ` ×${n.visits}` : ''}
                </span>
              </li>
            ))}
          </ol>
          {path.unreached.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 text-[11px] text-muted-foreground">{t('run.notReached')}</div>
              <ul className="flex flex-wrap gap-1.5 text-xs">
                {path.unreached.map((n) => (
                  <li
                    key={n.id}
                    className="rounded-full border border-dashed border-border px-2.5 py-1 text-muted-foreground"
                    title={n.type}
                  >
                    {n.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          {run.log.length === 0 ? t('run.logEmpty') : t('run.noErrors')}
        </p>
      ) : (
        <ol className="relative space-y-2 px-5 pb-5 before:absolute before:bottom-8 before:left-[26px] before:top-4 before:w-px before:bg-border">
          {rows.map((s) => (
            <StepRow
              key={`${s.seq}-${s.event}-${s.at}`}
              s={s}
              removed={!!s.nodeId && removed.has(s.nodeId)}
            />
          ))}
        </ol>
      )}

      {run.logTruncated && (
        <p className="border-t border-border px-5 py-3 text-xs text-warning">
          {t('run.truncated', { max: FLOW_RUN_LOG_MAX_STEPS })}
        </p>
      )}
      <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
        {t('run.retention', { days: FLOW_RUN_LOG_RETENTION_DAYS })}
      </p>
    </section>
  );
}
