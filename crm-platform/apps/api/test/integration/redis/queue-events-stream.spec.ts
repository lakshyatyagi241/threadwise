import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUEUE_EVENTS_MAX_LEN, QUEUE_STREAMS } from '../../../src/infra/queue/queues';
import { startOwnRedis, type OwnRedis } from './own-redis';

/**
 * Sheet4 V-03. BullMQ keeps an event stream per queue and trims it at 10,000 entries unless told otherwise; nothing here reads it. The
 * queues are registered with QUEUE_STREAMS (queue.module.ts), and this pins what that buys on a real Redis: the stream stays near the cap
 * and the cost goes with it.
 */
let own: OwnRedis;
const open: Array<Queue | Worker> = [];
const RUN = randomUUID().slice(0, 8);
const conn = () => ({ host: own.host, port: own.port, maxRetriesPerRequest: null as null });

beforeAll(async () => {
  own = await startOwnRedis(['--maxmemory-policy', 'noeviction']);
}, 120_000);
afterAll(async () => {
  await Promise.all(open.map((x) => x.close().catch(() => undefined)));
  await own.stop();
});

async function drain(name: string, streams: typeof QUEUE_STREAMS | undefined, n: number) {
  const queue = new Queue(name, { connection: conn(), ...(streams ? { streams } : {}) });
  const worker = new Worker(name, async () => undefined, { connection: conn(), concurrency: 50 });
  open.push(queue, worker);
  await worker.waitUntilReady();
  let done = 0;
  const finished = new Promise<void>((ok) => worker.on('completed', () => ++done >= n && ok()));
  const jobs = Array.from({ length: n }, (_, i) => ({ name: 'j', data: { orgId: 1, id: i } }));
  for (let i = 0; i < jobs.length; i += 500) await queue.addBulk(jobs.slice(i, i + 500));
  await finished;
  await new Promise((r) => setTimeout(r, 300));
  return own.client().xlen(`bull:${name}:events`);
}

describe('BullMQ event stream cap', () => {
  it('the cap is small and the queues are registered with it', () => {
    expect(QUEUE_EVENTS_MAX_LEN).toBeLessThanOrEqual(1000);
    expect(QUEUE_STREAMS.events.maxLen).toBe(QUEUE_EVENTS_MAX_LEN);
  });

  it('a queue with the cap keeps about that many entries; without it the stream holds thousands', async () => {
    // 3,000 jobs write about 12,000 entries: more than BullMQ's own cap of 10,000.
    const capped = await drain(`ev-capped-${RUN}`, QUEUE_STREAMS, 3000);
    const plain = await drain(`ev-plain-${RUN}`, undefined, 3000);
    // BullMQ trims approximately (whole blocks of the stream), so allow a margin over the cap.
    expect(capped).toBeLessThanOrEqual(QUEUE_EVENTS_MAX_LEN * 3);
    expect(plain).toBeGreaterThan(5000);
  }, 120_000);

  it('a Queue built without the option puts BullMQ default back in the queue meta (why every process must pass it)', async () => {
    const name = `ev-meta-${RUN}`;
    const a = new Queue(name, { connection: conn(), streams: QUEUE_STREAMS });
    await a.waitUntilReady();
    const meta = () => own.client().hget(`bull:${name}:meta`, 'opts.maxLenEvents');
    await new Promise((r) => setTimeout(r, 200));
    expect(await meta()).toBe(String(QUEUE_EVENTS_MAX_LEN));
    const b = new Queue(name, { connection: conn() });
    open.push(a, b);
    await b.waitUntilReady();
    await new Promise((r) => setTimeout(r, 200));
    expect(await meta()).toBe('10000');
  });
});
