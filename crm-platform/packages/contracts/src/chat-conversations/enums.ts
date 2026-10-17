import { z } from 'zod';

/**
 * chat-conversations: the vocabulary of a thread and its messages. These mirror the CHECK constraints of `conversations` and
 * `messages` (migrations 20261014100000 and 20261014100100); the Drizzle schema and the database agree on the same lists.
 */

// --- conversation -------------------------------------------------------------------------------------------------------

/**
 * One lifecycle (Reference kept a Quick Send status and an inbox status side by side). `closed` stays because Reference's inbox can reach it
 * separately from `resolved`. Reference's `pending` (waiting on the customer) is removed by the owner's decision.
 */
export const CONVERSATION_STATUSES = ['open', 'snoozed', 'resolved', 'closed', 'spam'] as const;
/** The zod schema is `conversationStatusSchema` in common/enums.ts (the platform's mirror of the legal values). */
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const CONVERSATION_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const conversationPrioritySchema = z.enum(CONVERSATION_PRIORITIES);
export type ConversationPriority = z.infer<typeof conversationPrioritySchema>;

/** The tabs of the list. `mine` is assigned to the caller, `unassigned` has no human assignee, `unread` has unread messages. */
export const INBOX_TABS = ['all', 'mine', 'unassigned', 'unread'] as const;
export const inboxTabSchema = z.enum(INBOX_TABS);
export type InboxTab = z.infer<typeof inboxTabSchema>;

// --- message ------------------------------------------------------------------------------------------------------------

export const MESSAGE_DIRECTIONS = ['in', 'out'] as const;
export const messageDirectionSchema = z.enum(MESSAGE_DIRECTIONS);
export type MessageDirection = z.infer<typeof messageDirectionSchema>;

export const MESSAGE_KINDS = [
  'text',
  'image',
  'video',
  'audio',
  'voice',
  'document',
  'sticker',
  'location',
  'contact',
  'template',
  'reaction',
  'interactive',
  'system',
] as const;
export const messageKindSchema = z.enum(MESSAGE_KINDS);
export type MessageKind = z.infer<typeof messageKindSchema>;

/** Kinds that carry a stored file (`media`). */
export const MEDIA_MESSAGE_KINDS = [
  'image',
  'video',
  'audio',
  'voice',
  'document',
  'sticker',
] as const;

/**
 * Who produced a message. `customer` is the peer, `agent` a staff user, `bot` an automation or AI agent, `system` a line the
 * platform wrote into the thread, `broadcast` a campaign send mirrored into the thread.
 */
export const MESSAGE_SENDER_KINDS = ['customer', 'agent', 'bot', 'system', 'broadcast'] as const;
export const messageSenderKindSchema = z.enum(MESSAGE_SENDER_KINDS);
export type MessageSenderKind = z.infer<typeof messageSenderKindSchema>;

/** `received` is the only status an inbound message has; an outbound one starts `queued` and only moves forward. */
export const MESSAGE_STATUSES = [
  'received',
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
] as const;
export const messageStatusSchema = z.enum(MESSAGE_STATUSES);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

const RANK = { queued: 0, sent: 1, delivered: 2, read: 3 } as const;

/**
 * The receipt rule, shared by the API (which enforces it with a conditional UPDATE) and the web (which must not draw a tick going
 * backwards): a status only moves forward queued < sent < delivered < read; `failed` is reachable only from queued or sent and never
 * replaces delivered or read; nothing leaves `failed` except a retry, which is a new `queued` attempt and not a receipt.
 */
export function canAdvanceMessageStatus(from: MessageStatus, to: MessageStatus): boolean {
  if (from === 'received' || to === 'received' || from === 'failed') return false;
  if (to === 'failed') return from === 'queued' || from === 'sent';
  return RANK[to] > RANK[from];
}

/** Everything the dispatcher and the receipts record about a message, in the order a normal send goes through them. */
export const MESSAGE_EVENT_TYPES = [
  'queued',
  'attempt',
  'retry',
  'sent',
  'delivered',
  'read',
  'failed',
] as const;
export const messageEventTypeSchema = z.enum(MESSAGE_EVENT_TYPES);
export type MessageEventType = z.infer<typeof messageEventTypeSchema>;
