import {
  parseOtpSenderRef,
  type OtpActivationReason,
  type OtpStatus,
  type OtpTemplateState,
} from '@crm/contracts';
import type { OtpSenderState } from './otp-sender-registry.service';

export interface OtpActivationInput {
  enabled: boolean;
  /** `<kind>:<id>` as saved in the registration settings. */
  sender: string | null;
  template: Pick<OtpTemplateState, 'sender' | 'status'> | null;
  /** What the registry says about `sender` (ignored while there is no sender). */
  senderState: OtpSenderState;
}

/**
 * Is the sign-up code step on? (WD-AUTH-006 rule 1.)
 *
 * Active only when the switch is on AND the chosen sender can deliver AND, for a
 * WhatsApp Business (waba) sender, the OTP template for that sender exists and
 * Meta has approved it. Otherwise sign-up silently skips the code. Twilio and
 * bridge senders need no template: their message text is local.
 *
 * Pure, so the rule is one place and unit-tested without a database.
 */
export function evaluateOtpActivation(input: OtpActivationInput): OtpStatus {
  const no = (reason: OtpActivationReason): OtpStatus => ({ active: false, reason });
  if (!input.enabled) return no('disabled');
  const ref = parseOtpSenderRef(input.sender);
  if (!input.sender) return no('no_sender');
  if (!ref) return no('sender_missing');
  if (input.senderState === 'missing') return no('sender_missing');
  if (input.senderState === 'incomplete') return no('sender_incomplete');
  if (input.senderState === 'dev_in_production') return no('dev_in_production');

  if (ref.kind === 'waba') {
    const t = input.template;
    if (!t || t.sender !== input.sender) return no('template_missing');
    if (t.status === 'pending') return no('template_pending');
    if (t.status !== 'approved') return no('template_rejected');
  }
  return { active: true, reason: 'active' };
}
