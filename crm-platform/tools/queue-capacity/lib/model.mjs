// Pure capacity maths (QCAP-017, 018, 023, 024, 071..075, 096). No I/O, so the policies are unit-testable and CI can run them anywhere.
// First-order queueing estimates: they size a test, they never replace a measurement.

/** Backlog growth in jobs/s: arrivals minus completions. Positive means the queue is falling behind. */
export const backlogGrowthRate = (lambda, mu) => lambda - mu;

/** Backlog after t seconds starting from b0; a queue cannot go below empty. */
export const backlogAfter = (b0, lambda, mu, t) => Math.max(0, b0 + (lambda - mu) * t);

/** Seconds to clear `backlog` jobs. Infinity when arrivals >= capacity; 0 for an empty queue. */
export function drainSeconds(backlog, lambda, mu) {
  if (backlog <= 0) return 0;
  const net = mu - lambda;
  return net > 0 ? backlog / net : Infinity;
}

/** Slots needed to carry lambda jobs/s of avg duration W seconds at target utilization u (0<u<=1). */
export function requiredSlots(lambda, avgSeconds, utilization = 0.7) {
  if (!(utilization > 0 && utilization <= 1)) throw new RangeError('utilization must be in (0,1]');
  return Math.ceil((lambda * avgSeconds) / utilization);
}

/** Worker instances for a slot requirement given slots per instance, bounded by an optional provider/DB ceiling on jobs/s. */
export function requiredInstances({ lambda, avgSeconds, utilization = 0.7, slotsPerInstance, providerCeilingPerSec = Infinity }) {
  const slots = requiredSlots(Math.min(lambda, providerCeilingPerSec), avgSeconds, utilization);
  const instances = Math.max(1, Math.ceil(slots / slotsPerInstance));
  return { slots, instances, providerBound: lambda > providerCeilingPerSec, effectiveLambda: Math.min(lambda, providerCeilingPerSec) };
}

/** Theoretical max jobs/s of `slots` slots at avg duration. */
export const maxThroughput = (slots, avgSeconds) => slots / avgSeconds;

/** Little's law check: observed concurrency should be ~ lambda * W. Returns the utilization of the slots actually occupied. */
export const utilization = (lambda, avgSeconds, slots) => (lambda * avgSeconds) / slots;

/** Linear-interpolated percentile of a numeric array (p in 0..100). null for an empty array. */
export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

/**
 * Throughput knee of a concurrency sweep. `points` = [{concurrency, throughput, p95WaitMs?, failRate?}] ascending by concurrency.
 * The knee is the smallest concurrency whose throughput is within `tolerance` (default 5%) of the best observed throughput and whose
 * failure rate is acceptable; raising it further buys < tolerance. `safeDefault` keeps `headroom` (default 30%) below the knee.
 */
export function findKnee(points, { tolerance = 0.05, maxFailRate = 0.01, headroom = 0.3 } = {}) {
  const ok = points.filter((p) => (p.failRate ?? 0) <= maxFailRate);
  if (!ok.length) return { knee: null, safeDefault: null, peakThroughput: 0, reason: 'every level exceeded the failure budget' };
  const peak = Math.max(...ok.map((p) => p.throughput));
  const knee = ok.find((p) => p.throughput >= peak * (1 - tolerance));
  const safeDefault = Math.max(1, Math.floor(knee.concurrency * (1 - headroom)));
  const degraded = ok.some((p) => p.concurrency > knee.concurrency && p.throughput < peak * 0.9);
  const atRangeEdge = knee.concurrency === points[points.length - 1].concurrency;
  return { knee: knee.concurrency, atRangeEdge, safeDefault, peakThroughput: peak, degradesPastKnee: degraded, reason: 'smallest level within tolerance of peak' };
}

/** Relative change; positive = increase. */
export const relChange = (base, now) => (base === 0 ? (now === 0 ? 0 : Infinity) : (now - base) / base);

/**
 * Regression verdict between a baseline and a current run for one queue. Throughput may not fall more than `maxThroughputDrop`;
 * p95/p99 wait and processing time may not rise more than `maxLatencyRise` (and by more than `minAbsMs`, so noise on a 2 ms number does
 * not fail the gate). Returns {ok, failures[]}.
 */
export function regression(base, now, { maxThroughputDrop = 0.15, maxLatencyRise = 0.3, minAbsMs = 20 } = {}) {
  const failures = [];
  if (relChange(base.throughput, now.throughput) < -maxThroughputDrop) failures.push(`throughput ${base.throughput} -> ${now.throughput}`);
  for (const k of ['waitP95Ms', 'waitP99Ms', 'procP95Ms', 'procP99Ms']) {
    if (base[k] == null || now[k] == null) continue;
    if (relChange(base[k], now[k]) > maxLatencyRise && now[k] - base[k] > minAbsMs) failures.push(`${k} ${base[k]} -> ${now[k]}`);
  }
  if ((now.lost ?? 0) > 0) failures.push(`lost jobs: ${now.lost}`);
  return { ok: failures.length === 0, failures };
}

/**
 * Autoscaling decision with hysteresis (QCAP-072..075). Scale out on age/utilization breach, scale in only after `scaleInCooldownS`
 * of sustained calm, never past the DB/provider ceiling or the resource budget. Returns the desired replica count and why.
 */
export function scaleDecision(s, cfg) {
  const { replicas, oldestWaitingS, utilization: u, secondsCalm, dbConnHeadroom, providerHeadroom } = s;
  const { minReplicas, maxReplicas, ageSloS, scaleOutUtil = 0.8, scaleInUtil = 0.4, scaleInCooldownS = 600, connPerReplica = 0 } = cfg;
  const dbCap = connPerReplica > 0 ? replicas + Math.floor(dbConnHeadroom / connPerReplica) : Infinity;
  const ceiling = Math.min(maxReplicas, dbCap);
  if (providerHeadroom !== undefined && providerHeadroom <= 0 && (oldestWaitingS > ageSloS || u > scaleOutUtil)) {
    return { desired: replicas, reason: 'provider-bound: more workers would only add 429s' };
  }
  if (oldestWaitingS > ageSloS || u > scaleOutUtil) {
    const desired = Math.min(ceiling, replicas + Math.max(1, Math.ceil(replicas * 0.5)));
    return { desired, reason: desired === replicas ? 'at ceiling (budget or DB connections)' : 'age or utilization over threshold' };
  }
  if (u < scaleInUtil && oldestWaitingS < ageSloS / 2 && secondsCalm >= scaleInCooldownS) {
    return { desired: Math.max(minReplicas, replicas - 1), reason: 'calm for cooldown, scale in by one' };
  }
  return { desired: replicas, reason: 'hold' };
}
