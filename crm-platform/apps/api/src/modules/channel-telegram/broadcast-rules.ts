import type { MediaKind } from '../../infra/providers/channel-telegram/telegram.port';

/** Pure rules of a Telegram broadcast (TW-TG-012, 013). */

/** Chats sent to in one go. Telegram's ceiling is about 30 messages a second overall; a 429 locks the bot out, which also stops customer replies. */
export const BATCH_SIZE = 25;
/** The gap between two sends: about 20 a second, well under the ceiling. */
export const SEND_GAP_MS = 50;
/** A recipient claimed by a worker that died is put back after this long. */
export const CLAIM_TIMEOUT_MINUTES = 2;
/** Reference listed the 500 newest chats of a bot. */
export const AUDIENCE_LIMIT = 500;

/**
 * Telegram's refusals that mean the person cannot be reached (blocked the bot, left, deleted): the recipient is `blocked`, not
 * `failed`, and a retry leaves it alone because it would be the same refusal again.
 */
const UNREACHABLE = [
  'bot was blocked',
  'user is deactivated',
  'chat not found',
  'peer_id_invalid',
  'bot was kicked',
  'have no rights',
  'not enough rights',
  'user is deleted',
];
export const isUnreachable = (description: string): boolean => {
  const d = description.toLowerCase();
  return UNREACHABLE.some((n) => d.includes(n));
};

/**
 * `{{name}}` and `{{ name }}` become the chat's title (Reference's sender); so does `{name}`, which Reference's compose screen promises and
 * its sender left as typed. Nothing else is merged (a chat has no other attributes).
 */
export const personalise = (body: string, title: string | null): string =>
  body.replace(/\{\{\s*name\s*\}\}|\{name\}/g, title ?? '').trim();

/** Whole percent done; blocked counts as done. */
export const progressPct = (sent: number, failed: number, blocked: number, total: number): number =>
  Math.round(((sent + failed + blocked) / Math.max(1, total)) * 100);

/** The Telegram method family for an attachment, from the address's extension (Reference's mapping). */
export function mediaKindFor(url: string): MediaKind {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* keep the raw text */
  }
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
  if (ext === 'gif') return 'animation';
  if (['mp4', 'mov'].includes(ext)) return 'video';
  if (['mp3', 'ogg'].includes(ext)) return 'audio';
  return 'document';
}

/** A chat id that starts with `-` is a group or channel; the type comes from the latest message that said so. */
export function chatType(chatId: string, seenTypes: readonly string[], anySender: boolean): string {
  if (!chatId.startsWith('-')) return 'private';
  const seen = seenTypes[0];
  const type = seen ?? (anySender ? 'group' : 'channel');
  return type === 'supergroup' ? 'group' : type;
}

/** private chats are `private`, everything else `group` (a channel is stored as a group recipient). */
export const recipientKind = (type: string): 'private' | 'group' =>
  type === 'private' ? 'private' : 'group';
