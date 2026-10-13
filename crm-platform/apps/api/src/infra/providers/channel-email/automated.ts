/**
 * Is this mail a machine's (TW-MAIL-032 first slice): an auto-reply, a bounce, a newsletter, a no-reply notice. Such mail is stored but marked
 * `automated`, so a later loop guard can leave it out of auto-replies. Header names are matched case-insensitively by the caller, which
 * passes them lower-cased.
 */
const NOREPLY_LOCAL =
  /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer-daemon|postmaster|bounce[s]?|notifications?|auto[-_.]?reply)([+._-].*)?$/i;

export function isAutomated(input: {
  /** Lower-cased header name -> value. */
  headers: Readonly<Record<string, string>>;
  /** The sender's address. */
  from: string | null;
  /** The top-level content type, lower-cased. */
  contentType: string;
}): boolean {
  const h = input.headers;
  const autoSubmitted = h['auto-submitted']?.trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return true;
  const precedence = h['precedence']?.trim().toLowerCase();
  if (precedence && ['bulk', 'list', 'junk', 'auto_reply'].includes(precedence)) return true;
  if (h['list-id'] || h['list-unsubscribe'] || h['list-post']) return true;
  if (h['x-auto-response-suppress'] || h['x-autoreply'] || h['x-autorespond']) return true;
  // A bounce has an empty envelope sender.
  if (h['return-path']?.trim() === '<>') return true;
  // A delivery status notification.
  if (input.contentType === 'multipart/report') return true;
  if (input.from) {
    const local = input.from.split('@')[0] ?? '';
    if (NOREPLY_LOCAL.test(local)) return true;
  }
  return false;
}
