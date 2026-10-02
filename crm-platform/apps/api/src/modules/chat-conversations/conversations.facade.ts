/**
 * The door other domains will use to reach conversations (plan-inbox-chat.md sections 3.1 and 5.1): `recordOutbound` (a broadcast, an
 * appointment reminder or a flow wrote a message into a thread), `openConversationFor` (find or create the perpetual thread of a
 * contact on a channel) and `findThread`.
 *
 * Declared here as the contract so callers can be written against it; the implementation lands with the message store and the ingest
 * pipeline (Phase 1), which need the reshaped conversations table. Nothing binds `CONVERSATIONS_FACADE` yet, so injecting it fails at
 * boot rather than at the first call.
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

export interface ConversationsFacade {
  openConversationFor(contactId: string, channelId: string): Promise<ThreadRef>;
  findThread(channelId: string, peerKey: string): Promise<ThreadRef | null>;
  recordOutbound(input: RecordOutboundInput): Promise<{ messageId: string; thread: ThreadRef }>;
}

export const CONVERSATIONS_FACADE = Symbol('CONVERSATIONS_FACADE');
