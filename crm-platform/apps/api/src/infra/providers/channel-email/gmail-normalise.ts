import type { GmailMessage } from './gmail.types';
import type { ParsedEmail } from './mime-parse';
import { RAW_HEADER_KEYS, type NormalisedMail } from './mail-types';
import { resolveThreadKey } from './thread-key';

/**
 * A parsed Gmail message as the provider-neutral {@link NormalisedMail}. The thread key is Gmail's own `threadId`, verbatim (so the
 * conversations that exist keep their key). An attachment Gmail did not inline is downloaded lazily through `fetchAttachment`.
 */
export function normaliseGmailMessage(
  msg: GmailMessage,
  parsed: ParsedEmail,
  fetchAttachment: (messageId: string, attachmentId: string) => Promise<Buffer>,
): NormalisedMail {
  const wanted = new Set<string>(RAW_HEADER_KEYS);
  const rawHeaders: Record<string, string> = {};
  for (const h of msg.payload?.headers ?? []) {
    const key = h.name.toLowerCase();
    if (wanted.has(key) && !(key in rawHeaders)) rawHeaders[key] = h.value.slice(0, 2000);
  }
  return {
    providerMessageId: parsed.providerMessageId,
    threadKey: resolveThreadKey({
      providerThreadId: parsed.threadId,
      messageId: parsed.messageId,
      inReplyTo: parsed.inReplyTo,
      references: parsed.references,
    }),
    messageId: parsed.messageId,
    inReplyTo: parsed.inReplyTo,
    references: parsed.references,
    from: parsed.from,
    replyTo: parsed.replyTo,
    to: parsed.to,
    cc: parsed.cc,
    bcc: parsed.bcc,
    subject: parsed.subject,
    text: parsed.text,
    html: parsed.html,
    attachments: parsed.attachments.map((a) => ({
      partId: a.partId,
      name: a.name,
      mime: a.mime,
      size: a.size,
      contentId: a.contentId,
      inline: a.inline,
      data: a.data,
      fetch: a.attachmentId
        ? () => fetchAttachment(parsed.providerMessageId, a.attachmentId!)
        : null,
    })),
    sentAt: parsed.sentAt,
    labels: parsed.labelIds,
    flags: [],
    automated: parsed.automated,
    rawHeaders,
    skip: parsed.skip,
    report: parsed.report,
  };
}
