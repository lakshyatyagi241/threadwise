import {
  WMIG_DRY_RUN_MAX_AGE_HOURS,
  WMIG_MAX_SCHEDULE_DAYS,
  WMIG_STEP_NAMES,
  WMIG_STEP_STATUSES,
  deriveClientKey,
  verdictOf,
  type WabooMigrationReport,
  type WabooMigrationStep,
} from '@crm/contracts';

/** Pure rules of the Waboo migration panel: the pipeline protocol, step bookkeeping, state moves, gates, batches and the verdict. */

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'blocked';
export type BatchStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type RunMode = 'dry' | 'load' | 'catchup';

/** What the worker moves a run through. A finished run never moves again. */
const MOVES: Record<RunStatus, readonly RunStatus[]> = {
  queued: ['running', 'cancelled', 'failed', 'blocked'],
  running: ['completed', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
  blocked: [],
};
export const canMove = (from: RunStatus, to: RunStatus): boolean => MOVES[from].includes(to);
export const isActive = (s: RunStatus): boolean => s === 'queued' || s === 'running';

export interface StepEvent {
  event: 'step';
  name: string;
  status: WabooMigrationStep['status'];
  counts: Record<string, number>;
  message: string | null;
}
export interface ReportEvent {
  event: 'report';
  green: boolean;
  unaccounted: number;
  integrityErrors: number;
  alarms: number;
  orgId: number | null;
  summary: string;
}
export type PipelineEvent = StepEvent | ReportEvent;

const MAX_MESSAGE = 500;
const MAX_LINE = 64 * 1024;

/** Removes anything that looks like a credential or personal data before text is stored, logged or returned. */
export function scrub(text: string): string {
  return text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]*:[^\s/@]*@\S+/gi, '[url]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [secret]')
    .replace(
      /\b(password|passwd|pwd|secret|token|api[_-]?key|authorization)(\s*[=:]\s*)\S+/gi,
      '$1$2[secret]',
    )
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[secret]')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/\+?\d[\d\s-]{8,}\d/g, '[number]');
}

const int = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
const text = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? scrub(v).slice(0, MAX_MESSAGE) : null;

/** One stdout line of the pipeline. Anything that is not a known JSON event is ignored (returns null). */
export function parseLine(line: string): PipelineEvent | null {
  const raw = line.trim();
  if (raw.length === 0 || raw.length > MAX_LINE || raw[0] !== '{') return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const r = o as Record<string, unknown>;
  if (r.event === 'step') {
    const name = r.name as string;
    const status = r.status as StepEvent['status'];
    if (!(WMIG_STEP_NAMES as readonly string[]).includes(name)) return null;
    if (!(WMIG_STEP_STATUSES as readonly string[]).includes(status)) return null;
    const counts: Record<string, number> = {};
    if (typeof r.counts === 'object' && r.counts !== null)
      for (const [k, v] of Object.entries(r.counts).slice(0, 50))
        if (typeof v === 'number' && Number.isFinite(v)) counts[k.slice(0, 60)] = v;
    return { event: 'step', name, status, counts, message: text(r.message) };
  }
  if (r.event === 'report') {
    if (typeof r.green !== 'boolean') return null;
    return {
      event: 'report',
      green: r.green,
      unaccounted: int(r.unaccounted),
      integrityErrors: int(r.integrityErrors),
      alarms: int(r.alarms),
      orgId:
        typeof r.orgId === 'number' && Number.isInteger(r.orgId) && r.orgId > 0 ? r.orgId : null,
      summary: text(r.summary) ?? '',
    };
  }
  return null;
}

/** Records a step event on the timeline: one entry per step name, in first-seen order. */
export function applyStep(
  steps: WabooMigrationStep[],
  ev: StepEvent,
  now: Date,
): WabooMigrationStep[] {
  const at = now.toISOString();
  const i = steps.findIndex((s) => s.name === ev.name);
  const prev = i >= 0 ? steps[i]! : null;
  const next: WabooMigrationStep = {
    name: ev.name,
    status: ev.status,
    startedAt: prev?.startedAt ?? (ev.status === 'skipped' ? null : at),
    finishedAt: ev.status === 'running' ? null : at,
    counts: { ...(prev?.counts ?? {}), ...ev.counts },
    message: ev.message ?? prev?.message ?? null,
  };
  return i >= 0 ? steps.map((s, k) => (k === i ? next : s)) : [...steps, next];
}

export interface LatestDry {
  status: RunStatus;
  green: boolean | null;
  finishedAt: Date | null;
}

export type GateFailure = 'confirm';
export type DryReason = 'ok' | 'no_dry' | 'not_green' | 'stale';

/**
 * Is the latest dry run of an organization good enough to load? It must have completed green (amber, i.e. green with alarms to
 * review, passes; red does not) and finished no more than 24 hours ago. Used at enqueue AND again by the worker right before start.
 */
export function dryReadiness(d: LatestDry | null, now: Date): DryReason {
  if (!d) return 'no_dry';
  if (d.status !== 'completed' || d.green !== true) return 'not_green';
  const maxAge = WMIG_DRY_RUN_MAX_AGE_HOURS * 3600_000;
  return d.finishedAt && now.getTime() - d.finishedAt.getTime() <= maxAge ? 'ok' : 'stale';
}

/**
 * A load needs the organization id typed again (the id or the derived client key is accepted). Returns what is missing, or null when the
 * load may start. A dry run always passes. A load and a catch-up need NO earlier dry run: the pipeline starts each of them with its own
 * full rehearsal (export if the dump is stale, preflight, the dry load) and stops before a single row is written when that is not clean.
 */
export function loadGate(input: {
  mode: RunMode;
  sourceClient: string;
  organizationId?: string;
  confirmClient: string | undefined;
}): GateFailure | null {
  if (input.mode === 'dry') return null;
  const c = input.confirmClient;
  if (c === undefined || (c !== input.sourceClient && c !== input.organizationId)) return 'confirm';
  return null;
}

/** The report stored on a run: the pipeline's numbers plus the verdict. ok = the process finished and the pipeline said green. */
export function buildReport(
  rep: Pick<ReportEvent, 'green' | 'unaccounted' | 'integrityErrors' | 'alarms' | 'summary'>,
  processOk: boolean,
): WabooMigrationReport {
  return {
    green: rep.green,
    verdict: verdictOf({
      ok: processOk && rep.green,
      unaccounted: rep.unaccounted,
      integrityErrors: rep.integrityErrors,
      alarms: rep.alarms,
    }),
    unaccounted: rep.unaccounted,
    integrityErrors: rep.integrityErrors,
    alarms: rep.alarms,
    summary: rep.summary,
  };
}

type StoredReport = Omit<WabooMigrationReport, 'verdict'> & {
  verdict?: WabooMigrationReport['verdict'];
};

/** Verdict shown for a run. A failed run is red; a run still going, cancelled or blocked has none. Old rows without one are recomputed. */
export function runVerdict(
  status: RunStatus,
  report: StoredReport | null,
): WabooMigrationReport['verdict'] | null {
  if (status === 'failed') return 'red';
  if (status !== 'completed' || !report) return null;
  return (
    report.verdict ??
    verdictOf({
      ok: report.green,
      unaccounted: report.unaccounted,
      integrityErrors: report.integrityErrors,
      alarms: report.alarms,
    })
  );
}

/** run_at must be in the future and at most 90 days ahead. */
export function validateRunAt(runAt: string | undefined, now: Date): 'past' | 'too_far' | null {
  if (runAt === undefined) return null;
  const t = new Date(runAt).getTime();
  if (!Number.isFinite(t) || t <= now.getTime()) return 'past';
  return t - now.getTime() > WMIG_MAX_SCHEDULE_DAYS * 86_400_000 ? 'too_far' : null;
}

/** BullMQ delay for a run_at (0 = now; a time that already passed fires at once). */
export const delayFor = (runAt: Date | null, now: Date): number =>
  runAt ? Math.max(0, runAt.getTime() - now.getTime()) : 0;

export type BatchPlan =
  | { ok: true; items: Array<{ organizationId: string; sourceClient: string }> }
  | { ok: false; reason: 'duplicate' | 'collision'; organizationId: string };

/** One client key per organization id; the same id twice, or two ids that slug to the same key, is refused. */
export function planBatch(organizationIds: readonly string[]): BatchPlan {
  const ids = new Set<string>();
  const keys = new Set<string>();
  const items: Array<{ organizationId: string; sourceClient: string }> = [];
  for (const organizationId of organizationIds) {
    if (ids.has(organizationId)) return { ok: false, reason: 'duplicate', organizationId };
    const sourceClient = deriveClientKey(organizationId);
    if (keys.has(sourceClient)) return { ok: false, reason: 'collision', organizationId };
    ids.add(organizationId);
    keys.add(sourceClient);
    items.push({ organizationId, sourceClient });
  }
  return { ok: true, items };
}

/** Final status of a batch from its children: cancelled stays cancelled; any failed or blocked child makes it failed. */
export function batchFinalStatus(
  current: BatchStatus,
  counts: Partial<Record<RunStatus, number>>,
): BatchStatus {
  if (current === 'cancelled') return 'cancelled';
  return (counts.failed ?? 0) + (counts.blocked ?? 0) > 0 ? 'failed' : 'completed';
}

/** Keeps the last `max` characters (the tail of stderr). */
export const tail = (s: string, max: number): string =>
  s.length > max ? s.slice(s.length - max) : s;

export interface PipelineResult {
  exitCode: number | null;
  timedOut: boolean;
  stderrTail: string;
  report: ReportEvent | null;
}

/**
 * How a finished pipeline process maps to the run's final state. "completed" means the pipeline ran to its report;
 * whether the data is clean is the report's verdict (green/amber/red), which is what the load gate reads.
 */
export function finalState(
  r: PipelineResult,
  timeoutMin: number,
): { status: 'completed' | 'failed'; error: string | null } {
  if (r.timedOut)
    return { status: 'failed', error: `The pipeline was stopped after ${timeoutMin} minutes.` };
  if (r.exitCode !== 0)
    return {
      status: 'failed',
      error: r.stderrTail || `The pipeline exited with code ${r.exitCode ?? 'unknown'}.`,
    };
  if (!r.report)
    return { status: 'failed', error: r.stderrTail || 'The pipeline ended without a report.' };
  return { status: 'completed', error: null };
}
