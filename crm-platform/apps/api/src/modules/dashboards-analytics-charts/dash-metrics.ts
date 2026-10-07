import type { DashFunnel, DashTotals } from '@crm/contracts';

/** What the repository counts for one window, before rates (WD-DASH-002 rule 3). */
export interface RawCounts {
  sent: number;
  delivered: number;
  failed: number;
  read: number;
  replies: number;
  repliers: number;
  contactsMessaged: number;
  contactsDelivered: number;
  contactsReplied: number;
  contactsGoalCompleted: number;
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

/** Percent of contacts messaged, capped at 100: a contact can reply without being messaged in this window. */
export const contactPct = (num: number, messaged: number): number =>
  Math.min(100, pct(num, messaged));

/** Contacts replied over contacts messaged, percent, one decimal, never above 100. */
export const contactReplyRate = (
  t: Pick<DashTotals, 'contactsReplied' | 'contactsMessaged'>,
): number => contactPct(t.contactsReplied, t.contactsMessaged);

/** Replies per responding contact, one decimal; null when nobody replied. */
export const repliesPerContact = (inbound: number, respondingContacts: number): number | null =>
  respondingContacts > 0 ? round1(inbound / respondingContacts) : null;

/**
 * Reply-rate change against the previous window, in percentage points (one decimal). Null when the previous window messaged no
 * contacts (nothing to compare with), so the card hides the comparison.
 */
export function replyRateComparison(
  current: DashTotals,
  previous: DashTotals | undefined,
): { previousReplyRate: number; replyRatePp: number } | null {
  if (!previous || previous.contactsMessaged <= 0) return null;
  const prev = contactReplyRate(previous);
  return { previousReplyRate: prev, replyRatePp: deltaPp(contactReplyRate(current), prev) };
}

/**
 * Sent, delivered, replied (inbound), engaged (distinct repliers) kept for the CSV and older readers (drops are measured from the
 * stage the story comes from), plus the contact-based view the Engagement funnel card draws: contacts messaged, delivered, replied,
 * the conversation activity and the reply-rate comparison with `previous` (the same function serves dashboard and analytics).
 */
export function funnelOf(t: DashTotals, previous?: DashTotals): DashFunnel {
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
  return {
    stages: out,
    endToEnd: out[3]!.pct,
    contacts: {
      messaged: t.contactsMessaged,
      delivered: t.contactsDelivered,
      replied: t.contactsReplied,
      goalCompleted: t.contactsGoalCompleted,
    },
    activity: {
      inbound: t.replies,
      respondingContacts: t.contactsReplied,
      repliesPerContact: repliesPerContact(t.replies, t.contactsReplied),
    },
    replyRate: contactReplyRate(t),
    comparison: replyRateComparison(t, previous),
  };
}
