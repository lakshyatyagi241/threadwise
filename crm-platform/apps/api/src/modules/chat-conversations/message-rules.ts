import {
  canAdvanceMessageStatus,
  emailMetaSchema,
  type EmailMeta,
  type MessageKind,
  type MessageStatus,
} from '@crm/contracts';
import type { NormalisedInbound } from '../../infra/providers/chat-conversations';

/** Length of the plain-text preview a thread keeps for the list. */
export const PREVIEW_MAX = 200;

/**
 * SQL for the rank of `messages.status` (queued 0 < sent 1 < delivered 2 < read 3; `failed` and `received` have none). The receipt
 * UPDATE compares it in the WHERE clause, so the rule is applied by the database in one statement and two receipts racing cannot
 * step a status backwards. `canAdvanceMessageStatus` in `@crm/contracts` is the same rule as a function.
 */
export const STATUS_RANK_SQL = `(CASE status WHEN 'queued' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 END)`;

export type ReceiptStatusStep = 'sent' | 'delivered' | 'read' | 'failed';

export interface ReceiptDecision {
  /** The summary column moves to the reported status. */
  advance: boolean;
  /** The timestamp column that is filled even though the status does not move (a `delivered` that arrives after `read`). */
  backfill: 'sent_at' | 'delivered_at' | 'read_at' | null;
}

/**
 * What a receipt does to a message currently in `from`. The SQL in `MessagesRepository.applyReceipt` is the same rule; this is the
 * form the unit tests and any reader of the rule can check. A receipt that does not advance still leaves its time behind.
 */
export function decideReceipt(from: MessageStatus, to: ReceiptStatusStep): ReceiptDecision {
  const advance = canAdvanceMessageStatus(from, to);
  if (advance) return { advance, backfill: null };
  const backfill =
    to === 'sent'
      ? 'sent_at'
      : to === 'delivered'
        ? 'delivered_at'
        : to === 'read'
          ? 'read_at'
          : null;
  return { advance, backfill };
}

/**
 * Free-form replies are allowed `windowHours` after the customer's last message. Null `windowHours` = the channel has no window
 * rule, so the thread never closes. The expiry is derived from the newest inbound time.
 */
export function windowExpiry(windowHours: number | null, lastInboundAt: Date | null): Date | null {
  if (windowHours === null || lastInboundAt === null) return null;
  return new Date(lastInboundAt.getTime() + windowHours * 3_600_000);
}

/** The customer's message time, clamped so a provider clock in the future cannot stretch the window past what the arrival allows. */
export function clampProviderTime(providerTs: Date, arrivedAt: Date): Date {
  return providerTs.getTime() > arrivedAt.getTime() ? arrivedAt : providerTs;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The one line the thread list shows for a message (Reference: the text, else a place, else a paperclip and the kind). */
export function previewOf(m: {
  kind: MessageKind | string;
  body?: string | null;
  locationName?: string | null;
}): string {
  const body = (m.body ?? '').replace(/\s+/g, ' ').trim();
  if (body !== '') return body.slice(0, PREVIEW_MAX);
  if (m.kind === 'location')
    return `📍 ${m.locationName?.trim() || 'Location'}`.slice(0, PREVIEW_MAX);
  if (m.kind === 'text' || m.kind === 'system') return '';
  return `📎 ${capitalise(String(m.kind))}`;
}

/** What a stored message of an inbound delivery is called (`messages.kind`). */
export function inboundMessageKind(m: Pick<NormalisedInbound, 'kind' | 'media'>): MessageKind {
  switch (m.kind) {
    case 'media':
      // A voice note is its own kind: the bubble plays it, and a recorded message reads differently from a sent audio file.
      return m.media?.voice ? 'voice' : (m.media?.mediaKind ?? 'document');
    case 'location':
      return 'location';
    case 'contact':
      return 'contact';
    case 'reaction':
      return 'reaction';
    case 'interactive':
      return 'interactive';
    case 'text':
    case 'unsupported':
      return 'text';
  }
}

/** The message kind of an uploaded file, from its mime type. */
export function kindOfFileMime(mime: string): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

/** Text shown for a delivery the adapter could not turn into anything we render. */
export const UNSUPPORTED_BODY = 'This message type is not supported yet';

/** The keys of an adapter's `meta` that are stored on the message (screens read them), and nothing else. */
const CHANNEL_META_KEYS = [
  'contacts',
  'interactive',
  'buttons',
  'telegram',
  'line',
  'viber',
  'wechat',
  'payment',
  'referral',
  'rawType',
  /** The import of a personal number's history left the file out (the value is its kind): the message keeps a placeholder. */
  'mediaOmitted',
  'forwarded',
  'mentions',
  'referredProduct',
  'buttonPayload',
  'flowName',
  'flowResponse',
  'providerErrors',
  'order',
  'animated',
  'interactiveType',
  'callPermission',
  'reason',
] as const;
const CHANNEL_META_MAX_BYTES = 16_384;
/**
 * An email message's `meta.email` carries the sanitised HTML (up to 64K characters, which JSON escaping can roughly double) beside its
 * header fields, so a message of kind `email` gets this larger budget for its `email` block only. Every other key, and every other
 * kind, keeps the 16K cap.
 */
export const EMAIL_META_MAX_BYTES = 131_072;
const EMAIL_FALLBACK_LIST_MAX = 20;

const jsonSize = (v: unknown): number => JSON.stringify(v).length;

/**
 * The email block as it is stored: validated against `emailMetaSchema` (unknown keys and bad shapes do not pass), and when still over
 * {@link EMAIL_META_MAX_BYTES} trimmed in steps, from the least to the most important part: the HTML first (kept flagged
 * `htmlTruncated`, the plain-text body is the message body and stays), then the address and reference lists, then the attachment list.
 * Null when it cannot be made to fit or is not an email block at all (the message is then stored without it, never rejected).
 */
export function emailMetaOf(raw: unknown): EmailMeta | null {
  const parsed = emailMetaSchema.safeParse(raw);
  if (!parsed.success) return null;
  let email = parsed.data;
  if (jsonSize(email) <= EMAIL_META_MAX_BYTES) return email;
  email = { ...email, html: null, htmlTruncated: email.htmlTruncated || email.html !== null };
  if (jsonSize(email) <= EMAIL_META_MAX_BYTES) return email;
  email = {
    ...email,
    to: email.to.slice(0, EMAIL_FALLBACK_LIST_MAX),
    cc: email.cc.slice(0, EMAIL_FALLBACK_LIST_MAX),
    bcc: email.bcc.slice(0, EMAIL_FALLBACK_LIST_MAX),
    references: email.references.slice(-EMAIL_FALLBACK_LIST_MAX),
  };
  if (jsonSize(email) <= EMAIL_META_MAX_BYTES) return email;
  email = { ...email, attachments: email.attachments.slice(0, EMAIL_FALLBACK_LIST_MAX) };
  return jsonSize(email) <= EMAIL_META_MAX_BYTES ? email : null;
}

/**
 * What of an adapter's `meta` goes on the message row: only the known keys, and nothing at all when it is oversized. The adapter is
 * trusted to be ours, but its input is a customer's, and a row is not a place to keep whatever a webhook happened to carry.
 *
 * `email` is accepted only for a channel of kind `email`, and is budgeted on its own (see {@link emailMetaOf}); the other keys stay under
 * the 16K cap whatever the kind.
 */
export function channelMetaOf(
  meta: Record<string, unknown> | undefined,
  kind?: string,
): Record<string, unknown> {
  if (!meta) return {};
  const picked: Record<string, unknown> = {};
  for (const k of CHANNEL_META_KEYS) if (meta[k] !== undefined) picked[k] = meta[k];
  if (jsonSize(picked) > CHANNEL_META_MAX_BYTES) return {};
  if (kind === 'email' && meta.email !== undefined) {
    const email = emailMetaOf(meta.email);
    if (email) picked.email = email;
  }
  return picked;
}

/** A failure reason is one short line. */
export function failureReason(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, 500);
}
