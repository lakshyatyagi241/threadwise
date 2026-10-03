import type { MessengerButton } from '../../infra/providers/channel-facebook/facebook.port';

/** Pure rules of a Messenger broadcast (WD-FB-012 to 014). */

/** Meta's standard messaging window: a Page may message a person only within this long of their last message. */
export const WINDOW_HOURS = 24;
/** People sent to in one go. */
export const BATCH_SIZE = 25;
/** The gap between two sends: about 20 a second, well under Meta's ceiling for a Page. */
export const SEND_GAP_MS = 50;
/** A recipient claimed by a worker that died is put back after this long. */
export const CLAIM_TIMEOUT_MINUTES = 2;
/** The most people the compose form lists for one Page (a create takes the same number). */
export const AUDIENCE_LIMIT = 5000;

/** The oldest last-message time that is still inside the window at `now`. */
export const windowCutoff = (now: Date): Date => new Date(now.getTime() - WINDOW_HOURS * 3_600_000);

/** Is this person still inside the window? A thread that never received a message is not. */
export const insideWindow = (lastInboundAt: Date | null, now: Date): boolean =>
  lastInboundAt !== null && lastInboundAt.getTime() >= windowCutoff(now).getTime();

/**
 * Meta's refusals that mean the person cannot be reached for this broadcast: outside the window, blocked the Page, unavailable, an
 * invalid or expired id, a Page still in development mode, a policy block. The recipient is `blocked`, not `failed`, and a retry
 * leaves it alone because it would be the same refusal again.
 */
const UNREACHABLE = [
  'outside of the allowed window',
  'outside the allowed window',
  "this person isn't available",
  'not available right now',
  'no matching user',
  'invalid user id',
  'cannot message users who are not admins',
  'policy',
];
export const isUnreachable = (description: string): boolean => {
  const d = description.toLowerCase();
  return UNREACHABLE.some((n) => d.includes(n));
};

/**
 * `{{name}}` and `{{ name }}` become the person's name (WaDesk's sender); so does `{name}`, which WaDesk's compose screen promises
 * and its sender left as typed. Nothing else is merged.
 */
export const personalise = (body: string, title: string | null): string =>
  body.replace(/\{\{\s*name\s*\}\}|\{name\}/g, title ?? '').trim();

/** Whole percent done; blocked counts as done. */
export const progressPct = (sent: number, failed: number, blocked: number, total: number): number =>
  Math.round(((sent + failed + blocked) / Math.max(1, total)) * 100);

const dict = (x: unknown): Record<string, unknown> =>
  typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {};
const text = (x: unknown): string =>
  typeof x === 'string' || typeof x === 'number' ? String(x) : '';

/**
 * A template's buttons as Messenger buttons: at most three (Meta's limit), titles cut to 20. A link becomes `web_url`, a phone
 * number `phone_number`, anything else a `postback` whose payload `tqr:<title>` brings the tap back as the title. A button with no
 * title, or a link or phone without its address, is skipped. The first three are looked at, as in WaDesk.
 */
export function messengerButtons(buttons: readonly unknown[]): MessengerButton[] {
  const out: MessengerButton[] = [];
  for (const raw of buttons.slice(0, 3)) {
    const b = dict(raw);
    const title = text(b.text) || text(b.title);
    if (title === '') continue;
    const type = text(b.type) || 'quick_reply';
    const t = title.slice(0, 20);
    const url = text(b.url);
    const phone = text(b.phone) || text(b.phone_number);
    if (type === 'url' && url !== '') out.push({ type: 'web_url', title: t, url });
    else if (type === 'phone' && phone !== '')
      out.push({ type: 'phone_number', title: t, payload: phone });
    else out.push({ type: 'postback', title: t, payload: `tqr:${title}` });
  }
  return out;
}

/** The person's id from a Messenger thread key (`fb:<page>:<psid>`); null for any other key, a comment thread included. */
export function psidOf(rawJid: string): string | null {
  const parts = rawJid.split(':');
  return parts[0] === 'fb' && parts.length === 3 && parts[2] !== '' && parts[2] !== 'post'
    ? parts[2]!
    : null;
}
