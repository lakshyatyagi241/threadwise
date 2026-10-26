import { Queue, Worker } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RuntimeMonitor,
  attachJobMetrics,
  type ObservableWorker,
} from '../../../src/modules/platform-infrastructure';
import { sleep, startOwnRedis, type OwnRedis } from './own-redis';

/**
 * Sheet 3 D-14, against a real BullMQ worker on a private Redis: a job that uses up its attempts is ONE `failed` observation (BullMQ
 * emits `failed` for every attempt; only the last has finishedOn), the series exists at 0 before it, and a job that recovers on a
 * retry is a completion with no failure. QueueJobFailed (deploy/observability/queue-capacity.rules.yml) alerts on this counter.
 */
let redis: OwnRedis;
beforeAll(async () => {
  redis = await startOwnRedis();
}, 120_000);
afterAll(async () => {
  await redis.stop();
});

const series = (monitor: RuntimeMonitor, queue: string, outcome: 'failed' | 'completed') => {
  const m = new RegExp(
    `crm_queue_jobs_total\\{[^}]*queue="${queue}",outcome="${outcome}"\\} (\\d+)`,
  ).exec(monitor.render());
  return m ? Number(m[1]) : undefined;
};

async function until(cond: () => boolean, ms = 8_000): Promise<void> {
  for (let t = 0; t < ms && !cond(); t += 50) await sleep(50);
}

describe('queue job outcome metric on a real BullMQ worker', () => {
  it('a job that fails every attempt is one failed observation, and the series was 0 before', async () => {
    const monitor = new RuntimeMonitor({ service: 'worker', intervalMs: 60_000 });
    const name = `d14-fail-${Date.now()}`;
    const queue = new Queue(name, { connection: redis.client() });
    let attempts = 0;
    const worker = new Worker(
      name,
      async () => {
        attempts++;
        throw new Error('boom');
      },
      { connection: redis.client() },
    );
    attachJobMetrics(worker as unknown as ObservableWorker, monitor);
    try {
      expect(series(monitor, name, 'failed')).toBe(0); // exists before the first failure
      await queue.add(
        't',
        {},
        { attempts: 3, backoff: { type: 'fixed', delay: 50 }, removeOnFail: true },
      );
      await until(() => (series(monitor, name, 'failed') ?? 0) >= 1);
      await sleep(400); // room for a wrong extra count from an earlier attempt
      expect(attempts).toBe(3); // it really was tried three times
      expect(series(monitor, name, 'failed')).toBe(1); // but it is one failed job
      expect(series(monitor, name, 'completed')).toBe(0);
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
      monitor.stop();
    }
  }, 30_000);

  it('a job that fails once and then succeeds is a completion and no failure', async () => {
    const monitor = new RuntimeMonitor({ service: 'worker', intervalMs: 60_000 });
    const name = `d14-flaky-${Date.now()}`;
    const queue = new Queue(name, { connection: redis.client() });
    let calls = 0;
    const worker = new Worker(
      name,
      async () => {
        if (++calls === 1) throw new Error('first attempt fails');
      },
      { connection: redis.client() },
    );
    attachJobMetrics(worker as unknown as ObservableWorker, monitor);
    try {
      await queue.add(
        't',
        {},
        { attempts: 3, backoff: { type: 'fixed', delay: 50 }, removeOnComplete: true },
      );
      await until(() => (series(monitor, name, 'completed') ?? 0) >= 1);
      await sleep(200);
      expect(calls).toBe(2);
      expect(series(monitor, name, 'completed')).toBe(1);
      expect(series(monitor, name, 'failed')).toBe(0);
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
      monitor.stop();
    }
  }, 30_000);
});
