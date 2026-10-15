import { scrub, tail, type PipelineEvent, type ReportEvent } from './waboo-migration.rules';
import { timeoutMs, type RunArgs, type RunOutcome, type Runner } from './runner';
import type { RunnerJobStore } from './runner-jobs';

/** The agent is the only thing that can reach Waboo; this says what to do when none answers. */
export class RunnerUnavailableError extends Error {}

export interface RemoteRunnerTiming {
  /** How often the job is re-read. */
  pollMs: number;
  /** A job nobody claims within this long is abandoned. */
  pickupMs: number;
  /** A claimed job whose agent has been silent this long is abandoned (the agent reports at least every 15 seconds). */
  silenceMs: number;
  /** The hard limit of one run (the same WABOO_MIGRATE_TIMEOUT_MIN the local runner uses). */
  totalMs: number;
}

const minutes = (v: string | undefined, dflt: number): number => {
  const n = Number(v);
  return (Number.isFinite(n) && n > 0 ? n : dflt) * 60_000;
};

/** WABOO_RUNNER_PICKUP_MIN (default 10), WABOO_RUNNER_SILENCE_MIN (default 5), WABOO_MIGRATE_TIMEOUT_MIN (default 90). */
export function remoteTiming(env: NodeJS.ProcessEnv): RemoteRunnerTiming {
  return {
    pollMs: 3000,
    pickupMs: minutes(env.WABOO_RUNNER_PICKUP_MIN, 10),
    silenceMs: minutes(env.WABOO_RUNNER_SILENCE_MIN, 5),
    totalMs: timeoutMs(env),
  };
}

/**
 * Runs the pipeline on a runner agent instead of in the worker: it writes the job, then follows the job row. Events reach `onEvent`
 * in the order the agent saw them, exactly once each, so the panel's timeline is the same as with the local runner. The agent is
 * never trusted with a verdict: the final outcome is built from the validated report event and the exit code it stored.
 *
 * Failure handling (the job is abandoned, so a late agent stops the pipeline and never starts it):
 *   nobody claims the job in time   -> RunnerUnavailableError (the run fails with a message that says what to start)
 *   the agent goes silent           -> RunnerUnavailableError
 *   the hard limit passes           -> a timed-out outcome (the engine words it)
 */
export class RemoteRunner implements Runner {
  constructor(
    private readonly jobs: RunnerJobStore,
    private readonly timing: RemoteRunnerTiming,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = () => Date.now(),
  ) {}

  async run(args: RunArgs, onEvent: (ev: PipelineEvent) => Promise<void>): Promise<RunOutcome> {
    if (!args.runUuid) throw new Error('A remote run needs the run id.');
    const runUuid = args.runUuid;
    await this.jobs.enqueue(runUuid, {
      sourceClient: args.sourceClient,
      sourceDb: args.sourceDb,
      mode: args.mode,
    });
    const started = this.now();
    let delivered = 0;
    let report: ReportEvent | null = null;

    for (;;) {
      await this.sleep(this.timing.pollMs);
      const job = await this.jobs.read(runUuid);
      if (!job) throw new RunnerUnavailableError('The runner job disappeared.');

      for (const ev of job.events.slice(delivered)) {
        if (ev.event === 'report') report = ev;
        await onEvent(ev);
        delivered++;
      }

      if (job.status === 'done') {
        return {
          exitCode: job.exitCode,
          timedOut: job.timedOut,
          stderrTail: scrub(tail(job.stderrTail, 2048)),
          report,
        };
      }
      if (job.status === 'abandoned')
        throw new RunnerUnavailableError('The runner job was abandoned.');

      const t = this.now();
      if (t - started > this.timing.totalMs) {
        await this.jobs.abandon(runUuid);
        return {
          exitCode: null,
          timedOut: true,
          stderrTail: scrub(tail(job.stderrTail, 2048)),
          report,
        };
      }
      if (job.status === 'queued' && job.queuedForMs > this.timing.pickupMs) {
        await this.jobs.abandon(runUuid);
        throw new RunnerUnavailableError(
          `No runner agent picked this run up within ${Math.round(this.timing.pickupMs / 60_000)} minutes. ` +
            'Start the runner agent on a machine that is on the Geta VPN, then run it again. Nothing was started.',
        );
      }
      if (job.status === 'claimed' && job.silentForMs > this.timing.silenceMs) {
        await this.jobs.abandon(runUuid);
        throw new RunnerUnavailableError(
          'The runner agent stopped reporting while the migration was running, so this run was marked failed. ' +
            'Check the machine it runs on and the last step shown before running it again.',
        );
      }
    }
  }
}
