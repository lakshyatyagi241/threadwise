import { IN_FLIGHT_STATUSES } from '@crm/contracts';
import type { RecipientCounts } from './recipient-status';

/**
 * The numbers on the broadcast screens, from recipient counts (WD-BCAST-002, 030, 031, 033, 035, 036). Pure.
 *
 * A higher tier includes the lower ones: a read recipient is also delivered and sent.
 */
export const pct = (n: number, base: number) => (base > 0 ? Math.round((n / base) * 1000) / 10 : 0);

export function cascade(c: RecipientCounts) {
  const total = c.pending + c.processing + c.sent + c.delivered + c.read + c.failed;
  const read = c.read;
  const delivered = c.delivered + c.read;
  const sent = c.sent + delivered;
  return {
    total,
    sent,
    delivered,
    read,
    failed: c.failed,
    queued: c.pending,
    processing: c.processing,
  };
}

/** The detail header: sent% delivered% and failed% over the audience, read% and the click-through rate over delivered. */
export function headerPct(c: ReturnType<typeof cascade>, clicked = 0) {
  return {
    sent: pct(c.sent, c.total),
    delivered: pct(c.delivered, c.total),
    read: pct(c.read, c.delivered),
    failed: pct(c.failed, c.total),
    clicked: pct(clicked, c.delivered),
  };
}

export const DONUT_LABELS = ['Sent', 'Delivered', 'Read', 'Queued', 'Failed'] as const;

/** Sent but not yet delivered, delivered but not read, read, queued, failed; the centre is how much of the audience is not failed or waiting. */
export function donut(c: RecipientCounts) {
  const total = c.pending + c.processing + c.sent + c.delivered + c.read + c.failed;
  return {
    labels: [...DONUT_LABELS],
    series: [c.sent, c.delivered, c.read, c.pending, c.failed],
    successPct: total > 0 ? Math.round(((total - c.failed - c.pending) / total) * 100) : 0,
  };
}

/** The live counters (WD-BCAST-035). Percentages are over the audience size, as WaDesk had them. */
export function liveStats(status: string, c: RecipientCounts, now: Date) {
  const k = cascade(c);
  return {
    status,
    total: k.total,
    sent: k.sent,
    delivered: k.delivered,
    read: k.read,
    failed: k.failed,
    queued: k.queued,
    pct: {
      sent: pct(k.sent, k.total),
      delivered: pct(k.delivered, k.total),
      read: pct(k.read, k.total),
      failed: pct(k.failed, k.total),
    },
    inFlight: (IN_FLIGHT_STATUSES as readonly string[]).includes(status),
    fetchedAt: now.toISOString(),
  };
}

/** Top `limit` reasons by count, the rest summed into "Other"; a missing reason is "Unknown". */
export function failureHistogram(
  rows: ReadonlyArray<{ reason: string | null; count: number }>,
  limit = 8,
) {
  const merged = new Map<string, number>();
  for (const r of rows) {
    const key = (r.reason ?? '').trim() || 'Unknown';
    merged.set(key, (merged.get(key) ?? 0) + r.count);
  }
  const sorted = [...merged.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = sorted.slice(0, limit).map(([reason, count]) => ({ reason, count }));
  const rest = sorted.slice(limit).reduce((n, [, count]) => n + count, 0);
  return rest > 0 ? [...top, { reason: 'Other', count: rest }] : top;
}

export interface HourCount {
  /** The hour in the broadcast's zone as `YYYY-MM-DD HH24`. */
  hour: string;
  n: number;
}

const HOUR_MS = 3_600_000;
const parseHour = (h: string) =>
  Date.UTC(+h.slice(0, 4), +h.slice(5, 7) - 1, +h.slice(8, 10), +h.slice(11, 13));

/**
 * The delivery curve (WD-BCAST-031): hourly buckets from the creation hour to the latest event hour, at most 24, labelled
 * `H:00`. The origin is the creation time, as in WaDesk. Hours are strings in the broadcast's own zone, so the arithmetic
 * is plain hour counting with no zone maths.
 */
export function deliveryCurve(
  createdHour: string,
  events: { sent: HourCount[]; delivered: HourCount[]; read: HourCount[] },
) {
  const start = parseHour(createdHour);
  const all = [...events.sent, ...events.delivered, ...events.read].map((e) => parseHour(e.hour));
  const latest = all.length ? Math.max(...all) : start + HOUR_MS;
  const end = Math.max(latest, start);
  const buckets = Math.min(24, Math.max(1, Math.floor((end - start) / HOUR_MS) + 1));

  const labels = Array.from(
    { length: buckets },
    (_, i) => `${new Date(start + i * HOUR_MS).getUTCHours()}:00`,
  );
  const tally = (list: HourCount[]) => {
    const out = new Array<number>(buckets).fill(0);
    for (const e of list) {
      const i = Math.floor((parseHour(e.hour) - start) / HOUR_MS);
      if (i >= 0 && i < buckets) out[i]! += e.n;
    }
    return out;
  };
  return {
    labels,
    sent: tally(events.sent),
    delivered: tally(events.delivered),
    read: tally(events.read),
  };
}
