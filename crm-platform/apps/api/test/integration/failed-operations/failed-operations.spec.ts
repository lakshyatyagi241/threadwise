import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbClientPair, runMigrations, withTenant, type DbClientPair } from '@crm/db';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { FailedOperationsRepository } from '../../../src/modules/failed-operations/failed-operations.repository';
import { FailedOperationsService } from '../../../src/modules/failed-operations/failed-operations.service';
import { FailureCaptureService } from '../../../src/modules/failed-operations/failure-capture.service';
import { FailureRecorder } from '../../../src/modules/failed-operations/failure-recorder';
import { QUEUES } from '../../../src/infra/queue/queues';

/**
 * The failed-operation record end to end: a real BullMQ worker on a real Redis, the record and redrive on a real Postgres, as the
 * application role. CI provides both (Postgres through testcontainers; Redis from REDIS_URL). To run it without Docker, point
 * TEST_PG_OWNER_URL at a migrated database whose owner can create the `crm_app_user` role.
 */
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const QUEUE = QUEUES.WEBHOOK_INGEST;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | null | false | undefined>, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await sleep(50);
  }
}

describe('failed operations', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let owner: Client;
  let clients: DbClientPair;
  let appUrl: string;
  let connection: Redis;
  let queue: Queue;
  let worker: Worker | undefined;
  let repo: FailedOperationsRepository;
  let recorder: FailureRecorder;
  let ops: FailedOperationsService;
  let capture: FailureCaptureService;
  let prefix: string;
  let orgActive = 0;
  let orgSuspended = 0;
  const audit = { recordStandalone: vi.fn().mockResolvedValue(undefined) };
  // Seals like the real service (AES-GCM would need the key ring; the point under test is that the payload is not stored in the clear).
  const crypto = {
    encrypt: (s: string) => `sealed:${Buffer.from(s).toString('base64')}`,
    decrypt: (s: string) => Buffer.from(s.replace(/^sealed:/, ''), 'base64').toString(),
  };

  const q = async <T>(sqlText: string, params: unknown[] = []) =>
    (await owner.query(sqlText, params)).rows as T[];
  const records = () => q<Record<string, unknown>>(`SELECT * FROM failed_operations ORDER BY id`);
  const events = (uuid: string) =>
    q<{ event_type: string }>(
      `SELECT e.event_type FROM failed_operation_events e JOIN failed_operations f ON f.id = e.failed_operation_id WHERE f.uuid = $1 ORDER BY e.id`,
      [uuid],
    ).then((r) => r.map((x) => x.event_type));

  /** Starts a worker whose processor is `fn`, wired to the capture handlers exactly as the bootstrap hook wires them. */
  async function startWorker(fn: (job: Job) => Promise<unknown>) {
    // One worker at a time: a second would take jobs meant for the first.
    await worker?.close();
    worker = new Worker(QUEUE, fn, { connection: connection.duplicate(), prefix, concurrency: 4 });
    worker.on('failed', (job, err) => void capture.onFailed(QUEUE, job, err));
    worker.on('completed', (job) => void capture.onCompleted(QUEUE, job));
  }

  beforeAll(async () => {
    const ownerUrl = process.env.TEST_PG_OWNER_URL;
    let host: string;
    let ownerConn: string;
    if (ownerUrl) {
      ownerConn = ownerUrl;
      const u = new URL(ownerUrl);
      host = `${u.hostname}:${u.port}/${u.pathname.slice(1)}`;
    } else {
      container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
        .withDatabase('crm')
        .withUsername('crm')
        .withPassword('crm')
        .start();
      ownerConn = container.getConnectionUri();
      host = `${container.getHost()}:${container.getPort()}/crm`;
    }
    owner = new Client({ connectionString: ownerConn });
    await owner.connect();
    await owner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app_user') THEN
      CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; END IF; END $$`);
    if (!ownerUrl) {
      await runMigrations(ownerConn, {
        dir: resolve(__dirname, '../../../../../packages/db/migrations'),
        log: () => undefined,
      });
    }
    appUrl = `postgres://crm_app_user:test@${host}`;
    const mk = async (slug: string, status: string) =>
      (
        await owner.query<{ id: number }>(
          `INSERT INTO organizations (slug, name, status) VALUES ($1, $1, $2) ON CONFLICT (slug) DO UPDATE SET status = $2 RETURNING id`,
          [`${slug}-${randomUUID().slice(0, 6)}`, status],
        )
      ).rows[0]!.id;
    orgActive = await mk('dlq-a', 'active');
    orgSuspended = await mk('dlq-s', 'suspended');
    clients = createDbClientPair({ url: appUrl, poolMax: 4 });
    connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    prefix = `dlqtest-${randomUUID().slice(0, 8)}`;
    queue = new Queue(QUEUE, { connection: connection.duplicate(), prefix });
    const db = new DatabaseService(clients);
    repo = new FailedOperationsRepository(db);
    recorder = new FailureRecorder(repo, crypto as never);
    // Only the queue under test exists; the sweep asks for every queue in the policy and must find the others empty.
    const empty = { getFailed: async () => [], getJob: async () => undefined };
    const moduleRef = { get: (token: unknown) => (token === getQueueToken(QUEUE) ? queue : empty) };
    class FastReplay extends FailedOperationsService {
      protected override replayOptions() {
        return { attempts: 3, backoff: { type: 'fixed' as const, delay: 20 } };
      }
    }
    ops = new FastReplay(repo, crypto as never, moduleRef as never, audit as never);
    capture = new FailureCaptureService({} as never, recorder, repo, ops);
  }, 180_000);

  afterAll(async () => {
    await worker?.close();
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await queue?.close();
    connection?.disconnect();
    await owner?.query(`DELETE FROM failed_operations`).catch(() => undefined);
    await clients?.close();
    await owner?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await worker?.close();
    worker = undefined;
    await queue.obliterate({ force: true }).catch(() => undefined);
    await owner.query(`DELETE FROM failed_operations`);
    audit.recordStandalone.mockClear();
  });

  const fast = { attempts: 3, backoff: { type: 'fixed' as const, delay: 20 } };

  // ---- what BullMQ really emits ------------------------------------------------------------------------------------------------

  it('BullMQ emits `failed` for an attempt it will retry; only the last one is final, and an UnrecoverableError is final at once', async () => {
    const seen: Array<{ n: number; final: boolean }> = [];
    const { isFinalFailure } =
      await import('../../../src/modules/failed-operations/failure-capture.service');
    const watch = (w: Worker) =>
      w.on('failed', (job, err) => {
        if (job) seen.push({ n: job.attemptsMade, final: isFinalFailure(job, err) });
      });
    worker = new Worker(
      QUEUE,
      async (): Promise<unknown> => {
        throw new Error('db down');
      },
      { connection: connection.duplicate(), prefix },
    );
    watch(worker);
    await queue.add('n', {}, { ...fast, jobId: 'retry-shape' });
    await until(async () => seen.length >= 3);
    expect(seen).toEqual([
      { n: 1, final: false },
      { n: 2, final: false },
      { n: 3, final: true },
    ]);

    seen.length = 0;
    await worker.close();
    worker = new Worker(
      QUEUE,
      async (): Promise<unknown> => {
        throw new UnrecoverableError('Malformed ingest job');
      },
      { connection: connection.duplicate(), prefix },
    );
    watch(worker);
    await queue.add('n', {}, { ...fast, attempts: 10, jobId: 'poison-shape' });
    await until(async () => seen.length >= 1);
    await sleep(200);
    expect(seen).toEqual([{ n: 1, final: true }]);
  });

  // ---- capture -----------------------------------------------------------------------------------------------------------------

  it('a job that fails once and then succeeds leaves no record', async () => {
    let calls = 0;
    await startWorker(async () => {
      calls += 1;
      if (calls === 1) throw new Error('blip');
      return 'ok';
    });
    const job = await queue.add('n', { orgId: orgActive }, { ...fast, jobId: 'flaky' });
    await until(async () => (await job.getState()) === 'completed');
    await sleep(150);
    expect(await records()).toEqual([]);
  });

  it('retry exhaustion writes one durable record: identity, stable code, scrubbed summary, sealed payload, hash', async () => {
    await startWorker(async () => {
      throw new Error('Graph 500 for jane@example.com access_token=EAAGsecret12345 timed out');
    });
    await queue.add(
      'n',
      { orgId: orgActive, text: 'my card is 4111' },
      { ...fast, jobId: 'exhaust-1' },
    );
    const [rec] = await until(async () => {
      const r = await records();
      return r.length ? r : null;
    });
    expect(rec).toMatchObject({
      source_queue: QUEUE,
      original_job_id: 'exhaust-1',
      status: 'OPEN',
      failure_category: 'INFRASTRUCTURE',
      error_code: 'DEPENDENCY_UNAVAILABLE',
      attempts_made: 3,
      max_attempts: 3,
    });
    expect(Number(rec!.org_id)).toBe(orgActive);
    const summary = String(rec!.error_summary);
    expect(summary).not.toContain('jane@example.com');
    expect(summary).not.toContain('EAAGsecret12345');
    expect(String(rec!.payload_sealed)).not.toContain('4111');
    expect(rec!.payload_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await events(String(rec!.uuid))).toEqual(['CAPTURED']);
  });

  it('a poison payload is quarantined at once: BLOCKED, POISON_MESSAGE, no retry loop', async () => {
    let calls = 0;
    await startWorker(async () => {
      calls += 1;
      throw new UnrecoverableError('Malformed ingest job: orgId required');
    });
    await queue.add('n', { junk: true }, { ...fast, attempts: 10, jobId: 'poison-1' });
    const [rec] = await until(async () => {
      const r = await records();
      return r.length ? r : null;
    });
    expect(rec).toMatchObject({
      status: 'BLOCKED',
      failure_category: 'POISON_MESSAGE',
      error_code: 'PAYLOAD_INVALID',
      org_id: null,
    });
    expect(calls).toBe(1);
  });

  it('the same failure reported twice, or seen again by the sweep, is one incident', async () => {
    await startWorker(async () => {
      throw new Error('db down');
    });
    const job = await queue.add('n', { orgId: orgActive }, { ...fast, jobId: 'dup-1' });
    await until(async () => (await records()).length === 1);
    const failedJob = (await job.getState()) === 'failed' ? await queue.getJob('dup-1') : undefined;
    await capture.onFailed(QUEUE, failedJob!, new Error('db down'));
    await capture.onFailed(QUEUE, failedJob!, new Error('db down'));
    await capture.captureFailedSets();
    const recs = await records();
    expect(recs).toHaveLength(1);
    expect(await events(String(recs[0]!.uuid))).toEqual(['CAPTURED']);
  });

  it('the sweep records a failure the live event missed (database down at the moment of failure)', async () => {
    const real = repo.capture.bind(repo);
    const spy = vi.spyOn(repo, 'capture').mockRejectedValue(new Error('connection terminated'));
    await startWorker(async () => {
      throw new Error('db down');
    });
    const job = await queue.add('n', { orgId: orgActive }, { ...fast, jobId: 'miss-1' });
    await until(async () => (await job.getState()) === 'failed');
    await sleep(2500); // the handler's own three tries
    expect(await records()).toEqual([]);
    spy.mockRestore();
    void real;
    expect(await capture.captureFailedSets()).toBe(1);
    expect((await records())[0]).toMatchObject({ original_job_id: 'miss-1', status: 'OPEN' });
  }, 20_000);

  // ---- redrive -----------------------------------------------------------------------------------------------------------------

  async function failedRecord(
    jobId: string,
    org: number | null,
    extra: Partial<{ attempts: number }> = {},
  ) {
    await startWorker(async () => {
      throw new Error('db down');
    });
    await queue.add('n', org === null ? { text: 'hi' } : { orgId: org, text: 'hi' }, {
      ...fast,
      ...extra,
      jobId,
    });
    const rec = await until(async () => (await records()).find((r) => r.original_job_id === jobId));
    await worker!.close();
    worker = undefined;
    return String(rec.uuid);
  }
  const noCooldown = (uuid: string) =>
    owner.query(
      `UPDATE failed_operations SET last_replay_at = now() - interval '1 hour' WHERE uuid = $1`,
      [uuid],
    );

  it('redrive puts the stored payload back under a replay id, and the job completing resolves the record and deletes the payload', async () => {
    const uuid = await failedRecord('rd-1', orgActive);
    const seen: unknown[] = [];
    await startWorker(async (job) => {
      seen.push(job.data);
      return 'ok';
    });
    const out = await ops.redrive(uuid, 7, false);
    expect(out).toMatchObject({ redriven: true, replay: 1 });
    await until(
      async () =>
        (
          await q<{ status: string }>(`SELECT status FROM failed_operations WHERE uuid = $1`, [
            uuid,
          ])
        )[0]!.status === 'RESOLVED',
    );
    expect(seen).toEqual([{ orgId: orgActive, text: 'hi' }]);
    const [rec] = await records();
    expect(rec).toMatchObject({ payload_sealed: null, replay_count: 1 });
    expect(rec!.resolved_at).not.toBeNull();
    expect(await events(uuid)).toEqual(['CAPTURED', 'REDRIVE_ENQUEUED', 'RESOLVED']);
    expect(audit.recordStandalone).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 7,
        payload: expect.objectContaining({ outcome: 'enqueued' }),
      }),
    );
    // The logical identity did not change.
    expect(rec).toMatchObject({ original_job_id: 'rd-1' });
  });

  it('two operators redriving at once: exactly one job is queued', async () => {
    const uuid = await failedRecord('race-1', orgActive);
    const results = await Promise.all([
      ops.redrive(uuid, 1, false),
      ops.redrive(uuid, 2, false),
      ops.redrive(uuid, 3, false),
    ]);
    expect(results.filter((r) => r.redriven)).toHaveLength(1);
    expect(await queue.getJobCounts('waiting', 'delayed', 'active')).toMatchObject({ waiting: 1 });
    expect((await records())[0]).toMatchObject({ status: 'REDRIVING', replay_count: 1 });
  });

  it('a suspended workspace has no authority: refused, nothing queued, the refusal is on the record', async () => {
    const uuid = await failedRecord('susp-1', orgSuspended);
    const out = await ops.redrive(uuid, 1, false);
    expect(out).toMatchObject({ redriven: false, code: 'TENANT_INACTIVE' });
    expect(await queue.getJobCounts('waiting')).toMatchObject({ waiting: 0 });
    expect(await events(uuid)).toEqual(['CAPTURED', 'REDRIVE_REJECTED']);
  });

  it('a blocked operation needs the operator to confirm the repair', async () => {
    await startWorker(async () => {
      throw new UnrecoverableError('Malformed ingest job');
    });
    await queue.add('n', { orgId: orgActive }, { ...fast, jobId: 'blk-1' });
    const [rec] = await until(async () => {
      const r = await records();
      return r.length ? r : null;
    });
    await worker!.close();
    worker = undefined;
    const uuid = String(rec!.uuid);
    expect(await ops.redrive(uuid, 1, false)).toMatchObject({
      redriven: false,
      code: 'NEEDS_ACKNOWLEDGEMENT',
    });
    expect(await ops.redrive(uuid, 1, true)).toMatchObject({ redriven: true });
  });

  it('a record with no payload (closed, or purged) cannot be redriven; closing deletes the payload', async () => {
    const uuid = await failedRecord('term-1', orgActive);
    expect(await ops.terminate(uuid, 9, 'duplicate of an earlier delivery')).toEqual({
      closed: true,
    });
    const [rec] = await records();
    expect(rec).toMatchObject({
      status: 'TERMINAL',
      payload_sealed: null,
      resolution_reason: 'duplicate of an earlier delivery',
    });
    expect(await ops.redrive(uuid, 1, true)).toMatchObject({
      redriven: false,
      code: 'ALREADY_CLOSED',
    });
    expect(await ops.terminate(uuid, 9, 'again')).toEqual({ closed: false });
  });

  it('honours the cooldown between redrives', async () => {
    const uuid = await failedRecord('cool-1', orgActive);
    expect((await ops.redrive(uuid, 1, false)).redriven).toBe(true);
    await owner.query(
      `UPDATE failed_operations SET status = 'OPEN', claimed_at = NULL WHERE uuid = $1`,
      [uuid],
    );
    expect(await ops.redrive(uuid, 1, false)).toMatchObject({ redriven: false, code: 'COOLDOWN' });
  });

  it('a replay that keeps failing is finite: back to OPEN, then ESCALATED, then refused', async () => {
    const uuid = await failedRecord('loop-1', orgActive);
    await startWorker(async () => {
      throw new Error('still down');
    });
    for (let i = 1; i <= 3; i += 1) {
      await noCooldown(uuid);
      expect(await ops.redrive(uuid, 1, false)).toMatchObject({ redriven: true, replay: i });
      await until(
        async () =>
          (
            await q<{ status: string }>(`SELECT status FROM failed_operations WHERE uuid = $1`, [
              uuid,
            ])
          )[0]!.status !== 'REDRIVING',
      );
      await queue.remove(`dlq-${uuid}-${i}`).catch(() => undefined);
    }
    const [rec] = await records();
    expect(rec).toMatchObject({ status: 'ESCALATED', replay_count: 3 });
    await noCooldown(uuid);
    // Without the operator's confirmation that the cause is repaired it is refused.
    expect(await ops.redrive(uuid, 1, false)).toMatchObject({ redriven: false, code: 'ESCALATED' });
    expect((await events(uuid)).filter((e) => e === 'REDRIVE_ENQUEUED')).toHaveLength(3);
    // With it, one more run is allowed past the limit, and it escalates again if it fails again.
    expect(await ops.redrive(uuid, 1, true)).toMatchObject({ redriven: true, replay: 4 });
    await until(
      async () =>
        (
          await q<{ status: string }>(`SELECT status FROM failed_operations WHERE uuid = $1`, [
            uuid,
          ])
        )[0]!.status !== 'REDRIVING',
    );
    expect((await records())[0]).toMatchObject({ status: 'ESCALATED', replay_count: 4 });
  }, 30_000);

  it('a send with an unknown outcome gets a reconciliation record: no payload, never redriven, closed by a person', async () => {
    const input = {
      source: 'broadcast-send',
      orgId: orgActive,
      ref: '7:42',
      jobName: 'broadcast-recipient',
      reason: 'socket hang up for +919876543210',
    };
    const first = await recorder.recordUnknownOutcome(input);
    expect(first).toMatchObject({ recorded: true, created: true });
    // The same recipient reported again is one record.
    expect(await recorder.recordUnknownOutcome(input)).toMatchObject({ created: false });
    const row = (await records()).find((r) => r.original_job_id === '7:42')!;
    expect(row).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      failure_category: 'AMBIGUOUS',
      error_code: 'OUTCOME_UNKNOWN',
      payload_sealed: null,
    });
    expect(JSON.stringify(row)).not.toContain('919876543210');
    // There is nothing to resend: the redrive says so, and only closing it is left.
    expect(await ops.redrive(first.uuid!, 1, true)).toMatchObject({
      redriven: false,
      code: 'NOT_REPLAYABLE',
    });
    expect(await ops.terminate(first.uuid!, 1, 'checked the provider receipt: delivered')).toEqual({
      closed: true,
    });
  });

  it('an enqueue that fails hands the claim back and does not use up the budget', async () => {
    const uuid = await failedRecord('enq-1', orgActive);
    const add = vi.spyOn(queue, 'add').mockRejectedValueOnce(new Error('Redis is down'));
    const out = await ops.redrive(uuid, 1, false);
    add.mockRestore();
    expect(out).toMatchObject({ redriven: false, code: 'ENQUEUE_FAILED' });
    expect((await records())[0]).toMatchObject({ status: 'OPEN', replay_count: 0 });
    // Nothing ran, so the cooldown of the failed claim must not hold the next redrive back.
    expect((await ops.redrive(uuid, 1, false)).redriven).toBe(true);
  });

  it('a late failure report from an earlier replay does not undo the replay that is running now', async () => {
    const uuid = await failedRecord('late-1', orgActive);
    expect((await ops.redrive(uuid, 1, false)).redriven).toBe(true);
    await queue.remove(`dlq-${uuid}-1`).catch(() => undefined);
    // Replay 1 is long over; the operator started replay 2, which is running.
    await owner.query(
      `UPDATE failed_operations SET status = 'REDRIVING', replay_count = 2 WHERE uuid = $1`,
      [uuid],
    );
    await capture.onFailed(
      QUEUE,
      { id: `dlq-${uuid}-1`, attemptsMade: 10, opts: { attempts: 10 } } as never,
      new Error('boom'),
    );
    expect((await records())[0]).toMatchObject({ status: 'REDRIVING', replay_count: 2 });
  });

  it('the sweep settles a redrive whose process died: a completed replay is resolved, a missing one is handed back', async () => {
    const uuid = await failedRecord('stale-1', orgActive);
    await startWorker(async () => 'ok');
    expect((await ops.redrive(uuid, 1, false)).redriven).toBe(true);
    // The completed event was lost: put the record back to REDRIVING and old.
    await until(async () => (await queue.getJobCounts('completed')).completed === 1);
    await owner.query(
      `UPDATE failed_operations SET status = 'REDRIVING', resolved_at = NULL, resolution_reason = NULL, claimed_at = now() - interval '1 hour' WHERE uuid = $1`,
      [uuid],
    );
    await capture.settleStaleRedrives();
    expect((await records())[0]).toMatchObject({ status: 'RESOLVED' });

    const lost = await failedRecord('stale-2', orgActive);
    await owner.query(
      `UPDATE failed_operations SET status = 'REDRIVING', replay_count = 1, claimed_at = now() - interval '1 hour' WHERE uuid = $1`,
      [lost],
    );
    await capture.settleStaleRedrives();
    expect(
      (
        await q<{ status: string }>(`SELECT status FROM failed_operations WHERE uuid = $1`, [lost])
      )[0]!.status,
    ).toBe('OPEN');
  });

  // ---- isolation ---------------------------------------------------------------------------------------------------------------

  it('no workspace can read or write a failed operation, even its own (the policies are privileged-only)', async () => {
    const uuid = await failedRecord('rls-1', orgActive);
    const asTenant = await withTenant(
      clients.primary.db,
      { orgId: orgActive, userId: null },
      async (tx) => {
        const { sql } = await import('drizzle-orm');
        const seen = await tx.execute(sql`SELECT count(*)::int AS n FROM failed_operations`);
        const events = await tx.execute(
          sql`SELECT count(*)::int AS n FROM failed_operation_events`,
        );
        let wrote: string | null = null;
        try {
          await tx.execute(
            sql`UPDATE failed_operations SET status = 'TERMINAL', resolved_at = now() WHERE uuid = ${uuid}`,
          );
        } catch (e) {
          wrote = (e as Error).message;
        }
        return {
          seen: (seen.rows[0] as { n: number }).n,
          events: (events.rows[0] as { n: number }).n,
          wrote,
        };
      },
    );
    expect(asTenant.seen).toBe(0);
    expect(asTenant.events).toBe(0);
    expect((await records())[0]).toMatchObject({ status: 'OPEN' });
  });

  it('backlog reports the open count and age per queue, and closed rows age out while open ones never do', async () => {
    const open = await failedRecord('bl-1', orgActive);
    const closed = await failedRecord('bl-2', orgActive);
    await ops.terminate(closed, 1, 'not needed');
    const b = await repo.backlog();
    expect(b).toEqual([expect.objectContaining({ queue: QUEUE, open: 1 })]);
    await owner.query(
      `UPDATE failed_operations SET resolved_at = now() - interval '40 days' WHERE uuid = $1`,
      [closed],
    );
    await owner.query(
      `UPDATE failed_operations SET first_failed_at = now() - interval '90 days' WHERE uuid = $1`,
      [open],
    );
    expect(await repo.purgeClosed(30)).toBe(1);
    expect((await records()).map((r) => r.uuid)).toEqual([open]);
  });
});
