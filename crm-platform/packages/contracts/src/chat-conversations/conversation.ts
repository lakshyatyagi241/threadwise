import { z } from 'zod';
import { conversationStatusSchema } from '../common/enums';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema, pageResponseSchema } from '../common/pagination';
import { channelCapabilitiesSchema } from './channels';
import { conversationPrioritySchema, inboxTabSchema } from './enums';

/**
 * chat-conversations: the conversation (thread) as the inbox list and the thread header read it (plan-inbox-chat.md section 3.3).
 *
 * One perpetual thread per (channel, peer). The contact link is optional: a thread exists before, or without, a contact.
 */

/** The channel a thread sits on. `kind` is a plain string: a thread can sit on a kind this client has not heard of. */
export const conversationChannelSchema = z.object({
  id: uuidSchema,
  kind: z.string().min(1),
  name: z.string(),
});
export type ConversationChannel = z.infer<typeof conversationChannelSchema>;

export const conversationContactSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
});
export type ConversationContact = z.infer<typeof conversationContactSchema>;

/**
 * Who a conversation is assigned to. The shape the assignment domain (team-inbox-routing-sla) fills; the conversation core only
 * reads it. Every part is nullable: unassigned, or assigned to a team only, or handled by an AI agent.
 */
export const conversationAssignmentSchema = z.object({
  user: z.object({ id: uuidSchema, name: z.string().nullable() }).nullable(),
  team: z.object({ id: uuidSchema, name: z.string(), color: z.string().nullable() }).nullable(),
  aiAgent: z.object({ id: uuidSchema, name: z.string() }).nullable(),
});
export type ConversationAssignment = z.infer<typeof conversationAssignmentSchema>;

/**
 * `POST /inbox/conversations/:id/status`: resolve, close, reopen, or park a thread as pending (waiting on the customer). The legal moves are
 * `canMoveConversationStatus` below. Snooze and spam have their own routes (they carry a time or a reason).
 */
export const SETTABLE_CONVERSATION_STATUSES = ['open', 'pending', 'resolved', 'closed'] as const;
export const setConversationStatusSchema = z.object({
  rowVersion: z.number().int().positive(),
  status: z.enum(SETTABLE_CONVERSATION_STATUSES),
});
export type SetConversationStatusInput = z.infer<typeof setConversationStatusSchema>;

/** `POST /inbox/conversations/:id/read`: clear the unread counter up to a message (`seq`), so a message that arrived meanwhile stays unread. */
export const markConversationReadSchema = z.object({
  upToSeq: z.number().int().nonnegative(),
});
export type MarkConversationReadInput = z.infer<typeof markConversationReadSchema>;

// --- list ---------------------------------------------------------------------------------------------------------------

export const conversationSummarySchema = z.object({
  id: uuidSchema,
  channel: conversationChannelSchema,
  /** The peer on that channel: digits for phone channels, the channel's own thread id otherwise. */
  peerKey: z.string(),
  peerName: z.string().nullable(),
  /** What the list shows as the name (the contact's, else the peer's, else the number). */
  title: z.string(),
  preview: z.string().nullable(),
  status: conversationStatusSchema,
  priority: conversationPrioritySchema,
  archived: z.boolean(),
  pinned: z.boolean(),
  muted: z.boolean(),
  unreadCount: z.number().int().nonnegative(),
  /** The thread has no contact record because the contact quota was reached. */
  needsContact: z.boolean(),
  contact: conversationContactSchema.nullable(),
  assignment: conversationAssignmentSchema,
  snoozedUntil: z.string().datetime().nullable(),
  lastMessageAt: z.string().datetime().nullable(),
  lastInboundAt: z.string().datetime().nullable(),
  lastOutboundAt: z.string().datetime().nullable(),
  /** The highest message `seq`; a client that holds fewer messages has a gap to fill. */
  lastSeq: z.number().int().nonnegative(),
  /** Free-form replies are allowed until this instant; null when the channel has no window rule. */
  windowExpiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const listConversationsQuerySchema = paginationQuerySchema.extend({
  tab: inboxTabSchema.default('all'),
  /** Omitted: the open and pending threads (Reference's default view). `all` removes the filter. */
  status: z.union([conversationStatusSchema, z.literal('all')]).optional(),
  channelId: uuidSchema.optional(),
  /** Contact name, peer name or number, or a word of the preview. */
  q: z.string().trim().min(1).max(200).optional(),
  /** The archive view: every archived thread, whatever the tab or status. A query string, so `false` must mean false (`z.coerce.boolean` reads any non-empty string as true). */
  archived: z
    .enum(['true', 'false', '1', '0'])
    .transform((v) => v === 'true' || v === '1')
    .default('false'),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

/** Tab badges and the archived count; also what the safety poll of `GET /inbox/counts` returns. */
export const inboxCountsSchema = z.object({
  all: z.number().int().nonnegative(),
  mine: z.number().int().nonnegative(),
  unassigned: z.number().int().nonnegative(),
  unread: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
});
export type InboxCounts = z.infer<typeof inboxCountsSchema>;

/** The standard `{ data, page }` list envelope, plus the tab counts for the same visibility scope. */
export const conversationListResponseSchema = pageResponseSchema(conversationSummarySchema).extend({
  meta: z.object({ counts: inboxCountsSchema }),
});
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;

// --- detail -------------------------------------------------------------------------------------------------------------

/** The 24 hour rule as the composer needs it: can a free-form message be sent right now, and until when. */
export const serviceWindowSchema = z.object({
  /** False means only a template may be sent. Always true on a channel with no window rule. */
  open: z.boolean(),
  /** Null when the channel has no window rule or the customer never wrote. */
  expiresAt: z.string().datetime().nullable(),
});
export type ServiceWindow = z.infer<typeof serviceWindowSchema>;

export const conversationDetailSchema = conversationSummarySchema.extend({
  /** What the channel can do, so the composer offers only what will be accepted. */
  capabilities: channelCapabilitiesSchema,
  window: serviceWindowSchema,
  customerLanguage: z.string().nullable(),
  /** Start of the current wait for a human answer (the SLA anchor). */
  waitingSince: z.string().datetime().nullable(),
  firstResponseAt: z.string().datetime().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  /** Placeholder for the SLA domain: the due times of the current turn. */
  sla: z.object({
    firstResponseDueAt: z.string().datetime().nullable(),
    resolutionDueAt: z.string().datetime().nullable(),
    breached: z.boolean(),
  }),
});
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;
