/**
 * Container healthcheck for the worker, which serves no HTTP (TW-INFRA-015). Exit 0 when this container's worker has beaten
 * recently, 1 otherwise:
 *
 *   healthcheck:
 *     test: ['CMD', 'node', 'dist/src/modules/platform-infrastructure/observability/worker-probe.js']
 *     interval: 30s
 *     start_period: 40s
 *
 * Standalone on purpose: it loads no Nest, no database client and no config module, only a Redis connection, so it stays
 * cheap enough to run every few seconds and cannot fail for any reason but "the worker is not beating".
 */
import { hostname } from 'node:os';
import { Redis } from 'ioredis';
import { ALIVE_FOR_BEATS, WORKERS_KEY } from './worker-heartbeat';

/** True if some member of the set for `host` has a score newer than `now - aliveMs`. Exported for the test. */
export async function workerIsBeating(
  redis: Pick<Redis, 'zscan'>,
  host: string,
  aliveMs: number,
  now: number = Date.now(),
): Promise<boolean> {
  let cursor = '0';
  do {
    const [next, entries] = await redis.zscan(
      WORKERS_KEY,
      cursor,
      'MATCH',
      `${host}:*`,
      'COUNT',
      100,
    );
    for (let i = 0; i < entries.length; i += 2) {
      if (Number(entries[i + 1]) >= now - aliveMs) return true;
    }
    cursor = next;
  } while (cursor !== '0');
  return false;
}

async function main(): Promise<void> {
  const beatSeconds = Number(process.env.INFRA_WORKER_HEARTBEAT_SECONDS) || 10;
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    lazyConnect: true,
  });
  redis.on('error', () => undefined);
  // A Redis that accepts the connection but never answers would hang connect(); fail on our own before docker's timeout kills us.
  setTimeout(() => process.exit(1), 3000).unref();
  try {
    await redis.connect();
    const beating = await workerIsBeating(redis, hostname(), beatSeconds * ALIVE_FOR_BEATS * 1000);
    process.exitCode = beating ? 0 : 1;
  } catch {
    process.exitCode = 1;
  } finally {
    redis.disconnect();
  }
}

if (require.main === module) void main();
