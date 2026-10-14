import { describe, expect, it } from 'vitest';
import {
  wabooMigrationRunnerClaimSchema,
  wabooMigrationRunnerFinishSchema,
  wabooMigrationRunnerJobSchema,
  wabooMigrationRunnerReportSchema,
} from '@crm/contracts';
import {
  RemoteRunner,
  RunnerUnavailableError,
  remoteTiming,
  type RemoteRunnerTiming,
} from '../../../src/modules/waboo-migration/remote-runner';
import { runnerMode } from '../../../src/modules/waboo-migration/runner';
import {
  eventsOf,
  MIN_RUNNER_TOKEN_LENGTH,
  runnerTokenMatches,
} from '../../../src/modules/waboo-migration/runner-auth';
import type {
  JobState,
  RunnerJobArgs,
  RunnerJobStore,
} from '../../../src/modules/waboo-migration/runner-jobs';
import {
  executeRun,
  type ExecStore,
} from '../../../src/modules/waboo-migration/waboo-migration.engine';
import type { PipelineEvent } from '../../../src/modules/waboo-migration/waboo-migration.rules';

const RUN = '11111111-1111-4111-8111-111111111111';
const ARGS = { runUuid: RUN, sourceClient: 'acme', sourceDb: 'Acme_Db', mode: 'dry' as const };
const TIMING: RemoteRunnerTiming = {
  pollMs: 1000,
  pickupMs: 10 * 60_000,
  silenceMs: 5 * 60_000,
  totalMs: 90 * 60_000,
};

const step = (name: string, status: 'running' | 'done' | 'failed'): PipelineEvent => ({
  event: 'step',
  name,
  status,
  counts: {},
  message: null,
});
const report = (green: boolean): PipelineEvent => ({
  event: 'report',
  green,
  unaccounted: 0,
  integrityErrors: 0,
  alarms: 2,
  orgId: 7,
  summary: 'dry run clean',
});

/** A job table that moves by a script, one entry per poll, with a fake clock the sleep advances. */
function harness(script: Array<(now: number) => Partial<JobState>>) {
  let now = Date.parse('2026-10-14T10:00:00Z');
  const created = new Date(now);
  const enqueued: Array<{ uuid: string; args: RunnerJobArgs }> = [];
  const abandoned: string[] = [];
  let poll = 0;
  const base: JobState = {
    status: 'queued',
    events: [],
    exitCode: null,
    timedOut: false,
    stderrTail: '',
    claimedAt: null,
    lastSeenAt: null,
    createdAt: created,
  };
  const store: RunnerJobStore = {
    enqueue: async (uuid, args) => void enqueued.push({ uuid, args }),
    read: async () => {
      const f = script[Math.min(poll, script.length - 1)]!;
      poll++;
      return { ...base, ...f(now) };
    },
    abandon: async (uuid) => void abandoned.push(uuid),
  };
  const runner = new RemoteRunner(
    store,
    TIMING,
    async (ms) => void (now += ms),
    () => now,
  );
  return {
    runner,
    enqueued,
    abandoned,
    polls: () => poll,
    advance: (ms: number) => void (now += ms),
    at: () => now,
  };
}

describe('RemoteRunner', () => {
  it('writes the job with exactly the three values of the run, then returns the stored outcome with the report', async () => {
    const h = harness([
      (now) => ({ status: 'claimed', claimedAt: new Date(now), lastSeenAt: new Date(now) }),
      (now) => ({
        status: 'done',
        events: [step('export', 'done'), report(true)],
        exitCode: 0,
        stderrTail: 'ok',
        lastSeenAt: new Date(now),
      }),
    ]);
    const seen: PipelineEvent[] = [];
    const out = await h.runner.run(ARGS, async (ev) => void seen.push(ev));
    expect(h.enqueued).toEqual([
      { uuid: RUN, args: { sourceClient: 'acme', sourceDb: 'Acme_Db', mode: 'dry' } },
    ]);
    expect(out.exitCode).toBe(0);
    expect(out.timedOut).toBe(false);
    expect(out.report?.green).toBe(true);
    expect(seen.map((e) => e.event)).toEqual(['step', 'report']);
  });

  it('hands every event over exactly once and in order, however the job grows between polls', async () => {
    const e1 = step('export', 'running');
    const e2 = step('export', 'done');
    const e3 = step('preflight', 'running');
    const h = harness([
      (now) => ({ status: 'claimed', events: [e1], lastSeenAt: new Date(now) }),
      (now) => ({ status: 'claimed', events: [e1, e2], lastSeenAt: new Date(now) }),
      (now) => ({ status: 'claimed', events: [e1, e2], lastSeenAt: new Date(now) }),
      (now) => ({
        status: 'done',
        events: [e1, e2, e3, report(true)],
        exitCode: 0,
        lastSeenAt: new Date(now),
      }),
    ]);
    const seen: PipelineEvent[] = [];
    await h.runner.run(ARGS, async (ev) => void seen.push(ev));
    expect(seen).toHaveLength(4);
    expect(seen.slice(0, 3)).toEqual([e1, e2, e3]);
  });

  it('delivers the events that arrived together with the end of the job (nothing is lost on the last poll)', async () => {
    const h = harness([
      (now) => ({
        status: 'done',
        events: [step('export', 'failed'), report(false)],
        exitCode: 1,
        stderrTail: 'boom',
        lastSeenAt: new Date(now),
      }),
    ]);
    const seen: PipelineEvent[] = [];
    const out = await h.runner.run(ARGS, async (ev) => void seen.push(ev));
    expect(seen).toHaveLength(2);
    expect(out).toMatchObject({ exitCode: 1, timedOut: false, stderrTail: 'boom' });
    expect(out.report?.green).toBe(false);
  });

  it('gives up on a job nobody claims: abandons it and says what to start (nothing was started)', async () => {
    const h = harness([() => ({ status: 'queued' })]);
    const err = await h.runner.run(ARGS, async () => undefined).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RunnerUnavailableError);
    expect((err as Error).message).toMatch(/No runner agent picked this run up within 10 minutes/);
    expect((err as Error).message).toMatch(/VPN/);
    expect(h.abandoned).toEqual([RUN]);
    // it waited the pick-up time and no longer than a poll beyond it
    expect(h.at() - Date.parse('2026-10-14T10:00:00Z')).toBeLessThanOrEqual(
      10 * 60_000 + 2 * TIMING.pollMs,
    );
  });

  it('gives up on an agent that went silent after claiming, and abandons the job so a late agent stops', async () => {
    const claimedAt = new Date('2026-10-14T10:00:00Z');
    const h = harness([() => ({ status: 'claimed', claimedAt, lastSeenAt: claimedAt })]);
    const err = await h.runner.run(ARGS, async () => undefined).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RunnerUnavailableError);
    expect((err as Error).message).toMatch(/stopped reporting/);
    expect(h.abandoned).toEqual([RUN]);
  });

  it('keeps waiting while the agent keeps reporting, however long the run takes (up to the hard limit)', async () => {
    const h = harness([
      (now) =>
        now < Date.parse('2026-10-14T10:40:00Z')
          ? { status: 'claimed', lastSeenAt: new Date(now) }
          : { status: 'done', exitCode: 0, events: [report(true)] },
    ]);
    const out = await h.runner.run(ARGS, async () => undefined);
    expect(out.exitCode).toBe(0);
    expect(h.abandoned).toEqual([]);
  });

  it('stops at the hard limit with a timed-out outcome and abandons the job', async () => {
    const h = harness([(now) => ({ status: 'claimed', lastSeenAt: new Date(now) })]);
    const out = await h.runner.run(ARGS, async () => undefined);
    expect(out.timedOut).toBe(true);
    expect(out.exitCode).toBeNull();
    expect(h.abandoned).toEqual([RUN]);
  });

  it('fails when the job was abandoned elsewhere, and when the row disappears', async () => {
    const a = harness([() => ({ status: 'abandoned' })]);
    await expect(a.runner.run(ARGS, async () => undefined)).rejects.toBeInstanceOf(
      RunnerUnavailableError,
    );
    const store: RunnerJobStore = {
      enqueue: async () => undefined,
      read: async () => null,
      abandon: async () => undefined,
    };
    const r = new RemoteRunner(store, TIMING, async () => undefined);
    await expect(r.run(ARGS, async () => undefined)).rejects.toBeInstanceOf(RunnerUnavailableError);
  });

  it('refuses to run without the run id (the job could not be addressed)', async () => {
    const h = harness([() => ({ status: 'done' })]);
    await expect(
      h.runner.run({ sourceClient: 'a', sourceDb: 'b', mode: 'dry' }, async () => undefined),
    ).rejects.toThrow(/run id/);
    expect(h.enqueued).toEqual([]);
  });

  it('scrubs what the agent stored before the engine sees it', async () => {
    const h = harness([
      () => ({
        status: 'done',
        exitCode: 1,
        stderrTail: 'failed password=hunter2 for ops@geta.ai',
      }),
    ]);
    const out = await h.runner.run(ARGS, async () => undefined);
    expect(out.stderrTail).not.toContain('hunter2');
    expect(out.stderrTail).not.toContain('ops@geta.ai');
  });

  it('plugs into the engine: a run is marked failed with the runner message when no agent answers, and the pipeline is never started', async () => {
    const h = harness([() => ({ status: 'queued' })]);
    const finished: unknown[] = [];
    const store: ExecStore = {
      peek: async () => ({
        id: 1,
        uuid: RUN,
        sourceClient: 'acme',
        sourceDb: 'Acme_Db',
        mode: 'dry',
        status: 'queued',
      }),
      latestDry: async () => null,
      block: async () => undefined,
      begin: async () => ({
        id: 1,
        uuid: RUN,
        sourceClient: 'acme',
        sourceDb: 'Acme_Db',
        mode: 'dry',
        status: 'running',
      }),
      saveSteps: async () => undefined,
      finish: async (_id, f) => void finished.push(f),
    };
    const out = await executeRun({ store, runner: h.runner, timeoutMin: 90 }, RUN);
    expect(out).toBe('failed');
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ status: 'failed', report: null });
    expect((finished[0] as { error: string }).error).toMatch(/runner agent/);
    expect(h.enqueued[0]?.uuid).toBe(RUN);
  });
});

describe('runner settings', () => {
  it('runs in the worker unless WABOO_MIGRATE_RUNNER is exactly "remote"', () => {
    expect(runnerMode({})).toBe('local');
    expect(runnerMode({ WABOO_MIGRATE_RUNNER: 'remote' })).toBe('remote');
    for (const v of ['', 'Remote', 'true', '1', 'local'])
      expect(runnerMode({ WABOO_MIGRATE_RUNNER: v })).toBe('local');
  });
  it('reads the waiting times in minutes and falls back to the defaults for anything unusable', () => {
    expect(remoteTiming({})).toMatchObject({
      pickupMs: 600_000,
      silenceMs: 300_000,
      totalMs: 5_400_000,
    });
    expect(
      remoteTiming({
        WABOO_RUNNER_PICKUP_MIN: '2',
        WABOO_RUNNER_SILENCE_MIN: '1',
        WABOO_MIGRATE_TIMEOUT_MIN: '30',
      }),
    ).toMatchObject({
      pickupMs: 120_000,
      silenceMs: 60_000,
      totalMs: 1_800_000,
    });
    expect(
      remoteTiming({ WABOO_RUNNER_PICKUP_MIN: 'x', WABOO_RUNNER_SILENCE_MIN: '-3' }),
    ).toMatchObject({ pickupMs: 600_000, silenceMs: 300_000 });
  });
});

describe('runner token', () => {
  const TOKEN = 'k'.repeat(MIN_RUNNER_TOKEN_LENGTH) + 'XyZ';
  it('accepts exactly the configured token as a bearer header', () => {
    expect(runnerTokenMatches(TOKEN, `Bearer ${TOKEN}`)).toBe(true);
    expect(runnerTokenMatches(TOKEN, `bearer ${TOKEN}`)).toBe(true);
  });
  it('refuses a wrong, near, empty, missing or oddly shaped token', () => {
    for (const h of [
      undefined,
      '',
      'Bearer ',
      `Bearer ${TOKEN}x`,
      `Bearer ${TOKEN.slice(1)}`,
      TOKEN,
      `Basic ${TOKEN}`,
      `Bearer ${TOKEN} extra`,
      `Bearer a b`,
    ])
      expect(runnerTokenMatches(TOKEN, h), String(h)).toBe(false);
  });
  it('stays closed while no token of the minimum length is configured, even for a matching header', () => {
    for (const configured of [undefined, '', 'short', 'k'.repeat(MIN_RUNNER_TOKEN_LENGTH - 1)])
      expect(runnerTokenMatches(configured, `Bearer ${configured ?? ''}`)).toBe(false);
    expect(
      runnerTokenMatches(
        'k'.repeat(MIN_RUNNER_TOKEN_LENGTH),
        `Bearer ${'k'.repeat(MIN_RUNNER_TOKEN_LENGTH)}`,
      ),
    ).toBe(true);
  });
});

describe('what an agent can send', () => {
  it('keeps only known pipeline events, scrubbed, and drops everything else', () => {
    const evs = eventsOf([
      JSON.stringify({
        event: 'step',
        name: 'export',
        status: 'running',
        message: 'reading ops@geta.ai',
      }),
      'not json at all',
      JSON.stringify({ event: 'step', name: 'rm -rf', status: 'running' }),
      JSON.stringify({ event: 'step', name: 'export', status: 'weird' }),
      JSON.stringify({ event: 'shell', cmd: 'x' }),
      JSON.stringify({ event: 'report', green: 'yes' }),
      JSON.stringify({
        event: 'report',
        green: true,
        unaccounted: 0,
        integrityErrors: 0,
        alarms: 1,
        orgId: 5,
        summary: 'ok',
      }),
      '',
    ]);
    expect(evs.map((e) => e.event)).toEqual(['step', 'report']);
    expect(JSON.stringify(evs[0])).not.toContain('ops@geta.ai');
  });
  it('validates the bodies: names, uuids, counts and sizes', () => {
    expect(wabooMigrationRunnerClaimSchema.safeParse({ runner: 'vedant-laptop' }).success).toBe(
      true,
    );
    for (const bad of ['', 'has space', 'a'.repeat(65), 'semi;colon', '../x'])
      expect(wabooMigrationRunnerClaimSchema.safeParse({ runner: bad }).success, bad).toBe(false);
    expect(wabooMigrationRunnerReportSchema.parse({ runner: 'r' })).toEqual({
      runner: 'r',
      lines: [],
      stderrTail: '',
    });
    expect(
      wabooMigrationRunnerReportSchema.safeParse({ runner: 'r', lines: Array(51).fill('x') })
        .success,
    ).toBe(false);
    expect(
      wabooMigrationRunnerReportSchema.safeParse({ runner: 'r', lines: ['x'.repeat(8193)] })
        .success,
    ).toBe(false);
    expect(
      wabooMigrationRunnerFinishSchema.safeParse({ runner: 'r', exitCode: 0, timedOut: false })
        .success,
    ).toBe(true);
    expect(
      wabooMigrationRunnerFinishSchema.safeParse({ runner: 'r', exitCode: null, timedOut: true })
        .success,
    ).toBe(true);
    expect(
      wabooMigrationRunnerFinishSchema.safeParse({ runner: 'r', exitCode: 'x', timedOut: false })
        .success,
    ).toBe(false);
    expect(
      wabooMigrationRunnerJobSchema.safeParse({
        runId: RUN,
        sourceClient: 'acme',
        sourceDb: 'Acme_Db',
        mode: 'catchup',
      }).success,
    ).toBe(true);
    for (const bad of [
      { sourceDb: 'a b' },
      { sourceClient: 'A B' },
      { mode: 'drop' },
      { runId: 'nope' },
    ])
      expect(
        wabooMigrationRunnerJobSchema.safeParse({
          runId: RUN,
          sourceClient: 'acme',
          sourceDb: 'Acme_Db',
          mode: 'dry',
          ...bad,
        }).success,
      ).toBe(false);
  });
});
