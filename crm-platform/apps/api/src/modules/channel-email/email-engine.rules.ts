import { randomUUID } from 'node:crypto';

/** The pure rules of the email engine that sends a campaign (Reference's `EmailCampaignRunner`). No I/O, so each is tested alone. */

/** Reference's words for what stops a send. */
export const NO_SENDABLE_MAILBOX =
  'This campaign has no connected mailbox. Connect a mailbox on the Email page, then pick it as the campaign sender.';
export const PLAN_WITHOUT_EMAIL = 'Your plan does not include Email.';
export const OPTED_OUT = 'This contact has opted out of messages.';
export const NO_RECORDED_CONSENT = 'This contact has no recorded consent for marketing messages.';
export const NOT_A_CONTACT =
  'A marketing email can only go to a contact, so it can carry an unsubscribe link.';

export const quotaMessage = (cap: number): string =>
  `You've reached your plan's limit of ${cap} email${cap === 1 ? '' : 's'} a month. Upgrade your plan to send more.`;

/** The first instant of the calendar month `now` is in (UTC): what the monthly count starts from. */
export const monthStart = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** `camp-<campaign>-<contact>[-rN]` and `bcast-<broadcast>-<contact>`: the contact a send is for, or null for any other reference. */
export function contactOfReference(ref: string): number | null {
  const m = /^(?:bcast|camp)-\d+-(\d+)(?:-r\d+)?$/.exec(ref);
  return m ? Number(m[1]) : null;
}

/**
 * The Message-ID of one campaign mail, without brackets. Unlike a reply's it is NOT derived from the send's reference alone: a recurring
 * campaign mails the same contact again on every run, and two mails sharing an id would be folded into one by every mail client and by
 * our own sync. The reference keeps it traceable; the random part keeps it unique.
 */
export function campaignMessageId(
  reference: string,
  mailboxAddress: string,
  nonce: string = randomUUID().slice(0, 12),
): string {
  const local = reference.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80) || 'campaign';
  const domain = mailboxAddress.split('@')[1]?.replace(/[^A-Za-z0-9.-]/g, '') || 'mail.invalid';
  return `tw.${local}.${nonce}@${domain}`;
}

/** The unsubscribe line every marketing mail ends with, in the plain-text part. */
export const unsubscribeLine = (pageUrl: string): string => `Unsubscribe: ${pageUrl}`;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The two bodies of a campaign mail: the text part is the typed message and the unsubscribe line; the HTML part is the same message
 * HTML-escaped with line breaks kept (a campaign body is plain text, so an ampersand or a stray angle bracket can never break or
 * inject into the page), and the unsubscribe link as an anchor.
 */
export function campaignBodies(
  body: string,
  unsubscribePageUrl: string,
  unsubscribeLabel = 'Unsubscribe',
): { text: string; html: string } {
  const text = `${body}\n\n${unsubscribeLine(unsubscribePageUrl)}`;
  const html =
    `<div dir="auto">${escapeHtml(body).replace(/\r\n|\r|\n/g, '<br>\n')}</div>\n` +
    `<p style="font-size:12px;color:#6b7280"><a href="${escapeHtml(unsubscribePageUrl)}">${escapeHtml(unsubscribeLabel)}</a></p>`;
  return { text, html };
}

/** A subject can never carry a line break (it would open a second header): collapsed to a space, trimmed. */
export const oneLine = (s: string): string => s.replace(/[\r\n]+/g, ' ').trim();
