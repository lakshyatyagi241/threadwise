import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RuntimeMonitor, instrumentHttpRequests } from '@crm/observability';
import { afterEach, describe, expect, it } from 'vitest';

// EL-B20: the web server has no middleware chain, so its requests are timed by wrapping Server.prototype.emit. Real servers, real
// requests; the monitor is real too and its Prometheus text is what a scrape would read.
const servers: Server[] = [];
const stops: Array<() => void> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function listen(handler: Parameters<typeof createServer>[1]): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as AddressInfo).port;
}
const get = (port: number, path: string, method = 'GET') =>
  new Promise<number>((resolve, reject) => {
    const req = request({ port, path, method, host: '127.0.0.1' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const series = (monitor: RuntimeMonitor, re: RegExp) =>
  monitor
    .render()
    .split('\n')
    .filter((l) => re.test(l));

describe('instrumentHttpRequests', () => {
  it('records method, the route template and the status class, and a duration that includes the handler', async () => {
    const monitor = new RuntimeMonitor({ service: 'web', intervalMs: 60_000 });
    stops.push(
      instrumentHttpRequests(monitor, (req, status) =>
        status === 404 ? 'unmatched' : req.url.replace(/\d+/g, ':id'),
      ),
    );
    const port = await listen((req, res) => {
      if (req.url === '/gone') {
        res.statusCode = 404;
        res.end();
        return;
      }
      setTimeout(() => res.end('ok'), 30);
    });
    expect(await get(port, '/items/42')).toBe(200);
    expect(await get(port, '/items/43')).toBe(200);
    expect(await get(port, '/gone')).toBe(404);
    const counts = series(monitor, /^crm_http_request_duration_seconds_count\{/);
    expect(
      counts.some(
        (l) => l.includes('route="/items/:id"') && l.includes('status="2xx"') && l.endsWith(' 2'),
      ),
    ).toBe(true);
    expect(counts.some((l) => l.includes('route="unmatched"') && l.includes('status="4xx"'))).toBe(
      true,
    );
    const sum = series(
      monitor,
      /^crm_http_request_duration_seconds_sum\{.*route="\/items\/:id"/,
    )[0]!;
    expect(Number(sum.split(' ').pop())).toBeGreaterThan(0.05); // two handlers of 30 ms
  });

  it('leaves a request unmeasured when routeOf says null', async () => {
    const monitor = new RuntimeMonitor({ service: 'web', intervalMs: 60_000 });
    stops.push(instrumentHttpRequests(monitor, (req) => (req.url === '/metrics' ? null : req.url)));
    const port = await listen((_req, res) => res.end('x'));
    await get(port, '/metrics');
    await get(port, '/real');
    const counts = series(monitor, /^crm_http_request_duration_seconds_count\{/).join('\n');
    expect(counts).toContain('route="/real"');
    expect(counts).not.toContain('route="/metrics"');
  });

  it('counts a client that gives up as 499, not as a success', async () => {
    const monitor = new RuntimeMonitor({ service: 'web', intervalMs: 60_000 });
    stops.push(instrumentHttpRequests(monitor, () => '/slow'));
    const port = await listen(() => {
      /* never answers */
    });
    await new Promise<void>((resolve) => {
      const req = request({ port, path: '/slow', host: '127.0.0.1' });
      req.on('error', () => resolve());
      req.end();
      setTimeout(() => req.destroy(), 40);
    });
    await sleep(50);
    expect(
      series(monitor, /^crm_http_request_duration_seconds_count\{.*status="4xx"/),
    ).toHaveLength(1);
  });

  it('installs once per process, and stopping puts emit back', async () => {
    const monitor = new RuntimeMonitor({ service: 'web', intervalMs: 60_000 });
    const before = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(createServer()), 'emit');
    const stop = instrumentHttpRequests(monitor, () => '/r');
    const second = instrumentHttpRequests(monitor, () => '/other'); // a no-op
    stops.push(stop);
    const port = await listen((_req, res) => res.end('x'));
    await get(port, '/a');
    second();
    await get(port, '/b');
    const counts = series(monitor, /^crm_http_request_duration_seconds_count\{/);
    expect(counts).toHaveLength(1);
    expect(counts[0]!.endsWith(' 2')).toBe(true); // counted once per request, not twice
    stop();
    stops.pop();
    await get(port, '/c');
    expect(series(monitor, /^crm_http_request_duration_seconds_count\{/)[0]!.endsWith(' 2')).toBe(
      true,
    );
    expect(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(createServer()), 'emit')).toEqual(
      before,
    );
  });

  it('never breaks a request when the route function throws', async () => {
    const monitor = new RuntimeMonitor({ service: 'web', intervalMs: 60_000 });
    stops.push(
      instrumentHttpRequests(monitor, () => {
        throw new Error('boom');
      }),
    );
    const port = await listen((_req, res) => res.end('still served'));
    expect(await get(port, '/x')).toBe(200);
  });
});
