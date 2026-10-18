import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyAccepted,
  evaluate,
  heapLimitBytes,
  parseCompose,
  parseSize,
  processorConcurrency,
  serviceMemLimit,
} from './lib.mjs';

const MIB = 1024 * 1024;
const registry = {
  thresholds: {
    heapToMemoryMax: 0.75,
    redisToMemoryMax: 0.6,
    hostHeadroom: 0.2,
    dbConnectionReserve: 0.15,
    workerStopGraceMinSeconds: 60,
    workerConcurrencyPerPoolSlot: 3,
  },
  hosts: {},
};
const workerConc = { processors: [], total: 4, implicit: [] };
const run = (services, extra = {}) =>
  evaluate(
    {
      deployments: [{ name: 'd', services }],
      workerConcurrency: workerConc,
      workerPoolMax: 10,
      ...extra,
    },
    registry,
  );
const status = (results, id) => results.find((r) => r.id === id)?.status;
const base = {
  name: 'api',
  memLimit: 1024 * MIB,
  cpuLimit: 1,
  pidsLimit: 256,
  logging: true,
  runsNode: true,
  heapLimit: 640 * MIB,
};

test('parseSize reads compose and redis spellings', () => {
  assert.equal(parseSize('1g'), 1024 * MIB);
  assert.equal(parseSize('768m'), 768 * MIB);
  assert.equal(parseSize('192mb'), 192 * MIB);
  assert.equal(parseSize('1536M'), 1536 * MIB);
  assert.equal(parseSize('lots'), undefined);
});

test('parseCompose follows anchors, merges, lists and skips block scalars', () => {
  const doc = parseCompose(`
x-slot: &slot
  mem_limit: 1g
  logging:
    driver: json-file
x-env: &env
  NODE_OPTIONS: --max-old-space-size=640
services:
  a:
    <<: *slot
    environment:
      <<: *env
      DB_POOL_MAX: '10'
  b:
    command:
      - postgres
      - -c
      - max_connections=100
    entrypoint: ['bash', '-c']
    script: |
      echo "not: a key"
      more: text
    mem_limit: 256m
`);
  assert.equal(serviceMemLimit(doc.services.a), 1024 * MIB);
  assert.equal(heapLimitBytes(doc.services.a.environment.NODE_OPTIONS), 640 * MIB);
  assert.equal(doc.services.a.environment.DB_POOL_MAX, '10');
  assert.deepEqual(doc.services.b.command, ['postgres', '-c', 'max_connections=100']);
  assert.equal(serviceMemLimit(doc.services.b), 256 * MIB);
});

test('a service with every limit passes; each missing limit fails its own check', () => {
  assert.equal(status(run([base]), 'd:mem-limit'), 'PASSED');
  assert.equal(status(run([{ ...base, memLimit: undefined }]), 'd:mem-limit'), 'FAILED');
  assert.equal(status(run([{ ...base, cpuLimit: undefined }]), 'd:cpu-limit'), 'FAILED');
  assert.equal(status(run([{ ...base, pidsLimit: undefined }]), 'd:pids-limit'), 'FAILED');
  assert.equal(status(run([{ ...base, logging: false }]), 'd:log-cap'), 'FAILED');
  assert.equal(
    status(
      run([{ ...base, oneShot: true, memLimit: undefined, cpuLimit: undefined }]),
      'd:mem-limit',
    ),
    'PASSED',
  );
});

test('V8 heap above 75% of the container limit fails', () => {
  assert.equal(status(run([{ ...base, heapLimit: 900 * MIB }]), 'd:heap-headroom'), 'FAILED');
  assert.equal(status(run([{ ...base, heapLimit: undefined }]), 'd:heap-set'), 'FAILED');
});

test('db connections: slots and the worker at release overlap must fit under max_connections minus the reserve', () => {
  const pg = { name: 'postgres', memLimit: 1024 * MIB, maxConnections: 100 };
  const apps = [10, 10, 10].map((n, i) => ({ ...base, name: `app${i}`, dbPoolMax: n }));
  assert.equal(status(run([pg, ...apps]), 'd:db-connections'), 'PASSED');
  assert.equal(
    status(run([pg, ...apps.map((a) => ({ ...a, dbPoolMax: 30 }))]), 'd:db-connections'),
    'FAILED',
  );
  // a second pool for a replica URL that differs doubles the need
  assert.equal(
    status(
      run([pg, ...apps.map((a) => ({ ...a, dbPoolMax: 20, poolsPerProcess: 2 }))]),
      'd:db-connections',
    ),
    'FAILED',
  );
});

test('redis: needs maxmemory, room for the AOF rewrite, and noeviction', () => {
  const redis = {
    name: 'redis',
    isRedis: true,
    memLimit: 256 * MIB,
    redisMaxMemory: 192 * MIB,
    redisPolicy: 'noeviction',
  };
  assert.equal(status(run([redis]), 'd:redis-maxmemory'), 'FAILED'); // 75% > 60%
  assert.equal(
    status(run([{ ...redis, redisMaxMemory: 128 * MIB }]), 'd:redis-maxmemory'),
    'PASSED',
  );
  assert.equal(
    status(run([{ ...redis, redisMaxMemory: undefined }]), 'd:redis-maxmemory'),
    'FAILED',
  );
  assert.equal(
    status(
      run([{ ...redis, redisMaxMemory: 128 * MIB, redisPolicy: 'allkeys-lru' }]),
      'd:redis-eviction',
    ),
    'FAILED',
  );
});

test('host budget is BLOCKED while the host size is unknown, then compared', () => {
  assert.equal(status(run([base]), 'd:host-budget'), 'BLOCKED');
  const withHost = (bytes) =>
    evaluate(
      {
        deployments: [{ name: 'd', services: [base] }],
        workerConcurrency: workerConc,
        workerPoolMax: 10,
      },
      { ...registry, hosts: { d: { memoryBytes: bytes } } },
    );
  assert.equal(status(withHost(1024 * MIB), 'd:host-budget'), 'FAILED'); // 1 GiB limit does not fit in 80% of 1 GiB
  assert.equal(status(withHost(4096 * MIB), 'd:host-budget'), 'PASSED');
});

test('worker concurrency is counted from @Processor options, defaulting to 1', () => {
  const r = processorConcurrency([
    ['a.ts', '@Processor(QUEUES.A, { concurrency: 4 })'],
    ['b.ts', '@Processor(QUEUES.B)'],
    ['c.ts', '@Processor(QUEUES.C, {\n  concurrency: 16,\n  limiter: { max: 1, duration: 1 },\n})'],
  ]);
  assert.equal(r.total, 21);
  assert.deepEqual(
    r.implicit.map((i) => i.queue),
    ['B'],
  );
});

test('accepted gaps: unlisted failure is a regression, a now-passing entry is stale, an old one is expired', () => {
  const results = [
    { id: 'x', status: 'FAILED' },
    { id: 'y', status: 'PASSED' },
    { id: 'z', status: 'FAILED' },
  ];
  const v = applyAccepted(results, [
    { id: 'y' },
    { id: 'z', expires: '2000-01-01' },
    { id: 'gone' },
  ]);
  assert.deepEqual(
    v.regressions.map((r) => r.id),
    ['x'],
  );
  assert.deepEqual(v.stale.sort(), ['gone', 'y']);
  assert.deepEqual(v.expired, ['z']);
});
