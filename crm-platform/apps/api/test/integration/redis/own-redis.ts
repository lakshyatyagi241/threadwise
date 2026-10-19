import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Redis, type RedisOptions } from 'ioredis';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

/**
 * A throwaway Redis owned by one test file (item #67). Never the shared dev Redis: these tests fill memory, change server settings and
 * restart the server. The container gets a random name (`nf-redis-67-<hex>`) and a free host port; testcontainers' reaper removes it
 * when the run ends, and `stop()` removes it at once.
 *
 * `REDIS_AUDIT_URL` points the suite at a Redis you started yourself (for example `docker run -p 0:6379 redis:7-alpine ...`). Such a
 * server must be disposable too, and the settings tests (maxmemory, restart) are skipped against it.
 */
export interface OwnRedis {
  url: string;
  host: string;
  port: number;
  /** The container, or null when the suite runs against REDIS_AUDIT_URL. */
  container: StartedTestContainer | null;
  /** A client for the test's own use. */
  client: (opts?: RedisOptions) => Redis;
  stop: () => Promise<void>;
}

const freePort = (): Promise<number> =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });

export async function startOwnRedis(args: string[] = []): Promise<OwnRedis> {
  const external = process.env.REDIS_AUDIT_URL;
  const made: Redis[] = [];
  const mk = (url: string) => (opts?: RedisOptions) => {
    const r = new Redis(url, { maxRetriesPerRequest: null, ...opts });
    made.push(r);
    return r;
  };
  if (external) {
    const u = new URL(external);
    // The shared dev Redis (and the other project's Redis) must never be a target of these tests.
    if (['6379', '56379', ''].includes(u.port))
      throw new Error(
        `REDIS_AUDIT_URL points at a shared Redis port (${u.port || '6379'}); refusing`,
      );
    return {
      url: external,
      host: u.hostname,
      port: Number(u.port),
      container: null,
      client: mk(external),
      stop: async () => {
        await Promise.all(made.map((r) => r.quit().catch(() => r.disconnect())));
      },
    };
  }
  const hostPort = await freePort();
  const container = await new GenericContainer('redis:7-alpine')
    .withName(`nf-redis-67-${randomBytes(4).toString('hex')}`)
    .withExposedPorts({ container: 6379, host: hostPort })
    .withCommand(['redis-server', ...args])
    .start();
  const url = `redis://127.0.0.1:${hostPort}`;
  return {
    url,
    host: '127.0.0.1',
    port: hostPort,
    container,
    client: mk(url),
    stop: async () => {
      await Promise.all(made.map((r) => r.quit().catch(() => r.disconnect())));
      await container.stop({ remove: true, timeout: 2 });
    },
  };
}

/** `INFO <section>` as a map. */
export async function info(r: Redis, section: string): Promise<Record<string, string>> {
  const text = await r.info(section);
  return Object.fromEntries(
    text
      .split('\r\n')
      .filter((l) => l && !l.startsWith('#') && l.includes(':'))
      .map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)]),
  );
}

export const usedMemory = async (r: Redis): Promise<number> =>
  Number((await info(r, 'memory')).used_memory);
export const clientCount = async (r: Redis): Promise<number> =>
  Number((await info(r, 'clients')).connected_clients);

const RESULTS = resolve(__dirname, '../../../../../docs/performance/redis/measurements.json');

/**
 * Writes one measured number to docs/performance/redis/measurements.json when REDIS_AUDIT_WRITE=1 (how the report's numbers were
 * produced). A plain test run only asserts.
 */
export function record(section: string, values: Record<string, unknown>): void {
  if (process.env.REDIS_AUDIT_WRITE !== '1') return;
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse(readFileSync(RESULTS, 'utf8')) as Record<string, unknown>;
  } catch {
    /* first write */
  }
  all[section] = values;
  mkdirSync(dirname(RESULTS), { recursive: true });
  writeFileSync(RESULTS, JSON.stringify(all, null, 2) + '\n');
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
