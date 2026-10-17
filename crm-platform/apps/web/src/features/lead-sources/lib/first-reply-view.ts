import {
  LEAD_FIRST_REPLY_REASONS,
  LEAD_FIRST_REPLY_STATUSES,
  type LeadFirstReplyReason,
  type LeadFirstReplyResponse,
  type LeadFirstReplyStatus,
} from '@crm/contracts';
import type { Tone } from './event-view';

/**
 * How a lead's automatic first message (speed-to-lead) is shown: the colour of its status, what its reason means, and which moment
 * goes with it. Pure, so every status and reason has a test and a text.
 */

export const FIRST_REPLY_TONE: Record<LeadFirstReplyStatus, Tone> = {
  scheduled: 'neutral',
  sending: 'neutral',
  held: 'warning',
  sent: 'success',
  blocked: 'danger',
  skipped: 'neutral',
  failed: 'danger',
};

export const FIRST_REPLY_STATUS_KEYS: readonly LeadFirstReplyStatus[] = LEAD_FIRST_REPLY_STATUSES;
export const FIRST_REPLY_REASON_KEYS: readonly LeadFirstReplyReason[] = LEAD_FIRST_REPLY_REASONS;

const REASONS: ReadonlySet<string> = new Set(LEAD_FIRST_REPLY_REASONS);

/** A known reason is translated; an unknown one (a newer server) is not shown as a code, the status says enough. */
export const knownReason = (reason: string | null): LeadFirstReplyReason | null =>
  reason !== null && REASONS.has(reason) ? (reason as LeadFirstReplyReason) : null;

/** Which moment goes with the status: when it is due (scheduled, held), when it left (sent), nothing for the rest. */
export function momentOf(
  r: Pick<LeadFirstReplyResponse, 'status' | 'dueAt' | 'sentAt'>,
): { kind: 'due' | 'sent'; at: string } | null {
  if (r.status === 'scheduled' || r.status === 'held') return { kind: 'due', at: r.dueAt };
  if (r.status === 'sent' && r.sentAt) return { kind: 'sent', at: r.sentAt };
  return null;
}
