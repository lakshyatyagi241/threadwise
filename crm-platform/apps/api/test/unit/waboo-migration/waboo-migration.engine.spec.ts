import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createWabooMigrationBatchSchema,
  createWabooMigrationRunSchema,
  deriveClientKey,
  verdictOf,
} from '@crm/contracts';
import type { Runner, RunOutcome } from '../../../src/modules/waboo-migration/runner';
import {
  executeRun,
  recover,
  runBatch,
  STOP_REASON,
  type BatchStore,
  type ExecOutcome,
  type ExecStore,
  type Finish,
  type JobEnqueuer,
  type RunHead,
  type SweepStore,
} from '../../../src/modules/waboo-migration/waboo-migration.engine';
import {
  batchFinalStatus,
  buildReport,
  delayFor,
  dryReadiness,
  planBatch,
  runVerdict,
  validateRunAt,
  type BatchStatus,
  type LatestDry,
  type RunMode,
} from '../../../src/modules/waboo-migration/waboo-migration.rules';

const NOW = new Date('2026-10-13T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const greenDry = (h = 1): LatestDry => ({
  status: 'completed',
  green: true,
  finishedAt: hoursAgo(h),
});

describe('client key derivation', () => {
  it('is the lower-case slug of the organization id, within the client-key rule', () => {
    expect(deriveClientKey('Acme_Org_01')).toBe('acme_org_01');
    expect(deriveClientKey('A'.repeat(100))).toBe('a'.repeat(64));
    expect(deriveClientKey('5f8d0d55b54764421b7156c3')).toBe('5f8d0d55b54764421b7156c3');
  });
  it('makes the client key optional on the request and still validates the id as a database name', () => {
    const ok = createWabooMigrationRunSchema.parse({ organizationId: 'WS_123' });
    expect(ok).toMatchObject({ organizationId: 'WS_123', mode: 'dry' });
    expect(ok.sourceClient).toBeUndefined();
    for (const bad of ['ws-1', 'a b', 'x; drop', '', 'a'.repeat(129), '$(id)', '`id`', 'a/b'])
      expect(createWabooMigrationRunSchema.safeParse({ organizationId: bad }).success, bad).toBe(
        false,
      );
    expect(
      createWabooMigrationRunSchema.safeParse({ organizationId: 'ok', sourceClient: 'Bad Key' })
        .success,
    ).toBe(false);
  });
  it('still accepts the previous field names (sourceDb, confirmClient)', () => {
    expect(
      createWabooMigrationRunSchema.parse({
        sourceClient: 'acme',
        sourceDb: 'waboo_acme',
        confirmClient: 'acme',
      }),
    ).toMatchObject({ organizationId: 'waboo_acme', confirm: 'acme', sourceClient: 'acme' });
  });
});

describe('slug collisions in a batch', () => {
  it('accepts distinct ids and derives one key each', () => {
    expect(planBatch(['Aa', 'Bb'])).toEqual({
      ok: true,
      items: [
        { organizationId: 'Aa', sourceClient: 'aa' },
        { organizationId: 'Bb', sourceClient: 'bb' },
      ],
    });
  });
  it('refuses the same id twice and two ids that slug to the same key', () => {
    expect(planBatch(['x1', 'x1'])).toEqual({
      ok: false,
      reason: 'duplicate',
      organizationId: 'x1',
    });
    expect(planBatch(['AbC', 'aBc'])).toEqual({
      ok: false,
      reason: 'collision',
      organizationId: 'aBc',
    });
  });
  it('allows at most 50 organizations and at least 1', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `org${i}`);
    expect(createWabooMigrationBatchSchema.safeParse({ organizationIds: ids(50) }).success).toBe(
      true,
    );
    expect(createWabooMigrationBatchSchema.safeParse({ organizationIds: ids(51) }).success).toBe(
      false,
    );
    expect(createWabooMigrationBatchSchema.safeParse({ organizationIds: [] }).success).toBe(false);
    expect(createWabooMigrationBatchSchema.parse({ organizationIds: ['a'] })).toMatchObject({
      mode: 'dry',
      stopOnFailure: false,
    });
  });
});

describe('verdict', () => {
  const base = { ok: true, unaccounted: 0, integrityErrors: 0, alarms: 0 };
  it('is green only when ok, nothing unaccounted and no integrity errors', () => {
    expect(verdictOf(base)).toBe('green');
    expect(verdictOf({ ...base, ok: false })).toBe('red');
    expect(verdictOf({ ...base, unaccounted: 1 })).toBe('red');
    expect(verdictOf({ ...base, integrityErrors: 2 })).toBe('red');
  });
  it('is amber when alarms need review, and red still wins over alarms', () => {
    expect(verdictOf({ ...base, alarms: 3 })).toBe('amber');
    expect(verdictOf({ ...base, alarms: 3, unaccounted: 1 })).toBe('red');
  });
  it('is stored on the report; a failed process is red even if the report said green', () => {
    const rep = { green: true, unaccounted: 0, integrityErrors: 0, alarms: 0, summary: 's' };
    expect(buildReport(rep, true).verdict).toBe('green');
    expect(buildReport(rep, false).verdict).toBe('red');
    expect(buildReport({ ...rep, alarms: 1 }, true).verdict).toBe('amber');
    expect(buildReport({ ...rep, green: false }, true).verdict).toBe('red');
  });
  it('a failed run is red, a running one has none, an old report without a verdict is recomputed', () => {
    expect(runVerdict('failed', null)).toBe('red');
    expect(runVerdict('running', null)).toBeNull();
    expect(runVerdict('blocked', null)).toBeNull();
    expect(
      runVerdict('completed', {
        green: true,
        unaccounted: 0,
        integrityErrors: 0,
        alarms: 2,
        summary: '',
      }),
    ).toBe('amber');
    expect(
      runVerdict('completed', {
        green: false,
        unaccounted: 0,
        integrityErrors: 0,
        alarms: 0,
        summary: '',
      }),
    ).toBe('red');
  });
});

describe('green dry-run gate (shared by enqueue and the pre-start re-check)', () => {
  it('needs a completed green dry run no older than 24 hours', () => {
    expect(dryReadiness(greenDry(1), NOW)).toBe('ok');
    expect(dryReadiness(greenDry(24), NOW)).toBe('ok');
    expect(dryReadiness(greenDry(25), NOW)).toBe('stale');
    expect(dryReadiness(null, NOW)).toBe('no_dry');
    expect(dryReadiness({ ...greenDry(), green: false }, NOW)).toBe('not_green');
    expect(dryReadiness({ ...greenDry(), status: 'failed' }, NOW)).toBe('not_green');
    expect(dryReadiness({ ...greenDry(), status: 'queued' }, NOW)).toBe('not_green');
  });
});

describe('schedule', () => {
  it('accepts a time in the future up to 90 days ahead; omitted means now', () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
    expect(validateRunAt(undefined, NOW)).toBeNull();
    expect(validateRunAt(at(60_000), NOW)).toBeNull();
    expect(validateRunAt(at(90 * 86_400_000), NOW)).toBeNull();
    expect(validateRunAt(at(90 * 86_400_000 + 1000), NOW)).toBe('too_far');
    expect(validateRunAt(at(0), NOW)).toBe('past');
    expect(validateRunAt(at(-1000), NOW)).toBe('past');
    expect(validateRunAt('nonsense', NOW)).toBe('past');
  });
  it('delays a BullMQ job until run_at and never negatively', () => {
    expect(delayFor(null, NOW)).toBe(0);
    expect(delayFor(new Date(NOW.getTime() + 5000), NOW)).toBe(5000);
    expect(delayFor(hoursAgo(2), NOW)).toBe(0);
  });
});

// ---- in-memory fakes ----

interface FakeRun {
  uuid: string;
  client: string;
  mode: RunMode;
  status: string;
  error: string | null;
  verdict: string | null;
}
function world(opts: {
  runs: Array<{ client: string; mode?: RunMode; dry?: LatestDry | null }>;
  report?: (client: string) => {
    green: boolean;
    unaccounted?: number;
    integrityErrors?: number;
    alarms?: number;
  };
  fail?: Set<string>;
  busyOnce?: string;
}) {
  const rows: FakeRun[] = opts.runs.map((r, i) => ({
    uuid: `r${i + 1}`,
    client: r.client,
    mode: r.mode ?? 'dry',
    status: 'queued',
    error: null,
    verdict: null,
  }));
  const dry = new Map(opts.runs.map((r) => [r.client, r.dry === undefined ? greenDry() : r.dry]));
  let running = 0;
  let maxRunning = 0;
  const order: string[] = [];
  let busyLeft = opts.busyOnce ? 1 : 0;
  const head = (r: FakeRun, id: number): RunHead => ({
    id,
    uuid: r.uuid,
    sourceClient: r.client,
    sourceDb: r.client,
    mode: r.mode,
    status: r.status,
  });
  const exec: ExecStore = {
    peek: async (u) => {
      const i = rows.findIndex((r) => r.uuid === u);
      return i < 0 ? null : head(rows[i]!, i + 1);
    },
    latestDry: async (c) => dry.get(c) ?? null,
    block: async (u, reason) => {
      const r = rows.find((x) => x.uuid === u)!;
      if (r.status === 'queued') Object.assign(r, { status: 'blocked', error: reason });
    },
    begin: async (u) => {
      const i = rows.findIndex((r) => r.uuid === u);
      const r = rows[i]!;
      if (r.status !== 'queued') return null;
      if (running > 0 || (busyLeft > 0 && opts.busyOnce === u && busyLeft-- > 0)) return 'busy';
      r.status = 'running';
      running++;
      maxRunning = Math.max(maxRunning, running);
      return head(r, i + 1);
    },
    saveSteps: async () => undefined,
    finish: async (id, f: Finish) => {
      const r = rows[id - 1]!;
      r.status = f.status;
      r.verdict = f.report?.verdict ?? null;
      r.error = f.error;
      running--;
    },
  };
  const runner: Runner = {
    async run(args, onEvent): Promise<RunOutcome> {
      order.push(args.sourceClient);
      await Promise.resolve();
      await onEvent({
        event: 'step',
        name: 'export',
        status: 'running',
        counts: {},
        message: null,
      });
      if (opts.fail?.has(args.sourceClient))
        return { exitCode: 2, timedOut: false, stderrTail: 'boom', report: null };
      const rep = opts.report?.(args.sourceClient) ?? { green: true };
      return {
        exitCode: 0,
        timedOut: false,
        stderrTail: '',
        report: {
          event: 'report',
          green: rep.green,
          unaccounted: rep.unaccounted ?? 0,
          integrityErrors: rep.integrityErrors ?? 0,
          alarms: rep.alarms ?? 0,
          orgId: null,
          summary: '',
        },
      };
    },
  };
  return { rows, exec, runner, order, maxRunning: () => maxRunning };
}

function batchStore(w: ReturnType<typeof world>, stopOnFailure: boolean) {
  let status: BatchStatus = 'queued';
  let finalized = 0;
  const store: BatchStore = {
    begin: async () => {
      if (status === 'queued') status = 'running';
      return { status, stopOnFailure };
    },
    status: async () => status,
    nextQueued: async () => w.rows.find((r) => r.status === 'queued')?.uuid ?? null,
    cancelQueued: async (_u, reason) => {
      for (const r of w.rows)
        if (r.status === 'queued') Object.assign(r, { status: 'cancelled', error: reason });
    },
    finalize: async () => {
      finalized++;
      const counts: Record<string, number> = {};
      for (const r of w.rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
      status = batchFinalStatus(status, counts);
    },
  };
  return {
    store,
    cancel: () => void (status = 'cancelled'),
    status: () => status,
    finalized: () => finalized,
  };
}

const deps = (w: ReturnType<typeof world>) => ({
  store: w.exec,
  runner: w.runner,
  timeoutMin: 90,
  now: () => NOW,
});

describe('executeRun', () => {
  it('runs a dry run and stores the verdict; a failed process is failed', async () => {
    const w = world({
      runs: [{ client: 'a' }, { client: 'b' }],
      fail: new Set(['b']),
      report: () => ({ green: true, alarms: 2 }),
    });
    expect(await executeRun(deps(w), 'r1')).toBe('completed');
    expect(w.rows[0]).toMatchObject({ status: 'completed', verdict: 'amber' });
    expect(await executeRun(deps(w), 'r2')).toBe('failed');
    expect(w.rows[1]).toMatchObject({ status: 'failed', error: 'boom' });
  });
  it('a completed run with a red verdict is reported as red, never as plain completed', async () => {
    const w = world({ runs: [{ client: 'a' }], report: () => ({ green: false, unaccounted: 3 }) });
    expect(await executeRun(deps(w), 'r1')).toBe('red');
    expect(w.rows[0]!.verdict).toBe('red');
  });
  it('skips a run that is no longer queued (cancelled) without starting the pipeline', async () => {
    const w = world({ runs: [{ client: 'a' }] });
    w.rows[0]!.status = 'cancelled';
    expect(await executeRun(deps(w), 'r1')).toBe('skipped');
    expect(w.order).toEqual([]);
  });
  it('a load re-checks the green dry run right before it starts and is blocked, never loaded', async () => {
    for (const [dry, text] of [
      [null, 'no dry run'],
      [{ ...greenDry(), green: false }, 'not green'],
      [greenDry(30), 'more than 24 hours'],
    ] as const) {
      const w = world({ runs: [{ client: 'a', mode: 'load', dry }] });
      expect(await executeRun(deps(w), 'r1')).toBe('blocked');
      expect(w.rows[0]!.status).toBe('blocked');
      expect(w.rows[0]!.error).toContain(text);
      expect(w.order, 'the pipeline must not be started').toEqual([]);
    }
  });
  it('a load with a fresh green dry run goes ahead', async () => {
    const w = world({ runs: [{ client: 'a', mode: 'load' }] });
    expect(await executeRun(deps(w), 'r1')).toBe('completed');
    expect(w.order).toEqual(['a']);
  });
  it('reports busy (and starts nothing) while another run holds the environment', async () => {
    const w2 = world({ runs: [{ client: 'a' }], busyOnce: 'r1' });
    expect(await executeRun(deps(w2), 'r1')).toBe('busy');
    expect(w2.order).toEqual([]);
    expect(await executeRun(deps(w2), 'r1')).toBe('completed');
  });
});

describe('batch: sequential execution', () => {
  it('runs children strictly one after another, in order, never two at once', async () => {
    const w = world({ runs: ['a', 'b', 'c', 'd'].map((client) => ({ client })) });
    const b = batchStore(w, false);
    const out = await runBatch({ store: b.store, execute: (u) => executeRun(deps(w), u) }, 'B1');
    expect(out).toBe('done');
    expect(w.order).toEqual(['a', 'b', 'c', 'd']);
    expect(w.maxRunning()).toBe(1);
    expect(b.status()).toBe('completed');
  });
  it('a failed organization does not stop the batch by default; the batch ends failed with per-organization status', async () => {
    const w = world({ runs: ['a', 'b', 'c'].map((client) => ({ client })), fail: new Set(['b']) });
    const b = batchStore(w, false);
    await runBatch({ store: b.store, execute: (u) => executeRun(deps(w), u) }, 'B1');
    expect(w.rows.map((r) => r.status)).toEqual(['completed', 'failed', 'completed']);
    expect(b.status()).toBe('failed');
  });
  it('stop-on-failure cancels the organizations after the failure, with a reason', async () => {
    const w = world({ runs: ['a', 'b', 'c'].map((client) => ({ client })), fail: new Set(['b']) });
    const b = batchStore(w, true);
    await runBatch({ store: b.store, execute: (u) => executeRun(deps(w), u) }, 'B1');
    expect(w.rows.map((r) => r.status)).toEqual(['completed', 'failed', 'cancelled']);
    expect(w.rows[2]!.error).toBe(STOP_REASON);
    expect(w.order).toEqual(['a', 'b']);
  });
  it('stop-on-failure also stops on a red verdict and on a blocked load', async () => {
    const red = world({
      runs: ['a', 'b'].map((client) => ({ client })),
      report: (c) => ({ green: c !== 'a', unaccounted: c === 'a' ? 1 : 0 }),
    });
    await runBatch(
      { store: batchStore(red, true).store, execute: (u) => executeRun(deps(red), u) },
      'B1',
    );
    expect(red.rows.map((r) => r.status)).toEqual(['completed', 'cancelled']);
    const blocked = world({
      runs: [
        { client: 'a', mode: 'load', dry: null },
        { client: 'b', mode: 'load' },
      ],
    });
    await runBatch(
      { store: batchStore(blocked, true).store, execute: (u) => executeRun(deps(blocked), u) },
      'B1',
    );
    expect(blocked.rows.map((r) => r.status)).toEqual(['blocked', 'cancelled']);
    expect(blocked.order).toEqual([]);
  });
  it('in a bulk load an organization whose dry run is no longer green is skipped as blocked and the others still load', async () => {
    const w = world({
      runs: [
        { client: 'a', mode: 'load' },
        { client: 'b', mode: 'load', dry: greenDry(40) },
        { client: 'c', mode: 'load' },
      ],
    });
    const b = batchStore(w, false);
    await runBatch({ store: b.store, execute: (u) => executeRun(deps(w), u) }, 'B1');
    expect(w.rows.map((r) => r.status)).toEqual(['completed', 'blocked', 'completed']);
    expect(w.order).toEqual(['a', 'c']);
    expect(b.status()).toBe('failed');
  });
  it('a cancelled batch runs nothing more and stays cancelled', async () => {
    const w = world({ runs: ['a', 'b', 'c'].map((client) => ({ client })) });
    const b = batchStore(w, false);
    let n = 0;
    await runBatch(
      {
        store: b.store,
        execute: async (u) => {
          const o = await executeRun(deps(w), u);
          if (++n === 1) b.cancel();
          return o;
        },
      },
      'B1',
    );
    expect(w.order).toEqual(['a']);
    expect(b.status()).toBe('cancelled');
  });
  it('returns busy without losing progress when another run holds the environment, and resumes', async () => {
    const w = world({ runs: ['a', 'b'].map((client) => ({ client })), busyOnce: 'r2' });
    const b = batchStore(w, false);
    const exec = (u: string): Promise<ExecOutcome> => executeRun(deps(w), u);
    expect(await runBatch({ store: b.store, execute: exec }, 'B1')).toBe('busy');
    expect(w.rows.map((r) => r.status)).toEqual(['completed', 'queued']);
    expect(b.finalized()).toBe(0);
    expect(await runBatch({ store: b.store, execute: exec }, 'B1')).toBe('done');
    expect(w.order).toEqual(['a', 'b']);
  });
  it('an unknown or finished batch is a no-op', async () => {
    const w = world({ runs: [{ client: 'a' }] });
    const store = { ...batchStore(w, false).store, begin: async () => null };
    expect(await runBatch({ store, execute: async () => 'completed' }, 'x')).toBe('noop');
    const done = {
      ...batchStore(w, false).store,
      begin: async () => ({ status: 'completed' as const, stopOnFailure: false }),
    };
    expect(await runBatch({ store: done, execute: async () => 'completed' }, 'x')).toBe('noop');
  });
});

describe('batch final status', () => {
  it('failed when any child failed or was blocked, completed otherwise, cancelled stays cancelled', () => {
    expect(batchFinalStatus('running', { completed: 3 })).toBe('completed');
    expect(batchFinalStatus('running', { completed: 2, failed: 1 })).toBe('failed');
    expect(batchFinalStatus('running', { completed: 2, blocked: 1 })).toBe('failed');
    expect(batchFinalStatus('cancelled', { completed: 2 })).toBe('cancelled');
  });
});

describe('recovery sweep on worker start', () => {
  function sweepWorld(opts: {
    runs: Array<{ uuid: string; runAt: Date | null }>;
    batches: Array<{ uuid: string; runAt: Date | null }>;
    stale?: number;
    existing?: Set<string>;
  }) {
    const added: Array<{ kind: string; uuid: string; delay: number }> = [];
    const existing = opts.existing ?? new Set<string>();
    const store: SweepStore = {
      failStale: async () => opts.stale ?? 0,
      pendingRuns: async () => opts.runs,
      pendingBatches: async () => opts.batches,
    };
    const jobs: JobEnqueuer = {
      ensure: async (kind, uuid, delay) => {
        const id = `${kind}:${uuid}`;
        if (existing.has(id)) return false;
        existing.add(id);
        added.push({ kind, uuid, delay });
        return true;
      },
    };
    return { store, jobs, added };
  }
  it('fails stuck running runs and re-enqueues scheduled items whose time passed while the worker was down', async () => {
    const s = sweepWorld({
      runs: [
        { uuid: 'r1', runAt: hoursAgo(2) },
        { uuid: 'r2', runAt: new Date(NOW.getTime() + 60_000) },
        { uuid: 'r3', runAt: null },
      ],
      batches: [{ uuid: 'b1', runAt: hoursAgo(1) }],
      stale: 1,
    });
    const out = await recover(
      { store: s.store, jobs: s.jobs, now: () => NOW, timeoutMs: 1 },
      delayFor,
    );
    expect(out).toEqual({ failed: 1, requeued: 4 });
    expect(s.added).toEqual([
      { kind: 'migrate', uuid: 'r1', delay: 0 },
      { kind: 'migrate', uuid: 'r2', delay: 60_000 },
      { kind: 'migrate', uuid: 'r3', delay: 0 },
      { kind: 'batch', uuid: 'b1', delay: 0 },
    ]);
  });
  it('is idempotent: running it twice, or with live jobs already present, adds nothing new', async () => {
    const s = sweepWorld({
      runs: [{ uuid: 'r1', runAt: hoursAgo(2) }],
      batches: [{ uuid: 'b1', runAt: null }],
      existing: new Set(['batch:b1']),
    });
    const d = { store: s.store, jobs: s.jobs, now: () => NOW, timeoutMs: 1 };
    expect((await recover(d, delayFor)).requeued).toBe(1);
    expect((await recover(d, delayFor)).requeued).toBe(0);
    expect(s.added).toHaveLength(1);
  });
});

describe('WhatsApp / Waboo safety invariant (module source)', () => {
  const dir = join(process.cwd(), 'src', 'modules', 'waboo-migration');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  const source = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  it('never imports a WhatsApp, channel, provider, bridge or Mongo module: it cannot connect WhatsApp or write to Waboo', () => {
    expect(source).not.toMatch(
      /from '(\.\.\/)+(whatsapp|waba|channel[\w-]*|node-bridge|providers?|inbox|broadcasts?|messaging)[\w/-]*'/,
    );
    expect(source).not.toMatch(
      /from '(mongodb|mongoose|baileys|@whiskeysockets[^']*|whatsapp-web\.js)'/,
    );
    expect(source).not.toMatch(/\bMongoClient\b|\bconnectWhatsApp\b|\bsendMessage\b/);
  });
  it('talks to the outside only through the pipeline process (an args array, no shell, no network client)', () => {
    expect(source).not.toMatch(
      /\bfetch\(|from 'axios'|from 'undici'|from 'node:https?'|from 'node:net'/,
    );
    expect(source).toMatch(/shell: false/);
  });
  it('the module writes only to the panel tables (runs, batches) and the two runner hand-over tables', () => {
    const writes = [...source.matchAll(/\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_]+)/g)].map(
      (m) => m[1],
    );
    expect(new Set(writes)).toEqual(
      new Set([
        'waboo_migration_runs',
        'waboo_migration_batches',
        'waboo_migration_runner_jobs',
        'waboo_migration_runners',
      ]),
    );
  });
  it('the API response mapper exposes no internal id, creator, secret or connection string', () => {
    const service = readFileSync(join(dir, 'waboo-migration.service.ts'), 'utf8');
    const mapper = service.slice(service.indexOf('private toItem'));
    expect(mapper).not.toMatch(/created_by|createdBy|password|secret|token|mongo/i);
    expect(mapper).not.toMatch(/id: Number|id: r\.id/);
  });
});
