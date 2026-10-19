import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Registry } from '@crm/observability';
import {
  guardWorkerAgainstOom,
  parseRedisInfo,
  createRedisSampler,
  type GuardableWorker,
} from '../../../src/modules/platform-infrastructure';

const INFO = [
  '# Server',
  'redis_version:7.4.1',
  '# Clients',
  'connected_clients:154',
  'blocked_clients:48',
  '# Memory',
  'used_memory:5216488',
  'maxmemory:201326592',
  '# Stats',
  'rejected_connections:2',
  'instantaneous_ops_per_sec:431',
  'evicted_keys:7',
  '# Keyspace',
  'db0:keys=1200,expires=1100,avg_ttl=45000',
  'db11:keys=30,expires=30,avg_ttl=1000',
  '',
].join('\r\n');

describe('parseRedisInfo', () => {
  it('reads the numbers the dashboards need, summing keys over every database', () => {
    expect(parseRedisInfo(INFO)).toEqual({
      usedMemoryBytes: 5_216_488,
      maxMemoryBytes: 201_326_592,
      connectedClients: 154,
      blockedClients: 48,
      keys: 1_230,
      evictedKeys: 7,
      rejectedConnections: 2,
      opsPerSecond: 431,
    });
  });

  it('treats a missing field as 0 (maxmemory is 0 when unlimited) and never returns NaN', () => {
    const r = parseRedisInfo('used_memory:100\r\nmaxmemory:0\r\n');
    expect(r.usedMemoryBytes).toBe(100);
    expect(r.maxMemoryBytes).toBe(0);
    expect(r.keys).toBe(0);
    expect(Object.values(r).every(Number.isFinite)).toBe(true);
    expect(Object.values(parseRedisInfo('garbage')).every((v) => v === 0)).toBe(true);
  });
});

describe('createRedisSampler', () => {
  const metric = (text: string, name: string) =>
    Number(new RegExp(`^${name}(?:\\{[^}]*\\})? (\\S+)$`, 'm').exec(text)?.[1]);

  it('exports gauges, counts evictions as a counter, and survives a Redis restart (counter reset)', async () => {
    const registry = new Registry({ service: 'worker' });
    const redis = { info: vi.fn(async () => INFO) };
    const sampler = createRedisSampler(registry);
    const s = () => sampler.sample(redis as never);
    await s();
    const text = registry.render();
    expect(metric(text, 'crm_redis_up')).toBe(1);
    expect(metric(text, 'crm_redis_memory_used_bytes')).toBe(5_216_488);
    expect(metric(text, 'crm_redis_memory_max_bytes')).toBe(201_326_592);
    expect(metric(text, 'crm_redis_connected_clients')).toBe(154);
    expect(metric(text, 'crm_redis_keys')).toBe(1_230);
    expect(metric(text, 'crm_redis_evicted_keys_total')).toBe(0); // the first reading is the baseline, not 7 evictions "now"

    redis.info.mockResolvedValueOnce(INFO.replace('evicted_keys:7', 'evicted_keys:10'));
    await s();
    expect(metric(registry.render(), 'crm_redis_evicted_keys_total')).toBe(3);

    // the server restarted: its counter starts again from 0, which must not subtract
    redis.info.mockResolvedValueOnce(INFO.replace('evicted_keys:7', 'evicted_keys:1'));
    await s();
    expect(metric(registry.render(), 'crm_redis_evicted_keys_total')).toBe(3);
  });

  it('reports crm_redis_up 0 and keeps the last numbers when INFO fails', async () => {
    const registry = new Registry({ service: 'worker' });
    const sampler = createRedisSampler(registry);
    await sampler.sample({ info: async () => INFO } as never);
    await sampler.sample({ info: async () => Promise.reject(new Error('boom')) } as never);
    const text = registry.render();
    expect(metric(text, 'crm_redis_up')).toBe(0);
    expect(metric(text, 'crm_redis_memory_used_bytes')).toBe(5_216_488);
  });
});

describe('guardWorkerAgainstOom', () => {
  class FakeWorker extends EventEmitter implements GuardableWorker {
    name = 'campaign';
    pause = vi.fn(async () => undefined);
    resume = vi.fn(async () => undefined);
  }
  const OOM = new Error(
    "OOM command not allowed when used memory > 'maxmemory'. script: abc, on @user_script:1.",
  );
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pauses the worker ONCE for a burst of OOM errors and resumes it after the pause', async () => {
    const w = new FakeWorker();
    const log = { warn: vi.fn(), error: vi.fn() };
    guardWorkerAgainstOom(w, { pauseMs: 5_000, log });
    for (let i = 0; i < 1_000; i++) w.emit('error', OOM); // BullMQ emits thousands a second while the server is full
    await vi.advanceTimersByTimeAsync(0);
    expect(w.pause).toHaveBeenCalledTimes(1);
    expect(w.pause).toHaveBeenCalledWith(true); // do not wait for active jobs: they finish on their own
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(w.resume).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(w.resume).toHaveBeenCalledTimes(1);
  });

  it('pauses again when the server is still full after the resume', async () => {
    const w = new FakeWorker();
    guardWorkerAgainstOom(w, { pauseMs: 1_000, log: { warn: vi.fn(), error: vi.fn() } });
    w.emit('error', OOM);
    await vi.advanceTimersByTimeAsync(1_000);
    w.emit('error', OOM);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.pause).toHaveBeenCalledTimes(2);
  });

  it('keeps logging every other error (BullMQ would print it when nobody listens) and does not pause', async () => {
    const w = new FakeWorker();
    const log = { warn: vi.fn(), error: vi.fn() };
    guardWorkerAgainstOom(w, { pauseMs: 5_000, log });
    w.emit('error', new Error('Missing lock for job 5'));
    await vi.advanceTimersByTimeAsync(0);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(w.pause).not.toHaveBeenCalled();
  });

  it('still resumes if pause() itself fails', async () => {
    const w = new FakeWorker();
    w.pause.mockRejectedValueOnce(new Error('closing'));
    guardWorkerAgainstOom(w, { pauseMs: 100, log: { warn: vi.fn(), error: vi.fn() } });
    w.emit('error', OOM);
    await vi.advanceTimersByTimeAsync(100);
    expect(w.resume).toHaveBeenCalledTimes(1);
  });
});
