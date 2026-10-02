/**
 * The recipient state machine and the broadcast outcome (TW-BCAST-025, 026, 027).
 *
 * One machine for every source that reports a recipient: the sender worker, Meta and Twilio status webhooks and
 * Baileys receipts. Reference had it only on the Meta and Twilio paths; Node's callbacks could move a row backwards.
 */

export const RECIPIENT_STATUSES = [
  'pending',
  'processing',
  'sent',
  'delivered',
  'read',
  'failed',
] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

const RANK: Record<string, number> = {
  pending: 1,
  queued: 1,
  processing: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 5,
};

/**
 * May a row at `current` take `incoming`?
 * A failed row never turns into a non-failed one, a read row ignores a later delivered, sent or failed, and otherwise
 * a status may only stay or move forward.
 */
export function shouldAdvance(current: string, incoming: string): boolean {
  if (!(incoming in RANK)) return false;
  const cur = RANK[current] ?? 1;
  const inc = RANK[incoming]!;
  if (current === 'failed') return incoming === 'failed';
  if (current === 'read') return incoming === 'read';
  return inc >= cur;
}

export interface RecipientCounts {
  pending: number;
  processing: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
}

/** The counters cached on the broadcast row: a higher tier includes the lower ones (read is also delivered is also sent). */
export function aggregates(c: RecipientCounts) {
  return {
    successCount: c.sent + c.delivered + c.read,
    deliveredCount: c.delivered + c.read,
    readCount: c.read,
    failCount: c.failed,
  };
}

export const TERMINAL_STATUSES = ['completed', 'completed_with_errors', 'failed'] as const;

/**
 * Derived from the recipient rows rather than trusted from the worker (TW-BCAST-026 port note). `null` while any recipient
 * is still waiting or being sent.
 */
export function outcome(c: RecipientCounts): (typeof TERMINAL_STATUSES)[number] | null {
  if (c.pending > 0 || c.processing > 0) return null;
  const total = c.sent + c.delivered + c.read + c.failed;
  if (total === 0) return null;
  if (c.failed === total) return 'failed';
  return c.failed > 0 ? 'completed_with_errors' : 'completed';
}
