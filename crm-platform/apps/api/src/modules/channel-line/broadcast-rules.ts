import type { MediaKind } from './message-builders';

/** Pure rules of a LINE broadcast. */

/** People sent to in one go. Reference's batch; push has a generous ceiling and the batch is kept modest so a burst never stalls customer replies. */
export const BATCH_SIZE = 40;
/** The gap between two pushes, so a batch stays well under LINE's rate limit. */
export const SEND_GAP_MS = 50;
/** A recipient claimed by a worker that died is put back after this long. */
export const CLAIM_TIMEOUT_MINUTES = 2;
/** Reference listed the 500 newest threads of a channel. */
export const AUDIENCE_LIMIT = 500;

/** The substrings (lower case) of a LINE refusal that mean the person cannot be reached; Reference's list. */
const UNREACHABLE = [
  'blocked',
  'not a friend',
  'invalid user',
  'the user hasn',
  'forbidden',
  'not found',
  'no longer',
  'cannot send messages',
];

/**
 * LINE's refusals that mean the person is gone for good (blocked the account, no longer a friend): the recipient is `blocked`, not
 * `failed`, and a retry leaves it alone because it would be the same refusal again.
 */
export const isUnreachable = (description: string): boolean => {
  const d = description.toLowerCase();
  return UNREACHABLE.some((n) => d.includes(n));
};

/** `{{name}}` and `{{ name }}` become the person's LINE display name; `{name}` does too, which Reference's compose screen promises. */
export const personalise = (body: string, title: string | null): string =>
  body.replace(/\{\{\s*name\s*\}\}|\{name\}/g, title ?? '').trim();

/** Whole percent done; blocked counts as done. */
export const progressPct = (sent: number, failed: number, blocked: number, total: number): number =>
  Math.round(((sent + failed + blocked) / Math.max(1, total)) * 100);

/** The LINE message family for an attachment, from the address's extension (Reference: anything unknown is an image). */
export function mediaKindFor(url: string): MediaKind {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* keep the raw text */
  }
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  if (['mp4', 'mov'].includes(ext)) return 'video';
  if (['m4a', 'mp3'].includes(ext)) return 'audio';
  return 'image';
}
