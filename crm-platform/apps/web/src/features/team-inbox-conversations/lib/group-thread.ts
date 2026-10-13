import type { ConversationCloudGroup, MessageGroupDelivery } from '@crm/contracts';

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

/** Why the composer of a Cloud API group thread is off, from `conversation.cloudGroup`; null: it works (a short wallet only warns). */
export function cloudGroupBlock(
  group: ConversationCloudGroup | null | undefined,
): 'suspended' | 'plan' | 'ineligible' | null {
  return group?.block ?? null;
}

/** What one message to the whole group costs, in the workspace's billing currency (the API sends hundredths). */
export function formatGroupCost(minor: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export interface GroupTally {
  delivered: number;
  members: number;
  read: number;
  failed: number;
  billable: number;
  free: number;
  /** The group size is known and not smaller than the count reached: "of N" makes sense (the group may have grown or shrunk since). */
  withTotal: boolean;
}

/** The delivery tally of a message sent to a group; null until Meta has reported on a member (nothing to show yet). */
export function groupTallyOf(d: MessageGroupDelivery | null | undefined): GroupTally | null {
  if (!d) return null;
  const read = d.readBy ?? 0;
  const failed = d.failed ?? 0;
  if (d.deliveredTo <= 0 && read <= 0 && failed <= 0) return null;
  const members = d.members ?? 0;
  return {
    delivered: d.deliveredTo,
    members,
    read,
    failed,
    billable: d.billable,
    free: d.free,
    withTotal: members > 0 && members >= d.deliveredTo,
  };
}

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
