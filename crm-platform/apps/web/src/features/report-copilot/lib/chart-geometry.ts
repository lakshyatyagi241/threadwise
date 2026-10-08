import type { ChartBlock } from './blocks';
import { colorAt, foldSlices } from './palette';

/** Round upper bound for an axis: 1, 2, 2.5, 5 or 10 times a power of ten that covers `max`. */
export function niceCeil(max: number): number {
  if (!(max > 0)) return 1;
  const base = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= max) return m * base;
  return 10 * base;
}

export interface AxisSeries {
  name: string;
  color: string;
  values: Array<number | null>;
}

export interface AxisModel {
  labels: string[];
  series: AxisSeries[];
  /** The value range of the y axis. It always includes 0, so bars start at the baseline. */
  lo: number;
  hi: number;
  ticks: number[];
}

/**
 * Lines the series up on one list of labels (each label once, in the order first seen; a series with no point there has a gap, not a
 * zero) and works out the y range. Colour follows the series by its position.
 */
export function axisModel(chart: ChartBlock): AxisModel {
  const labels: string[] = [];
  for (const s of chart.series)
    for (const p of s.points) if (!labels.includes(p.label)) labels.push(p.label);
  const series = chart.series.map((s, i) => ({
    name: s.name,
    color: colorAt(i),
    values: labels.map((l) => s.points.find((p) => p.label === l)?.value ?? null),
  }));
  const stacked = chart.type === 'bar' && !!chart.stacked;
  let max = 0;
  let min = 0;
  labels.forEach((_, i) => {
    const vals = series.map((s) => s.values[i]).filter((v): v is number => v !== null);
    if (stacked) {
      max = Math.max(
        max,
        vals.filter((v) => v > 0).reduce((a, b) => a + b, 0),
      );
      min = Math.min(
        min,
        vals.filter((v) => v < 0).reduce((a, b) => a + b, 0),
      );
    } else {
      for (const v of vals) {
        max = Math.max(max, v);
        min = Math.min(min, v);
      }
    }
  });
  const hi = max > 0 ? niceCeil(max) : 0;
  const lo = min < 0 ? -niceCeil(-min) : 0;
  const top = hi === 0 && lo === 0 ? 1 : hi;
  const step = (top - lo) / 4;
  const ticks = [0, 1, 2, 3, 4].map((k) => lo + step * k);
  return { labels, series, lo, hi: top, ticks };
}

/** True when there is at least one real point to draw (so an empty or all-gap chart gets the empty state, never a blank plot). */
export const hasData = (chart: ChartBlock): boolean =>
  chart.series.some((s) => s.points.some((p) => Number.isFinite(p.value)));

export interface Slice {
  label: string;
  value: number;
  color: string;
  /** Share of the total, 0..1. */
  share: number;
  start: number;
  end: number;
}

/** Slices of a pie or donut: positive values of the first series, the smallest folded into "Other" past eight, angles in radians. */
export function sliceModel(chart: ChartBlock, other: string): { slices: Slice[]; total: number } {
  const first = chart.series[0];
  const positive = (first?.points ?? []).filter((p) => p.value > 0);
  const folded = foldSlices(positive, other);
  const total = folded.reduce((n, s) => n + s.value, 0);
  let angle = -Math.PI / 2;
  const slices = folded.map((s, i) => {
    const share = total > 0 ? s.value / total : 0;
    const start = angle;
    angle += share * Math.PI * 2;
    return { ...s, color: colorAt(i), share, start, end: angle };
  });
  return { slices, total };
}

/** An SVG path for a ring segment (inner radius 0 for a pie). A full circle is drawn as two halves, which one arc cannot do. */
export function arcPath(
  cx: number,
  cy: number,
  r: number,
  r0: number,
  a0: number,
  a1: number,
): string {
  const full = a1 - a0 >= Math.PI * 2 - 1e-6;
  const end = full ? a0 + Math.PI * 2 - 1e-4 : a1;
  const p = (rad: number, a: number) =>
    `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
  const large = end - a0 > Math.PI ? 1 : 0;
  const outer = `M ${p(r, a0)} A ${r} ${r} 0 ${large} 1 ${p(r, end)}`;
  return r0 > 0
    ? `${outer} L ${p(r0, end)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`
    : `${outer} L ${cx} ${cy} Z`;
}
