/**
 * The warmer's arithmetic (WD-SCHED-038, 040), ported from WaDesk's WarmerService and kept pure: no database, no clock of its own.
 * A warming number sends from a ramping daily budget with a random gap between messages, only inside its active hours, and may vary
 * each message with spintax. It is risk reduction, not a guarantee: heavy senders belong on the official API.
 */
import { WARMER_DEFAULTS, type WarmerProfileInput } from '@crm/contracts';

export type WarmerProfile = WarmerProfileInput;

const int = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

/** A stored profile merged over the defaults and clamped, so a bad save can never break a send. */
export function profileOf(raw: unknown): WarmerProfile {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  // The stored shape is WaDesk's snake case; the screens speak camel case.
  const pick = (camel: string, snake: string) => r[camel] ?? r[snake];
  const dailyBase = Math.max(1, int(pick('dailyBase', 'daily_base'), WARMER_DEFAULTS.dailyBase));
  const gapMin = Math.max(0, int(pick('gapMin', 'gap_min'), WARMER_DEFAULTS.gapMin));
  return {
    enabled: Boolean(pick('enabled', 'enabled')),
    dailyBase,
    stepPct: Math.max(0, Math.min(200, int(pick('stepPct', 'step_pct'), WARMER_DEFAULTS.stepPct))),
    stepDays: Math.max(1, int(pick('stepDays', 'step_days'), WARMER_DEFAULTS.stepDays)),
    maxDaily: Math.max(dailyBase, int(pick('maxDaily', 'max_daily'), WARMER_DEFAULTS.maxDaily)),
    gapMin,
    gapMax: Math.max(gapMin, int(pick('gapMax', 'gap_max'), WARMER_DEFAULTS.gapMax)),
    activeStart: Math.max(
      0,
      Math.min(23, int(pick('activeStart', 'active_start'), WARMER_DEFAULTS.activeStart)),
    ),
    activeEnd: Math.max(
      0,
      Math.min(24, int(pick('activeEnd', 'active_end'), WARMER_DEFAULTS.activeEnd)),
    ),
    spintax: Boolean(pick('spintax', 'spintax')),
  };
}

/** The ramp's first day, as stored (`started_at`); null until the warmer was first enabled. */
export function startedAtOf(raw: unknown): string | null {
  const v =
    (raw as { started_at?: unknown; startedAt?: unknown } | null)?.started_at ??
    (raw as { startedAt?: unknown } | null)?.startedAt;
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

const DAY_MS = 86_400_000;
const dayNumber = (isoDate: string): number =>
  Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS);

/**
 * The ramped budget for one calendar day: `dailyBase` grown by `stepPct` every `stepDays` days since the ramp started, never above
 * `maxDaily`. A send next week gets next week's (larger) budget. `fallbackStart` is when the number was created, used until a start
 * is stamped.
 */
export function dailyBudgetFor(
  profile: WarmerProfile,
  startedAt: string | null,
  fallbackStart: string,
  day: string,
): number {
  const start = startedAt ?? fallbackStart;
  const daysIn = Math.max(0, dayNumber(day) - dayNumber(start));
  const steps = Math.floor(daysIn / Math.max(1, profile.stepDays));
  const budget = profile.dailyBase * Math.pow(1 + profile.stepPct / 100, steps);
  return Math.min(profile.maxDaily, Math.max(profile.dailyBase, Math.floor(budget)));
}

/** Is `hour` (0 to 23, local) inside the window? Equal start and end means all day; a window like 21 to 6 wraps past midnight. */
export function withinActiveHours(profile: WarmerProfile, hour: number): boolean {
  const { activeStart: start, activeEnd: end } = profile;
  if (start === end) return true;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** A human-like delay for the next send, seconds, from `random` in [0, 1). */
export function gapSeconds(profile: WarmerProfile, random: () => number = Math.random): number {
  return profile.gapMax > profile.gapMin
    ? profile.gapMin + Math.floor(random() * (profile.gapMax - profile.gapMin + 1))
    : profile.gapMin;
}

export type HoldReason = 'outside_active_hours' | 'daily_budget_reached' | 'budget_capped';

/**
 * Whether a batch of `requested` messages may leave. `now` batches also need the active hours; a batch for a later day only needs to
 * fit that day's budget after what is already reserved (the send fires later, so the hour does not apply). A number that is not
 * warming always passes.
 */
export function gateBatch(
  profile: WarmerProfile,
  q: { requested: number; budget: number; used: number; hour?: number },
): { ok: boolean; allowed: number; reason: HoldReason | null; remaining: number } {
  if (!profile.enabled) return { ok: true, allowed: q.requested, reason: null, remaining: 0 };
  if (q.hour !== undefined && !withinActiveHours(profile, q.hour)) {
    return { ok: false, allowed: 0, reason: 'outside_active_hours', remaining: 0 };
  }
  const remaining = Math.max(0, q.budget - q.used);
  if (remaining <= 0)
    return { ok: false, allowed: 0, reason: 'daily_budget_reached', remaining: 0 };
  if (q.requested > remaining)
    return { ok: false, allowed: remaining, reason: 'budget_capped', remaining };
  return { ok: true, allowed: q.requested, reason: null, remaining };
}

export interface HealthFacts {
  status: string;
  ageDays: number;
  sent24h: number;
  failed24h: number;
  budget: number;
}

/**
 * 0 to 100: connection, age, failure ratio over 24 hours and volume far above the ramp. Higher means safer to ramp. Advisory only
 * (WD-SCHED-040): nothing is blocked by it.
 */
export function healthScore(f: HealthFacts): number {
  let score = 50;
  const status = f.status.toLowerCase();
  if (['connected', 'open', 'online', 'active'].includes(status)) score += 20;
  else if (['disconnected', 'logged_out', 'banned'].includes(status)) score -= 25;
  score += Math.min(20, Math.floor(Math.max(0, f.ageDays) / 3));
  const total = f.sent24h + f.failed24h;
  if (total > 0) score -= Math.round((f.failed24h / total) * 40);
  if (f.budget > 0 && f.sent24h > f.budget * 2) score -= 15;
  return Math.max(0, Math.min(100, score));
}

/**
 * `{a|b|c}` becomes one random choice; nested braces work from the inside out. Only a group with a `|` is a choice: a lone `{x}` or a
 * merge tag `{{name}}` is left alone (WaDesk's version stripped their braces). Bounded so a hostile text cannot loop.
 */
export function spin(text: string, random: () => number = Math.random): string {
  const choice = /\{([^{}]*\|[^{}]*)\}/;
  let out = text;
  for (let i = 0; i < 50 && choice.test(out); i++) {
    out = out.replace(choice, (_m, inner: string) => {
      const parts = inner.split('|');
      return parts[Math.floor(random() * parts.length)]!;
    });
  }
  return out;
}
