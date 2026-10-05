/** Small pure helpers behind the Security Center KPI strip and coverage bars. */

/** WaDesk calls 70 and up "strong"; below that "attention needed". */
export const SCORE_STRONG_AT = 70;
export const scoreState = (score: number): 'strong' | 'attention' =>
  score >= SCORE_STRONG_AT ? 'strong' : 'attention';

/** Operator MFA coverage as a whole percent; 0 when there are no operators (never a division by zero). */
export function mfaCoveragePercent(enrolled: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((enrolled / total) * 100));
}

/** More than 1% failing is worth a look. */
export const webhookState = (failurePct: number): 'review' | 'normal' =>
  failurePct > 1 ? 'review' : 'normal';

export type MeterTone = 'success' | 'primary' | 'warning' | 'danger';

/** Coverage bar colour: 75+ strong, 50+ fair, 25+ weak, below that poor. */
export function coverageTone(percent: number): MeterTone {
  if (percent >= 75) return 'success';
  if (percent >= 50) return 'primary';
  if (percent >= 25) return 'warning';
  return 'danger';
}

/** What a coverage bucket shows next to its bar: "75%" and, when the API counts them, "75% (3/4)". */
export interface CoverageCounts {
  percent: number;
  /** Controls switched on in this bucket. */
  enabled?: number;
  /** Controls the bucket is made of. */
  total?: number;
}
export function coverageText(bucket: CoverageCounts, locale = 'en'): string {
  const pct = `${formatPercent(bucket.percent, locale)}%`;
  const { enabled, total } = bucket;
  if (enabled === undefined || total === undefined) return pct;
  const nf = new Intl.NumberFormat(locale);
  return `${pct} (${nf.format(enabled)}/${nf.format(total)})`;
}

export type KpiTone = 'success' | 'warning' | 'danger';
export type KpiId = 'score' | 'openRisks' | 'blocked' | 'warnings' | 'mfa' | 'webhooks';
export interface KpiAccent {
  /** Coloured tile outline; null keeps the neutral one. */
  border: KpiTone | null;
  /** Colour of the big number; null keeps the text colour. */
  value: KpiTone | null;
  /** Colour of the small note under it; null keeps the muted one. */
  note: KpiTone | null;
}

interface KpiNumbers {
  score: number;
  openRisks: number;
  warnings24h: number;
  webhookFailurePct: number;
}

/**
 * The colour logic of the six tiles. The score tile always has a green outline and the open-risks
 * tile turns red as soon as there is one; the warnings tile turns amber with the first warning
 * (WaDesk colours its "campaign holds" tile the same way); webhook failures read amber above 1%,
 * green otherwise. Everything else stays neutral.
 */
export function kpiAccents(k: KpiNumbers): Record<KpiId, KpiAccent> {
  const none: KpiAccent = { border: null, value: null, note: null };
  return {
    score: {
      border: 'success',
      value: null,
      note: scoreState(k.score) === 'strong' ? 'success' : 'warning',
    },
    openRisks: k.openRisks > 0 ? { border: 'danger', value: 'danger', note: 'danger' } : none,
    blocked: none,
    warnings: k.warnings24h > 0 ? { border: 'warning', value: null, note: 'warning' } : none,
    mfa: none,
    webhooks: {
      border: null,
      value: null,
      note: webhookState(k.webhookFailurePct) === 'review' ? 'warning' : 'success',
    },
  };
}

export type SeverityTone = 'danger' | 'warning' | 'neutral';
export const severityTone = (severity: 'high' | 'medium' | 'watch'): SeverityTone =>
  severity === 'high' ? 'danger' : severity === 'medium' ? 'warning' : 'neutral';

/** Up to two decimals, no trailing zeros, in the viewer's locale: 0 -> "0", 2.5 -> "2.5", 33.333 -> "33.33". */
export function formatPercent(value: number, locale = 'en'): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** "2 hours ago" in the viewer's locale. Anything under a minute reads as "now". */
export function formatRelativeTime(iso: string, now: number, locale = 'en'): string {
  const diffSeconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(diffSeconds) >= size) return rtf.format(Math.round(diffSeconds / size), unit);
  }
  return rtf.format(0, 'second');
}

/** 125 -> "2:05". Used for the sign-in challenge and lockout countdowns. */
export function formatMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
