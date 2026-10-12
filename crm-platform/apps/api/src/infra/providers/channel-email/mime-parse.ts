import { createHash } from 'node:crypto';
import type { GmailHeader, GmailMessage, GmailPart } from './gmail.types';
import { isAutomated } from './automated';
import {
  decodeWords,
  parseAddressList,
  parseFirstAddress,
  parseHeaderParams,
  parseMessageIds,
  type ParsedAddress,
} from './mime-words';

/** One file of a mail as the sync finds it: where its bytes are (inline in the part, or a Gmail attachment id) and what it is. */
export interface InboundAttachment {
  /** Stable within the message: the part id. */
  partId: string;
  name: string;
  mime: string;
  size: number;
  /** The bytes came with the message part (small files); otherwise fetch them with `attachmentId`. */
  data: Buffer | null;
  attachmentId: string | null;
  /** The `Content-ID` without brackets: how the HTML body points at an inline image. */
  contentId: string | null;
  /** Shown inside the HTML body (an image referenced by `cid:`) rather than offered as a file. */
  inline: boolean;
}

export interface ParsedEmail {
  providerMessageId: string;
  threadId: string;
  labelIds: string[];
  subject: string;
  from: ParsedAddress;
  replyTo: ParsedAddress | null;
  to: ParsedAddress[];
  cc: ParsedAddress[];
  bcc: ParsedAddress[];
  /** RFC 5322 Message-ID without brackets; a stable synthetic one when the sender wrote none. */
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  /** When the mail was sent: Gmail's internal date, else the Date header, else now. */
  sentAt: Date;
  /** The plain text part, or the text of the HTML part when there is none. Empty when the mail has no body. */
  text: string;
  /** The raw (unsanitised) HTML part. */
  html: string | null;
  attachments: InboundAttachment[];
  automated: boolean;
  /** Gmail says it is a draft, spam or trash, or our own sent mail: the sync skips it. */
  skip: 'draft' | 'spam' | 'trash' | 'sent' | null;
}

const headerMap = (headers: GmailHeader[] | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const h of headers ?? []) {
    const key = h.name.toLowerCase();
    // The first occurrence wins (a forwarded copy repeats Received and friends; none of the ones read here is meant to repeat).
    if (!(key in out)) out[key] = h.value;
  }
  return out;
};

function decodeCharset(bytes: Buffer, charset: string | undefined): string {
  const cs = (charset ?? 'utf-8').toLowerCase();
  try {
    return new TextDecoder(cs === 'utf8' ? 'utf-8' : cs, { fatal: false }).decode(bytes);
  } catch {
    return bytes.toString('utf8');
  }
}

const bodyBytes = (part: GmailPart): Buffer | null =>
  typeof part.body?.data === 'string' ? Buffer.from(part.body.data, 'base64url') : null;

interface Walk {
  text: string[];
  html: string[];
  files: InboundAttachment[];
}

function walk(part: GmailPart, out: Walk, path: string): void {
  const headers = headerMap(part.headers);
  const type = (
    part.mimeType ??
    parseHeaderParams(headers['content-type']).value ??
    'text/plain'
  ).toLowerCase();
  const disposition = parseHeaderParams(headers['content-disposition']);
  const contentId = headers['content-id']?.trim().replace(/^<|>$/g, '') || null;
  const filename = (part.filename ?? '').trim() || disposition.params.filename || '';

  if (part.parts?.length && type.startsWith('multipart/')) {
    part.parts.forEach((p, i) => walk(p, out, `${path}.${p.partId ?? i}`));
    return;
  }
  // message/rfc822 and friends with children: look inside only when they are not a named attachment.
  if (part.parts?.length && !filename) {
    part.parts.forEach((p, i) => walk(p, out, `${path}.${p.partId ?? i}`));
    return;
  }

  const isAttachmentDisposition = disposition.value === 'attachment';
  const textual = type === 'text/plain' || type === 'text/html';
  if (textual && !filename && !isAttachmentDisposition) {
    const bytes = bodyBytes(part);
    if (bytes === null) return;
    const text = decodeCharset(bytes, parseHeaderParams(headers['content-type']).params.charset);
    (type === 'text/html' ? out.html : out.text).push(text);
    return;
  }

  const hasBytes = part.body?.attachmentId || typeof part.body?.data === 'string';
  if (!hasBytes) return;
  if (!filename && !contentId) return;
  const data = bodyBytes(part);
  const size = Number(part.body?.size) || data?.length || 0;
  const inlineImage =
    type.startsWith('image/') && contentId !== null && disposition.value !== 'attachment';
  out.files.push({
    partId: part.partId ?? path,
    name: decodeWords(filename) || (contentId ? `${contentId}`.slice(0, 80) : 'attachment'),
    mime: type || 'application/octet-stream',
    size,
    data,
    attachmentId: part.body?.attachmentId ?? null,
    contentId,
    inline: inlineImage,
  });
}

/**
 * Turns one Gmail message (`format=full`) into what the inbox stores: the headers that matter, the plain and HTML bodies, the file list and
 * the `automated` flag. Pure and tolerant: a malformed or oddly built mail yields the best reading it has, never an exception. The sender
 * is the `From` address (never `Sender`/`Return-Path`); a mail with no usable `From` is reported with the mailbox's own address only if
 * Gmail marks it as ours, otherwise its From is the empty-safe `unknown@invalid`.
 */
export function parseGmailMessage(msg: GmailMessage, mailboxAddress: string): ParsedEmail {
  const payload = msg.payload ?? {};
  const headers = headerMap(payload.headers);
  const labels = msg.labelIds ?? [];

  const from = parseFirstAddress(headers.from) ?? { name: null, address: 'unknown@invalid' };
  const replyTo = parseFirstAddress(headers['reply-to']);
  const contentType =
    parseHeaderParams(headers['content-type'] ?? undefined).value ||
    (payload.mimeType ?? '').toLowerCase();

  const out: Walk = { text: [], html: [], files: [] };
  walk(payload, out, payload.partId ?? '0');

  const html = out.html.length ? out.html.join('\n') : null;
  const text = out.text.join('\n').replace(/\r\n/g, '\n').trim();

  const sent = Number(msg.internalDate);
  const dated = headers.date ? new Date(headers.date) : null;
  const sentAt =
    Number.isFinite(sent) && sent > 0
      ? new Date(sent)
      : dated && !Number.isNaN(dated.getTime())
        ? dated
        : new Date();

  const rawId = parseMessageIds(headers['message-id'])[0];
  const messageId =
    rawId ??
    `gmail-${createHash('sha1').update(`${msg.id}:${msg.threadId}`).digest('hex').slice(0, 24)}@gmail.invalid`;
  const references = parseMessageIds(headers.references);
  const inReplyTo = parseMessageIds(headers['in-reply-to'])[0] ?? null;

  const mine = from.address === mailboxAddress.toLowerCase();
  let skip: ParsedEmail['skip'] = null;
  if (labels.includes('DRAFT')) skip = 'draft';
  else if (labels.includes('SPAM')) skip = 'spam';
  else if (labels.includes('TRASH')) skip = 'trash';
  // Our own sent mail (a reply typed in Gmail itself, or one this app sent): the thread already shows what we sent. A mail one sends to
  // oneself carries both SENT and INBOX and is a real inbound message.
  else if (labels.includes('SENT') && !labels.includes('INBOX')) skip = 'sent';
  else if (mine && !labels.includes('INBOX') && labels.length > 0) skip = 'sent';

  return {
    providerMessageId: msg.id,
    threadId: msg.threadId,
    labelIds: labels,
    subject: decodeWords(headers.subject ?? '')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 998),
    from,
    replyTo,
    to: parseAddressList(headers.to),
    cc: parseAddressList(headers.cc),
    bcc: parseAddressList(headers.bcc),
    messageId: messageId.slice(0, 998),
    inReplyTo,
    references,
    sentAt,
    text,
    html,
    attachments: out.files,
    automated: isAutomated({ headers, from: from.address, contentType }),
    skip,
  };
}
