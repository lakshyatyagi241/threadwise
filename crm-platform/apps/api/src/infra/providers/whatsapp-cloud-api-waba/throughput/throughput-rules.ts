import {
  WABA_COEXISTENCE_MPS,
  WABA_DEFAULT_MPS,
  WABA_HIGH_MPS,
  type WabaRateSource,
  type WabaTierState,
} from '@crm/contracts';

/**
 * The rules of WhatsApp send pacing. Pure: no Redis, no clock of its own, so every rule is tested row by row.
 *
 * Meta's figures (throughput reference): 80 messages per second per number by default, 1,000 once Meta upgrades a number that has
 * an unlimited messaging limit, 100K+ unique users in 24 hours outside the service window and Medium or better quality; 20 for a
 * number used with both the Business app and the Cloud API. Messaging tiers (a daily count of unique recipients) are a separate
 * limit and are read here only to be shown and, if the operator asks, enforced.
 */

export interface ParsedThroughput {
  /** Meta's label as given (`STANDARD`, `HIGH`), upper-cased; null when none. */
  level: string | null;
  /** The rate that label stands for; null when Meta gave a label this code does not know. */
  mps: number | null;
}

const clampMps = (n: number) => Math.min(WABA_HIGH_MPS, Math.max(1, Math.floor(n)));

/**
 * `GET /<PHONE_NUMBER_ID>?fields=throughput` answers `{ level: "STANDARD" | "HIGH" | "NOT_APPLICABLE" }`. Read defensively: a bare
 * string, a number, or an object that carries a number is accepted; anything else is "unknown", never a guess.
 */
export function parseThroughput(raw: unknown): ParsedThroughput {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0)
    return { level: null, mps: clampMps(raw) };
  const level =
    typeof raw === 'string'
      ? raw
      : raw && typeof raw === 'object' && typeof (raw as { level?: unknown }).level === 'string'
        ? (raw as { level: string }).level
        : null;
  const label = level ? level.trim().toUpperCase() : null;
  if (label === 'STANDARD') return { level: label, mps: WABA_DEFAULT_MPS };
  if (label === 'HIGH') return { level: label, mps: WABA_HIGH_MPS };
  if (raw && typeof raw === 'object') {
    for (const key of ['mps', 'messages_per_second', 'value'] as const) {
      const n = (raw as Record<string, unknown>)[key];
      if (typeof n === 'number' && Number.isFinite(n) && n > 0)
        return { level: label, mps: clampMps(n) };
    }
  }
  return { level: label, mps: null };
}

export interface ParsedTier {
  name: string | null;
  /** Unique recipients per 24 hours; null for unlimited and for a tier this code cannot read. */
  cap: number | null;
  unlimited: boolean;
}

/** `TIER_50`, `TIER_250`, `TIER_1K`, `TIER_10K`, `TIER_100K`, `TIER_UNLIMITED` (also the `current_limit` of the quality webhook). */
export function parseTier(raw: unknown): ParsedTier {
  if (typeof raw !== 'string' || raw.trim() === '') return { name: null, cap: null, unlimited: false };
  const name = raw.trim().toUpperCase();
  if (name.includes('UNLIMITED')) return { name, cap: null, unlimited: true };
  const m = /(\d+(?:\.\d+)?)\s*([KM])?$/.exec(name);
  if (!m) return { name, cap: null, unlimited: false };
  const mult = m[2] === 'K' ? 1_000 : m[2] === 'M' ? 1_000_000 : 1;
  return { name, cap: Math.round(Number(m[1]) * mult), unlimited: false };
}

export interface RateInputs {
  /** Operator override, or null to follow Meta. */
  overrideMps: number | null;
  coexistence: boolean;
  /** The rate Meta reported (see {@link parseThroughput}), or null. */
  metaMps: number | null;
  defaultMps: number;
  safetyMarginPct: number;
}

export interface ResolvedRate {
  /** What Meta allows (or the operator chose), before the safety margin. */
  capMps: number;
  /** What sends are paced to. */
  mps: number;
  source: WabaRateSource;
}

/**
 * The rate a number is paced to. An operator override wins and is used as given (it is a decision, not a guess); otherwise a
 * coexistence number is held at Meta's fixed 20, then Meta's own value, then the platform default. The safety margin is taken off
 * every source except an override, and the result is never below 1.
 */
export function resolveRate(i: RateInputs): ResolvedRate {
  if (i.overrideMps !== null && i.overrideMps > 0) {
    const mps = clampMps(i.overrideMps);
    return { capMps: mps, mps, source: 'override' };
  }
  const margin = Math.min(50, Math.max(0, i.safetyMarginPct));
  const apply = (cap: number) => ({
    capMps: cap,
    mps: Math.max(1, Math.floor((cap * (100 - margin)) / 100)),
  });
  if (i.coexistence) return { ...apply(WABA_COEXISTENCE_MPS), source: 'coexistence' };
  if (i.metaMps !== null && i.metaMps > 0) return { ...apply(clampMps(i.metaMps)), source: 'meta' };
  return { ...apply(clampMps(i.defaultMps)), source: 'default' };
}

// --- adaptive back-off after a Meta throttle -----------------------------------------------------------------------------------

/** How long a number takes to win back full speed after a throttle, from the lowest factor. */
export const RECOVERY_MS = 60_000;
/** The slowest a throttled number is paced to, as a share of its rate. */
export const MIN_SPEED_FACTOR = 0.2;

/** Multiplicative decrease: each Meta throttle halves the speed, down to the floor. */
export function afterThrottle(currentFactor: number): number {
  return Math.max(MIN_SPEED_FACTOR, Math.min(1, currentFactor) / 2);
}

/** Additive recovery: the factor climbs back linearly, reaching 1 `RECOVERY_MS` after the throttle it started from. */
export function recoveredFactor(factor: number, sinceMs: number): number {
  if (sinceMs <= 0) return Math.min(1, factor);
  return Math.min(1, factor + (sinceMs / RECOVERY_MS) * (1 - MIN_SPEED_FACTOR));
}

// --- daily tier ------------------------------------------------------------------------------------------------------------------

export function tierState(
  tier: ParsedTier,
  used: number,
  warnPct: number,
): { state: WabaTierState; pct: number | null } {
  if (tier.unlimited) return { state: 'unlimited', pct: null };
  if (tier.cap === null || tier.cap <= 0) return { state: 'unknown', pct: null };
  const pct = Math.round((used / tier.cap) * 1000) / 10;
  if (used >= tier.cap) return { state: 'full', pct };
  return { state: pct >= warnPct ? 'warn' : 'ok', pct };
}

/** Milliseconds until the hour bucket that holds the oldest counted recipients expires: when a full tier starts to free up. */
export function msUntilNextHour(now: number): number {
  return 3_600_000 - (now % 3_600_000);
}

export const hourBucket = (now: number) => Math.floor(now / 3_600_000);
export const secondBucket = (now: number) => Math.floor(now / 1_000);
export const minuteBucket = (now: number) => Math.floor(now / 60_000);

/** The throughput level changed in a way worth a log line (Meta upgraded the number, or took the upgrade back). */
export function throughputChanged(before: ParsedThroughput, after: ParsedThroughput): boolean {
  return before.level !== after.level || before.mps !== after.mps;
}
