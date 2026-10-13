import type { OutboundEmail } from '../../infra/providers/chat-conversations';

/** Pure rules of an outbound reply (TW-MAIL-022). */

/** The Message-ID of a reply: derived from the send's idempotency key, so a retry builds the SAME id and finds what an earlier try sent. */
export function replyMessageId(clientReference: string, mailboxAddress: string): string {
  const local = clientReference.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 100) || 'reply';
  const domain = mailboxAddress.split('@')[1]?.replace(/[^A-Za-z0-9.-]/g, '') || 'mail.invalid';
  return `tw.${local}@${domain}`;
}

/** Every address the reply goes to once, lower-cased, the mailbox's own address left out of cc and bcc (Gmail keeps its own copy). */
export function recipientsOf(
  email: OutboundEmail,
  mailboxAddress: string,
): { to: string[]; cc: string[]; bcc: string[] } {
  const own = mailboxAddress.toLowerCase();
  const seen = new Set<string>();
  const take = (list: string[], dropOwn: boolean) =>
    list
      .map((a) => a.trim().toLowerCase())
      .filter((a) => {
        if (!a || seen.has(a) || (dropOwn && a === own)) return false;
        seen.add(a);
        return true;
      });
  const to = take(email.to, false);
  return { to, cc: take(email.cc, true), bcc: take(email.bcc, true) };
}
