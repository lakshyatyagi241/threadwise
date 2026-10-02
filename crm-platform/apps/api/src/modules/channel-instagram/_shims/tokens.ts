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
}
export const INSTAGRAM_PLAN_GATE = Symbol('INSTAGRAM_PLAN_GATE');

export interface IngestOutcome {
  /** False when the message was already stored (the push and the pull both delivered it). */
  stored: boolean;
  conversationId: number;
  messageId: number | null;
  contactId: number | null;
  newThread: boolean;
}

/**
 * Writes an inbound or pulled Instagram message into the team inbox (team-inbox-conversations): finds or creates the
 * `channel = instagram` thread, stores the message once, moves the thread (preview, unread, the 24 hour window) and links a contact
 * for a genuine inbound. The inbox domain also owns the live "message received" push; until it exports this, `SqlInstagramIngest`
 * does the writes only.
 */
export interface InstagramInboxIngest {
  record(tx: Tx, orgId: number, n: Normalized): Promise<IngestOutcome>;
  /** The time of the last message of every Instagram thread we hold, by thread key: the pull skips a thread with nothing newer. */
  threadClock(tx: Tx, orgId: number): Promise<Map<string, Date | null>>;
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
 * blocks the stored message. Reference's flow hand-off for Instagram exists only in the native add-on (TW-IG-020); with the engine,
 * the engine runs the flows itself.
 */
export interface InstagramAutomation {
  automate(ctx: AutomationContext): Promise<void>;
}
export const INSTAGRAM_AUTOMATION = Symbol('INSTAGRAM_AUTOMATION');
