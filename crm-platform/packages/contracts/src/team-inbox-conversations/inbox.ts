import { z } from 'zod';
import { conversationStatusSchema } from '../common/enums';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema, pageResponseSchema } from '../common/pagination';
import {
  conversationChannelSchema,
  conversationDetailSchema,
  conversationTagSchema,
} from '../chat-conversations/conversation';
import type { ConversationStatus } from '../chat-conversations/enums';

/**
 * team-inbox-conversations: what the agent-facing inbox adds on top of the conversation core's shapes
 * (`chat-conversations/`: the list row, the message, the note, the send and read bodies). Routes: docs/api/team-inbox-conversations.md.
 */

// --- the status state machine ---------------------------------------------------------------------------------------------

/**
 * Where a conversation can go from where it is, by an agent's hand (the status route). The same table drives the API (which refuses
 * anything else with `CONVERSATION_STATUS_INVALID`) and the web (which offers only these buttons). A move to the status the thread
 * already has is a no-op, not an error: resolving twice does not run the side effects twice.
 *
 *   open     -> resolved, closed
 *   snoozed  -> open (wake it now), resolved, closed
 *   resolved -> open (reopen), closed
 *   closed   -> open (reopen), resolved
 *   spam     -> open (not spam)
 *
 * `snoozed` and `spam` are never a target here: they have their own routes (a time to wake at, a reason).
 */
const MOVES: Record<ConversationStatus, readonly ConversationStatus[]> = {
  open: ['resolved', 'closed'],
  snoozed: ['open', 'resolved', 'closed'],
  resolved: ['open', 'closed'],
  closed: ['open', 'resolved'],
  spam: ['open'],
};

export function canMoveConversationStatus(
  from: ConversationStatus,
  to: ConversationStatus,
): boolean {
  return from === to || MOVES[from].includes(to);
}

// --- detail -------------------------------------------------------------------------------------------------------------

/** The linked contact as the side panel shows it. Read through the contacts barrel; the panel links to the contact for the rest. */
export const inboxContactSummarySchema = z.object({
  id: uuidSchema,
  displayId: z.string().nullable(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  lifecycleStage: z.string().nullable(),
  status: z.string().nullable(),
  ownerName: z.string().nullable(),
  source: z.string().nullable(),
  isUnsubscribed: z.boolean(),
  whatsappSubscriptionStatus: z.string().nullable(),
  /** AI lead scoring: the contact's score and who set it, the same fields the contact page reads (null: never scored). */
  leadScore: z.number().int().min(0).max(100).nullable(),
  leadScoreSource: z.enum(['manual', 'ai']).nullable(),
  leadScoreReasons: z.array(z.string()).nullable(),
  leadScoredAt: z.string().datetime().nullable(),
  leadScoreModel: z.string().nullable(),
  createdAt: z.string().datetime(),
  /**
   * The contact's own tags (they describe the person: VIP, lead, region), from the same workspace tag library as the thread's tags.
   * Read-only here; they are edited on the contact.
   */
  contactTags: z.array(conversationTagSchema).default([]),
});
export type InboxContactSummary = z.infer<typeof inboxContactSummarySchema>;

/** Another thread with the same contact (Reference's "past conversations"), at most 20, newest first, only ones the caller may see. */
export const pastConversationSchema = z.object({
  id: uuidSchema,
  channel: conversationChannelSchema,
  title: z.string(),
  preview: z.string().nullable(),
  status: conversationStatusSchema,
  lastMessageAt: z.string().datetime().nullable(),
});
export type PastConversation = z.infer<typeof pastConversationSchema>;

export const inboxConversationDetailSchema = conversationDetailSchema.extend({
  /** Null when the thread has no contact record (the quota was reached, or the number was never saved). */
  contactSummary: inboxContactSummarySchema.nullable(),
  pastConversations: z.array(pastConversationSchema),
});
export type InboxConversationDetail = z.infer<typeof inboxConversationDetailSchema>;

// --- read state ---------------------------------------------------------------------------------------------------------

/** `POST .../read` answers with where the counter stands afterwards (it never goes up, and never below what is still unread). */
export const markConversationReadResponseSchema = z.object({
  conversationId: uuidSchema,
  unreadCount: z.number().int().nonnegative(),
});
export type MarkConversationReadResponse = z.infer<typeof markConversationReadResponseSchema>;

// --- notes --------------------------------------------------------------------------------------------------------------

/** Notes, newest first. A thread rarely has more than a handful; the cursor exists so one that does cannot load them all. */
export const listConversationNotesQuerySchema = paginationQuerySchema.pick({
  limit: true,
  cursor: true,
});
export type ListConversationNotesQuery = z.infer<typeof listConversationNotesQuerySchema>;

// --- timeline -----------------------------------------------------------------------------------------------------------

/**
 * What the timeline records. The inbox writes the first group; routing, SLA and automation write the rest, so the list is open: the
 * wire type is a plain string and a client shows an unknown one with its underscores turned into spaces (as Reference does).
 */
export const CONVERSATION_EVENT_TYPES = [
  'created',
  'assigned',
  'reassigned',
  'unassigned',
  'ai_handoff',
  'resolved',
  'closed',
  'reopened',
  'status_changed',
  'note_added',
  'snoozed',
  'auto_unsnoozed',
  'spam_flagged',
  'escalated',
  'priority_changed',
  'tag_added',
  'tag_removed',
  'first_response',
  'sla_breach',
  'handoff_returned',
  'bot_resumed',
  'bot_resume_skipped',
  'handoff_requested',
  'queue_reminded',
  'queue_offered',
  'queue_customer_message',
] as const;
export type ConversationEventType = (typeof CONVERSATION_EVENT_TYPES)[number];

export const CONVERSATION_EVENT_ACTORS = ['user', 'system', 'bot', 'flow', 'ai'] as const;
export const conversationEventActorKindSchema = z.enum(CONVERSATION_EVENT_ACTORS);
export type ConversationEventActorKind = z.infer<typeof conversationEventActorKindSchema>;

export const conversationEventSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  type: z.string(),
  actor: z.object({
    kind: conversationEventActorKindSchema,
    /** The staff member, for `kind: 'user'`. Null when the user was removed or the actor is not a person. */
    userId: uuidSchema.nullable(),
    name: z.string().nullable(),
  }),
  /** Type-specific details with ids as uuids (`from`/`to` status, the previous and new assignee, the note id). */
  payload: z.record(z.unknown()),
  createdAt: z.string().datetime(),
});
export type ConversationEvent = z.infer<typeof conversationEventSchema>;

export const listConversationEventsQuerySchema = paginationQuerySchema.pick({
  limit: true,
  cursor: true,
});
export type ListConversationEventsQuery = z.infer<typeof listConversationEventsQuerySchema>;
export const conversationEventListResponseSchema = pageResponseSchema(conversationEventSchema);
export type ConversationEventListResponse = z.infer<typeof conversationEventListResponseSchema>;

// --- attachments --------------------------------------------------------------------------------------------------------

/** A file waits this long for the message that uses it; after that the reference is gone and the file may be swept. */
export const INBOX_MEDIA_UPLOAD_TTL_HOURS = 24;

export const inboxMediaKindSchema = z.enum(['image', 'video', 'audio', 'document']);
export type InboxMediaKind = z.infer<typeof inboxMediaKindSchema>;

/**
 * `POST /inbox/media` (multipart, field `file`): the answer. Send the `id` as `mediaId` of a `kind: 'media'` message. The file is checked
 * by content (a renamed script is refused), not by what the browser called it, and held for the agent who uploaded it.
 */
export const inboxMediaUploadSchema = z.object({
  id: uuidSchema,
  kind: inboxMediaKindSchema,
  mime: z.string(),
  name: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  /** A link for a preview in the composer: authenticated, valid for minutes. Do not store it. */
  previewUrl: z.string(),
  expiresAt: z.string().datetime(),
});
export type InboxMediaUpload = z.infer<typeof inboxMediaUploadSchema>;

/**
 * `POST /v2/inbox/conversations/open`: the conversation for a contact on a channel, created when there is none yet (a phone channel
 * and a contact with a number). The first message to a contact outside the 24 hour window must then be a template.
 */
export const openConversationSchema = z.object({
  contactId: z.string().uuid(),
  channelId: z.string().uuid(),
});
export type OpenConversationInput = z.infer<typeof openConversationSchema>;
