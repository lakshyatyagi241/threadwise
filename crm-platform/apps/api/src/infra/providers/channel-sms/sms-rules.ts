import type { SmsCredentials, SmsLineKind } from './sms.port';

/** Pure rules shared by both adapters (TW-SMS-010, 013, 008). No I/O. */

export const NO_CREDENTIALS = 'This SMS number has no credentials — reconnect it on the SMS page.';
export const EMPTY_BODY = 'Nothing to send — the message is empty.';
export const BAD_RECIPIENT = 'That recipient number could not be read as a phone number.';

export const digitsOf = (s: string): string => s.replace(/\D+/g, '');

/** A From value with any letter in it is an alphanumeric sender id: passed through verbatim, one-way. */
export const isAlphanumericFrom = (from: string): boolean => /\p{L}/u.test(from);

/** Twilio's To: digits with a leading plus. Null when there are no digits. */
export function twilioRecipient(to: string): string | null {
  const d = digitsOf(to);
  return d ? `+${d}` : null;
}

/** Twilio's From: an alphanumeric id verbatim, a number as `+digits`. */
export function twilioFrom(from: string): string {
  const f = from.trim();
  return isAlphanumericFrom(f) ? f : `+${digitsOf(f)}`;
}

/** MSG91's mobile: digits with the country code and no plus. Null when there are no digits. */
export function msg91Recipient(to: string): string | null {
  const d = digitsOf(to);
  return d || null;
}

/** Why this sender cannot send, or null when it can. Twilio needs the SID and token; MSG91 only the key. Both need a From. */
export function credentialsProblem(c: SmsCredentials): string | null {
  if (c.from.trim() === '') return NO_CREDENTIALS;
  if (c.provider === 'msg91') return c.authToken.trim() ? null : NO_CREDENTIALS;
  return c.accountSid.trim() && c.authToken.trim() ? null : NO_CREDENTIALS;
}

/** Twilio's codes turned into something an operator can act on; any other code keeps Twilio's own words (TW-SMS-013 rule 1). */
export function explainTwilio(code: number, message: string | undefined, status: number): string {
  switch (code) {
    case 572006:
      return 'Trial accounts can only send their own preset templates, so this message was refused; add billing to the Twilio account to send your own text.';
    case 21608:
      return 'Trial accounts can only send to verified numbers; verify the recipient in the Twilio console or add billing.';
    case 21211:
      return 'Twilio could not read the recipient number; it must be full international format, e.g. +919876543210.';
    case 21606:
    case 21212:
      return 'The sending number is not valid for SMS on this Twilio account; check it is SMS-capable in the console.';
    case 21610:
      return 'This recipient has replied STOP and is unsubscribed; carriers require they text START before you can message them again.';
    case 21614:
      return 'That recipient number cannot receive SMS.';
    default:
      return (message ?? '').trim() || `HTTP ${status}`;
  }
}

/** MSG91's wording by the first rule that matches the lower-cased message (TW-SMS-013 rule 2). */
export function explainMsg91(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('authkey') || m.includes('authentication'))
    return 'MSG91 rejected the auth key — check it on the SMS page.';
  if (m.includes('dlt') || m.includes('template'))
    return `MSG91 rejected the DLT template id. The template must be approved on the DLT portal and linked to this sender id. (${message})`;
  if (m.includes('sender'))
    return `MSG91 rejected the sender id. It must be exactly 6 letters and DLT-registered. (${message})`;
  if (m.includes('balance') || m.includes('credit')) return 'The MSG91 account is out of credit.';
  return message;
}

/** Twilio error codes that mean the recipient asked not to be texted (TW-SMS-024). */
export const TWILIO_STOP_CODE = '21610';

/**
 * The sentence for a lookup (TW-SMS-008 rule 10). A carrier name is appended when there is one.
 */
export function describeLine(
  kind: SmsLineKind,
  rawType: string | null,
  carrier: string | null,
): string {
  const tail = carrier ? ` Carrier: ${carrier}.` : '';
  switch (kind) {
    case 'invalid':
      return 'Not a valid number — texting it would be charged and never arrive.';
    case 'mobile':
      return `Mobile — can receive SMS.${tail}`;
    case 'landline':
      return `Landline — cannot receive SMS. Texting it is charged and lost.${tail}`;
    case 'voip':
      return `VoIP — may not receive SMS reliably.${tail}`;
    default:
      return rawType
        ? `Valid ${rawType} number.${tail}`
        : `Valid number. Twilio did not report a line type.${tail}`;
  }
}

/** Replaces every secret in a text with asterisks, so an error never carries a key out of the adapter. */
export function scrub(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) if (s.length >= 4) out = out.split(s).join('***');
  return out;
}

/** `text` as an error sentence for a thrown fetch error. */
export const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
