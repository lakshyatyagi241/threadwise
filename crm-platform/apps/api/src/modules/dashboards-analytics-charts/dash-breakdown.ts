/** One group of the overview's single pass over a window's messages (`DashRepository.breakdown`). */
export interface BreakdownRow {
  /** Local calendar day, counted from the window's first day. */
  day: number;
  /** Weekday in the workspace zone, Sunday 0. */
  dow: number;
  hour: number;
  direction: string;
  /** Display type: template, media, location, interactive or text. */
  type: string;
  count: number;
  delivered: number;
  failed: number;
}

export interface FoldedBreakdown {
  /** Outbound per local day; days with no outbound message are missing. */
  days: Map<number, { sent: number; delivered: number; failed: number }>;
  /** Outbound by display type; types with no outbound message are missing. */
  types: Array<{ key: string; count: number; delivered: number }>;
  /** Messages of both directions by weekday (Sunday 0) and hour. */
  heatmap: number[][];
}

/** Sums the groups into the daily series, the type mix and the heatmap (TW-DASH-027, 031). */
export function foldBreakdown(rows: readonly BreakdownRow[]): FoldedBreakdown {
  const days = new Map<number, { sent: number; delivered: number; failed: number }>();
  const types = new Map<string, { count: number; delivered: number }>();
  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const r of rows) {
    heatmap[r.dow]![r.hour]! += r.count;
    if (r.direction !== 'out') continue;
    const d = days.get(r.day) ?? { sent: 0, delivered: 0, failed: 0 };
    d.sent += r.count;
    d.delivered += r.delivered;
    d.failed += r.failed;
    days.set(r.day, d);
    const t = types.get(r.type) ?? { count: 0, delivered: 0 };
    t.count += r.count;
    t.delivered += r.delivered;
    types.set(r.type, t);
  }
  return { days, types: [...types].map(([key, t]) => ({ key, ...t })), heatmap };
}
