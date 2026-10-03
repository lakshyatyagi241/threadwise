/**
 * How a channel's state reads in a conversation. The registry stores `connected`, `disconnected`, `error` and `needs_reauth` (the
 * provider no longer accepts the credentials); a person needs four words: working, needs reconnecting, broken for another reason,
 * not on. Connecting and checking numbers is the WABA screens' job (`/channels/whatsapp`); the inbox only has to say why a reply
 * cannot go out and where to fix it.
 */
export type ChannelState = 'connected' | 'needs_reconnect' | 'error' | 'not_connected';

export function channelState(status: string): ChannelState {
  switch (status) {
    case 'connected':
      return 'connected';
    case 'needs_reauth':
      return 'needs_reconnect';
    case 'error':
      return 'error';
    default:
      // `disconnected`: switched off, or a new number whose first check has not passed yet.
      return 'not_connected';
  }
}

/** Whether sending through the channel is blocked (the inbox disables the composer). */
export const sendBlocked = (status: string): boolean => channelState(status) !== 'connected';
