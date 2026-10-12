/**
 * A WhatsApp group thread is keyed `g:<group id>` (the inbound ingest). The WhatsApp Cloud API channel sends text and files to it
 * (docs/specs/waba-groups-management.md, phase 3); reactions, places, contact cards, buttons and the template picker stay off on
 * a group thread, since Meta takes only text, files and templates there. Any other channel kind cannot address a group at all: the
 * API refuses with `WABA_GROUP_SEND_UNAVAILABLE`, and the composer is switched off so nobody types a reply that cannot go.
 */
export const isGroupThread = (peerKey: string | null | undefined): boolean =>
  (peerKey ?? '').trimStart().startsWith('g:');

/** A group thread on a channel that cannot send to a group: the Reply tab is off (notes and everything else work as before). */
export const isGroupSendBlocked = (
  peerKey: string | null | undefined,
  channelKind: string | null | undefined,
): boolean => isGroupThread(peerKey) && channelKind !== 'whatsapp_cloud';
