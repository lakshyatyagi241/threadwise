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
