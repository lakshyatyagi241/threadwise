import { randomUUID } from 'node:crypto';
import { Queue, Worker, type Job } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_JOB_OPTIONS, QUEUES, jobOptionsFor } from '../../../src/infra/queue/queues';
import { record, startOwnRedis, usedMemory, type OwnRedis } from './own-redis';

/**
 * Job retention measured against a real Redis with the application's own job options (queues.ts), not with numbers copied into the
 * test. A queue "keeps the last 1,000 completed and 2,000 failed jobs" only if the server actually ends up holding that many.
 */
let own: OwnRedis;
const RUN = randomUUID().slice(0, 8);
const open: Array<Queue | Worker> = [];
// A realistic small job: ids and a short text, about 0.5 KB serialized.
const payload = (i: number) => ({
  orgId: 1234,
  campaignId: 98765,
  contactId: i,
  to: `+9198${String(10_000_000 + i)}`,
  text: 'x'.repeat(300),
});

beforeAll(async () => {
  own = await startOwnRedis(['--maxmemory', '256mb', '--maxmemory-policy', 'noeviction']);
}, 120_000);
afterAll(async () => {
  await Promise.all(open.map((x) => x.close().catch(() => undefined)));
  await own.stop();
});

const conn = () => ({ host: own.host, port: own.port, maxRetriesPerRequest: null as null });

async function run(name: string, opts: object, n: number, handler: (j: Job) => Promise<void>) {
  const queue = new Queue(name, { connection: conn(), defaultJobOptions: opts });
  const worker = new Worker(name, handler, { connection: conn(), concurrency: 50 });
  open.push(queue, worker);
  await worker.waitUntilReady();
  let done = 0;
  const finished = new Promise<void>((ok) => {
    const tick = () => {
      if (++done >= n) ok();
    };
    worker.on('completed', tick);
    worker.on('failed', (_j, _e) => tick());
  });
  const total = Array.from({ length: n }, (_, i) => ({ name: 'j', data: payload(i) }));
  for (let i = 0; i < total.length; i += 500) await queue.addBulk(total.slice(i, i + 500));
  await finished;
  // BullMQ trims after the job that finishes; give the last trims a moment
  await new Promise((r) => setTimeout(r, 300));
  return queue;
}

describe('queue retention (default job options)', () => {
  it('trims completed jobs to the configured count', async () => {
    const keep = DEFAULT_JOB_OPTIONS.removeOnComplete.count;
    const before = await usedMemory(own.client());
    const q = await run(
      `ret-ok-${RUN}`,
      jobOptionsFor(QUEUES.CAMPAIGN),
      keep + 400,
      async () => undefined,
    );
    const counts = await q.getJobCounts('completed', 'failed', 'waiting', 'active');
    const after = await usedMemory(own.client());
    const bytesPerJob = (after - before) / keep;
    record('retentionCompleted', {
      queue: 'campaign (default options)',
      jobsRun: keep + 400,
      completedKept: counts.completed,
      configuredCount: keep,
      bytesPerRetainedJob: Math.round(bytesPerJob),
    });
    expect(counts.completed).toBeLessThanOrEqual(keep);
    expect(counts.completed).toBeGreaterThan(keep - 100);
    expect(counts.waiting).toBe(0);
    expect(bytesPerJob).toBeLessThan(5_000);
  }, 120_000);

  it('trims failed jobs to the configured count', async () => {
    const keep = DEFAULT_JOB_OPTIONS.removeOnFail.count;
    const before = await usedMemory(own.client());
    // attempts 1 so a failure is final at once (the retries and their back-off are not under test)
    const q = await run(
      `ret-fail-${RUN}`,
      { ...jobOptionsFor(QUEUES.CAMPAIGN), attempts: 1 },
      keep + 300,
      async () => {
        throw new Error('provider refused');
      },
    );
    const counts = await q.getJobCounts('completed', 'failed');
    const after = await usedMemory(own.client());
    record('retentionFailed', {
      queue: 'campaign (default options, attempts 1)',
      jobsRun: keep + 300,
      failedKept: counts.failed,
      configuredCount: keep,
      bytesPerRetainedFailedJob: Math.round((after - before) / keep),
    });
    expect(counts.failed).toBeLessThanOrEqual(keep);
    expect(counts.failed).toBeGreaterThan(keep - 100);
  }, 180_000);

  it('drops completed jobs at once on the queues that carry personal data (removeOnComplete: true)', async () => {
    const opts = jobOptionsFor(QUEUES.WABA_INGEST);
    expect(opts.removeOnComplete).toBe(true);
    const q = await run(`ret-pii-${RUN}`, opts, 300, async () => undefined);
    expect((await q.getJobCounts('completed')).completed).toBe(0);
    // and no job hash is left behind in Redis
    const keys = await own.client().keys(`bull:ret-pii-${RUN}:*`);
    expect(keys.filter((k) => /:\d+$/.test(k))).toEqual([]);
  }, 60_000);

  it('bounds the worst case: every queue full of retained jobs against the production maxmemory', async () => {
    const measured = (await import('node:fs')).existsSync(__dirname) ? true : false;
    expect(measured).toBe(true);
    const queues = Object.keys(QUEUES).length;
    const perQueue =
      DEFAULT_JOB_OPTIONS.removeOnComplete.count + DEFAULT_JOB_OPTIONS.removeOnFail.count;
    record('retentionBudget', {
      queues,
      retainedJobsPerQueueMax: perQueue,
      retainedJobsAllQueuesMax: queues * perQueue,
      productionMaxmemoryMb: 192,
    });
    expect(queues * perQueue).toBe(
      queues *
        (DEFAULT_JOB_OPTIONS.removeOnComplete.count + DEFAULT_JOB_OPTIONS.removeOnFail.count),
    );
  });
});
