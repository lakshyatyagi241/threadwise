import type { ListMessagesQuery, MessageListResponse, MessageResponse } from '@crm/contracts';

/**
 * The door other domains use to reach conversations (plan-inbox-chat.md sections 3.1 and 5.1). The team-inbox read model and its
 * actions (team-inbox-conversations) never touch `messages`, `message_ledger` or `message_events` themselves: they call this.
 *
 * Every method runs under the ambient request context (the caller's workspace, through `DatabaseService.tx`), opens its own
 * transaction, and speaks uuids on the wire. None of them knows about read scopes: **the caller decides whether the person may see
 * the conversation (the read-model's visibility rule, `conversationVisible`) before it calls**, exactly as it does for its own reads.
 *
 * Bound to `CONVERSATIONS_FACADE` by `ChatConversationsModule`.
 */

export interface ThreadRef {
  /** Conversation uuid. */
  id: string;
  channelId: string;
  peerKey: string;
}

export interface RecordOutboundInput {
  channelId: string;
  /** The peer on the channel; the thread is found or created from (channel, peer). */
  peerKey: string;
  contactId?: string;
  /** What produced the message: broadcast, appointment, flow, auto_reply, ... (the thread shows where it came from). */
  source: string;
  body: string;
  /** The provider's id once it accepted the message; the ledger makes a repeated call with the same id a no-op. */
  providerMessageId?: string;
}

// --- sending from the inbox ---------------------------------------------------------------------------------------------

/** A file already stored by `ChatMediaStore.store` (the inbox upload route): the key is the only locator, never a URL. */
export interface OutboundMediaRef {
  key: string;
  mime: string;
  size: number;
  name: string;
  sha256: string;
}

export type OutboundContent =
  | { kind: 'text'; body: string }
  | { kind: 'media'; media: OutboundMediaRef; caption?: string }
  /** The caller resolved the template (the TPL domain owns `wa_templates`); `body` is what the thread shows. */
  | {
      kind: 'template';
      name: string;
      language: string;
      variables: Record<string, string>;
      body: string;
      templateId?: number | null;
    };

export interface EnqueueOutboundInput {
  /** Conversation uuid. */
  conversationId: string;
  /** The sender's own uuid for the message: the idempotency key. The same id twice returns the first message and sends once. */
  clientMessageId: string;
  content: OutboundContent;
  /** `id` of the message this one answers. */
  replyToMessageId?: string;
  /** Who wrote it. Defaults to the caller (`agent`). */
  sender?: { kind: 'agent' | 'bot'; userId?: number | null; agentId?: number | null };
}

export interface EnqueueOutboundResult {
  /** The stored `queued` message (or, for a replay, the first one as it is now). */
  message: MessageResponse;
  /** True when `clientMessageId` had been seen: nothing was created or queued. */
  replayed: boolean;
}

export interface ConversationsFacade {
  openConversationFor(contactId: string, channelId: string): Promise<ThreadRef>;
  findThread(channelId: string, peerKey: string): Promise<ThreadRef | null>;
  recordOutbound(input: RecordOutboundInput): Promise<{ messageId: string; thread: ThreadRef }>;

  /**
   * `POST /inbox/conversations/:id/messages`: guards, stores a `queued` message and hands it to the dispatch worker. Nothing is sent
   * from here (the answer is 202 with this message; the worker sends, and ticks arrive by realtime).
   *
   * Refused before anything is stored: `CHANNEL_DISCONNECTED`, `CHANNEL_CAPABILITY_UNSUPPORTED`, `SERVICE_WINDOW_CLOSED` (a
   * free-form message outside the 24 hour window), `PLAN_LIMIT_REACHED` (monthly message cap). The emergency halt and the content
   * screen are checked at send time by the worker, so a halt also stops what is already queued (the message ends `failed`,
   * `AUTH_SEND_HALTED`, with a Retry).
   */
  enqueueOutbound(input: EnqueueOutboundInput): Promise<EnqueueOutboundResult>;

  /**
   * `POST /inbox/messages/:id/retry`: puts a `failed` outbound message back in the queue (same guards as a new send).
   * `MESSAGE_NOT_FOUND`, `MESSAGE_NOT_RETRYABLE` (only a failed outbound message can be retried).
   */
  retryOutbound(messageId: string): Promise<MessageResponse>;

  /**
   * `GET /inbox/conversations/:id/messages`: a thread page, ascending by `seq`, gap-free. Media carry a short-lived authenticated
   * url minted for the caller. `CONVERSATION_NOT_FOUND` when the uuid is not in this workspace.
   */
  listMessages(conversationId: string, query: ListMessagesQuery): Promise<MessageListResponse>;

  /**
   * `POST /inbox/conversations/:id/read`: sets `unread_count` to the number of customer messages after `upToSeq`, so a message that
   * arrived while the agent was reading stays unread. Tells the caller's other tabs by realtime (`inbox.unread`).
   */
  markRead(conversationId: string, upToSeq: number): Promise<{ unreadCount: number }>;
}

export const CONVERSATIONS_FACADE = Symbol('CONVERSATIONS_FACADE');
