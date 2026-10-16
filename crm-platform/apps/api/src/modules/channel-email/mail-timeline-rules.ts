import type { MailScope } from '@crm/contracts';

// Pure rules of the contact timeline entries the Email channel writes (E-19). No I/O: the writer (`MailTimeline`) decides WHERE, these
// decide WHETHER and WHAT.

export const EMAIL_RECEIVED_ACTIVITY = 'email_received';
export const EMAIL_SENT_ACTIVITY = 'email_sent';

/** `contact_activities.title` is free text; the screen shows one line of it. */
export const TIMELINE_TITLE_MAX = 200;
/** Characters of the mail's text kept as the preview line. */
export const TIMELINE_PREVIEW_MAX = 240;
/** The subject shown for a mail that has none. */
export const NO_SUBJECT = '(no subject)';

export interface TimelinePerson {
  name: string | null;
  address: string;
}

export interface TimelineEntry {
  activityType: typeof EMAIL_RECEIVED_ACTIVITY | typeof EMAIL_SENT_ACTIVITY;
  title: string;
  body: string | null;
}

/**
 * Only SHARED mailboxes write to the shared timeline. A contact's timeline is read by everyone who may read the contact, while the mail of
 * a personal mailbox is visible to its owner alone (and to admins only when the workspace policy says so, TW-MAIL-035): a subject and a
 * preview on the timeline would open that mail to people the inbox keeps out. So a personal mailbox leaves no entry at all.
 */
export const writesToTimeline = (scope: MailScope): boolean => scope === 'shared';

/**
 * Auto-replies, list and no-reply mail are `automated`: stored in the inbox for an agent to read, never correspondence with the contact,
 * so they leave no entry (an out-of-office reply is not a conversation). Bounce reports never reach this point: the bounce handler
 * consumes them before they are stored.
 */
export const isTimelineWorthy = (automated: boolean): boolean => !automated;

/** The dedupe key of an inbound mail: one entry per provider message of a mailbox, however often it is seen. */
export const inboundKey = (mailboxUuid: string, providerMessageId: string): string =>
  `${mailboxUuid}:in:${providerMessageId}`.slice(0, 500);

/** And of an outbound one: the Message-ID of the reply, which is derived from the send's idempotency key, so a retry has the same one. */
export const outboundKey = (mailboxUuid: string, messageId: string): string =>
  `${mailboxUuid}:out:${messageId}`.slice(0, 500);

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;

/** A person as one short label: their name when there is one, else the address. */
const label = (p: TimelinePerson): string => {
  const name = p.name?.replace(/\s+/g, ' ').trim();
  return name ? name : p.address;
};

/**
 * The first lines of what the person wrote, on one line: quoted earlier mail (`> ...`) and the "On <date>, <name> wrote:" lead-in are
 * dropped, whitespace is collapsed, and it is cut at `max` characters. Null when nothing is left (a mail with only a picture or files).
 */
export function previewOf(text: string | null | undefined, max = TIMELINE_PREVIEW_MAX): string | null {
  if (!text) return null;
  const kept: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('>')) continue;
    // The quote header of a reply: everything after it is the earlier mail.
    if (/^(on .{5,200} wrote:|-{2,}\s*original message\s*-{2,}|from:\s.+)$/i.test(trimmed)) break;
    kept.push(trimmed);
  }
  const one = kept.join(' ').replace(/\s+/g, ' ').trim();
  if (one === '' || one === '(no text)') return null;
  return clip(one, max);
}

export function receivedEntry(input: {
  subject: string | null | undefined;
  from: TimelinePerson;
  text: string | null | undefined;
}): TimelineEntry {
  const subject = input.subject?.replace(/\s+/g, ' ').trim() || NO_SUBJECT;
  return {
    activityType: EMAIL_RECEIVED_ACTIVITY,
    title: clip(`Email received from ${label(input.from)}: ${subject}`, TIMELINE_TITLE_MAX),
    body: previewOf(input.text),
  };
}

export function sentEntry(input: {
  subject: string | null | undefined;
  to: readonly string[];
  text: string | null | undefined;
}): TimelineEntry {
  const subject = input.subject?.replace(/\s+/g, ' ').trim() || NO_SUBJECT;
  const first = input.to[0] ?? '';
  const more = input.to.length > 1 ? ` (+${input.to.length - 1})` : '';
  return {
    activityType: EMAIL_SENT_ACTIVITY,
    title: clip(`Email sent to ${first}${more}: ${subject}`, TIMELINE_TITLE_MAX),
    body: previewOf(input.text),
  };
}
