import type { EmailMeta } from '@crm/contracts';

export type DeliveryView =
  { state: 'ok' } | { state: 'bounced'; kind: 'hard' | 'soft'; address: string; reason: string };

/**
 * How an email message stands in the thread: a sent message that bounced (or the report that says so) shows who it did not reach
 * and why. A hard bounce will not pass; a soft one may (mailbox full, server busy).
 */
export function deliveryView(email: Pick<EmailMeta, 'bounce' | 'delivery'>): DeliveryView {
  if (email.bounce && (email.delivery === 'bounced' || email.delivery === undefined)) {
    return {
      state: 'bounced',
      kind: email.bounce.kind,
      address: email.bounce.failedRecipient,
      reason: email.bounce.reason,
    };
  }
  return { state: 'ok' };
}
