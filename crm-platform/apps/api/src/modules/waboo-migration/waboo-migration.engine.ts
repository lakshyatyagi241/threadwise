import type { WabooMigrationReport, WabooMigrationStep } from '@crm/contracts';
import type { Runner } from './runner';
import {
  applyStep,
  buildReport,
  finalState,
  scrub,
  type BatchStatus,
  type LatestDry,
  type PipelineResult,
  type RunMode,
  type StepEvent,
} from './waboo-migration.rules';

/**
 * The execution logic of the panel, written against small store interfaces so the sequencing, the pre-start dry-run gate, batch
 * stop-on-failure and the recovery sweep are unit-tested without a database. The service implements the stores with SQL.
 * Safety: nothing here connects WhatsApp or writes to Waboo; the only side effect is the Runner (the pipeline process).
 */

export interface RunHead {
  id: number;
  uuid: string;
  sourceClient: string;
  sourceDb: string;
  mode: RunMode;
  /** testing switch: leave the WhatsApp number out */
  skipWhatsapp: boolean;
  status: string;
  /** the steps saved so far (a resumed run starts from them) */
  steps?: WabooMigrationStep[];
}

export interface Finish {
  status: 'completed' | 'failed';
  error: string | null;
  report: WabooMigrationReport | null;
  orgId: number | null;
}

export interface ExecStore {
  peek(uuid: string): Promise<RunHead | null>;
  latestDry(sourceClient: string): Promise<LatestDry | null>;
  /** queued -> blocked, with the reason. Only touches a queued run. */
  block(uuid: string, reason: string): Promise<void>;
  /** queued -> running. 'busy' when another run is running (the one-running-run rule); null when it is no longer queued. */
  begin(uuid: string): Promise<RunHead | 'busy' | null>;
  saveSteps(id: number, steps: WabooMigrationStep[]): Promise<void>;
  finish(id: number, f: Finish): Promise<void>;
}

export type ExecOutcome = 'completed' | 'red' | 'failed' | 'blocked' | 'skipped' | 'busy';

/**
 * A step event the saved steps already show. A resumed follower replays the job's events from the start; those are skipped, so the
 * steps keep the times they were first written with (applyStep would move a finished step's finish time to the resume).
 */
const alreadyApplied = (prev: WabooMigrationStep | undefined, ev: StepEvent): boolean =>
  prev !== undefined &&
  prev.status === ev.status &&
  (ev.message ?? prev.message ?? null) === (prev.message ?? null) &&
  Object.entries(ev.counts).every(([k, v]) => prev.counts[k] === v);

/**
 * Runs one queued run. A load needs no earlier dry run: the pipeline starts with its own rehearsal and stops before it writes anything
 * when that is not clean, so a bad organization ends as a failed run with nothing loaded.
 */
export async function executeRun(
  d: { store: ExecStore; runner: Runner; now?: () => Date; timeoutMin: number; resume?: boolean },
  uuid: string,
): Promise<ExecOutcome> {
  const now = d.now ?? (() => new Date());
  const head = await d.store.peek(uuid);
  if (!head) return 'skipped';
  // A remote run still running on its agent when the worker that followed it restarted: recover keeps it alive and re-enqueues it,
  // and it is followed again from the start of the job's events (see alreadyApplied). Nothing else is ever resumed.
  const resuming = d.resume === true && head.status === 'running';
  if (!resuming && head.status !== 'queued') return 'skipped';

  let run: RunHead;
  if (resuming) run = head;
  else {
    const began = await d.store.begin(uuid);
    if (began === 'busy') return 'busy';
    if (!began) return 'skipped';
    run = began;
  }

  let steps: WabooMigrationStep[] = resuming ? (head.steps ?? []) : [];
  let result: PipelineResult | null = null;
  let startError: string | null = null;
  try {
    result = await d.runner.run(
      {
        runUuid: run.uuid,
        sourceClient: run.sourceClient,
        sourceDb: run.sourceDb,
        mode: run.mode,
        skipWhatsapp: run.skipWhatsapp,
      },
      async (ev) => {
        if (ev.event !== 'step') return;
        const prev = steps.find((s) => s.name === ev.name);
        if (resuming && alreadyApplied(prev, ev)) return;
        steps = applyStep(steps, ev, now());
        await d.store.saveSteps(run.id, steps);
      },
    );
  } catch (err) {
    startError = scrub(err instanceof Error ? err.message : 'The pipeline could not be started.');
  }
  const end = result
    ? finalState(result, d.timeoutMin)
    : { status: 'failed' as const, error: startError };
  const rep = result?.report ?? null;
  const report = rep ? buildReport(rep, end.status === 'completed') : null;
  await d.store.finish(run.id, {
    status: end.status,
    error: end.error,
    report,
    orgId: rep?.orgId ?? null,
  });
  if (end.status === 'failed') return 'failed';
  return report?.verdict === 'red' ? 'red' : 'completed';
}

// ---- batches: children run ONE AFTER ANOTHER ----

export interface BatchStore {
  /** queued -> running (stamps started_at). A batch that is already running is resumed. Null when the batch is gone. */
  begin(batchUuid: string): Promise<{ status: BatchStatus; stopOnFailure: boolean } | null>;
  status(batchUuid: string): Promise<BatchStatus | null>;
  /** The queued child with the lowest position, or null. */
  nextQueued(batchUuid: string): Promise<string | null>;
  /** Marks every still-queued child cancelled with a reason (stop-on-failure). */
  cancelQueued(batchUuid: string, reason: string): Promise<void>;
  /** Writes the final status and the counts snapshot (a cancelled batch stays cancelled). */
  finalize(batchUuid: string): Promise<void>;
}

export const STOP_REASON =
  'Skipped: an earlier organization failed and stop-on-failure was chosen.';

/**
 * Executes a batch's children strictly one at a time. A failed child does not stop the batch unless stop-on-failure was chosen.
 * 'busy' = another run holds the environment: the caller re-delays this job; progress is kept in the rows, so it resumes.
 */
export async function runBatch(
  d: { store: BatchStore; execute: (runUuid: string) => Promise<ExecOutcome> },
  batchUuid: string,
): Promise<'done' | 'busy' | 'noop'> {
  const b = await d.store.begin(batchUuid);
  if (!b || b.status !== 'running') return 'noop';
  for (;;) {
    if ((await d.store.status(batchUuid)) !== 'running') break; // cancelled meanwhile
    const next = await d.store.nextQueued(batchUuid);
    if (!next) break;
    const out = await d.execute(next);
    if (out === 'busy') return 'busy';
    if (b.stopOnFailure && (out === 'failed' || out === 'blocked' || out === 'red')) {
      await d.store.cancelQueued(batchUuid, STOP_REASON);
      break;
    }
  }
  await d.store.finalize(batchUuid);
  return 'done';
}

// ---- recovery on worker start ----

export interface SweepStore {
  /** running longer than the timeout belonged to a worker that died: failed, unless the run is in `keep`. Returns how many. */
  failStale(timeoutMs: number, keep: string[]): Promise<number>;
  /**
   * Remote runner only: the running runs whose agent is still following them (its job queued, or claimed and reporting recently).
   * They are resumed by the worker that just started instead of being failed.
   */
  resumableRemote?(): Promise<string[]>;
  /**
   * Remote runner only. The worker that was following a running run is gone (it just started), and the agent would keep loading with
   * nobody reading it while the one-running-run rule lets a new run start. Fails every running run that is not in `keep` (the ones an
   * agent still follows) and abandons the jobs of runs that are no longer running, so the agent stops the pipeline at its next report.
   * Returns how many runs it failed.
   */
  failOrphanedRemote?(keep: string[]): Promise<number>;
  /** Standalone runs still queued. */
  pendingRuns(): Promise<Array<{ uuid: string; runAt: Date | null }>>;
  /** Batches still queued or running (resumable from their rows). */
  pendingBatches(): Promise<Array<{ uuid: string; runAt: Date | null }>>;
}
export interface JobEnqueuer {
  /** Adds the job unless one with this id is already waiting/delayed/active (idempotent). True when it was added. */
  ensure(kind: 'migrate' | 'batch', uuid: string, delayMs: number): Promise<boolean>;
}

/**
 * Re-enqueues scheduled work whose job was lost (worker or Redis down at fire time), fails stuck running runs and resumes the remote
 * runs an agent is still following (a release restarts the worker under a running migration; it must not kill it). Safe to repeat.
 */
export async function recover(
  d: {
    store: SweepStore;
    jobs: JobEnqueuer;
    now?: () => Date;
    timeoutMs: number;
    /** true when the pipeline runs on a runner agent */
    remote?: boolean;
  },
  delay: (runAt: Date | null, now: Date) => number,
): Promise<{ failed: number; requeued: number }> {
  const now = (d.now ?? (() => new Date()))();
  const keep = d.remote && d.store.resumableRemote ? await d.store.resumableRemote() : [];
  let failed = await d.store.failStale(d.timeoutMs, keep);
  if (d.remote && d.store.failOrphanedRemote) failed += await d.store.failOrphanedRemote(keep);
  let requeued = 0;
  for (const uuid of keep) if (await d.jobs.ensure('migrate', uuid, 0)) requeued++;
  for (const r of await d.store.pendingRuns())
    if (await d.jobs.ensure('migrate', r.uuid, delay(r.runAt, now))) requeued++;
  for (const b of await d.store.pendingBatches())
    if (await d.jobs.ensure('batch', b.uuid, delay(b.runAt, now))) requeued++;
  return { failed, requeued };
}
