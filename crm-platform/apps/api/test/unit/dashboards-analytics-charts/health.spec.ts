import { QUEUES } from '../../../src/infra/queue/queues';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HealthService } from '../../../src/modules/dashboards-analytics-charts/health.service';
import {
  diskTone,
  overallState,
  queueState,
  shortError,
} from '../../../src/modules/dashboards-analytics-charts/health-rules';

describe('health rules (TW-DASH-048)', () => {
  it('overall is down if any core probe is down, else degraded if any is, else up; idle is ignored', () => {
    expect(overallState(['up', 'down', 'warn'])).toBe('down');
    expect(overallState(['up', 'warn', 'idle'])).toBe('warn');
    expect(overallState(['up', 'idle', 'up'])).toBe('up');
  });

  it('the queue is degraded on any failed job or above 500 pending, otherwise up', () => {
    expect(queueState(0, 3)).toBe('warn');
    expect(queueState(501, 0)).toBe('warn');
    expect(queueState(500, 0)).toBe('up');
  });

  it('failure messages are cut at 90 characters', () => {
    expect(shortError(new Error('x'.repeat(200))).length).toBe(93);
    expect(shortError(new Error('boom'))).toBe('boom');
  });

  it('the disk bar is red above 90, amber above 75, else green (TW-DASH-050)', () => {
    expect(diskTone(92)).toBe('danger');
    expect(diskTone(80)).toBe('warning');
    expect(diskTone(40)).toBe('success');
  });
});

const queue = (counts: Record<string, number>) => ({
  getJobCounts: async () => counts,
  drain: async () => undefined,
  clean: async () => [],
});

function service(over: {
  db?: () => Promise<unknown>;
  failed?: number;
  env?: Record<string, string>;
}) {
  const redisStore = new Map<string, string>();
  const redis = {
    set: async (k: string, v: string) => void redisStore.set(k, v),
    get: async (k: string) => redisStore.get(k) ?? null,
  };
  const db = { primary: { execute: over.db ?? (async () => [{}]) } };
  const config = { get: (k: string) => over.env?.[k] };
  const moduleRef = { get: () => queue({ waiting: 0, delayed: 0, failed: over.failed ?? 0 }) };
  const audit = { recordStandalone: async () => undefined };
  return new HealthService(
    db as never,
    redis as never,
    config as never,
    moduleRef as never,
    audit as never,
  );
}

describe('health probes (TW-DASH-048)', () => {
  let bridge: Server;
  let bridgeUrl = '';
  beforeAll(async () => {
    // answers 404 to everything: any HTTP answer is "up"
    bridge = createServer((_req, res) => res.writeHead(404).end());
    await new Promise<void>((r) => bridge.listen(0, '127.0.0.1', r));
    bridgeUrl = `http://127.0.0.1:${(bridge.address() as AddressInfo).port}`;
  });
  afterAll(() => bridge.close());

  const state = (r: Awaited<ReturnType<HealthService['snapshot']>>, key: string) =>
    r.checks.find((c) => c.key === key)!;

  it('every probe succeeding gives an Operational banner', async () => {
    const r = await service({ env: { NODE_BRIDGE_URL: bridgeUrl } }).snapshot(true);
    expect(r.overall).toBe('up');
    expect(r.checks.map((c) => c.key)).toEqual(['database', 'cache', 'queue', 'bridge', 'storage']);
    expect(state(r, 'storage').state).toBe('idle');
    expect(Date.parse(r.ts)).not.toBeNaN();
  });

  it('a throwing database is Down and the banner is Down while the other cards still render', async () => {
    const r = await service({
      db: async () => {
        throw new Error('connection refused');
      },
      env: { NODE_BRIDGE_URL: bridgeUrl },
    }).snapshot(true);
    expect(state(r, 'database')).toMatchObject({ state: 'down', detail: 'connection refused' });
    expect(state(r, 'cache').state).toBe('up');
    expect(r.overall).toBe('down');
  });

  it('failed jobs make the queue and the banner Degraded', async () => {
    const r = await service({ failed: 3, env: { NODE_BRIDGE_URL: bridgeUrl } }).snapshot(true);
    const q = state(r, 'queue');
    expect(q.state).toBe('warn');
    expect(q.detail).toMatch(new RegExp(` ${Object.keys(QUEUES).length * 3} failed$`)); // every queue x 3
    expect(r.overall).toBe('warn');
  });

  it('a bridge answering 404 is up; refusing connections is down; unset is degraded', async () => {
    expect(
      state(await service({ env: { NODE_BRIDGE_URL: bridgeUrl } }).snapshot(true), 'bridge'),
    ).toMatchObject({
      state: 'up',
      detail: expect.stringMatching(/^HTTP 404/),
    });
    const dead = await service({ env: { NODE_BRIDGE_URL: 'http://127.0.0.1:1' } }).snapshot(true);
    expect(state(dead, 'bridge')).toMatchObject({
      state: 'down',
      detail: 'unreachable - process down?',
    });
    expect(state(await service({}).snapshot(true), 'bridge').state).toBe('warn');
  });

  it('a second poll inside the cache window reuses the first run', async () => {
    const svc = service({ env: { NODE_BRIDGE_URL: bridgeUrl } });
    const a = await svc.snapshot();
    expect(await svc.snapshot()).toBe(a);
    expect(await svc.snapshot(true)).not.toBe(a);
  });

  it('clearing reports what it removed per the BullMQ counts and refuses an unknown queue', async () => {
    const svc = service({ failed: 2 });
    const r = await svc.clearQueues();
    const failed = Object.keys(QUEUES).length * 2;
    expect(r).toMatchObject({ ok: true, clearedFailed: failed, clearedPending: 0 });
    expect(r.message).toBe(`Cleared 0 pending and ${failed} failed job(s).`);
    await expect(svc.clearQueues('nope')).rejects.toMatchObject({ status: 422 });
  });
});
