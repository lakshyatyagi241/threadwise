'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { WabooMigrationRun, WabooMigrationStep } from '@crm/contracts';
import { Alert, Badge } from '@crm/ui';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

const STEP_TONE: Record<WabooMigrationStep['status'], Tone> = {
  done: 'success',
  failed: 'danger',
  running: 'warning',
  skipped: 'neutral',
};

/** What the status badge says. A run that finished with a red verdict is NEVER shown as plain "completed". */
export type StatusKey =
  WabooMigrationRun['status'] | 'scheduled' | 'completedRed' | 'completedReview';

export function statusKey(
  r: Pick<WabooMigrationRun, 'status' | 'verdict' | 'runAt'>,
  now = new Date(),
): StatusKey {
  if (r.status === 'completed' && r.verdict === 'red') return 'completedRed';
  if (r.status === 'completed' && r.verdict === 'amber') return 'completedReview';
  if (r.status === 'queued' && r.runAt && new Date(r.runAt).getTime() > now.getTime())
    return 'scheduled';
  return r.status;
}

export const statusTone = (k: StatusKey): Tone =>
  k === 'completed'
    ? 'success'
    : k === 'failed' || k === 'completedRed' || k === 'blocked'
      ? 'danger'
      : k === 'running' || k === 'completedReview'
        ? 'warning'
        : 'neutral';

export function StatusBadge({
  run,
}: {
  run: Pick<WabooMigrationRun, 'status' | 'verdict' | 'runAt'>;
}) {
  const ts = useTranslations('waboo-migration.status');
  const k = statusKey(run);
  return <Badge tone={statusTone(k)}>{ts(k)}</Badge>;
}

/** The verdict as a badge: green / review alarms (amber) / red. Nothing when the run has none yet. */
export function VerdictBadge({ verdict }: { verdict: WabooMigrationRun['verdict'] }) {
  const tv = useTranslations('waboo-migration.verdict');
  if (!verdict) return null;
  return (
    <Badge tone={verdict === 'green' ? 'success' : verdict === 'amber' ? 'warning' : 'danger'}>
      {tv(`short.${verdict}`)}
    </Badge>
  );
}

/** The step timeline of a run: each step's status and counts, live while the run is active. */
export function StepList({
  steps,
  compact = false,
}: {
  steps: WabooMigrationStep[];
  compact?: boolean;
}) {
  const t = useTranslations('waboo-migration.detail');
  const tstep = useTranslations('waboo-migration.step');
  const tss = useTranslations('waboo-migration.stepStatus');
  const format = useFormatter();
  if (steps.length === 0) return <p className="text-sm text-muted-foreground">{t('noSteps')}</p>;
  return (
    <ol className={compact ? 'flex flex-wrap gap-2' : 'space-y-2'}>
      {steps.map((s) => (
        <li
          key={s.name}
          className={
            compact
              ? 'rounded-md border border-border px-2 py-1'
              : 'rounded-md border border-border p-3'
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 text-sm font-medium">{tstep(s.name)}</span>
            <Badge tone={STEP_TONE[s.status]}>{tss(s.status)}</Badge>
          </div>
          {Object.keys(s.counts).length > 0 && (
            <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {Object.entries(s.counts).map(([k, v]) => (
                <div key={k} className="flex gap-1">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-mono">{format.number(v)}</dd>
                </div>
              ))}
            </dl>
          )}
          {s.message && !compact && (
            <p className="mt-2 text-xs text-muted-foreground">{s.message}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * The verifier result: the verdict with unaccounted, integrity errors and alarms. Red is a danger alert, amber says "review alarms"
 * (never hidden), green is success. A failed run without a report is red too.
 */
export function VerdictBlock({ run }: { run: WabooMigrationRun }) {
  const tv = useTranslations('waboo-migration.verdict');
  const format = useFormatter();
  if (!run.verdict) return null;
  const tone = run.verdict === 'green' ? 'success' : run.verdict === 'amber' ? 'warning' : 'danger';
  return (
    <Alert tone={tone} className="space-y-2">
      <p className="font-medium">{tv(run.verdict)}</p>
      {run.report && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {(['unaccounted', 'integrityErrors', 'alarms'] as const).map((k) => (
            <div key={k} className="flex gap-1">
              <dt>{tv(k)}</dt>
              <dd className="font-mono">{format.number(run.report![k])}</dd>
            </div>
          ))}
        </dl>
      )}
      {run.report?.summary && <p className="text-sm">{run.report.summary}</p>}
    </Alert>
  );
}
