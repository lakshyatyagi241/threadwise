/** Geometry of the sales-by-day chart (30 revenue columns, an orders line, two y axes). Pure. */

/** A round upper bound for an axis: 1, 2, 2.5, 5 or 10 times a power of ten that covers `max`. */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const exp = Math.floor(Math.log10(max));
  const base = 10 ** exp;
  for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= max) return m * base;
  return 10 * base;
}

/** `count + 1` evenly spaced tick values from 0 to `top`. */
export function ticks(top: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => (top / count) * i);
}

/** Indexes of the x labels to print: evenly spread, at most `max` of them, always the first and last. */
export function labelIndexes(length: number, max = 10): number[] {
  if (length <= 0) return [];
  if (length <= max) return Array.from({ length }, (_, i) => i);
  const step = (length - 1) / (max - 1);
  const out = new Set<number>();
  for (let i = 0; i < max; i++) out.add(Math.round(i * step));
  return [...out];
}

export interface ChartBox {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface SalesChartModel {
  revenueTop: number;
  ordersTop: number;
  revenueTicks: number[];
  ordersTicks: number[];
  /** One column per day, in pixels inside the box. */
  bars: Array<{ x: number; y: number; width: number; height: number }>;
  /** One point per day for the orders line, in pixels. */
  points: Array<{ x: number; y: number }>;
  /** SVG path of the orders line (a smooth curve through the points). */
  linePath: string;
  plot: { x: number; y: number; width: number; height: number };
}

/** Smooth path through the points (Catmull-Rom turned into cubic Beziers). */
export function smoothPath(points: ReadonlyArray<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  const p = (n: number) => Math.round(n * 100) / 100;
  let d = `M${p(points[0]!.x)} ${p(points[0]!.y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${p(c1x)} ${p(c1y)} ${p(c2x)} ${p(c2y)} ${p(p2.x)} ${p(p2.y)}`;
  }
  return d;
}

export function buildSalesChart(
  revenue: readonly number[],
  orders: readonly number[],
  box: ChartBox,
): SalesChartModel {
  const n = Math.max(revenue.length, orders.length);
  const plot = {
    x: box.left,
    y: box.top,
    width: Math.max(0, box.width - box.left - box.right),
    height: Math.max(0, box.height - box.top - box.bottom),
  };
  const revenueTop = niceMax(Math.max(0, ...revenue));
  const ordersTop = niceMax(Math.max(0, ...orders));
  const slot = n > 0 ? plot.width / n : 0;
  const barWidth = Math.max(1, slot * 0.62);
  const bars = Array.from({ length: n }, (_, i) => {
    const value = Math.max(0, revenue[i] ?? 0);
    const height = value > 0 ? Math.max(1.5, (value / revenueTop) * plot.height) : 0;
    return {
      x: plot.x + slot * i + (slot - barWidth) / 2,
      y: plot.y + plot.height - height,
      width: barWidth,
      height,
    };
  });
  const points = Array.from({ length: n }, (_, i) => ({
    x: plot.x + slot * i + slot / 2,
    y: plot.y + plot.height - (Math.max(0, orders[i] ?? 0) / ordersTop) * plot.height,
  }));
  const tickCount = (top: number) => (top >= 4 ? 4 : top >= 2 ? 2 : 1);
  return {
    revenueTop,
    ordersTop,
    revenueTicks: ticks(revenueTop, tickCount(revenueTop)),
    ordersTicks: ticks(ordersTop, tickCount(ordersTop)),
    bars,
    points,
    linePath: smoothPath(points),
    plot,
  };
}
