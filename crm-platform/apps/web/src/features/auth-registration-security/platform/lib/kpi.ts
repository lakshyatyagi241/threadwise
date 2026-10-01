/** Small pure helpers behind the Security Center KPI strip and coverage bars. */

/** Reference calls 70 and up "strong"; below that "attention needed". */
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
