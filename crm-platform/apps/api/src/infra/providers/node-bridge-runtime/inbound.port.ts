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
  /** Group messages: the ids WhatsApp lists as @mentioned (`contextInfo.mentionedJid`). */
  mentionedJids?: string[];
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

/** One member of a group as the socket reports it. `phone` is digits (no `+`); a member WhatsApp addresses only by an anonymous id has none. */
export interface GroupParticipantSnapshot {
  /** WhatsApp's id for the member, as the group lists it (`...@s.whatsapp.net` or `...@lid`). What a mention or an admin action takes. */
  jid: string;
  phone: string | null;
  /** The anonymous id's user part (digits), when known. */
  lid: string | null;
  /** The member's own profile name (or the one saved on our phone), when WhatsApp gave one. */
  name: string | null;
  admin: 'superadmin' | 'admin' | null;
}

/**
 * A group as the socket last read it. Crosses Redis as JSON between the worker and the API: only strings, numbers, booleans and arrays.
 * `jid` is WhatsApp's full id (`...@g.us`); `groupId` is the BARE id the platform stores and uses in the thread key `g:<groupId>`.
 */
export interface GroupSnapshot {
  jid: string;
  groupId: string;
  subject: string | null;
  description: string | null;
  size: number | null;
  /** Is OUR number an admin (or the owner) of the group. */
  isAdmin: boolean;
  /** Only admins may send. */
  announce: boolean;
  /** Only admins may edit the group info. */
  restrict: boolean;
  /** New members need an admin's approval. */
  joinApproval: boolean;
  memberAddMode: 'all_member_add' | 'admin_add';
  /** The owner's id, when WhatsApp gave one. */
  owner: string | null;
  /** When the group was created (ISO). */
  creation: string | null;
  addressingMode: 'pn' | 'lid' | null;
  /** The invite code, only when WhatsApp sent it (we are admin). A bearer secret: never log it. */
  inviteCode: string | null;
  /** The roster, capped at 1024 members (`size` stays the true count). */
  participants: GroupParticipantSnapshot[];
}

/** What a group's metadata changed to. Only the fields WhatsApp sent are set. */
export interface GroupPatch {
  subject?: string;
  description?: string;
  announce?: boolean;
  restrict?: boolean;
  joinApproval?: boolean;
  memberAddMode?: 'all_member_add' | 'admin_add';
}

/**
 * A change in one group (`groups.update`, `group-participants.update`, `group.join-request`), delivered as it happens so the directory
 * can update one row and notify. `author` is the id of whoever did it (null when WhatsApp did not say). All ids are WhatsApp ids.
 */
export type GroupEvent =
  | { kind: 'update'; groupId: string; author: string | null; patch: GroupPatch }
  | {
      kind: 'participants';
      groupId: string;
      author: string | null;
      action: 'add' | 'remove' | 'promote' | 'demote' | 'modify';
      participants: string[];
      /** OUR number is one of `participants` (we were added, removed, promoted or demoted). */
      selfAffected: boolean;
    }
  | {
      kind: 'join_request';
      groupId: string;
      /** Who asked (or whose request was handled). */
      participant: string;
      author: string | null;
      action: 'created' | 'revoked' | 'rejected';
      method: string | null;
    };
