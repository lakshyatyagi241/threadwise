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
  /**
   * How long a window is expected to last, so the next histogram can be armed shortly before the window ends (see the class comment).
   * The monitor passes its reporting interval. Ignored when `histogram` is injected.
   */
  windowHintMs?: number;
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
 * The blind spot and how it is closed (measured on Node 22.17, win32): `histogram.reset()` discards the next tick, so with ONE
 * histogram a stall that begins before the first tick after a reset is not recorded, about 0.1 to 0.2 % of the time at a 10 s window
 * and a 10 ms resolution (EL-B10). So there are two. The one for the next window is enabled and reset a few ticks BEFORE the current
 * window ends (a short unref'd timer), so its discarded tick is long gone by the boundary; at the boundary the sampler reads the
 * current one and switches. The price is that the last few ticks (about 100 ms) of a window are also at the start of the next one, so a
 * stall in that sliver counts in both windows. If the arming timer has not run by the boundary, it falls back to reset in place, i.e.
 * to the old single-histogram behaviour for that one window. Two limits, both measured: a lead of 3 ticks (30 ms) was marginal (34 to
 * 40 of 40 trials), and checking that the spare had recorded a tick before switching made it WORSE (8 of 40: `count` lags the timer, so
 * the check sent most boundaries to the fallback). And a loop starved for the whole lead (a full parallel test run on a loaded laptop
 * did it once) defeats it. An injected `histogram` (tests) keeps the single-histogram mode.
 */
const DEFAULT_WINDOW_MS = 10_000;
/**
 * How many ticks before the boundary the next histogram is armed. The first tick after a reset is discarded; the second is kept. Ten
 * (100 ms at the default resolution) leaves room for a loop that is busy but not blocked (40 of 40 in `measure-sampler-blindspot.mjs`);
 * the cost is that much overlap between windows, 1 % of a 10 s window.
 */
const ARM_LEAD_TICKS = 10;

type Histogram = NonNullable<EventLoopSamplerDeps['histogram']>;

export class EventLoopSampler {
  private histogram: Histogram;
  /** The histogram for the next window (real mode only): armed shortly before the boundary, swapped in at it. */
  private spare: Histogram | undefined;
  private spareArmed = false;
  private armTimer: NodeJS.Timeout | undefined;
  private readonly resolutionMs: number;
  private readonly windowHintMs: number;
  private readonly elu: NonNullable<EventLoopSamplerDeps['elu']>;
  private readonly now: () => number;
  private previousElu: EventLoopUtilization;
  private windowStartedAt: number;
  private running = false;

  constructor(deps: EventLoopSamplerDeps = {}) {
    this.resolutionMs = deps.resolutionMs ?? 10;
    this.windowHintMs = deps.windowHintMs ?? DEFAULT_WINDOW_MS;
    if (deps.histogram) {
      this.histogram = deps.histogram;
    } else {
      this.histogram = monitorEventLoopDelay({ resolution: this.resolutionMs });
      this.spare = monitorEventLoopDelay({ resolution: this.resolutionMs });
    }
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
    this.scheduleArm();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.armTimer) clearTimeout(this.armTimer);
    this.armTimer = undefined;
    this.histogram.disable();
    if (this.spare) {
      this.spare.disable();
      this.spareArmed = false;
    }
  }

  /** Arms the spare histogram a few ticks before this window is expected to end. Real mode only. */
  private scheduleArm(): void {
    if (!this.spare) return;
    if (this.armTimer) clearTimeout(this.armTimer);
    // From the cadence the caller promised, never from the last window that happened to be observed: a caller that samples at irregular
    // times would otherwise arm far too early and report one stall in two windows.
    const delay = Math.max(0, this.windowHintMs - ARM_LEAD_TICKS * this.resolutionMs);
    this.armTimer = setTimeout(() => {
      this.armTimer = undefined;
      if (!this.running || !this.spare) return;
      this.spare.enable();
      this.spare.reset();
      this.spareArmed = true;
    }, delay);
    this.armTimer.unref();
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
    if (this.spare && this.spareArmed) {
      // The next window's histogram has been recording for a few ticks already: switch to it, and stop the one just read.
      const finished = this.histogram;
      this.histogram = this.spare;
      this.spare = finished;
      finished.disable();
      this.spareArmed = false;
    } else {
      this.histogram.reset(); // single-histogram mode, or the arming timer did not run in time
    }
    if (this.running) this.scheduleArm();

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
