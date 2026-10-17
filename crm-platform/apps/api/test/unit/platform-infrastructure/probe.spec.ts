import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Prober,
  metricsListenerDecision,
  parseProbeTargets,
  probeOnce,
} from '../../../src/modules/platform-infrastructure';

describe('metricsListenerDecision', () => {
  it('stays closed when no port is set, without a warning', () => {
    expect(metricsListenerDecision({ port: 0, host: '0.0.0.0' })).toMatchObject({
      listen: false,
      warn: false,
    });
  });

  it('opens on loopback with or without a token', () => {
    for (const host of ['127.0.0.1', '::1', 'localhost', 'LOCALHOST']) {
      expect(metricsListenerDecision({ port: 9464, host })).toEqual({ listen: true });
    }
  });

  it('refuses a non-loopback host without a token, and says why', () => {
    const d = metricsListenerDecision({ port: 9464, host: '0.0.0.0' });
    expect(d).toMatchObject({ listen: false, warn: true });
    expect((d as { reason: string }).reason).toContain('OBS_METRICS_TOKEN');
  });

  it('opens on a non-loopback host once a token is set', () => {
    expect(
      metricsListenerDecision({ port: 9464, host: '0.0.0.0', token: 'a-long-enough-token' }),
    ).toEqual({
      listen: true,
    });
  });
});

describe('parseProbeTargets', () => {
  it('parses name=url pairs', () => {
    expect(parseProbeTargets('health=http://api:3000/health, ready=https://x.test/ready')).toEqual([
      { name: 'health', url: 'http://api:3000/health' },
      { name: 'ready', url: 'https://x.test/ready' },
    ]);
  });

  it('rejects a bad name, a non-http url, a duplicate and an empty list', () => {
    expect(() => parseProbeTargets('Bad Name=http://a/')).toThrow(/name/);
    expect(() => parseProbeTargets('a=ftp://x/')).toThrow(/http/);
    expect(() => parseProbeTargets('a=http://x/,a=http://y/')).toThrow(/duplicate/);
    expect(() => parseProbeTargets(' , ')).toThrow(/no probe targets/);
    expect(() => parseProbeTargets('nourl')).toThrow();
  });
});

describe('probeOnce and Prober against a real HTTP server', () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise((r) => (server ? server.close(() => r(undefined)) : r(undefined)));
    server = undefined;
  });

  const serve = async (handler: Parameters<typeof createServer>[1]) => {
    server = createServer(handler);
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  };

  it('times a fast answer as ok', async () => {
    const url = await serve((_q, res) => res.end('ok'));
    const o = await probeOnce(url, 2000);
    expect(o.result).toBe('ok');
    expect(o.seconds).toBeLessThan(1);
  });

  it('counts a 5xx as bad_status, a hang as timeout and a closed port as error', async () => {
    const bad = await serve((_q, res) => {
      res.statusCode = 503;
      res.end('no');
    });
    expect((await probeOnce(bad, 2000)).result).toBe('bad_status');
    await new Promise((r) => server!.close(() => r(undefined)));
    server = undefined;
    expect((await probeOnce(bad, 2000)).result).toBe('error'); // nothing listens any more

    const hang = await serve(() => undefined); // never answers
    const t = await probeOnce(hang, 150);
    expect(t.result).toBe('timeout');
    expect(t.seconds).toBeGreaterThanOrEqual(0.14);
  });

  it('measures a slow answer', async () => {
    const url = await serve((_q, res) => setTimeout(() => res.end('ok'), 200));
    const o = await probeOnce(url, 2000);
    expect(o.result).toBe('ok');
    expect(o.seconds).toBeGreaterThanOrEqual(0.19);
  });

  it('keeps duration, up and last-success series per target, and never overlaps its own rounds', async () => {
    let hits = 0;
    const url = await serve((_q, res) => {
      hits += 1;
      setTimeout(() => res.end('ok'), 80);
    });
    const p = new Prober(parseProbeTargets(`good=${url}/a,bad=http://127.0.0.1:1/x`), {
      timeoutSeconds: 2,
      instance: 't:1',
    });
    await Promise.all([p.runOnce(), p.runOnce()]); // the second call is a no-op while the first runs
    expect(hits).toBe(1);
    const out = p.render();
    expect(out).toMatch(
      /crm_probe_http_duration_seconds_count\{[^}]*target="good",result="ok"\} 1/,
    );
    expect(out).toMatch(
      /crm_probe_http_duration_seconds_count\{[^}]*target="bad",result="error"\} 1/,
    );
    expect(out).toMatch(/crm_probe_up\{[^}]*target="good"\} 1/);
    expect(out).toMatch(/crm_probe_up\{[^}]*target="bad"\} 0/);
    expect(out).toMatch(/crm_probe_last_success_timestamp_seconds\{[^}]*target="good"\} \d+/);
    expect(out).not.toMatch(/crm_probe_last_success_timestamp_seconds\{[^}]*target="bad"/);
    expect(out).toContain('service="probe",instance="t:1"');
  });
});

describe('the reason the probe exists', () => {
  it('sees a stall in ANOTHER process that a timer inside that process cannot', async () => {
    // A server in its own process: it answers instantly, but keeps its event loop busy 400 ms out of every 600 ms.
    // Inside it, a request is "handled" in microseconds; the wait before the handler runs is invisible there.
    const script = `
      const http = require('node:http');
      const s = http.createServer((q, r) => r.end('ok'));
      s.listen(0, '127.0.0.1', () => {
        console.log(s.address().port);
        setInterval(() => { const e = Date.now() + 400; while (Date.now() < e) {} }, 600);
      });`;
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
    try {
      const port = await new Promise<number>((resolve, reject) => {
        child.stdout.once('data', (d: Buffer) => resolve(Number(String(d).trim())));
        child.once('error', reject);
      });
      const url = `http://127.0.0.1:${port}/`;
      const seconds: number[] = [];
      for (let i = 0; i < 24; i++) {
        seconds.push((await probeOnce(url, 5000)).seconds);
        await new Promise((r) => setTimeout(r, 37));
      }
      seconds.sort((a, b) => a - b);
      const p95 = seconds[Math.floor(seconds.length * 0.95)] ?? 0;
      expect(p95).toBeGreaterThan(0.2); // callers waited behind the blocked loop
    } finally {
      child.kill();
    }
  }, 30_000);
});
