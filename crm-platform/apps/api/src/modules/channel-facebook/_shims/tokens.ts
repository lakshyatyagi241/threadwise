import type { Tx } from '@crm/db';

/**
 * Stand-ins for what other domains own. Each is an interface here and a default in `open-gates.ts`; when the owner exports the
 * real service, bind it to the same token in `channel-facebook.module.ts` and delete the default.
 */

/** The plan flags `access_facebook`, `facebook_posts`, `facebook_ai_agent` and the page cap (plans-subscriptions-trials). */
export interface FacebookPlanGate {
  /** Throws a PLAN_FEATURE_LOCKED problem when the plan does not include the Facebook channel (`access_facebook`). */
  assertChannel(orgId: number): Promise<void>;
  /** Throws when the plan does not include posting (`facebook_posts`): composer, posts, my posts, insights. */
  assertPosts(orgId: number): Promise<void>;
  /** Throws when the plan's Page cap is reached (Reference stores `facebook_pages_limit` and never enforces it). */
  assertPageCap(orgId: number, connected: number): Promise<void>;
  /** The AI agent may answer a Facebook thread only when the plan says so (`facebook_ai_agent`, enforced in Reference). */
  aiAgentAllowed(orgId: number): Promise<boolean>;
}
export const FACEBOOK_PLAN_GATE = Symbol('FACEBOOK_PLAN_GATE');

/** One received Facebook message or comment, ready to be written into the inbox (TW-FB-007, 009, 010). */
export interface InboundInput {
  kind: 'dm' | 'comment';
  /** Meta's Page id and the Page's name: they name the inbox channel the thread belongs to. */
  pageId: string;
  pageName: string;
  /** The thread key: `fb:<page>:<psid>` or `fb:<page>:post:<post>:<commenter>`. */
  rawJid: string;
  /** The thread title when it is created; a DM starts as a placeholder until the sender's name is known. */
  title: string;
  /** The PSID (a DM) or the commenter's id. */
  senderId: string;
  body: string;
  mediaType: string | null;
  mediaUrl: string | null;
  /** Meta's id (mid or comment id): a message already stored with it is dropped. */
  dedup: string;
  /** Meta's time of the message; now when it sent none. */
  at: Date | null;
  /** What goes under `meta.facebook`. */
  meta: Record<string, unknown>;
}

export interface InboundRecorded {
  /** False when the Meta id was already stored. */
  stored: boolean;
  /** `conversations.id`, 0 when nothing was stored. */
  conversationId: number;
  /** Always null: the inbox does not create a contact for a Messenger sender (it has no phone or email to match on). */
  contactId: number | null;
  newThread: boolean;
}

/**
 * Writes into the inbox (chat-conversations): the thread lives on the Page's `facebook` channel, keyed by the thread key, and the
 * message goes through the same pipeline a Cloud API webhook feeds (ledger, sequence, unread, 24 hour window, realtime).
 */
export interface InboxIngest {
  recordInbound(orgId: number, input: InboundInput): Promise<InboundRecorded>;
  /** Has this Meta id already been stored in this organization? Checked BEFORE any Graph call. */
  alreadyStored(tx: Tx, orgId: number, dedup: string): Promise<boolean>;
  /** The sender's name and picture, learned once when a thread is created. */
  applyProfile(
    tx: Tx,
    orgId: number,
    conversationId: number,
    contactId: number | null,
    p: { name: string; avatarUrl: string | null },
  ): Promise<void>;
  /** A message we sent into a thread (a broadcast): shown as outbound, moves the thread's last-sent time, leaves unread alone. */
  recordOutbound(
    tx: Tx,
    orgId: number,
    conversationId: number,
    m: { body: string; providerMessageId: string | null; broadcastUuid: string },
  ): Promise<void>;
  /** When the person last wrote in this thread (the 24 hour window runs from here), or null. */
  lastInboundAt(tx: Tx, orgId: number, conversationId: number): Promise<Date | null>;
}
export const INBOX_INGEST = Symbol('FACEBOOK_INBOX_INGEST');

/** A Facebook template: a row of `wa_templates` whose channel is facebook (message-templates). */
export interface FacebookTemplate {
  id: number;
  uuid: string;
  name: string;
  body: string;
  buttons: unknown;
}

/** Reads Facebook templates until the templates domain exports a channel-aware lookup. */
export interface FacebookTemplates {
  list(tx: Tx, orgId: number): Promise<FacebookTemplate[]>;
  find(tx: Tx, orgId: number, uuid: string): Promise<FacebookTemplate | undefined>;
}
export const FACEBOOK_TEMPLATES = Symbol('FACEBOOK_TEMPLATES');

export interface InboundContext {
  orgId: number;
  pageRowId: number;
  /** Meta's Page id. */
  pageId: string;
  /** The stored thread; null for a postback (a tap is never stored). */
  conversationId: number | null;
  /** The PSID. */
  psid: string;
  text: string;
  /** The thread did not exist before this message. */
  newThread: boolean;
}

/**
 * What happens after a DM is stored (flow-runtime-engine, team-inbox routing, AI agents, keyword auto-reply). The order is Reference's:
 * a flow gets the message first; only when no flow consumed it do routing, the assigned AI agent or a keyword reply run. Each
 * returns without throwing; a failure is logged and never blocks the stored message.
 */
export interface InboundHooks {
  /**
   * True when a flow consumed the message, so nothing else replies. `postback` is a button tap, Get Started or an ice breaker: it
   * resumes a parked flow or starts a keyword flow, and is never stored.
   */
  handoffToFlow(ctx: InboundContext & { postback: boolean }): Promise<boolean>;
  /** Routing rules, then the assigned AI agent (only if `FacebookPlanGate.aiAgentAllowed`), else keyword auto-reply. */
  automate(ctx: InboundContext): Promise<void>;
}
export const INBOUND_HOOKS = Symbol('FACEBOOK_INBOUND_HOOKS');
