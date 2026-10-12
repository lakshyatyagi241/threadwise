import { createHash } from 'node:crypto';
import { isAutomated } from './automated';
import type { GraphAttachment, GraphEmailAddress, GraphMessage } from './graph.types';
import {
  RAW_HEADER_KEYS,
  type MailAddress,
  type MailSkipReason,
  type NormalisedAttachment,
  type NormalisedMail,
} from './mail-types';
import { parseFirstAddress, parseMessageIds } from './mime-words';
import { resolveThreadKey } from './thread-key';

const bare = (id: string) => id.trim().replace(/^<|>$/g, '').trim();
const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

function address(a: GraphEmailAddress | null | undefined): MailAddress | null {
  const raw = a?.emailAddress?.address?.trim();
  if (!raw || !raw.includes('@')) return null;
  const name = a?.emailAddress?.name?.trim();
  return {
    name: name && name.toLowerCase() !== raw.toLowerCase() ? name : null,
    address: raw.toLowerCase(),
  };
}

function list(items: GraphEmailAddress[] | null | undefined): MailAddress[] {
  const seen = new Set<string>();
  const out: MailAddress[] = [];
  for (const i of items ?? []) {
    const a = address(i);
    if (a && !seen.has(a.address)) {
      seen.add(a.address);
      out.push(a);
    }
  }
  return out;
}

/** Header name (lower-cased) to the first value. */
export function graphHeaders(msg: GraphMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of msg.internetMessageHeaders ?? []) {
    const key = h.name.toLowerCase();
    if (!(key in out)) out[key] = h.value;
  }
  return out;
}

/** Why a Graph message is not stored, from what the delta page already told us (the Inbox holds neither junk nor deleted items). */
export function graphSkip(msg: GraphMessage, mailboxAddress: string): MailSkipReason | null {
  if (msg.isDraft) return 'draft';
  const from = lower(msg.from?.emailAddress?.address);
  // Mail the mailbox sent to itself is our own sent mail, not a customer's.
  if (from && from === lower(mailboxAddress)) return 'sent';
  return null;
}

/**
 * A Graph message as the provider-neutral {@link NormalisedMail}. Graph returns ONE body (html unless asked otherwise): the text part is left
 * empty and the ingest derives it. Thread key = `resolveThreadKey` with Graph's `conversationId`. `attachments` come from a separate
 * metadata call (`listAttachments`); a file is downloaded lazily through `fetchAttachment`.
 */
export function normaliseGraphMessage(
  msg: GraphMessage,
  attachments: GraphAttachment[],
  fetchAttachment: (messageId: string, attachmentId: string) => Promise<Buffer>,
): NormalisedMail {
  const headers = graphHeaders(msg);
  const wanted = new Set<string>(RAW_HEADER_KEYS);
  const rawHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) if (wanted.has(k)) rawHeaders[k] = v.slice(0, 2000);

  const messageId =
    bare(msg.internetMessageId ?? parseMessageIds(headers['message-id'])[0] ?? '') ||
    `graph-${createHash('sha1')
      .update(`${msg.id}:${msg.conversationId ?? ''}`)
      .digest('hex')
      .slice(0, 24)}@graph.invalid`;
  const references = parseMessageIds(headers['references']);
  const inReplyTo = parseMessageIds(headers['in-reply-to'])[0] ?? null;

  // `from` is empty on some system mail; `sender`, then the From header, are the fallbacks. An Exchange-internal address that is not an
  // SMTP address is dropped by `address()`, and the header (always SMTP) takes over.
  const from: MailAddress = address(msg.from) ??
    address(msg.sender) ??
    parseFirstAddress(headers['from']) ?? { name: null, address: 'unknown@graph.invalid' };
  const replyTo = list(msg.replyTo)[0] ?? null;
  const html = msg.body?.contentType?.toLowerCase() === 'html' ? (msg.body.content ?? '') : null;
  const text = msg.body?.contentType?.toLowerCase() === 'text' ? (msg.body.content ?? '') : '';
  const sentAt = new Date(msg.receivedDateTime ?? msg.sentDateTime ?? Date.now());

  return {
    providerMessageId: msg.id,
    threadKey: resolveThreadKey({
      conversationId: msg.conversationId,
      messageId,
      inReplyTo,
      references,
    }),
    messageId,
    inReplyTo,
    references,
    from,
    replyTo,
    to: list(msg.toRecipients),
    cc: list(msg.ccRecipients),
    bcc: list(msg.bccRecipients),
    subject: msg.subject ?? '',
    text,
    html: html || null,
    attachments: attachments.map((a): NormalisedAttachment => {
      const isItem = (a['@odata.type'] ?? '').toLowerCase().endsWith('itemattachment');
      const isFile = (a['@odata.type'] ?? '').toLowerCase().endsWith('fileattachment');
      const name = a.name?.trim() || (isItem ? 'attached message' : 'attachment');
      return {
        partId: a.id,
        // An attached message downloads as raw MIME: it is offered as an .eml file (a bounce carries the original this way).
        name: isItem && !/\.eml$/i.test(name) ? `${name}.eml` : name,
        mime: isItem ? 'message/rfc822' : a.contentType || 'application/octet-stream',
        size: Number(a.size) || 0,
        contentId: a.contentId ? bare(a.contentId) : null,
        inline: Boolean(a.isInline),
        data: null,
        // A reference attachment (a link to a cloud file) has no bytes.
        fetch: isFile || isItem ? () => fetchAttachment(msg.id, a.id) : null,
      };
    }),
    sentAt: Number.isNaN(sentAt.getTime()) ? new Date() : sentAt,
    labels: msg.categories ?? [],
    flags: msg.isRead ? ['seen'] : [],
    automated: isAutomated({
      headers,
      from: from.address,
      contentType: lower(headers['content-type']).split(';')[0] ?? '',
    }),
    rawHeaders,
    skip: null,
  };
}
