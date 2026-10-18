import { monitorEventLoopDelay, performance, type EventLoopUtilization } from 'node:perf_hooks';

/** `IntervalHistogram` is not exported by the Node typings; this is the type `monitorEventLoopDelay` returns. */
type IntervalHistogram = ReturnType<typeof monitorEventLoopDelay>;

/** One reporting window of event-loop health. Delay values are milliseconds; utilization is 0..1 over the window only. */
export interface EventLoopSnapshot {
  /** Histogram samples in the window. 0 means the loop was too starved to tick even once: report nothing, not zeros. */
  samples: number;
  delayMeanMs: number;
  delayP50Ms: number;
  delayP95Ms: number;
  delayP99Ms: number;
  delayMaxMs: number;
  /** Interval ELU (delta between two readings), never the average since process start. */
  utilization: number;
  windowMs: number;
}

export interface EventLoopSamplerDeps {
  /** Histogram resolution in ms. 10 matches the monitoring standard; the timer floor makes smaller values meaningless. */
  resolutionMs?: number;
  histogram?: Pick<
    IntervalHistogram,
    'enable' | 'disable' | 'reset' | 'percentile' | 'mean' | 'max' | 'count'
  >;
  elu?: (current?: EventLoopUtilization, previous?: EventLoopUtilization) => EventLoopUtilization;
  now?: () => number;
}

const NS_PER_MS = 1_000_000;

/** `monitorEventLoopDelay` reports NaN for mean/percentiles with no samples; that is a missing measurement. */
function finiteMs(ns: number): number | null {
  return Number.isFinite(ns) ? ns / NS_PER_MS : null;
}

/**
 * Reads event-loop delay and utilization one window at a time. `sample()` returns the window since the previous call and
 * starts a fresh one (the histogram is reset, the ELU baseline moves), so overlapping or repeated reads never double count.
 *
 * Delay is the scheduling lag the histogram measures with its own timer; the resolution is a floor, not microsecond accuracy:
 * a healthy loop reads about the resolution itself (10 ms) at p50, because the histogram records the time between its ticks.
 *
 * Known blind spot (measured on Node 22.17, win32): `histogram.reset()` discards the next tick, so a stall that begins before the
 * first tick after a reset is not recorded. With a 10 s window and a 10 ms resolution that is about 0.1 to 0.2 % of the time.
 */
export class EventLoopSampler {
  private readonly histogram: NonNullable<EventLoopSamplerDeps['histogram']>;
  private readonly elu: NonNullable<EventLoopSamplerDeps['elu']>;
  private readonly now: () => number;
  private previousElu: EventLoopUtilization;
  private windowStartedAt: number;
  private running = false;

  constructor(deps: EventLoopSamplerDeps = {}) {
    this.histogram =
      deps.histogram ?? monitorEventLoopDelay({ resolution: deps.resolutionMs ?? 10 });
    // Both arguments must be forwarded: (current, previous) is the interval delta, one argument is "since that reading".
    this.elu =
      deps.elu ?? ((current, previous) => performance.eventLoopUtilization(current, previous));
    this.now = deps.now ?? Date.now;
    this.previousElu = this.elu();
    this.windowStartedAt = this.now();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.histogram.enable();
    this.histogram.reset();
    this.previousElu = this.elu();
    this.windowStartedAt = this.now();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.histogram.disable();
  }

  /** The window since the last call, or null when the histogram holds no valid sample yet. */
  sample(): EventLoopSnapshot | null {
    const at = this.now();
    const current = this.elu();
    const delta = this.elu(current, this.previousElu);
    this.previousElu = current;
    const windowMs = Math.max(0, at - this.windowStartedAt);
    this.windowStartedAt = at;

    const samples = this.histogram.count;
    const mean = finiteMs(this.histogram.mean);
    const p50 = finiteMs(this.histogram.percentile(50));
    const p95 = finiteMs(this.histogram.percentile(95));
    const p99 = finiteMs(this.histogram.percentile(99));
    const max = finiteMs(this.histogram.max);
    this.histogram.reset();

    if (
      samples === 0 ||
      mean === null ||
      p50 === null ||
      p95 === null ||
      p99 === null ||
      max === null
    ) {
      return null;
    }
    return {
      samples,
      delayMeanMs: mean,
      delayP50Ms: p50,
      delayP95Ms: p95,
      delayP99Ms: p99,
      delayMaxMs: max,
      utilization: Number.isFinite(delta.utilization) ? delta.utilization : 0,
      windowMs,
    };
  }
}

/**
 * Severity of a window against the engineering targets (p95 20/50 ms, p99 50/100 ms, max 100/250 ms, ELU 70/85 %).
 * A single window is only a reading: paging needs the sustained check in the alert rules, which also requires user impact.
 */
export type LoopLevel = 'ok' | 'warn' | 'critical';

export function classifySnapshot(s: EventLoopSnapshot): LoopLevel {
  if (s.delayP95Ms > 50 || s.delayP99Ms > 100 || s.delayMaxMs > 250) return 'critical';
  if (s.delayP95Ms > 20 || s.delayP99Ms > 50 || s.delayMaxMs > 100 || s.utilization > 0.7) {
    return 'warn';
  }
  return 'ok';
}
