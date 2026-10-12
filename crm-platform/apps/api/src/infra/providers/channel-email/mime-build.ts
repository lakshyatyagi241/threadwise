import MailComposer from 'nodemailer/lib/mail-composer';

export interface OutboundMime {
  from: { name: string | null; address: string };
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  /** The plain text body, as the agent wrote it. */
  text: string;
  /** RFC 5322 Message-ID of the new message, without brackets. */
  messageId: string;
  /** The Message-ID of the mail this answers, without brackets. */
  inReplyTo: string | null;
  /** The thread's Message-IDs oldest first, without brackets. */
  references: string[];
  /** The HTML body (signature already merged). Absent = the escaped text with `<br>`. */
  html?: string | null;
  /** Files that go out with the mail. */
  attachments?: Array<{ name: string; mime: string; bytes: Buffer }>;
  /** Headers that mark the mail as ours, for a retried send to find it again. */
  headers?: Record<string, string>;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The HTML twin of a plain text reply: the text escaped, line breaks as `<br>` (no formatting is invented). */
export function textToHtml(text: string): string {
  return `<div dir="auto">${escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>\n')}</div>`;
}

/** Header values may not carry line breaks: a subject or a name with one would let a sender inject a header. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
const bracket = (id: string) => `<${id.replace(/^<|>$/g, '')}>`;

/**
 * The RFC 5322 message of a reply: threading headers (`In-Reply-To`, `References`), the subject, cc and bcc, a plain text part and its HTML
 * twin (multipart/alternative), built by nodemailer's MailComposer. Bcc is kept in the bytes on purpose: Gmail's send call reads the Bcc
 * header to address those recipients and removes it from what is delivered. Resolves to the message bytes.
 */
export function buildMime(input: OutboundMime): Promise<Buffer> {
  const references = [...input.references];
  if (input.inReplyTo && !references.includes(input.inReplyTo)) references.push(input.inReplyTo);
  const composer = new MailComposer({
    from: { name: input.from.name ? oneLine(input.from.name) : '', address: input.from.address },
    to: input.to.map(oneLine),
    cc: input.cc.map(oneLine),
    bcc: input.bcc.map(oneLine),
    subject: oneLine(input.subject),
    text: input.text,
    html: input.html ?? textToHtml(input.text),
    messageId: bracket(input.messageId),
    ...(input.inReplyTo ? { inReplyTo: bracket(input.inReplyTo) } : {}),
    ...(references.length ? { references: references.map(bracket) } : {}),
    headers: input.headers ?? {},
    ...(input.attachments?.length
      ? {
          attachments: input.attachments.map((a) => ({
            filename: oneLine(a.name),
            content: a.bytes,
            contentType: a.mime,
          })),
        }
      : {}),
    textEncoding: 'quoted-printable',
  });
  const mail = composer.compile();
  mail.keepBcc = true;
  return new Promise<Buffer>((resolve, reject) => {
    mail.build((err: Error | null, message: Buffer) => (err ? reject(err) : resolve(message)));
  });
}
