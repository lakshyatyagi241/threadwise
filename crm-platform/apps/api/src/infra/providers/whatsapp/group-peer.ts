import { ChannelError } from '../chat-conversations/channel.port';

/** The code of the refusal. Mirrors `ERROR_CODES.WABA_GROUP_SEND_UNAVAILABLE` (contracts); the providers layer does not import the registry. */
export const GROUP_SEND_UNAVAILABLE = 'WABA_GROUP_SEND_UNAVAILABLE';

export const GROUP_SEND_UNAVAILABLE_MESSAGE =
  'Sending to WhatsApp groups is not available yet. Reply from the WhatsApp Business app.';

/**
 * A WhatsApp group thread is keyed `g:<group id>` (inbound ingest). The id is opaque text, not a phone number, so it must never be
 * turned into a recipient: stripping its non-digits would address an unrelated person (docs/specs/waba-groups-management.md 4.3).
 */
export const isGroupPeer = (to: string): boolean => to.trimStart().startsWith('g:');

/** Throws the non-retryable `WABA_GROUP_SEND_UNAVAILABLE` for a group peer; a no-op for anything else. */
export function assertNotGroupPeer(to: string): void {
  if (isGroupPeer(to))
    throw new ChannelError(GROUP_SEND_UNAVAILABLE, GROUP_SEND_UNAVAILABLE_MESSAGE, false);
}

/** The kinds Meta accepts on a group (docs/specs/waba-groups-management.md 3 and 11): text, files and templates; no reaction, interactive, place or contact card. */
const GROUP_SEND_KINDS: ReadonlySet<string> = new Set(['text', 'media', 'template']);

export const isGroupSendKind = (kind: string): boolean => GROUP_SEND_KINDS.has(kind);

/** The group id of a `g:<group id>` thread key, verbatim: Meta wants it untouched (no digit stripping, no case change). */
export const groupIdOf = (to: string): string => to.trimStart().slice(2);

/** Throws the non-retryable `CHANNEL_CAPABILITY_UNSUPPORTED` for a kind a group cannot carry. */
export function assertGroupSendKind(kind: string): void {
  if (!isGroupSendKind(kind))
    throw new ChannelError(
      'CHANNEL_CAPABILITY_UNSUPPORTED',
      `A WhatsApp group cannot receive a ${kind} message`,
      false,
    );
}

/** The kinds a personal-number (`whatsapp_qr`) group thread carries: text with mentions, files, a place, contact cards and a reaction. No template, no buttons or lists. */
const PERSONAL_GROUP_SEND_KINDS: ReadonlySet<string> = new Set([
  'text',
  'media',
  'location',
  'contacts',
  'reaction',
]);

export const isPersonalGroupSendKind = (kind: string): boolean =>
  PERSONAL_GROUP_SEND_KINDS.has(kind);

/** What `wa_device_groups` says about our number in a group, as far as sending goes. */
export interface PersonalGroupSendState {
  leftAt: Date | string | null;
  announce: boolean;
  isAdmin: boolean;
}

/**
 * Why a message cannot go into a personal-number group, or null when it can: the number left or was removed (`WA_GROUP_LEFT`), or only
 * admins may write there and ours is not one (`WA_GROUP_ANNOUNCE_ONLY`). A group with no row yet (the directory has not synced) is not
 * refused: WhatsApp has the last word.
 */
export function personalGroupSendBlock(
  state: PersonalGroupSendState | null | undefined,
): { code: 'WA_GROUP_LEFT' | 'WA_GROUP_ANNOUNCE_ONLY'; message: string } | null {
  if (!state) return null;
  if (state.leftAt)
    return {
      code: 'WA_GROUP_LEFT',
      message: 'This number is no longer in the group, so the thread is read-only.',
    };
  if (state.announce && !state.isAdmin)
    return {
      code: 'WA_GROUP_ANNOUNCE_ONLY',
      message: 'Only admins can send messages in this group, and this number is not an admin.',
    };
  return null;
}
