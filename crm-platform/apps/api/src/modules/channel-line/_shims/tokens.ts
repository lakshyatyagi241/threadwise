import type { Tx } from '@crm/db';

/**
 * Stand-ins for what other domains own. Each is an interface here and a default in `open-gates.ts`; when the owner exports the
 * real service, bind it to the same token in `channel-line.module.ts` and delete the default.
 */

/** One received LINE event, ready to be written into the inbox. */
export interface InboundMessageInput {
  /** `user`, `group` or `room`. */
  sourceType: string;
  /** The thread key: the user id, or the group or room id. */
  sourceId: string;
  /** The person who wrote, when LINE says (a user id; it is the thread key in a 1:1 chat). */
  userId: string | null;
  /** The sender's LINE display name, or `LINE user` when it is unknown; the title of a new 1:1 thread. */
  title: string;
  pictureUrl: string | null;
  /** What makes a redelivery a no-op: LINE's message id, or `pb:<webhook event id>` for a postback. */
  providerMessageId: string;
  /** LINE's message id (none for a postback). */
  messageId: string | null;
  text: string;
  mediaType: 'image' | 'video' | 'audio' | 'document' | null;
  /** The id the file is downloaded with. */
  mediaMessageId: string | null;
  fileName: string | null;
  replyToken: string | null;
  webhookEventId: string | null;
}

export interface InboundRecorded {
  /** False when LINE's message was already stored (a redelivery). */
  stored: boolean;
  conversationId: number;
  contactId: number | null;
  /** The contact was created by this message. */
  newContact: boolean;
  /** The thread was created by this message. */
  newThread: boolean;
}

/**
 * Writes into the inbox (chat-conversations): the thread lives on the channel's `line` inbox channel, keyed by the LINE user id, and
 * the message goes through the same pipeline a Cloud API webhook feeds (ledger, sequence, unread, reopen, realtime). A contact is linked.
 */
export interface InboxIngest {
  recordInbound(
    orgId: number,
    channelRowId: number,
    m: InboundMessageInput,
  ): Promise<InboundRecorded>;
  /** A message we sent into a thread (a broadcast to that person): shown as outbound, moves the thread's last-sent time, leaves unread alone. */
  recordOutbound(
    tx: Tx,
    orgId: number,
    conversationId: number,
    m: { body: string; providerMessageId: string | null; broadcastUuid: string },
  ): Promise<void>;
}
export const INBOX_INGEST = Symbol('LINE_INBOX_INGEST');

export interface InboundContext {
  orgId: number;
  channelRowId: number;
  conversationId: number;
  /** The thread key. */
  sourceId: string;
  sourceType: string;
  text: string;
  /** The reply token of this event (free to answer with for about a minute). */
  replyToken: string | null;
  /** The thread did not exist before this message. */
  newThread: boolean;
}

/**
 * What happens after a message is stored (flow-runtime-engine, team-inbox routing, AI agents, keyword auto-reply). The order is
 * Reference's: a flow gets the message first (1:1 chats only); only when no flow consumed it do routing, the assigned AI agent or a
 * keyword reply run. Each returns without throwing; a failure is logged and never blocks the stored message.
 */
export interface InboundHooks {
  /** True when a flow consumed the message, so nothing else replies. */
  handoffToFlow(ctx: InboundContext): Promise<boolean>;
  /** Routing rules, then the assigned AI agent, else keyword auto-reply. */
  automate(ctx: InboundContext): Promise<void>;
}
export const INBOUND_HOOKS = Symbol('LINE_INBOUND_HOOKS');

/** A LINE template: a row of `wa_templates` whose channel is line (message-templates). */
export interface LineTemplateRow {
  id: number;
  uuid: string;
  name: string;
  body: string;
  buttons: unknown;
}

/** Reads LINE templates until the templates domain exports a channel-aware lookup. */
export interface LineTemplates {
  list(tx: Tx, orgId: number): Promise<LineTemplateRow[]>;
  find(tx: Tx, orgId: number, uuid: string): Promise<LineTemplateRow | undefined>;
}
export const LINE_TEMPLATES = Symbol('LINE_TEMPLATES');
