/**
 * What the socket tells the runtime about messages (TW-NODE-016, 018, 020): normalized, with no library types in them. The
 * runtime turns these into outbox events; the consumers (the inbox, the broadcast and schedule receipts) never see Baileys.
 */

export interface ChatRef {
  /** WhatsApp's id for the chat (`...@s.whatsapp.net`, `...@lid`, `...@g.us`). */
  jid: string;
  /** The person's real phone number as digits, when known. */
  phone: string | null;
  /** WhatsApp's anonymous id for the person, when that is all there is. */
  lid: string | null;
  isGroup: boolean;
}

export interface InboundMessage {
  providerMessageId: string;
  chat: ChatRef;
  /** The business's own account sent it (typed on the phone, or sent by us): an echo, not a customer message. */
  fromMe: boolean;
  /** In a group, who spoke. */
  participant: { phone: string | null; lid: string | null; name: string | null } | null;
  pushName: string | null;
  timestamp: Date;
  text: string | null;
  media: {
    kind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
    mimeType: string | null;
    fileName: string | null;
    sizeBytes: number | null;
  } | null;
  location: {
    latitude: number;
    longitude: number;
    name: string | null;
    address: string | null;
  } | null;
  contact: { name: string; phone: string | null; vcard: string } | null;
  reaction: { emoji: string; targetMessageId: string } | null;
  forwarded: { score: number } | null;
  /** Every card of a contact or contacts-array message (`contact` stays the first one). */
  contacts?: { name: string | null; phones: string[]; emails: string[]; org: string | null }[];
  /** The id of the message this one answers (WhatsApp `contextInfo.stanzaId`). */
  replyToProviderMessageId?: string | null;
  /** A message type the inbox cannot show (a poll, a product, an order...): kept as a placeholder, never dropped. */
  unsupported?: { rawType: string; label: string } | null;
}

/** Delivery progress of a message we sent (TW-NODE-020). */
export interface ReceiptUpdate {
  providerMessageId: string;
  chatJid: string;
  /** Baileys' ack level: 0 error, 1 pending, 2 server ack (sent), 3 delivered, 4 read, 5 played. */
  ack: number;
}

export interface GroupSnapshot {
  jid: string;
  subject: string | null;
  description: string | null;
  size: number | null;
}
