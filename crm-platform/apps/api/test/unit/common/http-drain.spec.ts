import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HttpDrainService,
  InflightTracker,
  PROBE_PATH,
  inflight,
} from '../../../src/common/http/http-drain';
import { HealthController } from '../../../src/health/health.controller';

/** A real HTTP server whose handler takes `delayMs` to answer, behind the tracker's middleware. */
async function serve(tracker: InflightTracker, delayMs: number) {
  const mw = tracker.middleware();
  const server: Server = createServer((req, res) => {
    mw(req as never, res as never, () => {
      setTimeout(() => res.end('done'), delayMs);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, server };
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((r) => {
          s.closeAllConnections();
          s.close(() => r());
        }),
    ),
  );
});
const start = async (tracker: InflightTracker, delayMs: number) => {
  const s = await serve(tracker, delayMs);
  servers.push(s.server);
  return s.base;
};
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('InflightTracker', () => {
  it('counts a running request, not a probe, and releases it when the response ends', async () => {
    const tracker = new InflightTracker();
    const base = await start(tracker, 150);
    const work = fetch(`${base}/v2/contacts`).then((r) => r.text());
    const probe = fetch(`${base}/ready`).then((r) => r.text());
    await settle(50);
    expect(tracker.active).toBe(1);
    await Promise.all([work, probe]);
    await settle(20);
    expect(tracker.active).toBe(0);
  });

  it('releases a request the client abandons', async () => {
    const tracker = new InflightTracker();
    const base = await start(tracker, 500);
    const ctl = new AbortController();
    const p = fetch(`${base}/v2/contacts`, { signal: ctl.signal }).catch(() => undefined);
    await settle(50);
    expect(tracker.active).toBe(1);
    ctl.abort();
    await p;
    await settle(100);
    expect(tracker.active).toBe(0);
  });

  it.each(['/health', '/ready', '/metrics', '/ready?x=1'])('%s is a probe path', (p) => {
    expect(PROBE_PATH.test(p)).toBe(true);
  });
  it.each(['/v2/contacts', '/healthy', '/v2/ready'])('%s is not', (p) => {
    expect(PROBE_PATH.test(p)).toBe(false);
  });
});

describe('GET /ready while draining', () => {
  afterEach(() => {
    inflight.draining = false;
  });

  it('answers 503 "draining" so the proxy stops sending requests, without asking a dependency', async () => {
    inflight.draining = true;
    const res = { code: 200, status: (c: number) => ((res.code = c), res) };
    // Dependencies that fail the test if touched: a draining process must not spend a database or Redis call on the probe.
    const boom = new Proxy(
      {},
      { get: () => () => Promise.reject(new Error('dependency touched')) },
    );
    const controller = new HealthController(
      boom as never,
      boom as never,
      boom as never,
      boom as never,
    );
    expect(await controller.readiness(res as never)).toEqual({ status: 'draining' });
    expect(res.code).toBe(503);
  });
});

describe('HttpDrainService.drain', () => {
  it('does nothing when the request counter was never installed (a test application, a worker)', async () => {
    const tracker = new InflightTracker();
    const t0 = Date.now();
    expect(await new HttpDrainService().drain(tracker, { graceMs: 5_000 })).toBe(0);
    expect(Date.now() - t0).toBeLessThan(100);
    expect(tracker.draining).toBe(false);
  });

  it('answers "draining" at once and waits for a running request to finish before it returns', async () => {
    const tracker = new InflightTracker();
    const base = await start(tracker, 400);
    const work = fetch(`${base}/v2/public/webhooks/whatsapp`, { method: 'POST' }).then((r) =>
      r.text(),
    );
    await settle(50);
    const t0 = Date.now();
    const left = await new HttpDrainService().drain(tracker, {
      graceMs: 20,
      maxMs: 5_000,
      pollMs: 10,
    });
    expect(tracker.draining).toBe(true);
    expect(left).toBe(0);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250); // it waited for the 400 ms request, not just the grace
    expect(await work).toBe('done'); // and the request was answered, not cut off
  });

  it('keeps serving for the grace period even when nothing is running, so the proxy can notice', async () => {
    const tracker = new InflightTracker();
    await start(tracker, 0);
    const t0 = Date.now();
    await new HttpDrainService().drain(tracker, { graceMs: 200, maxMs: 5_000, pollMs: 10 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(190);
  });

  it('gives up at the cap and says how many requests were still running', async () => {
    const tracker = new InflightTracker();
    const base = await start(tracker, 3_000);
    const hung = fetch(`${base}/v2/contacts`).catch(() => undefined);
    await settle(50);
    const t0 = Date.now();
    const left = await new HttpDrainService().drain(tracker, {
      graceMs: 20,
      maxMs: 300,
      pollMs: 10,
    });
    expect(left).toBe(1);
    expect(Date.now() - t0).toBeLessThan(1_500);
    void hung;
  });
});
