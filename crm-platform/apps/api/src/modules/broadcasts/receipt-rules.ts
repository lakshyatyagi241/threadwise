/**
 * Delivery receipts (WD-BCAST-024, 027). Pure.
 */

/** The cached counters a recipient status contributes to: sent is in success; delivered is also in success; read in all three. */
const TIER: Record<string, { success: number; delivered: number; read: number; fail: number }> = {
  pending: { success: 0, delivered: 0, read: 0, fail: 0 },
  processing: { success: 0, delivered: 0, read: 0, fail: 0 },
  sent: { success: 1, delivered: 0, read: 0, fail: 0 },
  delivered: { success: 1, delivered: 1, read: 0, fail: 0 },
  read: { success: 1, delivered: 1, read: 1, fail: 0 },
  failed: { success: 0, delivered: 0, read: 0, fail: 1 },
  undelivered: { success: 0, delivered: 0, read: 0, fail: 1 },
};

/** How the broadcast's counters move when one recipient goes from `from` to `to`. Applied as a delta, so a repeat changes nothing. */
export function counterDelta(from: string, to: string) {
  const a = TIER[from] ?? TIER.pending!;
  const b = TIER[to] ?? TIER.pending!;
  return {
    success: b.success - a.success,
    delivered: b.delivered - a.delivered,
    read: b.read - a.read,
    fail: b.fail - a.fail,
  };
}

/** Baileys message-update status: 3 delivered, 4 read, 5 played (read). 1 and 2 (pending, server ack) say nothing new. */
export function mapBaileysAck(status: number): 'delivered' | 'read' | null {
  if (status === 3) return 'delivered';
  if (status === 4 || status === 5) return 'read';
  return null;
}

/** Twilio message status to a recipient status; the rest (queued, accepted, sending) say nothing new. */
export function mapTwilioStatus(status: string): 'sent' | 'delivered' | 'read' | 'failed' | null {
  switch (status.toLowerCase()) {
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'read':
      return 'read';
    case 'failed':
    case 'undelivered':
      return 'failed';
    default:
      return null;
  }
}

/** The text kept on a failed recipient: the provider's message, else its code (WaDesk), cut to 512 characters. */
export function failureText(
  message: string | null | undefined,
  code: string | null | undefined,
): string | null {
  const text = (message ?? '').trim() || (code ? `error_code:${code}` : '');
  return text ? text.slice(0, 512) : null;
}
