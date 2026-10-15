// Runs REAL BullMQ jobs through the job-metrics hook and checks what the monitor records. Needs a throwaway Redis:
//
//   docker run -d --rm --name el-job-redis -p 56379:6379 redis:7-alpine
//   cd apps/api && node node_modules/tsx/dist/cli.mjs ../../tools/event-loop-audit/verify-job-metrics.ts
//   docker stop el-job-redis
//
// REDIS_PORT overrides 56379. Exit 1 when an expectation fails. Uses its own queue name, so it touches nothing the app uses.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  RuntimeMonitor,
  attachJobMetrics,
  type ObservableWorker,
} from '../../apps/api/src/modules/platform-infrastructure/observability/event-loop';

const require = createRequire(resolve(__dirname, '../../apps/api/package.json'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Queue, Worker } = require('bullmq') as typeof import('bullmq');

const QUEUE = `elverify${Date.now()}`;
const connection = {
  host: '127.0.0.1',
  port: Number(process.env.REDIS_PORT ?? 56379),
  maxRetriesPerRequest: null,
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DELAY_MS = 1500;

async function main(): Promise<void> {
  const monitor = new RuntimeMonitor({ service: 'worker', instance: 'verify', intervalMs: 60_000 });
  const queue = new Queue(QUEUE, { connection });
  let retryAttempt = 0;
  const worker = new Worker(
    QUEUE,
    async (job) => {
      if (job.name === 'ok') await sleep(50);
      if (job.name === 'fail') throw new Error('expected failure');
      if (job.name === 'retry') {
        retryAttempt += 1;
        await sleep(20);
        if (retryAttempt === 1) throw new Error('first attempt fails');
      }
      if (job.name === 'delayed') await sleep(30);
    },
    { connection, concurrency: 1 },
  );
  attachJobMetrics(worker as unknown as ObservableWorker, monitor);
  await worker.waitUntilReady();

  await queue.add('ok', {});
  await queue.add('fail', {}, { attempts: 1 });
  await queue.add('retry', {}, { attempts: 2, backoff: { type: 'fixed', delay: 100 } });
  await queue.add('delayed', {}, { delay: DELAY_MS });

  // BullMQ reports a job when it reaches a FINAL state, not for an attempt that will be retried: ok, fail, retry (its 2nd attempt),
  // delayed = 4 observations.
  const expectedFinished = 4;
  const finished = () =>
    [...monitor.render().matchAll(/^crm_queue_jobs_total\{[^}]*\} (\d+)$/gm)].reduce(
      (n, m) => n + Number(m[1]),
      0,
    );
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && finished() < expectedFinished) await sleep(100);

  const out = monitor.render();
  const num = (metric: string, extra = '') =>
    Number(
      new RegExp(`${metric}\\{[^}]*queue="${QUEUE}"${extra}[^}]*\\} ([\\d.e+-]+)`).exec(out)?.[1] ??
        NaN,
    );
  const completed = num('crm_queue_jobs_total', ',outcome="completed"');
  const failed = num('crm_queue_jobs_total', ',outcome="failed"');
  const waitCount = num('crm_queue_job_wait_seconds_count');
  const durCount = num('crm_queue_job_duration_seconds_count');
  const waitSum = num('crm_queue_job_wait_seconds_sum');
  const durSum = num('crm_queue_job_duration_seconds_sum');

  const checks: Array<[string, boolean, unknown]> = [
    ['completed = ok, retry (2nd attempt), delayed  (3)', completed === 3, completed],
    [
      'failed = fail only; a retried attempt is not reported by the worker  (1)',
      failed === 1,
      failed,
    ],
    ['duration observed once per job that finished  (4)', durCount === 4, durCount],
    [
      'wait observed for ok, fail, delayed but not for the retried job  (3)',
      waitCount === 3,
      waitCount,
    ],
    [
      `total wait far below the ${DELAY_MS} ms the delayed job asked for (the delay is excluded)`,
      waitSum < (DELAY_MS / 1000) * 0.8,
      waitSum,
    ],
    ['total duration plausible (0.1 s to 3 s)', durSum > 0.1 && durSum < 3, durSum],
    [
      'no error text or job name in the output',
      !/expected failure|first attempt fails/.test(out),
      'n/a',
    ],
  ];
  let bad = 0;
  for (const [name, ok, value] of checks) {
    if (!ok) bad += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${String(value)})`);
  }
  console.log(
    out
      .split('\n')
      .filter((l) => l.includes(QUEUE) && /jobs_total|_count|_sum/.test(l))
      .join('\n'),
  );

  await worker.close();
  await queue.obliterate({ force: true });
  await queue.close();
  monitor.stop();
  process.exit(bad === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
