import type { DashFunnel, DashTotals } from '@crm/contracts';

/** What the repository counts for one window, before rates (WD-DASH-002 rule 3). */
export interface RawCounts {
  sent: number;
  delivered: number;
  failed: number;
  read: number;
  replies: number;
  repliers: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
/** Percent to one decimal; a zero denominator gives 0. */
export const pct = (num: number, den: number): number => (den > 0 ? round1((num / den) * 100) : 0);

/** Percent change: previous <= 0 gives +100 when there is anything now, else 0 (WD-DASH-002 rule 5). */
export function percentChange(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return round1(((current - previous) / previous) * 100);
}

/** Rate delta in percentage points. */
export const deltaPp = (current: number, previous: number): number => round1(current - previous);

export function totalsOf(c: RawCounts): DashTotals {
  return {
    ...c,
    queued: Math.max(0, c.sent - c.delivered - c.failed),
    deliverability: pct(c.delivered, c.sent),
    readRate: pct(c.read, c.sent),
    replyRate: pct(c.replies, c.sent),
  };
}

/** Sent, delivered, replied (inbound), engaged (distinct repliers); drops are measured from the stage the story comes from. */
export function funnelOf(t: DashTotals): DashFunnel {
  const stages = [
    { key: 'sent' as const, count: t.sent, from: t.sent },
    { key: 'delivered' as const, count: t.delivered, from: t.sent },
    { key: 'replied' as const, count: t.replies, from: t.delivered },
    { key: 'engaged' as const, count: t.repliers, from: t.replies },
  ];
  const out = stages.map((s, i) => ({
    key: s.key,
    count: s.count,
    pct: pct(s.count, t.sent),
    drop: i === 0 ? 0 : Math.max(0, s.from - s.count),
  }));
  return { stages: out, endToEnd: out[3]!.pct };
}
