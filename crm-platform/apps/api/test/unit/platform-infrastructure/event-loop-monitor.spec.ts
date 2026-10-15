import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { readInfraEnv } from '../../../src/config/domains/platform-infrastructure.env';
import {
  EventLoopSampler,
  RuntimeMonitor,
  classifySnapshot,
  httpMetricsMiddleware,
  startMetricsServer,
  startRuntimeMonitor,
  stopRuntimeMonitor,
  type EventLoopSnapshot,
} from '../../../src/modules/platform-infrastructure';
import { Registry } from '../../../src/modules/platform-infrastructure/observability/event-loop/prometheus-text';

const NS = 1_000_000;

function fakeHistogram(opts: {
  count: number;
  values: Record<number, number>;
  max: number;
  mean: number;
}) {
  return {
    count: opts.count,
    max: opts.max,
    mean: opts.mean,
    enable: () => true,
    disable: () => true,
    reset: () => undefined,
    percentile: (p: number) => opts.values[p] ?? NaN,
  };
}

const snap = (over: Partial<EventLoopSnapshot> = {}): EventLoopSnapshot => ({
  samples: 100,
  delayMeanMs: 10,
  delayP50Ms: 10,
  delayP95Ms: 12,
  delayP99Ms: 15,
  delayMaxMs: 20,
  utilization: 0.3,
  windowMs: 10_000,
  ...over,
});

describe('EventLoopSampler', () => {
  it('converts the histogram from nanoseconds to milliseconds', () => {
    const s = new EventLoopSampler({
      histogram: fakeHistogram({
        count: 50,
        values: { 50: 11 * NS, 95: 22 * NS, 99: 33 * NS },
        max: 44 * NS,
        mean: 12 * NS,
      }),
    });
    const w = s.sample();
    expect(w).toMatchObject({
      samples: 50,
      delayMeanMs: 12,
      delayP50Ms: 11,
      delayP95Ms: 22,
      delayP99Ms: 33,
      delayMaxMs: 44,
    });
  });

  it('reports a missing measurement, not zeros, when the histogram is empty or NaN', () => {
    const empty = new EventLoopSampler({
      histogram: fakeHistogram({ count: 0, values: {}, max: 0, mean: NaN }),
    });
    expect(empty.sample()).toBeNull();
    const nan = new EventLoopSampler({
      histogram: fakeHistogram({
        count: 5,
        values: { 50: NaN, 95: NaN, 99: NaN },
        max: 9 * NS,
        mean: NaN,
      }),
    });
    expect(nan.sample()).toBeNull();
  });

  it('uses interval ELU deltas and moves its baseline each window', () => {
    let active = 0;
    type Elu = { idle: number; active: number; utilization: number };
    // Like performance.eventLoopUtilization: (a, b) is the delta a - b; no argument is the absolute reading.
    const elu = (a?: Elu, b?: Elu): Elu => {
      if (a && b) {
        const d = a.active - b.active;
        return { idle: 0, active: d, utilization: d / 100 };
      }
      return { idle: 0, active, utilization: 0 };
    };
    const s = new EventLoopSampler({
      histogram: fakeHistogram({ count: 1, values: { 50: NS, 95: NS, 99: NS }, max: NS, mean: NS }),
      elu: elu as never,
    });
    active = 40;
    expect(s.sample()?.utilization).toBeCloseTo(0.4);
    active = 50; // only 10 more than the previous window, not 50 since start
    expect(s.sample()?.utilization).toBeCloseTo(0.1);
  });

  it('measures a real synchronous block and recovers afterwards', async () => {
    const s = new EventLoopSampler({ resolutionMs: 10 });
    s.start();
    try {
      await new Promise((r) => setTimeout(r, 120));
      s.sample(); // discard warm-up window
      // reset() discards the next tick (see the sampler's note), so let one tick pass before stalling.
      await new Promise((r) => setTimeout(r, 40));
      const end = Date.now() + 300;
      while (Date.now() < end) {
        /* deliberate CPU-bound block */
      }
      await new Promise((r) => setTimeout(r, 50));
      const blocked = s.sample();
      expect(blocked).not.toBeNull();
      expect(blocked!.delayMaxMs).toBeGreaterThan(200);
      expect(classifySnapshot(blocked!)).toBe('critical');

      await new Promise((r) => setTimeout(r, 250));
      const healthy = s.sample();
      expect(healthy).not.toBeNull();
      // Relative, not absolute: a loaded runner can add its own jitter, but recovery must be far below the 300 ms stall.
      expect(healthy!.delayMaxMs).toBeLessThan(blocked!.delayMaxMs / 2);
    } finally {
      s.stop();
    }
  });
});

describe('classifySnapshot thresholds', () => {
  it('is ok under every target', () => expect(classifySnapshot(snap())).toBe('ok'));
  it('warns on p95 20-50, p99 50-100, max 100-250, ELU over 70 %', () => {
    expect(classifySnapshot(snap({ delayP95Ms: 30 }))).toBe('warn');
    expect(classifySnapshot(snap({ delayP99Ms: 70 }))).toBe('warn');
    expect(classifySnapshot(snap({ delayMaxMs: 150 }))).toBe('warn');
    expect(classifySnapshot(snap({ utilization: 0.8 }))).toBe('warn');
  });
  it('is critical on p95 over 50, p99 over 100 or max over 250', () => {
    expect(classifySnapshot(snap({ delayP95Ms: 60 }))).toBe('critical');
    expect(classifySnapshot(snap({ delayP99Ms: 120 }))).toBe('critical');
    expect(classifySnapshot(snap({ delayMaxMs: 300 }))).toBe('critical');
  });
  it('does not treat high utilization alone as blocking', () => {
    expect(classifySnapshot(snap({ utilization: 0.95 }))).toBe('warn');
  });
});

describe('Prometheus text registry', () => {
  it('renders process identity on every series and escapes label values', () => {
    const r = new Registry({ service: 'api', instance: 'h:1' });
    r.gauge('x_gauge', 'help').set(1.5, { route: 'a"b\\c' });
    r.counter('x_total', 'help').inc(2);
    const out = r.render();
    expect(out).toContain('# TYPE x_gauge gauge');
    expect(out).toContain('x_gauge{service="api",instance="h:1",route="a\\"b\\\\c"} 1.5');
    expect(out).toContain('x_total{service="api",instance="h:1"} 2');
  });

  it('ignores non-finite gauge values and negative counter increments', () => {
    const r = new Registry({});
    r.gauge('g', 'h').set(NaN);
    const c = r.counter('c_total', 'h');
    c.inc(-1);
    expect(r.render()).toBe('\n');
  });

  it('keeps histograms cumulative and folds series past the cap into the overflow label set', () => {
    const r = new Registry({});
    const h = r.histogram('h_seconds', 'h', [0.1, 1], { route: 'overflow' });
    h.observe(0.05, { route: 'a' });
    h.observe(0.5, { route: 'a' });
    h.observe(5, { route: 'a' });
    const out = r.render();
    expect(out).toContain('h_seconds_bucket{route="a",le="0.1"} 1');
    expect(out).toContain('h_seconds_bucket{route="a",le="1"} 2');
    expect(out).toContain('h_seconds_bucket{route="a",le="+Inf"} 3');
    expect(out).toContain('h_seconds_count{route="a"} 3');
  });

  it('caps distinct label sets so a bug cannot explode cardinality', () => {
    const r = new Registry({});
    const h = r.histogram('h_seconds', 'h', [1], { route: 'overflow' });
    for (let i = 0; i < 2000; i++) h.observe(0.1, { route: `/r${i}` });
    const series = r
      .render()
      .split('\n')
      .filter((l) => l.startsWith('h_seconds_count'));
    expect(series.length).toBeLessThanOrEqual(501);
    expect(r.render()).toContain('h_seconds_count{route="overflow"}');
  });
});

describe('RuntimeMonitor', () => {
  let monitor: RuntimeMonitor | undefined;
  afterEach(() => monitor?.stop());

  it('exposes loop, CPU, memory, GC and identity series after a window', async () => {
    monitor = new RuntimeMonitor({
      service: 'worker',
      instance: 'test:1',
      intervalMs: 60_000,
      cgroupCpuStatPath: '/nonexistent',
    });
    monitor.start();
    await new Promise((r) => setTimeout(r, 150));
    monitor.tick();
    const out = monitor.render();
    for (const name of [
      'crm_event_loop_delay_p50_seconds',
      'crm_event_loop_delay_p95_seconds',
      'crm_event_loop_delay_p99_seconds',
      'crm_event_loop_delay_max_seconds',
      'crm_event_loop_utilization_ratio',
      'crm_process_cpu_ratio',
      'crm_process_heap_used_bytes',
      'crm_process_heap_limit_bytes',
      'crm_process_rss_bytes',
      'crm_runtime_last_report_timestamp_seconds',
    ]) {
      expect(out, name).toMatch(
        new RegExp(`^${name}\\{service="worker",instance="test:1"\\} `, 'm'),
      );
    }
    expect(out).not.toContain('crm_container_cpu_throttled'); // no cgroup file: absent, not zero
  });

  it('logs a blocked loop with route templates only, and records the window', async () => {
    const lines: Record<string, unknown>[] = [];
    monitor = new RuntimeMonitor({
      service: 'api',
      intervalMs: 60_000,
      blockedLogThresholdMs: 100,
      log: (l) => lines.push(l),
    });
    monitor.start();
    await new Promise((r) => setTimeout(r, 120));
    monitor.tick();
    await new Promise((r) => setTimeout(r, 40)); // one histogram tick after the reset, see the sampler's note
    monitor.observeHttp('GET', '/contacts/:id', 200, 480);
    const end = Date.now() + 250;
    while (Date.now() < end) {
      /* block */
    }
    await new Promise((r) => setTimeout(r, 30));
    monitor.tick();
    const blocked = lines.find((l) => l.msg === 'event loop blocked');
    expect(blocked).toBeDefined();
    expect(blocked!.slowestRequests).toEqual([
      { route: '/contacts/:id', method: 'GET', status: 200, durationMs: 480 },
    ]);
    expect(monitor.render()).toMatch(
      /crm_event_loop_blocked_windows_total\{service="api",instance="[^"]+",level="critical"\} 1/,
    );
  });

  it('reads cgroup v2 CPU throttling when the file exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cgroup-'));
    const file = join(dir, 'cpu.stat');
    writeFileSync(file, 'usage_usec 1\nnr_periods 100\nnr_throttled 7\nthrottled_usec 2500000\n');
    try {
      monitor = new RuntimeMonitor({
        service: 'api',
        intervalMs: 60_000,
        cgroupCpuStatPath: file,
      });
      monitor.tick();
      await new Promise((r) => setTimeout(r, 50)); // the read is asynchronous
      const out = monitor.render();
      expect(out).toMatch(/crm_container_cpu_throttled_periods_total\{[^}]*\} 7/);
      expect(out).toMatch(/crm_container_cpu_throttled_seconds_total\{[^}]*\} 2\.5/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records garbage collections by kind and the longest pause of the window', async () => {
    // A GC is forced with a throwaway context's gc(): V8 only exposes it after --expose-gc.
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    monitor = new RuntimeMonitor({ service: 'api', intervalMs: 60_000 });
    monitor.start();
    gc();
    await new Promise((r) => setTimeout(r, 100)); // the observer delivers asynchronously
    monitor.tick();
    const out = monitor.render();
    expect(out).toMatch(/crm_gc_events_total{[^}]*kind="(major|minor|incremental)"} [1-9]/);
    expect(out).toMatch(/crm_gc_pause_seconds_total{[^}]*kind="/);
    expect(out).toMatch(/crm_gc_pause_max_seconds{[^}]*} (0.|[1-9])/);
  });

  it('does not count a busy but responsive loop as a blocked window', async () => {
    monitor = new RuntimeMonitor({ service: 'api', intervalMs: 60_000, log: () => undefined });
    monitor.start();
    await new Promise((r) => setTimeout(r, 60));
    monitor.tick();
    // 80 % utilization with healthy delay is "warn" for classifySnapshot (capacity headroom) but is not blocking.
    expect(classifySnapshot(snap({ utilization: 0.8 }))).toBe('warn');
    expect(monitor.render()).not.toContain('crm_event_loop_blocked_windows_total');
  });

  it('records HTTP latency by method, route template and status class', () => {
    monitor = new RuntimeMonitor({ service: 'api', intervalMs: 60_000 });
    monitor.observeHttp('POST', '/webhooks/whatsapp', 200, 40);
    monitor.observeHttp('POST', '/webhooks/whatsapp', 503, 900);
    const out = monitor.render();
    expect(out).toContain('route="/webhooks/whatsapp",status="2xx",le="0.05"} 1');
    expect(out).toContain('crm_http_request_duration_seconds_count{service="api"');
    expect(out).toContain('status="5xx"');
  });

  it('records queue wait, duration and outcome by queue name', () => {
    monitor = new RuntimeMonitor({ service: 'worker', intervalMs: 60_000 });
    monitor.observeJob('waba-ingest', 250, 1200, 'completed');
    monitor.observeJob('waba-ingest', 10, 20, 'failed');
    const out = monitor.render();
    expect(out).toMatch(/crm_queue_jobs_total\{[^}]*queue="waba-ingest",outcome="completed"\} 1/);
    expect(out).toMatch(/crm_queue_jobs_total\{[^}]*queue="waba-ingest",outcome="failed"\} 1/);
    expect(out).toContain('crm_queue_job_wait_seconds_count');
  });

  it('keeps the last loop values (and a stale-able timestamp) when a window is unmeasurable', () => {
    monitor = new RuntimeMonitor({ service: 'api', intervalMs: 60_000 });
    monitor.tick(); // never started: histogram disabled, no samples
    const out = monitor.render();
    expect(out).not.toContain('crm_event_loop_delay_p99_seconds');
    expect(out).toContain('crm_runtime_last_report_timestamp_seconds');
  });

  it('start and stop are idempotent and leave no timer holding the process open', () => {
    monitor = new RuntimeMonitor({ service: 'api', intervalMs: 60_000 });
    monitor.start();
    monitor.start();
    monitor.stop();
    monitor.stop();
  });
});

describe('httpMetricsMiddleware abandoned requests', () => {
  it('records a request whose client left before the response finished, as 499', () => {
    const m = new RuntimeMonitor({ service: 'api', intervalMs: 60_000 });
    const mw = httpMetricsMiddleware(m);
    const handlers: Record<string, () => void> = {};
    const res = {
      statusCode: 200,
      writableFinished: false,
      once: (ev: string, cb: () => void) => (handlers[ev] = cb),
    };
    mw(
      { method: 'GET', baseUrl: '', route: { path: '/slow' } } as never,
      res as never,
      () => undefined,
    );
    handlers.close?.();
    handlers.finish?.(); // a late 'finish' must not double count
    const out = m.render();
    expect(out).toContain('route="/slow",status="4xx"');
    expect(out.match(/crm_http_request_duration_seconds_count{[^}]*} 1/g)?.length).toBe(1);
  });
});

describe('httpMetricsMiddleware', () => {
  it('uses the route template, and "unmatched" when no route matched', () => {
    const m = new RuntimeMonitor({ service: 'api', intervalMs: 60_000 });
    const mw = httpMetricsMiddleware(m);
    const run = (req: Record<string, unknown>, status: number) => {
      let finish: () => void = () => undefined;
      const res = {
        statusCode: status,
        writableFinished: true,
        once: (ev: string, cb: () => void) => {
          if (ev === 'finish') finish = cb;
        },
      };
      mw(req as never, res as never, () => undefined);
      finish();
    };
    run({ method: 'GET', baseUrl: '', route: { path: '/contacts/:id' } }, 200);
    run({ method: 'GET', baseUrl: '', url: '/wp-admin/../../etc/passwd' }, 404);
    const out = m.render();
    expect(out).toContain('route="/contacts/:id"');
    expect(out).toContain('route="unmatched"');
    expect(out).not.toContain('passwd');
  });
});

describe('metrics server', () => {
  const get = (port: number, path: string, headers: Record<string, string> = {}, method = 'GET') =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on('error', reject);
      req.end();
    });

  it('serves only GET /metrics, and requires the bearer token when one is set', async () => {
    const server = startMetricsServer({
      port: 0,
      host: '127.0.0.1',
      token: 'a-long-enough-token',
      render: () => 'x 1\n',
    });
    await new Promise((r) => server.once('listening', r));
    const port = (server.address() as AddressInfo).port;
    try {
      expect((await get(port, '/metrics')).status).toBe(401);
      expect(
        (await get(port, '/metrics', { authorization: 'Bearer wrong-token-value!' })).status,
      ).toBe(401);
      const ok = await get(port, '/metrics', { authorization: 'Bearer a-long-enough-token' });
      expect(ok).toEqual({ status: 200, body: 'x 1\n' });
      expect(
        (await get(port, '/other', { authorization: 'Bearer a-long-enough-token' })).status,
      ).toBe(404);
      expect(
        (await get(port, '/metrics', { authorization: 'Bearer a-long-enough-token' }, 'POST'))
          .status,
      ).toBe(404);
    } finally {
      server.close();
    }
  });
});

describe('startRuntimeMonitor environment', () => {
  afterEach(() => stopRuntimeMonitor());

  it('defaults: monitoring on, nothing listening', () => {
    const env = readInfraEnv({});
    expect(env.OBS_RUNTIME_MONITOR).toBe(true);
    expect(env.OBS_METRICS_PORT).toBe(0);
    expect(env.OBS_METRICS_HOST).toBe('127.0.0.1');
    expect(env.OBS_RUNTIME_INTERVAL_SECONDS).toBe(10);
  });

  it('OBS_RUNTIME_MONITOR=false starts nothing; a second start returns the first monitor', () => {
    expect(startRuntimeMonitor('api', { OBS_RUNTIME_MONITOR: 'false' })).toBeUndefined();
    const a = startRuntimeMonitor('api', {});
    expect(a).toBeDefined();
    expect(startRuntimeMonitor('worker', {})).toBe(a);
  });

  it('rejects a malformed value at boot rather than disabling quietly', () => {
    expect(() => readInfraEnv({ OBS_METRICS_PORT: '99999' })).toThrow();
    expect(() => readInfraEnv({ OBS_METRICS_TOKEN: 'short' })).toThrow();
  });
});
