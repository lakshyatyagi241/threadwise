import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The event-loop regression gate (EL-B06) lives in tools/event-loop-audit/regression-check.mjs. These tests keep its decision rules
// from drifting; that the gate trips on a real injected stall in a real API process is shown by run-load.mjs --inject-block-ms
// (docs/performance/event-loop/evidence/regression-gate-*.json), not here.
interface Run {
  environment: Record<string, unknown>;
  calibrationBefore: Record<string, unknown>;
  profiles: Record<string, unknown>;
  aborted?: string;
}
interface Result {
  exit: number;
  verdict: string;
  metrics: Record<string, { status: string }>;
}
interface Gate {
  buildBaseline(runs: Run[]): { runs: number; metrics: Record<string, { values: number[] }> };
  compare(baseline: unknown, run: unknown): Result;
  allowance(name: string, values: number[]): { center: number; spread: number; allowed: number };
  selfTest(): { bad: number; out: string[] };
  METRICS: Record<string, unknown>;
  DETECTS_BLOCK_MS: number;
}
const load = async (): Promise<Gate> =>
  (await import(
    pathToFileURL(resolve(__dirname, '../../../../../tools/event-loop-audit/regression-check.mjs'))
      .href
  )) as Gate;

const run = (p99: number, max: number, over250 = 0.04): Run => ({
  environment: { node: 'v22.17.0', os: 'linux 6.5', cpu: 'x, 4 logical cores, 16 GB' },
  calibrationBefore: {
    postgresSelect1Ms: { p50: 2, p99: 6 },
    redisPingMs: { p50: 2, p99: 6 },
  },
  profiles: {
    normal: {
      api: {
        loopDelayMs: { p99: { median: p99 }, max: { median: max } },
        loopDelayMaxOverShare: { over250ms: over250 },
      },
      client: { clientLatency: { p95Ms: 480 } },
    },
  },
});

describe('event-loop regression gate (EL-B06)', () => {
  it('passes its own self-test (the rules against made-up runs)', async () => {
    const g = await load();
    const { bad, out } = g.selfTest();
    expect(bad, out.filter((l) => l.startsWith('FAIL')).join('\n')).toBe(0);
    expect(out.length).toBeGreaterThanOrEqual(16);
  });

  it('derives the allowance from the spread between recorded runs, with floors', async () => {
    const g = await load();
    // Tight baseline: the floors decide. Wide baseline: twice the range decides.
    expect(g.allowance('apiLoopMaxMs', [34, 35, 36]).allowed).toBe(35 + 60);
    expect(g.allowance('apiLoopMaxMs', [30, 90, 40]).allowed).toBe(40 + 120);
  });

  it('fails a block of 300 ms in most windows, passes the runs it was recorded from', async () => {
    const g = await load();
    const base = g.buildBaseline([run(24, 33), run(27, 38, 0.06), run(25, 35)]);
    for (const r of [run(24, 33), run(27, 38, 0.06), run(25, 35)])
      expect(g.compare(base, r).exit).toBe(0);
    const bad = g.compare(base, run(30, 310, 1));
    expect(bad.exit).toBe(1);
    expect(bad.metrics.apiLoopMaxMs?.status).toBe('FAIL');
  });

  it('never calls "cannot decide" a pass', async () => {
    const g = await load();
    const base = g.buildBaseline([run(24, 33), run(27, 38), run(25, 35)]);
    expect(g.compare(undefined, run(25, 35)).exit).toBe(2);
    expect(g.compare(base, { ...run(25, 35), aborted: 'boom' }).exit).toBe(2);
    const noisy = g.buildBaseline([run(24, 30), run(27, 200), run(25, 90)]);
    expect(g.compare(noisy, run(25, 40)).exit).toBe(2);
  });
});
