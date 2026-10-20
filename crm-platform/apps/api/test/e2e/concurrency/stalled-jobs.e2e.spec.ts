import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUEUES, jobOptionsFor } from '../../../src/infra/queue/queues';
import { sleep } from './support';

/**
 * QA Sheet3 #15, CC-JOB-03: BullMQ jobs and worker processes. Two real worker processes (tsx) consume one queue on a private Redis
 * (a container this test starts and removes; the shared Redis is not touched). Jobs are added with the repo's own job options.
 * A worker killed with SIGKILL while it holds a job: another worker takes the job over once BullMQ notices the stall, the job
 * finishes once, it is not lost, and it is not run more often than BullMQ's documented one retry for a stalled job.
 */
const API = resolve(__dirname, '../../..');
const SCRIPT = resolve(__dirname, 'node/job-node.ts');
let redisBox: StartedTestContainer;
let url: string;
let redis: Redis;
const children: ChildProcess[] = [];

beforeAll(async () => {
  redisBox = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
  url = `redis://${redisBox.getHost()}:${redisBox.getMappedPort(6379)}`;
  redis = new Redis(url, { maxRetriesPerRequest: null });
}, 120_000);
afterAll(async () => {
  for (const c of children) c.kill('SIGKILL');
  redis?.disconnect();
  await redisBox?.stop();
});

let seq = 0;
const nextQueue = () => `conc-jobs-${Date.now().toString(36)}-${seq++}`;

function startWorker(
  queue: string,
  node: string,
  env: Record<string, string> = {},
): { proc: ChildProcess; ready: Promise<void> } {
  const proc = spawn(process.execPath, ['--import', 'tsx', SCRIPT], {
    cwd: API,
    env: { ...process.env, REDIS_URL: url, QUEUE_NAME: queue, NODE_NAME: node, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(proc);
  const ready = new Promise<void>((res, rej) => {
    proc.stdout!.on('data', (d) => String(d).includes('READY') && res());
    proc.on('error', rej);
    proc.on('exit', (c) => rej(new Error(`worker ${node} exited early with ${c}`)));
  });
  ready.catch(() => undefined);
  return { proc, ready };
}

const tally = async (queue: string, list: 'started' | 'finished') => {
  const rows = await redis.lrange(`${queue}:${list}`, 0, -1);
  const per = new Map<string, string[]>();
  for (const r of rows) {
    const [job, node] = r.split(':');
    per.set(job!, [...(per.get(job!) ?? []), node!]);
  }
  return per;
};
const until = async (fn: () => Promise<boolean>, ms: number, what: string) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${what}`);
};

describe('CC-JOB-03 parallel consumers and a dead worker', () => {
  it('40 jobs on two worker processes, one job id added 6 times at once: every job is run once, the repeated id makes one job, both workers took part', async () => {
    const queueName = nextQueue();
    const queue = new Queue(queueName, {
      connection: new Redis(url, { maxRetriesPerRequest: null }),
    });
    const opts = jobOptionsFor(QUEUES.WEBHOOK_INGEST);
    const a = startWorker(queueName, 'node-a');
    const b = startWorker(queueName, 'node-b');
    await Promise.all([a.ready, b.ready]);
    await Promise.all([
      ...Array.from({ length: 40 }, (_, i) =>
        queue.add('work', { i }, { ...opts, jobId: `j${i}` }),
      ),
      ...Array.from({ length: 6 }, () =>
        queue.add('work', { i: 'same' }, { ...opts, jobId: 'same' }),
      ),
    ]);
    await until(
      async () => (await tally(queueName, 'finished')).size === 41,
      30_000,
      'all 41 jobs',
    );
    await sleep(500);
    const started = await tally(queueName, 'started');
    const finished = await tally(queueName, 'finished');
    expect(finished.size).toBe(41);
    for (const [job, nodes] of started) expect(nodes, `${job} started`).toHaveLength(1);
    for (const [job, nodes] of finished) expect(nodes, `${job} finished`).toHaveLength(1);
    const nodes = new Set([...finished.values()].flat());
    expect(nodes.size).toBe(2);
    await queue.close();
  }, 120_000);

  it('a worker is killed (SIGKILL) while it holds a job: the other worker takes the job over, it finishes once, nothing is lost, it ran at most twice', async () => {
    const queueName = nextQueue();
    const queue = new Queue(queueName, {
      connection: new Redis(url, { maxRetriesPerRequest: null }),
    });
    const opts = jobOptionsFor(QUEUES.WEBHOOK_INGEST);
    // Worker A is the only one running when the slow job is added, so A holds it; B starts after A is dead.
    const a = startWorker(queueName, 'node-a', {
      SLOW_JOBS: 'slow',
      SLOW_MS: '120000',
      CONCURRENCY: '1',
    });
    await a.ready;
    await queue.add('work', { slow: true }, { ...opts, jobId: 'slow' });
    await until(
      async () => (await tally(queueName, 'started')).get('slow')?.[0] === 'node-a',
      20_000,
      'node-a to take the slow job',
    );
    a.proc.kill('SIGKILL');
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        queue.add('work', { i }, { ...opts, jobId: `after${i}` }),
      ),
    );
    const b = startWorker(queueName, 'node-b');
    await b.ready;
    try {
      await until(
        async () => (await tally(queueName, 'finished')).size === 11,
        40_000,
        'the stalled job and the 10 others to finish',
      );
    } catch (err) {
      const j = await queue.getJob('slow');
      throw new Error(
        `${String(err)}; slow job state=${await j?.getState()} stalledCounter=${j?.stalledCounter} failedReason=${j?.failedReason}; started=${JSON.stringify([...(await tally(queueName, 'started'))])}; finished=${JSON.stringify([...(await tally(queueName, 'finished'))])}`,
      );
    }
    await sleep(500);
    const started = await tally(queueName, 'started');
    const finished = await tally(queueName, 'finished');
    expect(finished.get('slow'), 'the stalled job finishes once, on the survivor').toEqual([
      'node-b',
    ]);
    expect(started.get('slow'), 'started by the dead worker, then taken over once').toEqual([
      'node-a',
      'node-b',
    ]);
    for (let i = 0; i < 10; i++) expect(finished.get(`after${i}`)).toHaveLength(1);
    const job = await queue.getJob('slow');
    expect(await job?.getState()).toBe('completed');
    await queue.close();
  }, 150_000);
});
