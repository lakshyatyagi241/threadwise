import type { MailFailureReasonCode, ResendVerificationResponse } from '@crm/contracts';

export type ResendNotice = 'sent' | 'notSent' | 'alreadyVerified' | 'throttled';

export interface ResendOutcome {
  notice: ResendNotice;
  /** Why the mail could not be sent (closed list from the API); null unless `notice` is `notSent`. */
  reason: MailFailureReasonCode | null;
  /** Whether the 60-second wait applies. A mail that never left must not make the person wait to try again. */
  cooldown: boolean;
}

/**
 * What a resend answer means for the screen. The API starts its 60-second throttle only for a mail it actually sent,
 * so the countdown here follows the same rule: no countdown after a failed send, and the reason is shown instead.
 * An API that predates `reason` still gets a sensible line (`unknown`).
 */
export function resendOutcome(result: ResendVerificationResponse): ResendOutcome {
  if (result.alreadyVerified) return { notice: 'alreadyVerified', reason: null, cooldown: false };
  if (result.sent) return { notice: 'sent', reason: null, cooldown: true };
  return { notice: 'notSent', reason: result.reason ?? 'unknown', cooldown: false };
}
