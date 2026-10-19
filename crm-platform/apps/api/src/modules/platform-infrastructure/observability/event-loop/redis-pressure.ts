import type { Registry } from '@crm/observability';

/** What the dashboards and alerts need from `INFO`. Every field is 0 when the server did not report it (`maxmemory` is 0 when unlimited). */
export interface RedisInfoSnapshot {
  usedMemoryBytes: number;
  maxMemoryBytes: number;
  connectedClients: number;
  blockedClients: number;
  /** Keys over every database (`INFO keyspace`). */
  keys: number;
  /** Cumulative since the server started. */
  evictedKeys: number;
  rejectedConnections: number;
  opsPerSecond: number;
}

const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Parses the text of `INFO` (all sections). Pure, so it is testable without a server. */
export function parseRedisInfo(text: string): RedisInfoSnapshot {
  const f: Record<string, string> = {};
  let keys = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 1);
    if (/^db\d+$/.test(k)) keys += num(/keys=(\d+)/.exec(v)?.[1]);
    else f[k] = v;
  }
  return {
    usedMemoryBytes: num(f.used_memory),
    maxMemoryBytes: num(f.maxmemory),
    connectedClients: num(f.connected_clients),
    blockedClients: num(f.blocked_clients),
    keys,
    evictedKeys: num(f.evicted_keys),
    rejectedConnections: num(f.rejected_connections),
    opsPerSecond: num(f.instantaneous_ops_per_sec),
  };
}

/**
 * Redis server numbers as Prometheus series (item #67). `INFO` is one cheap command, so the server is asked once per sample and nothing
 * here scales with the number of keys. Two things the queue-depth metrics cannot say: how full the server is against its `maxmemory`
 * (at `noeviction` a full server refuses every write, and workers stop taking jobs: see worker-oom-guard), and how many connections the
 * processes hold between them. Series carry no tenant, key or queue label.
 */
export function createRedisSampler(registry: Registry) {
  const up = registry.gauge('crm_redis_up', '1 when the last INFO answered, 0 when it failed');
  const used = registry.gauge('crm_redis_memory_used_bytes', 'Redis used_memory');
  const max = registry.gauge('crm_redis_memory_max_bytes', 'Redis maxmemory (0 = unlimited)');
  const clients = registry.gauge(
    'crm_redis_connected_clients',
    'Redis connected_clients, all processes together',
  );
  const blocked = registry.gauge(
    'crm_redis_blocked_clients',
    'Redis blocked_clients (workers waiting for a job)',
  );
  const keys = registry.gauge('crm_redis_keys', 'Keys over every database');
  const ops = registry.gauge('crm_redis_ops_per_second', 'Redis instantaneous_ops_per_sec');
  const evicted = registry.counter(
    'crm_redis_evicted_keys_total',
    'Keys Redis evicted to stay under maxmemory (expected 0 under noeviction)',
  );
  const rejected = registry.counter(
    'crm_redis_rejected_connections_total',
    'Connections Redis refused (maxclients reached)',
  );
  evicted.inc(0); // the series exists from the first scrape, so increase() has a starting point
  rejected.inc(0);
  let lastEvicted: number | null = null;
  let lastRejected: number | null = null;

  return {
    async sample(redis: { info(): Promise<string> }): Promise<RedisInfoSnapshot | null> {
      let s: RedisInfoSnapshot;
      try {
        s = parseRedisInfo(await redis.info());
      } catch {
        up.set(0); // the last numbers stay; the alert is on crm_redis_up
        return null;
      }
      up.set(1);
      used.set(s.usedMemoryBytes);
      max.set(s.maxMemoryBytes);
      clients.set(s.connectedClients);
      blocked.set(s.blockedClients);
      keys.set(s.keys);
      ops.set(s.opsPerSecond);
      // Redis counters are cumulative; a restart resets them, so only a positive step is added.
      if (lastEvicted !== null && s.evictedKeys > lastEvicted)
        evicted.inc(s.evictedKeys - lastEvicted);
      if (lastRejected !== null && s.rejectedConnections > lastRejected)
        rejected.inc(s.rejectedConnections - lastRejected);
      lastEvicted = s.evictedKeys;
      lastRejected = s.rejectedConnections;
      return s;
    },
  };
}
