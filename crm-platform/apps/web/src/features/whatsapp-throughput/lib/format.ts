import type {
  WabaNumberThroughput,
  WabaRateSource,
  WabaThroughputSeriesPoint,
  WabaTierState,
} from '@crm/contracts';

export type Tone = 'success' | 'warning' | 'danger' | 'neutral';

export const tierTone = (state: WabaTierState): Tone =>
  state === 'full'
    ? 'danger'
    : state === 'warn'
      ? 'warning'
      : state === 'ok'
        ? 'success'
        : 'neutral';

export const sourceTone = (source: WabaRateSource): Tone =>
  source === 'override' ? 'warning' : source === 'meta' ? 'success' : 'neutral';

/** A number that needs a person's eye: paused, slowed after a Meta throttle, its tier nearly or fully used, or its last Meta read failed. */
export function needsAttention(n: WabaNumberThroughput): boolean {
  return (
    n.control.paused ||
    n.live.speedFactor < 1 ||
    n.live.metaThrottled5m > 0 ||
    n.tier.state === 'warn' ||
    n.tier.state === 'full' ||
    n.syncError !== null
  );
}

/** How much of the number's paced rate is in use right now, 0 to 1 (can pass 1 for an instant: a burst is allowed). */
export function loadOf(n: WabaNumberThroughput): number {
  return n.effectiveMps > 0 ? Math.min(1.5, n.live.mpsNow / n.effectiveMps) : 0;
}

export const percent = (v: number) => `${Math.round(v * 100)}%`;

/** The polyline of a series, scaled to a `w` by `h` box (y grows downward). Empty for no data. */
export function sparkPoints(
  points: readonly Pick<WabaThroughputSeriesPoint, 'sent'>[],
  w: number,
  h: number,
  ceiling?: number,
): string {
  if (points.length < 2) return '';
  const max = Math.max(1, ceiling ?? 0, ...points.map((p) => p.sent));
  const step = w / (points.length - 1);
  return points
    .map((p, i) => `${(i * step).toFixed(1)},${(h - (p.sent / max) * h).toFixed(1)}`)
    .join(' ');
}

/** `1,234` style grouping in the viewer's locale. */
export const num = (n: number, locale?: string) => new Intl.NumberFormat(locale).format(n);
