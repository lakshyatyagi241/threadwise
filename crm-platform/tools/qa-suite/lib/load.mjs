// Open-loop load generator for LOCAL targets: requests are sent on a schedule whether or not earlier ones finished,
// so a slow server shows up as latency and errors instead of silently reducing the offered load.
import { env } from './core.mjs';

export const pct = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;

/** Sends `rps` requests per second for `seconds`; `build(i)` returns { method, path, headers?, body?, token? }. */
export async function stage({ rps, seconds, build, maxInflight = 3000, timeoutMs = 10000 }) {
  const lat = [],
    codes = {};
  let sent = 0,
    inflight = 0,
    dropped = 0,
    netErr = 0;
  const one = async (i) => {
    const r = build(i),
      t0 = performance.now();
    inflight++;
    try {
      const res = await fetch(env.api + r.path, {
        method: r.method ?? 'GET',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          ...(r.body ? { 'content-type': 'application/json' } : {}),
          ...(r.token ? { authorization: `Bearer ${r.token}` } : {}),
          ...(r.headers ?? {}),
        },
        body: r.body === undefined ? undefined : JSON.stringify(r.body),
      });
      await res.arrayBuffer();
      codes[res.status] = (codes[res.status] ?? 0) + 1;
    } catch {
      netErr++;
      codes.network = (codes.network ?? 0) + 1;
    } finally {
      inflight--;
      lat.push(performance.now() - t0);
    }
  };
  const start = performance.now(),
    total = rps * seconds,
    pending = [];
  for (let i = 0; i < total; i++) {
    const due = start + (i * 1000) / rps,
      wait = due - performance.now();
    if (wait > 1) await new Promise((r) => setTimeout(r, wait));
    if (inflight >= maxInflight) {
      dropped++;
      continue;
    }
    sent++;
    pending.push(one(i));
  }
  await Promise.all(pending);
  lat.sort((a, b) => a - b);
  const ok = Object.entries(codes)
    .filter(([c]) => /^[23]/.test(c))
    .reduce((a, [, n]) => a + n, 0);
  const shed = (codes[429] ?? 0) + (codes[503] ?? 0); // deliberate load shedding = controlled degradation
  const bad = Object.entries(codes)
    .filter(([c]) => c === 'network' || (/^5/.test(c) && c !== '503'))
    .reduce((a, [, n]) => a + n, 0);
  return {
    rps,
    sent,
    dropped,
    ok,
    shed,
    bad,
    netErr,
    codes,
    p50: pct(lat, 50),
    p95: pct(lat, 95),
    p99: pct(lat, 99),
    max: lat.at(-1) ?? 0,
    errorRate: sent ? bad / sent : 0,
    actualRps: sent / seconds,
  };
}
export const fmt = (n) => `${n.toFixed(0)}ms`;
