import type { Tx } from '@crm/db';
import type { InboundViberMessage, ViberUserInfo } from '../event-rules';

/**
 * Stand-ins for what other domains own. Each is an interface here; when the owner exports the real service, bind it to the same
 * token in `channel-viber.module.ts` and delete the default.
 */

export interface InboundRecorded {
  /** False when Viber's message was already stored (a redelivered event). */
  stored: boolean;
  conversationId: number;
  contactId: number | null;
  /** The thread was created by this message. */
  newThread: boolean;
}

/** A receipt Viber reported for a message we sent. */
export interface ReceiptInput {
  /** The id the message carries in the thread's ledger. */
  providerMessageId: string;
  status: 'delivered' | 'read' | 'failed';
  at: Date;
  reason?: string;
}

/**
 * Writes into the inbox (chat-conversations): the thread lives on the channel's `viber` channel, keyed by the Viber user id, and the
 * message goes through the same pipeline a Cloud API webhook feeds (ledger, sequence, unread, reopen, realtime). A contact is linked.
 */
export interface InboxIngest {
  recordInbound(
    orgId: number,
    channelRowId: number,
    m: InboundViberMessage,
  ): Promise<InboundRecorded>;
  /** A user subscribed or opened the chat: the thread (and contact) exist from now on, so the user is in the broadcast audience. */
  ensureThread(orgId: number, channelRowId: number, user: ViberUserInfo): Promise<void>;
  /** A message we sent into a thread (a broadcast to that user): shown as outbound, moves the thread's last-sent time, leaves unread alone. */
  recordOutbound(
    tx: Tx,
    orgId: number,
    conversationId: number,
    m: { body: string; providerMessageId: string; broadcastUuid: string },
  ): Promise<void>;
  /** Moves the sent message the receipt is about (delivered, seen, failed) in the thread. */
  recordReceipt(orgId: number, channelRowId: number, r: ReceiptInput): Promise<void>;
}
export const INBOX_INGEST = Symbol('VIBER_INBOX_INGEST');

/** A Viber template: a row of `wa_templates` whose channel is viber (message-templates). */
export interface ViberTemplate {
  id: number;
  uuid: string;
  name: string;
  body: string;
  buttons: unknown;
}

/** Reads Viber templates until the templates domain exports a channel-aware lookup. */
export interface ViberTemplates {
  list(tx: Tx, orgId: number): Promise<ViberTemplate[]>;
  find(tx: Tx, orgId: number, uuid: string): Promise<ViberTemplate | undefined>;
}
export const VIBER_TEMPLATES = Symbol('VIBER_TEMPLATES');
