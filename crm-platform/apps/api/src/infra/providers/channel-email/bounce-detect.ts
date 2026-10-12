import type { MailReport, NormalisedMail } from './mail-types';

/**
 * Delivery-status notifications (TW-MAIL-032), recognised from a normalised mail of ANY provider. Pure: no I/O.
 *
 * A bounce is recognised when the mail is a machine report from a mail system (multipart/report with a delivery-status part, or a
 * mail from MAILER-DAEMON / postmaster / a mail-delivery address, or one with X-Failed-Recipients) AND a failed recipient can be read
 * from it. An out-of-office from a person, a newsletter or a no-reply notice is NOT a bounce: it stays an ordinary automated mail.
 *
 * Formats handled: RFC 3464 (Postfix, Exim, Gmail, Exchange all send one), the Gmail "Delivery Status Notification" text, the Microsoft
 * "Undeliverable" NDR text, and `X-Failed-Recipients`. The status code decides the kind: 5.x.x (or SMTP 5xx) is hard, 4.x.x (or 4xx,
 * or Action: delayed) is soft.
 */

export interface ParsedBounce {
  kind: 'hard' | 'soft';
  /** Short, plain reason (<= 300 chars). */
  reason: string;
  failedRecipient: string;
  /** `5.1.1` style, when the report carries one. */
  status: string | null;
  /** Message-IDs (no brackets) that may name the sent message: the original's own id first, then the bounce's In-Reply-To / References. */
  originalMessageIds: string[];
}

const REASON_MAX = 300;
const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const DAEMON_LOCAL = /^(mailer-daemon|postmaster|mail[-_.]?delivery(-subsystem)?|mailerdaemon)$/i;
const SUBJECT =
  /(delivery status notification|undeliverable|undelivered mail|mail delivery (failed|failure|system)|returned mail|failure notice|delivery has failed|delivery failure|could not be delivered|message not delivered|non[- ]delivery)/i;

/** The value of one field of a delivery-status / header block (unfolded). */
export function fieldOf(block: string, name: string): string | null {
  const text = block.replace(/\r?\n[ \t]+/g, ' ');
  const m = new RegExp(`^${name}:[ \\t]*(.*)$`, 'im').exec(text);
  return m ? m[1]!.trim() : null;
}

const cleanAddress = (raw: string | null): string | null => {
  if (!raw) return null;
  const m = EMAIL.exec(raw.replace(/^rfc822;\s*/i, ''));
  return m ? m[0].toLowerCase() : null;
};

const oneLine = (s: string): string =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const messageIdsIn = (text: string | null | undefined): string[] => {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(/<([^<>\s@]+@[^<>\s]+)>/g)) out.push(m[1]!);
  return out;
};

function originalIds(mail: NormalisedMail, report: MailReport | null | undefined): string[] {
  const ids: string[] = [];
  const fromOriginal = report?.original ? fieldOf(report.original, 'message-id') : null;
  ids.push(...messageIdsIn(fromOriginal));
  // Exchange and some others quote the original's headers in the readable part instead.
  const quoted = /^message-id:\s*(<[^>\s]+>)/im.exec(mail.text)?.[1];
  ids.push(...messageIdsIn(quoted));
  if (mail.inReplyTo) ids.push(mail.inReplyTo);
  ids.push(...[...mail.references].reverse());
  return [...new Set(ids)];
}

/** True when the mail looks like it came from a mail system rather than a person. */
function fromMailSystem(mail: NormalisedMail): boolean {
  const local = mail.from.address.split('@')[0] ?? '';
  return DAEMON_LOCAL.test(local);
}

function statusKind(
  status: string | null,
  action: string | null,
  smtp: string | null,
): 'hard' | 'soft' | null {
  if (status) {
    if (status.startsWith('5')) return 'hard';
    if (status.startsWith('4')) return 'soft';
  }
  if (action?.toLowerCase() === 'delayed') return 'soft';
  if (smtp) {
    if (smtp.startsWith('5')) return 'hard';
    if (smtp.startsWith('4')) return 'soft';
  }
  if (action?.toLowerCase() === 'failed') return 'hard';
  return null;
}

/** Reads a Postfix / Gmail / Exchange readable body for the recipient and the reason when there is no delivery-status part. */
function fromText(text: string): {
  recipient: string | null;
  reason: string | null;
  status: string | null;
  smtp: string | null;
} {
  const status = /\b([45]\.\d{1,3}\.\d{1,3})\b/.exec(text)?.[1] ?? null;
  const smtp =
    /\b([45]\d\d)[ -]\d\.\d\.\d|\b(?:said|returned|replied)[^\n]{0,40}?\b([45]\d\d)\b/i.exec(text);
  const smtpCode = smtp ? (smtp[1] ?? smtp[2] ?? null) : null;
  let recipient: string | null = null;
  const patterns = [
    /(?:wasn['’]t|was not) delivered to\s+<?([^\s<>]+@[^\s<>]+?)>?(?:[\s.,]|$)/i,
    /message to\s+<?([^\s<>]+@[^\s<>]+?)>?\s+(?:couldn['’]t|could not|was not|wasn['’]t)/i,
    /delivery to the following recipients? failed[.:\s]*<?([^\s<>]+@[^\s<>]+?)>?(?:\s|$)/i,
    /^<([^<>\s]+@[^<>\s]+)>:/m,
    /(?:to|for) address\s+<?([^\s<>]+@[^\s<>]+?)>?[\s.:,]/i,
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    const addr = cleanAddress(m?.[1] ?? null);
    if (addr) {
      recipient = addr;
      break;
    }
  }
  let reason: string | null = null;
  const said = /(?:said|returned|replied|response)[^\n]*?:\s*([45]\d\d[^\n]*)/i.exec(text)?.[1];
  const exch = /Remote Server returned\s+['"]?([^'"\n]+)/i.exec(text)?.[1];
  const gmail = /because\s+([^\n]+?)(?:\.\s|\.$|\n)/i.exec(text)?.[1];
  const raw = said ?? exch ?? gmail ?? null;
  if (raw) reason = oneLine(raw);
  return { recipient, reason, status, smtp: smtpCode };
}

/** Null when the mail is not a bounce (or no failed recipient can be read: then nothing can be linked, so it stays an ordinary mail). */
export function detectBounce(mail: NormalisedMail): ParsedBounce | null {
  const h = mail.rawHeaders;
  const type = (h['content-type'] ?? '').toLowerCase();
  const reportType = /report-type=["']?delivery-status/.test(type);
  const status = mail.report?.deliveryStatus ?? null;
  const hasDsn = reportType || status !== null;
  const failedHeader = h['x-failed-recipients'] ?? null;
  const system = fromMailSystem(mail);
  const subjectHit = SUBJECT.test(mail.subject);
  if (!hasDsn && !failedHeader && !(system && (subjectHit || mail.automated))) return null;

  // Recipient, status code and reason: the machine readable part first, then the headers, then the text.
  let recipient: string | null = null;
  let code: string | null = null;
  let action: string | null = null;
  let diagnostic: string | null = null;
  if (status) {
    // A report has a per-message block, then one block per recipient: the first recipient that failed (or was delayed) is the one.
    const blocks = status.split(/\r?\n\r?\n/);
    const pick =
      blocks.find(
        (b) => /^final-recipient:/im.test(b) && /^action:\s*(failed|delayed)/im.test(b),
      ) ?? blocks.find((b) => /^final-recipient:/im.test(b));
    if (pick) {
      recipient =
        cleanAddress(fieldOf(pick, 'original-recipient')) ??
        cleanAddress(fieldOf(pick, 'final-recipient'));
      code = /^([245]\.\d{1,3}\.\d{1,3})/.exec(fieldOf(pick, 'status') ?? '')?.[1] ?? null;
      action = fieldOf(pick, 'action');
      diagnostic = fieldOf(pick, 'diagnostic-code');
    }
  }
  if (!recipient) recipient = cleanAddress(failedHeader?.split(/[,;\s]+/)[0] ?? null);
  const t = fromText(mail.text || '');
  recipient ??= t.recipient;
  if (!recipient) return null;
  // A mail that is only "from a daemon" with a subject match but nothing structural must have a readable failure to count.
  if (!hasDsn && !failedHeader && !t.status && !t.smtp && !t.reason) return null;

  code ??= t.status;
  const smtp = /^\s*(?:smtp;\s*)?([45]\d\d)\b/i.exec(diagnostic ?? '')?.[1] ?? t.smtp;
  const kind =
    statusKind(code, action, smtp) ??
    (/(delay|will keep trying)/i.test(mail.subject + mail.text) ? 'soft' : 'hard');
  const reasonRaw = diagnostic ? oneLine(diagnostic.replace(/^smtp;\s*/i, '')) : (t.reason ?? '');
  const reason = (
    reasonRaw || (kind === 'hard' ? 'The address could not be reached.' : 'Delivery was delayed.')
  ).slice(0, REASON_MAX);
  return {
    kind,
    reason,
    failedRecipient: recipient.slice(0, 320),
    status: code,
    originalMessageIds: originalIds(mail, mail.report),
  };
}

/**
 * Loop protection (TW-MAIL-032): mail that must never be answered by a machine (and never trigger a flow). Auto-Submitted other than
 * `no`, Precedence bulk / list / junk / auto_reply, X-Auto-Response-Suppress, List-Unsubscribe / List-Id, an empty return path, a daemon.
 * `automated` on the normalised mail already covers most of it; this is the explicit, testable rule the reply-suppression guard uses.
 */
export function isLoopRisk(
  mail: Pick<NormalisedMail, 'rawHeaders' | 'automated' | 'from'>,
): boolean {
  const h = mail.rawHeaders;
  const auto = h['auto-submitted']?.trim().toLowerCase();
  if (auto && auto !== 'no') return true;
  const precedence = h['precedence']?.trim().toLowerCase();
  if (precedence && ['bulk', 'list', 'junk', 'auto_reply'].includes(precedence)) return true;
  if (h['x-auto-response-suppress'] || h['list-unsubscribe'] || h['list-id']) return true;
  if (h['return-path']?.trim() === '<>') return true;
  if (DAEMON_LOCAL.test(mail.from.address.split('@')[0] ?? '')) return true;
  return mail.automated;
}
