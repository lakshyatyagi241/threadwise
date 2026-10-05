import type { Tx } from '@crm/db';
import type { Normalized } from '../ingest-rules';

/**
 * Stand-ins for what other domains own. Each is an interface here and a default in `open-gates.ts`; when the owner exports the
 * real service, bind it to the same token in `channel-instagram.module.ts` and delete the default.
 */

/** The plan flag `access_instagram` (plans-subscriptions-trials). */
export interface InstagramPlanGate {
  /** Throws a PLAN_FEATURE_LOCKED problem when the plan does not include the Instagram channel. */
  assertChannel(orgId: number): Promise<void>;
  /** Throws when the plan does not include broadcasts (`broadcast`), which a reply-only send needs too. */
  assertBroadcast(orgId: number): Promise<void>;
}
export const INSTAGRAM_PLAN_GATE = Symbol('INSTAGRAM_PLAN_GATE');

/** A conversation of the team inbox, as the Instagram channel needs to see it. */
export interface ThreadRef {
  id: number;
  uuid: string;
  title: string;
  channel: string | null;
  rawJid: string | null;
}

export interface IngestOutcome {
  /** False when the message was already stored (the push and the pull both delivered it). */
  stored: boolean;
  conversationId: number;
  messageId: number | null;
  contactId: number | null;
  newThread: boolean;
}

/**
 * Writes an inbound or pulled Instagram message into the inbox (chat-conversations): the thread lives on the account's `instagram`
 * channel, keyed by the engine's thread key; the message is stored once through the shared pipeline (ledger dedup on the engine's
 * id, sequence, unread, realtime), and a genuine inbound's sender becomes a contact.
 */
export interface InstagramInboxIngest {
  record(orgId: number, n: Normalized): Promise<IngestOutcome>;
  /** The time of the last message of every Instagram thread we hold, by thread key: the pull skips a thread with nothing newer. */
  threadClock(tx: Tx, orgId: number): Promise<Map<string, Date | null>>;
  /** The threads with these public ids, whatever their channel (the caller checks that they are Instagram ones). */
  findThreads(tx: Tx, orgId: number, uuids: string[]): Promise<ThreadRef[]>;
  /** An account's threads, the newest customer message first. */
  threadsOfAccount(
    tx: Tx,
    orgId: number,
    accountId: string,
    limit: number,
  ): Promise<Array<{ uuid: string; title: string; lastInboundAt: Date | null }>>;
  /**
   * A message we sent into a thread, shown as outbound: the engine's id is the ledger key so the pull never shows it a second time,
   * the thread's last-sent time and preview move, and its unread count is left alone.
   */
  recordOutbound(
    tx: Tx,
    orgId: number,
    conversationId: number,
    m: { body: string; providerMessageId: string | null; userId: number | null },
  ): Promise<void>;
  /** A thread by its public id, whatever its channel (the caller checks that it is an Instagram one). */
  findThread(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; channel: string | null; rawJid: string | null } | undefined>;
}
export const INSTAGRAM_INBOX_INGEST = Symbol('INSTAGRAM_INBOX_INGEST');

export interface AutomationContext {
  orgId: number;
  conversationId: number;
  /** The thread key, `ig:<conversation id>`. */
  rawJid: string;
  /** The sender's id. */
  igsid: string;
  /** The Instagram account that received it, by the engine's id. */
  accountId: string;
  text: string;
  /** `dm_keyword`, `comment_to_dm`, `story_reply`, `story_mention` or `mention`. */
  trigger: string;
}

/**
 * What happens after a genuine inbound is stored: the keyword auto-reply rules (auto-reply-keywords). A failure is logged and never
 * blocks the stored message. WaDesk's flow hand-off for Instagram exists only in the native add-on (WD-IG-020); with the engine,
 * the engine runs the flows itself.
 */
export interface InstagramAutomation {
  automate(ctx: AutomationContext): Promise<void>;
}
export const INSTAGRAM_AUTOMATION = Symbol('INSTAGRAM_AUTOMATION');

/** An Instagram template: a row of `wa_templates` whose channel is instagram (message-templates). */
export interface InstagramTemplate {
  id: number;
  uuid: string;
  name: string;
  body: string;
  buttons: unknown[];
}

/** Reads Instagram templates until the templates domain exports a channel-aware lookup. */
export interface InstagramTemplates {
  list(tx: Tx, orgId: number): Promise<InstagramTemplate[]>;
  find(tx: Tx, orgId: number, uuid: string): Promise<InstagramTemplate | undefined>;
}
export const INSTAGRAM_TEMPLATES = Symbol('INSTAGRAM_TEMPLATES');
