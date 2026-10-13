import { createHash } from 'node:crypto';
import { simpleParser, type ParsedMail } from 'mailparser';
import { isAutomated } from '../automated';
import {
  RAW_HEADER_KEYS,
  type MailAddress,
  type NormalisedAttachment,
  type NormalisedMail,
} from '../mail-types';
import { parseMessageIds } from '../mime-words';
import { resolveThreadKey, type KnownThreadKeys } from '../thread-key';

/** Attachments up to this size travel inside the batch; larger ones are downloaded again only when the ingest asks. */
export const INLINE_ATTACHMENT_BYTES = 256 * 1024;

const sha = (s: string, n = 40) => createHash('sha256').update(s).digest('hex').slice(0, n);

/**
 * The ledger key of an IMAP message. It is derived from the Message-ID, not from `<uidvalidity>:<uid>`, so a UIDVALIDITY change (the
 * server renumbered the folder) that makes the repair resync read the same mail again finds it stored. A mail without a Message-ID
 * gets a synthetic one from its stable fields.
 */
export const imapProviderMessageId = (messageId: string): string =>
  `i:${sha(messageId.toLowerCase())}`;

export const syntheticMessageId = (parts: {
  from: string;
  date: string;
  subject: string;
  size: number;
}): string =>
  `imap-${sha(`${parts.from}|${parts.date}|${parts.subject}|${parts.size}`, 24)}@imap.invalid`;

const addresses = (v: ParsedMail['to']): MailAddress[] => {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  const out: MailAddress[] = [];
  for (const group of list) {
    for (const a of group.value) {
      if (a.address)
        out.push({ name: a.name ? a.name : null, address: a.address.trim().toLowerCase() });
    }
  }
  return out;
};

/** Which attachment of a re-parsed source: the index in mailparser's order (stable for the same bytes). */
export const partIdOf = (index: number): string => `a${index}`;

export interface NormaliseInput {
  source: Buffer;
  /** The server's flags, lower-cased without the backslash. */
  flags: string[];
  folder: string;
  internalDate: Date | null;
  size: number;
  /** The Message-ID to use when the mail carries none (computed from the envelope, so the ledger key is the same before and after the download). */
  fallbackMessageId: string;
  known: KnownThreadKeys | undefined;
  /** Re-reads one attachment of this message (a new connection); used for attachments too big to carry. */
  refetch: (partId: string) => Promise<Buffer>;
}

/** One RFC 5322 message as the provider-neutral shape. Throws only for bytes that cannot be parsed at all. */
export async function normaliseImapMessage(input: NormaliseInput): Promise<NormalisedMail> {
  const mail = await simpleParser(input.source, {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true,
    skipTextLinks: true,
  });
  const wanted = new Set<string>(RAW_HEADER_KEYS);
  const rawHeaders: Record<string, string> = {};
  const headers: Record<string, string> = {};
  for (const line of mail.headerLines) {
    const key = line.key.toLowerCase();
    const value = line.line
      .slice(line.line.indexOf(':') + 1)
      .replace(/\r?\n[ \t]+/g, ' ')
      .trim();
    if (!(key in headers)) headers[key] = value;
    if (wanted.has(key) && !(key in rawHeaders)) rawHeaders[key] = value.slice(0, 2000);
  }
  const from = addresses(mail.from)[0] ?? { name: null, address: 'unknown@invalid' };
  const subject = (mail.subject ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 998);
  const sentAt =
    mail.date && !Number.isNaN(mail.date.getTime())
      ? mail.date
      : (input.internalDate ?? new Date());
  const messageId = parseMessageIds(mail.messageId)[0] ?? input.fallbackMessageId;
  const references = parseMessageIds(
    Array.isArray(mail.references) ? mail.references.join(' ') : (mail.references ?? ''),
  );
  const inReplyTo = parseMessageIds(mail.inReplyTo ?? '')[0] ?? null;

  const ancestors = inReplyTo || references.length > 0;
  const threadKey = resolveThreadKey(
    { messageId, inReplyTo, references },
    ancestors ? input.known : undefined,
  );

  const attachments: NormalisedAttachment[] = mail.attachments.map((a, i) => {
    const partId = partIdOf(i);
    const contentId = a.contentId ? a.contentId.replace(/^<|>$/g, '') : null;
    const mime = (a.contentType || 'application/octet-stream').toLowerCase();
    const inline =
      Boolean(contentId) &&
      mime.startsWith('image/') &&
      (a.related || a.contentDisposition === 'inline');
    const carried = a.size <= INLINE_ATTACHMENT_BYTES ? a.content : null;
    return {
      partId,
      name: (a.filename || contentId || 'attachment').slice(0, 255),
      mime,
      size: a.size,
      contentId,
      inline,
      data: carried,
      fetch: carried ? null : () => input.refetch(partId),
    };
  });

  const contentType =
    (mail.headers.get('content-type') as { value?: string } | undefined)?.value ?? '';
  return {
    providerMessageId: imapProviderMessageId(messageId),
    threadKey,
    messageId: messageId.slice(0, 998),
    inReplyTo,
    references,
    from,
    replyTo: addresses(mail.replyTo)[0] ?? null,
    to: addresses(mail.to),
    cc: addresses(mail.cc),
    bcc: addresses(mail.bcc),
    subject,
    text: (mail.text ?? '').replace(/\r\n/g, '\n').trim(),
    html: typeof mail.html === 'string' ? mail.html : null,
    attachments,
    sentAt,
    labels: [input.folder],
    flags: input.flags,
    automated: isAutomated({ headers, from: from.address, contentType: contentType.toLowerCase() }),
    rawHeaders,
    skip: null,
  };
}

/** The bytes of one attachment of a source, for the lazy download. Throws when the part is not there any more. */
export async function attachmentBytes(source: Buffer, partId: string): Promise<Buffer> {
  const mail = await simpleParser(source, {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true,
    skipTextLinks: true,
  });
  const found = mail.attachments[Number(partId.slice(1))];
  if (!found) throw new Error('attachment not found');
  return found.content;
}
