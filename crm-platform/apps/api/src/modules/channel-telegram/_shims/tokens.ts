import type { Tx } from '@crm/db';

/**
 * Stand-ins for what other domains own. Each is an interface here and a default in `open-gates.ts`; when the owner exports the
 * real service, bind it to the same token in `channel-telegram.module.ts` and delete the default.
 */

/** The plan flags `access_telegram`, `telegram_broadcasts` and the `telegram_bots` cap (plans-subscriptions-trials). */
export interface TelegramPlanGate {
  /** Throws a PLAN_FEATURE_LOCKED problem when the plan does not include the Telegram channel. */
  assertChannel(orgId: number): Promise<void>;
  /** Throws when the plan does not include Telegram broadcasts. */
  assertBroadcasts(orgId: number): Promise<void>;
  /** Throws when the plan's bot cap is reached (Reference stores `telegram_bots_limit` and never enforces it). */
  assertBotCap(orgId: number, connected: number): Promise<void>;
}
export const TELEGRAM_PLAN_GATE = Symbol('TELEGRAM_PLAN_GATE');

/** One received Telegram message, ready to be written into the inbox (TW-TG-004). */
export interface InboundMessageInput {
  chatId: string;
  chatType: string;
  title: string;
  /** The Telegram user who wrote (the chat id for a channel post). */
  uid: string;
  fromId: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  messageId: string | null;
  text: string;
  mediaType: string | null;
  mediaPath: string | null;
  fileId: string | null;
  /** `successful_payment` rows carry the payment facts and run no automation. */
  event: 'successful_payment' | null;
  payment: Record<string, unknown> | null;
}

export interface InboundRecorded {
  conversationId: number;
  contactId: number | null;
  /** The contact was created by this message (its avatar is fetched once). */
  newContact: boolean;
  /** The thread was created by this message. */
  newThread: boolean;
}

/**
 * Writes an inbound message into the team inbox (team-inbox-conversations): finds or creates the `channel = telegram` thread
 * keyed by bot and chat, links a contact, stores the message, moves the thread (preview, unread, reopen). The inbox domain also
 * owns the live "message received" push; until it exports this, `SqlInboxIngest` does the writes only.
 */
export interface InboxIngest {
  recordInbound(
    tx: Tx,
    orgId: number,
    botRowId: number,
    m: InboundMessageInput,
  ): Promise<InboundRecorded>;
  setContactImage(tx: Tx, orgId: number, contactId: number, url: string): Promise<void>;
}
export const INBOX_INGEST = Symbol('TELEGRAM_INBOX_INGEST');

/** Our own storage for files Telegram holds (platform-settings-branding-storage). Never the tokened Telegram URL. */
export interface MediaStore {
  /** False until the storage domain exports an upload: media is then not downloaded and a message carries no file. */
  readonly enabled: boolean;
  /** The stored path or public URL, or null when it could not be saved. */
  save(orgId: number, bytes: Uint8Array, extension: string): Promise<string | null>;
}
export const MEDIA_STORE = Symbol('TELEGRAM_MEDIA_STORE');

export interface InboundContext {
  orgId: number;
  botRowId: number;
  conversationId: number;
  chatId: string;
  text: string;
  fromId: string | null;
  /** The thread did not exist before this message. */
  newThread: boolean;
}

/**
 * What happens after a message is stored (flow-runtime-engine, team-inbox routing, AI agents, keyword auto-reply). The order is
 * Reference's: a flow gets the message first; only when no flow consumed it do routing, the assigned AI agent or a keyword reply run.
 * Each returns without throwing; a failure is logged and never blocks the stored message.
 */
export interface InboundHooks {
  /** True when a flow consumed the message, so nothing else replies. */
  handoffToFlow(ctx: InboundContext): Promise<boolean>;
  /** Routing rules, then the assigned AI agent, else keyword auto-reply. */
  automate(ctx: InboundContext): Promise<void>;
  /** A successful payment: resumes a flow parked on a block-until-paid Payment node. */
  resumePaid(
    ctx: InboundContext,
    payment: { amountDisplay: string; currency: string; chargeId: string; payload: string },
  ): Promise<void>;
}
export const INBOUND_HOOKS = Symbol('TELEGRAM_INBOUND_HOOKS');
