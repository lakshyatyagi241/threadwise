'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SETUP_RUN_STEPS, type SetupStatusResponse } from '@crm/contracts';
import { Alert, cn } from '@crm/ui';
import { runSetupStep } from './setup-api';
import {
  classifyFailure,
  railIndex,
  toRunRequest,
  type SetupFailure,
  type WizardDraft,
} from './setup-draft';
import { Cross, NS, StepHeader, Tick, labelClass, richTags } from './wizard-ui';
import { failureText } from './screens';

type RowState = {
  status: 'pending' | 'running' | 'done' | 'failed';
  duration: string | null;
  startedAt: number | null;
};

const fresh = (): RowState[] =>
  SETUP_RUN_STEPS.map(() => ({ status: 'pending', duration: null, startedAt: null }));

/** Milliseconds as Reference prints them: `420ms`, then seconds with one decimal. */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Overall percentage: finished rows plus half a row for the one running (Reference's formula). */
export function progressPercent(rows: ReadonlyArray<Pick<RowState, 'status'>>): number {
  const done = rows.filter((r) => r.status === 'done').length;
  const running = rows.filter((r) => r.status === 'running').length;
  return ((done + running * 0.5) / rows.length) * 100;
}

/**
 * The last screen (TW-INST-010): runs the six server steps one by one with live progress, timings and a retry from
 * the failed step. The server keeps the order and makes every step safe to repeat, so a retry, a double click or a
 * reload cannot create a second workspace.
 */
export function InstallRunScreen({
  draft,
  status,
  onFailure,
  onDone,
}: {
  draft: WizardDraft;
  status: SetupStatusResponse;
  onFailure: (f: SetupFailure) => void;
  onDone: () => void;
}) {
  const t = useTranslations(`${NS}.install`);
  const root = useTranslations(NS);
  const [rows, setRows] = useState<RowState[]>(fresh);
  const [error, setError] = useState<string | null>(null);
  const [allDone, setAllDone] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const started = useRef(false);

  const patch = (i: number, next: Partial<RowState>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...next } : r)));

  const runStep = useCallback(
    async (i: number): Promise<boolean> => {
      const begun = Date.now();
      patch(i, { status: 'running', startedAt: begun, duration: null });
      try {
        await runSetupStep(toRunRequest(draft, i + 1, status.licenceRequired));
        patch(i, { status: 'done', duration: formatDuration(Date.now() - begun) });
        return true;
      } catch (e) {
        const f = classifyFailure(e);
        // A finished install answers 409 to a repeated last step: the work is done, so this is success.
        if (f.kind === 'completed' && i === SETUP_RUN_STEPS.length - 1) {
          patch(i, { status: 'done', duration: formatDuration(Date.now() - begun) });
          return true;
        }
        patch(i, { status: 'failed', duration: null });
        if (f.kind === 'token' || f.kind === 'completed' || f.kind === 'disabled') onFailure(f);
        else setError(failureText(root, f) ?? root('problems.unknown'));
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, status.licenceRequired],
  );

  /** Runs the steps from `from` on, stopping at the first failure. Earlier rows are already done. */
  const start = useCallback(
    async (from: number) => {
      setError(null);
      for (let i = from; i < SETUP_RUN_STEPS.length; i++) {
        if (!(await runStep(i))) return;
      }
      setAllDone(true);
    },
    [runStep],
  );

  // Strict-mode double mount and re-renders must not start a second run.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start(0);
  }, [start]);

  const running = rows.findIndex((r) => r.status === 'running');
  useEffect(() => {
    if (running < 0) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [running]);
  const elapsed = `${(Math.max(0, now - (rows[running]?.startedAt ?? now)) / 1000).toFixed(1)}s`;

  useEffect(() => {
    if (!allDone) return;
    const timer = setTimeout(onDone, 1400);
    return () => clearTimeout(timer);
  }, [allDone, onDone]);

  /** Reference's "Retry from failed step": the failed row and every later one go back to pending. */
  const retry = () => {
    const failed = rows.findIndex((r) => r.status === 'failed');
    const from = failed === -1 ? 0 : failed;
    setRows((rs) =>
      rs.map((r, j) => (j >= from ? { status: 'pending', duration: null, startedAt: null } : r)),
    );
    void start(from);
  };

  const progress = progressPercent(rows);
  const activeName = running >= 0 ? SETUP_RUN_STEPS[running] : null;
  const label = allDone
    ? t('complete')
    : error
      ? t('failed')
      : activeName
        ? t(`rows.${activeName}.active`).replace('…', '')
        : t('preparing');

  return (
    <div className="space-y-5">
      <StepHeader
        eyebrow={t('eyebrow', { n: railIndex('install'), total: 7 })}
        title={t.rich('title', { ...richTags, app: root('brand') })}
        intro={t('intro')}
      />

      <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <span className={labelClass} aria-live="polite">
            {label}
          </span>
          <span className="font-mono text-[10.5px] font-semibold tabular-nums text-brand">
            {Math.round(progress)}%
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          className="h-1.5 w-full overflow-hidden rounded-full bg-border"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand to-primary transition-all duration-700 ease-out motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>

        <ol className="mt-5 space-y-1">
          {SETUP_RUN_STEPS.map((name, i) => {
            const row = rows[i]!;
            return (
              <li
                key={name}
                data-status={row.status}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors',
                  row.status === 'running' && 'bg-primary/15',
                  row.status === 'done' && 'bg-primary/10',
                  row.status === 'failed' && 'bg-danger/10',
                )}
              >
                <div className="grid size-5 shrink-0 place-items-center">
                  {row.status === 'pending' && (
                    <svg
                      className="size-4 text-muted-foreground/40"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      aria-hidden="true"
                    >
                      <circle cx="8" cy="8" r="6.5" />
                    </svg>
                  )}
                  {row.status === 'running' && (
                    <svg
                      className="size-4 animate-spin text-brand motion-reduce:animate-none"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" d="M14 8a6 6 0 1 1-6-6" />
                    </svg>
                  )}
                  {row.status === 'done' && <Tick className="size-4 text-brand" />}
                  {row.status === 'failed' && <Cross className="size-4 text-danger" />}
                </div>
                <span
                  className={cn(
                    'min-w-0 flex-1 text-[12.5px] transition-colors',
                    row.status === 'pending' && 'text-muted-foreground/70',
                    row.status === 'running' && 'font-semibold text-brand',
                    row.status === 'failed' && 'font-semibold text-danger',
                  )}
                >
                  {row.status === 'running' ? t(`rows.${name}.active`) : t(`rows.${name}.done`)}
                </span>
                <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                  {row.status === 'done' && row.duration}
                  {row.status === 'running' && <span className="text-brand">{elapsed}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {error && (
        <>
          <Alert tone="danger" className="rounded-2xl px-4 py-3">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em]">
              {t('paused')}
            </div>
            <p className="text-[12.5px] font-medium">{error}</p>
          </Alert>
          <button
            type="button"
            onClick={retry}
            className="h-11 w-full rounded-full bg-brand px-6 text-[13px] font-semibold text-brand-foreground shadow-sm transition hover:bg-primary"
          >
            {t('retry')}
          </button>
        </>
      )}

      {allDone && (
        <Alert
          tone="success"
          className="flex items-center gap-3 rounded-2xl px-4 py-3 text-[13px] font-semibold"
        >
          <Tick className="size-5" />
          {t('success')}
        </Alert>
      )}
    </div>
  );
}
