/**
 * A WhatsApp group thread is keyed `g:<group id>` (the inbound ingest). Two channels can send into one:
 *
 * - the WhatsApp Cloud API channel sends text and files (docs/specs/waba-groups-management.md, phase 3); reactions, places, contact cards,
 *   buttons and the template picker stay off there, since Meta takes only text, files and templates in a group;
 * - a personal (linked) number, channel kind `whatsapp_qr`, sends everything a person can send in a group chat: text, files, a place,
 *   contact cards, reactions, replies to a message and @mentions of members (docs/threadwise-port/plan/whatsapp-personal-groups-build.md).
 *
 * Any other channel kind cannot address a group at all: the API refuses with `WABA_GROUP_SEND_UNAVAILABLE`, and the composer is switched
 * off so nobody types a reply that cannot go.
 */
export const isGroupThread = (peerKey: string | null | undefined): boolean =>
  (peerKey ?? '').trimStart().startsWith('g:');

/** A group of a personal (linked) number: the full composer works, with @mentions. */
export const isPersonalGroupThread = (
  peerKey: string | null | undefined,
  channelKind: string | null | undefined,
): boolean => isGroupThread(peerKey) && channelKind === 'whatsapp_qr';

/** A group thread on a channel that cannot send to a group: the Reply tab is off (notes and everything else work as before). */
export const isGroupSendBlocked = (
  peerKey: string | null | undefined,
  channelKind: string | null | undefined,
): boolean =>
  isGroupThread(peerKey) && channelKind !== 'whatsapp_cloud' && channelKind !== 'whatsapp_qr';

/**
 * A group thread whose channel sends only text and files into it (the Cloud API): the reply, reaction and share controls stay off. A
 * personal-number group is not limited: it takes all of them.
 */
export const isGroupLimited = (
  peerKey: string | null | undefined,
  channelKind: string | null | undefined,
): boolean => isGroupThread(peerKey) && channelKind !== 'whatsapp_qr';

/** The slice of `conversation.personalGroup` the thread reads. */
export interface PersonalGroupFlags {
  left: boolean;
  announceOnly: boolean;
  canSend: boolean;
}

/**
 * Why a personal-group thread cannot be written to right now: the number left (or was removed), or only admins may write and this
 * number is not one. `null`: the composer works. A thread whose flags are not known yet (the detail is loading) is not blocked here:
 * the API refuses a send it cannot make with `WA_GROUP_LEFT` or `WA_GROUP_ANNOUNCE_ONLY`.
 */
export function personalGroupBlock(
  group: PersonalGroupFlags | null | undefined,
): 'left' | 'announceOnly' | null {
  if (!group) return null;
  if (group.left) return 'left';
  if (group.announceOnly || !group.canSend) return 'announceOnly';
  return null;
}
