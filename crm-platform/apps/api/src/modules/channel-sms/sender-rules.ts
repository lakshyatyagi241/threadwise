import { createHash, randomBytes } from 'node:crypto';
import { SMS_PROVIDER_LABEL, type ConnectSmsSenderInput, type SmsProvider } from '@crm/contracts';
import { isAlphanumericFrom } from '../../infra/providers/channel-sms/sms-rules';

/** Pure rules of the SMS senders (TW-SMS-002 to 007, 030). No I/O. */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A URL-safe random string: the MSG91 delivery-report secret. */
export function randomToken(length = 32): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

export const smsLabel = (provider: SmsProvider): string => SMS_PROVIDER_LABEL[provider];

/** The picker key a broadcast or campaign names a sender by. */
export const senderKey = (uuid: string): string => `sms:${uuid}`;

export const isAlphanumeric = isAlphanumericFrom;

/** `meta_json` as stored: what the screens read, none of it secret except `dlr_secret`, which never leaves the API. */
export interface SmsMeta {
  sms_provider?: SmsProvider;
  sender_id?: string;
  dlt_template_id?: string;
  rate_per_segment?: string | null;
  currency?: string;
  dlr_secret?: string;
  /** Why the provider refused the key at send time (the sender is then switched off). */
  last_error?: string | null;
}

/** The keys that end up on the row (TW-SMS-002 rule 5 and 8): the old value merged key by key under the new one. */
export function mergeMeta(
  old: SmsMeta | null | undefined,
  input: ConnectSmsSenderInput,
  newSecret: () => string,
): SmsMeta {
  const prior = old ?? {};
  return {
    ...prior,
    sms_provider: input.provider,
    // A blank sender id or DLT template on a re-submit overwrites the stored one (rule 9): there is no "keep existing".
    sender_id: input.senderId,
    dlt_template_id: input.dltTemplateId,
    rate_per_segment: input.ratePerSegment === undefined ? null : String(input.ratePerSegment),
    currency: (input.currency ?? 'USD').toUpperCase(),
    last_error: null,
    // Only MSG91 reports to an address typed into its panel by hand, so only it gets a secret in that address.
    ...(input.provider === 'msg91'
      ? { dlr_secret: prior.dlr_secret || newSecret() }
      : { dlr_secret: undefined }),
  };
}

/** The keys a sender is verified and stored with. MSG91's key is the token field, or the SID field when the token is blank (never both). */
export function credentialsToStore(
  input: ConnectSmsSenderInput,
  reuse: { accountSid: string; authToken: string } | null,
): { accountSid: string; authToken: string } {
  if (input.provider === 'msg91') {
    return { accountSid: '', authToken: (input.authToken || input.accountSid || '').trim() };
  }
  // Twilio: each blank field is filled from the workspace's existing Twilio keys on its own; a typed field wins.
  return {
    accountSid: (input.accountSid || reuse?.accountSid || '').trim(),
    authToken: (input.authToken || reuse?.authToken || '').trim(),
  };
}

/** The address a provider reports delivery to: https only, as Twilio and the carriers' panels need a public secure address. */
export function deliveryReportUrl(appUrl: string, secret?: string): string {
  const base = appUrl.replace(/\/+$/, '').replace(/^http:\/\//i, 'https://');
  return secret ? `${base}/v2/sms/status/${secret}` : `${base}/v2/sms/status`;
}

/** The monthly cap sentence. Reference built it from the key ("sms monthlies"); it says what it means here. */
export const quotaMessage = (cap: number): string =>
  `You've reached your plan's limit of ${cap} SMS messages a month. Upgrade your plan to send more.`;

/** `bcast-<broadcast>-<contact>` and `camp-<campaign>-<contact>[-rN]`: the contact a send is for, or null for any other reference. */
export function contactOfReference(ref: string): number | null {
  const m = /^(?:bcast|camp)-\d+-(\d+)(?:-r\d+)?$/.exec(ref);
  return m ? Number(m[1]) : null;
}

/** The broadcast or campaign a dispatcher reference (`bcast-<id>-<contact>`, `camp-<id>-<contact>[-rN]`) names, or null for any other. */
export function subjectOfReference(
  ref: string,
): { kind: 'broadcast' | 'campaign'; id: number } | null {
  const m = /^(bcast|camp)-(\d+)-\d+(?:-r\d+)?$/.exec(ref);
  return m ? { kind: m[1] === 'bcast' ? 'broadcast' : 'campaign', id: Number(m[2]) } : null;
}

/**
 * Where an SMS came from, for the customer's expense log: short, lowercase, at most 24 characters. The dispatchers' and the lead
 * pipeline's references say it; a send that names its own screening source keeps that; anything else is an API send.
 */
export function usageSourceOf(ref: string, screenSource?: string | null): string {
  const subject = subjectOfReference(ref);
  if (subject) return subject.kind;
  if (/^lead-first-\d+-\d+$/.test(ref)) return 'lead_first';
  const own = (screenSource ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return own || 'api';
}

/**
 * The outbox aggregate of one SMS's billing events. The charge (sent) and the refund (the carrier's failure report, which arrives from
 * another process some seconds later) of ONE message must be drained in order, or a refund that overtakes its charge is lost; the
 * drain keeps the order of events that share an aggregate. A number made from the provider's message id gives each message its own
 * aggregate, so unrelated messages are still settled in parallel and one stuck event holds up nothing else. 48 bits: always a safe
 * integer; two messages sharing a value only share a queue.
 */
export function usageAggregateOf(messageId: string): number {
  return createHash('sha256').update(messageId).digest().readUIntBE(0, 6);
}

/** The calendar month a message counts in (Reference counted from the first day of the month, server time; here UTC). */
export const usagePeriod = (now: Date): string =>
  `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

export const SMS_USAGE_METRIC = 'sms_sent';
