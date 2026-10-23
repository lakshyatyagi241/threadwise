import type { WalletUsageReported } from '@crm/contracts';
import { isGroupKey, isPhoneChannel } from './peer-key';

/**
 * Email and the other chat channels carry a platform fee per message, separate from the provider's own bill (the customer connects
 * their own mailbox, bot or page) and separate from `metered`, which is only the plan's monthly message cap. The prices are the
 * operator's (`email` and `chat_message` in the usage prices); the rules here only decide WHAT is billed.
 *
 * Not billed, on purpose: the simulator (a development tool), `whatsapp_qr` (a personal number: unbilled by product decision), the
 * web chat widget, and WhatsApp Cloud (priced per message by the rate card, reported as `message.delivery_reported`).
 */
const CHAT_MESSAGE_CHANNELS: ReadonlySet<string> = new Set([
  'telegram',
  'facebook',
  'instagram',
  'line',
  'viber',
  'wechat',
]);

export type ChatUsageKind = 'email' | 'chat_message';

/** The wallet kind a message through this channel is billed as; null when the channel's messages cost nothing here. */
export function usageKindOfChannel(channelKind: string): ChatUsageKind | null {
  if (channelKind === 'email') return 'email';
  return CHAT_MESSAGE_CHANNELS.has(channelKind) ? 'chat_message' : null;
}

/**
 * The key a message is billed under, unique per workspace (`<kind>:<usage id>`). The provider's id is used as it is, except on
 * Telegram: a message id is only unique inside one chat of one bot, so the same person writing to two bots of a workspace could
 * give two messages the same `<chat>:<message id>`, and the second would never be charged. `scope` is the bot's row id (the
 * channel's `external_id`). Every producer of a Telegram usage must pass the same scope, or a refund would miss its charge.
 */
export function chatUsageId(o: {
  channelKind: string;
  providerMessageId: string;
  scope?: string | null;
}): string {
  const id = o.providerMessageId.trim();
  return o.channelKind === 'telegram' && o.scope ? `tg${o.scope}:${id}` : id;
}

/** The number a usage is priced by country from: only a channel whose peer IS a phone number has one (never a handle or an address). */
export function usageRecipientOf(channelKind: string, peerKey: string): string | null {
  return isPhoneChannel(channelKind) && !isGroupKey(peerKey) ? peerKey : null;
}

export interface ChatUsageInput {
  channelKind: string;
  providerMessageId: string | null;
  /** `used` once the provider accepted the message; `failed` when it later reported it undelivered (a refund). */
  status: 'used' | 'failed';
  peerKey: string;
  /** Where it came from, short and lowercase (`inbox`, `auto_reply`, `broadcast`, `campaign`...). */
  source: string | null;
  /** The bot's row id on Telegram; see `chatUsageId`. */
  scope?: string | null;
  /** The campaign or broadcast it belongs to, by name. */
  subjectName?: string | null;
  /** The stored message's kind: a reaction is not a message and costs nothing. */
  messageKind?: string | null;
}

/**
 * The `usage.reported` payload of one outbound message of the team inbox or of a channel's own broadcast, or null when it is not
 * billed (an unbilled channel, a reaction, a message the provider gave no id for). One message is one unit: a mail, or one chat message
 * however many parts the provider split it into.
 */
export function chatUsageReport(o: ChatUsageInput): WalletUsageReported | null {
  const kind = usageKindOfChannel(o.channelKind);
  if (!kind || !o.providerMessageId?.trim() || o.messageKind === 'reaction') return null;
  return {
    kind,
    usageId: chatUsageId({
      channelKind: o.channelKind,
      providerMessageId: o.providerMessageId,
      scope: o.scope ?? null,
    }),
    status: o.status,
    units: 1,
    recipient: usageRecipientOf(o.channelKind, o.peerKey),
    source: o.source,
    provider: o.channelKind,
    ...(o.subjectName ? { subjectName: o.subjectName } : {}),
  };
}
