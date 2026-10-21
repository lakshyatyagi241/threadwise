/**
 * One BullMQ worker "node" for the stalled-job test: its own OS process and Redis connection. The handler records every start and every
 * finish of a job in plain Redis lists (`<prefix>:started`, `<prefix>:finished`) so the test can count them; SLOW_JOBS names job ids
 * that take a long time, so the process can be killed while it holds them.
 *
 * Run with tsx: REDIS_URL, QUEUE_NAME, NODE_NAME required.
 */
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';

const url = process.env.REDIS_URL!;
const queue = process.env.QUEUE_NAME!;
const node = process.env.NODE_NAME!;
const slow = new Set((process.env.SLOW_JOBS ?? '').split(',').filter(Boolean));
const slowMs = Number(process.env.SLOW_MS ?? 60_000);
const concurrency = Number(process.env.CONCURRENCY ?? 4);

const log = new Redis(url, { maxRetriesPerRequest: null });
const connection = new Redis(url, { maxRetriesPerRequest: null });

new Worker(
  queue,
  async (job) => {
    await log.rpush(`${queue}:started`, `${job.id}:${node}`);
    await new Promise((r) => setTimeout(r, slow.has(String(job.id)) ? slowMs : 20));
    await log.rpush(`${queue}:finished`, `${job.id}:${node}`);
  },
  // Short lock and stall check so a dead worker is noticed in seconds, not the 30 s defaults; everything else is BullMQ's default,
  // including maxStalledCount = 1.
  { connection, concurrency, lockDuration: 2_000, stalledInterval: 1_000 },
);
process.stdout.write(`READY ${node}\n`);
