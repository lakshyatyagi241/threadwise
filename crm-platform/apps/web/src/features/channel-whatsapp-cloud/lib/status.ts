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

/**
 * Whose words the inbox uses when a channel cannot send. The banner and the failure link are shared by every channel kind; only the
 * WhatsApp kinds may say "number" and "WhatsApp". An email channel is a mailbox, everything else is just a channel.
 */
export type ChannelFamily = 'whatsapp' | 'email' | 'other';

export function channelFamily(kind: string): ChannelFamily {
  switch (kind) {
    case 'whatsapp_cloud':
    case 'whatsapp_qr':
      return 'whatsapp';
    case 'email':
      return 'email';
    default:
      return 'other';
  }
}

/** Where each kind of channel is managed: the kind's own screen, or the inbox's channel list for a kind that has none (the simulator). */
const SETTINGS_HREF: Record<string, string> = {
  whatsapp_cloud: '/channels/whatsapp',
  whatsapp_qr: '/devices',
  webchat: '/channels/web',
  email: '/email',
  telegram: '/telegram',
  facebook: '/facebook',
  instagram: '/instagram',
  line: '/line',
  viber: '/viber',
  wechat: '/wechat',
};

export const channelSettingsHref = (kind: string): string =>
  SETTINGS_HREF[kind] ?? '/inbox/channels';
