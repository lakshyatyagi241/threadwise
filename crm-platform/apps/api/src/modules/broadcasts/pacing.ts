/**
 * Pacing a broadcast (TW-BCAST-022). Pure.
 *
 * Reference's Node loop sent to recipients one at a time with human-like gaps, optional cooldowns between batches, and a daily
 * cap for the unofficial engine. These are the rules; the worker applies them.
 */
export interface PacingSettings {
  /** Seconds between two messages (Reference `msg_gap`, default 3). */
  msgGapSeconds: number;
  enableBatches: boolean;
  /** Recipients per batch (Reference `batches_gap`, default 50). */
  batchSize: number;
  /** Minutes between batches (Reference `bw_msg_gap`, default 5). */
  batchGapMinutes: number;
  /** Messages per sender per UTC day on the unofficial engine (Reference default 4000). */
  baileysDailyCap: number;
}

export const DEFAULT_PACING: PacingSettings = {
  msgGapSeconds: 3,
  enableBatches: false,
  batchSize: 50,
  batchGapMinutes: 5,
  baileysDailyCap: 4000,
};

/** A WhatsApp warm-up number sets its own gap range, in seconds. */
export interface WarmGap {
  min: number;
  max: number;
}

export type Random = () => number;

/** `base` varied by up to +/- `ratio`: 3 s with 20% is anywhere from 2.4 to 3.6 s. */
export function jitter(base: number, ratio: number, random: Random): number {
  if (base <= 0) return 0;
  return base * (1 + (random() * 2 - 1) * ratio);
}

/** The pause after a message, in ms: the warmer's range when the sender is warming (never under 1 s), else the setting +/- 20%. */
export function nextGapMs(s: PacingSettings, warm: WarmGap | null, random: Random): number {
  if (warm) {
    const min = Math.max(1, Math.min(warm.min, warm.max));
    const max = Math.max(1, warm.max, min);
    return Math.round((min + random() * (max - min)) * 1000);
  }
  return Math.round(jitter(s.msgGapSeconds, 0.2, random) * 1000);
}

/** Batches only apply when they are on and the audience is bigger than one batch. */
export const batchingApplies = (s: PacingSettings, total: number) =>
  s.enableBatches && s.batchSize > 0 && total > s.batchSize;

/** The cooldown between two batches, in ms, +/- 20%. */
export const batchCooldownMs = (s: PacingSettings, random: Random) =>
  Math.round(jitter(s.batchGapMinutes * 60, 0.2, random) * 1000);

/** The UTC day a tally belongs to, `YYYYMMDD`. */
export const utcDayKey = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

/** Midnight UTC after `d`: when a daily cap resets. */
export const nextUtcMidnight = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));

/** What is left of the cap today; never negative. */
export const capRemaining = (cap: number, sentToday: number) => Math.max(0, cap - sentToday);

/** Why a run stopped before it finished, kept on the broadcast so a screen can say and the resumer knows when to try again. */
export interface PauseNote {
  reason: 'daily_cap' | 'halt' | 'manual';
  at: string;
  /** For a daily cap: the instant it can resume. */
  resumeAfter?: string;
}
export const DAILY_CAP_MESSAGE =
  'Daily sending cap reached for this number. It resumes after midnight UTC.';
export const HALT_MESSAGE =
  'Sending is halted by the platform. It resumes when the halt is lifted.';
