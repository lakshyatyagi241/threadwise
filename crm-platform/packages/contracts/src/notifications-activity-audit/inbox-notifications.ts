import { z } from 'zod';
import type { NotificationEventKey } from '../admin-console-shell/workspace-settings';
import { uuidSchema } from '../common/ids';
import { cursorSchema, pageInfoSchema } from '../common/pagination';
import { queryBoolean } from '../contacts-attributes-tags/query-helpers';

/**
 * The in-app notification feed behind the header bell (WD-NOTIF-006, 012, 015, 017): one row per person notified,
 * written by outbox consumers (task assigned, due, completed) and read by the person it is for.
 *
 * `type` says what happened and `data` carries the pieces a client needs to word it in the viewer's language
 * (`taskTitle`, `actorName`, ...); `title` and `body` are the server's English wording, the fallback for a type
 * the client does not know yet.
 */
export const NOTIFICATION_TYPES = [
  'task_assigned',
  'task_due',
  'task_completed',
  /** A lead arrived through a lead source (written by the lead pipeline's consumer). */
  'new_lead',
  /** A conversation nobody owned yet got its first message (everyone who may see and reply is told, once). */
  'new_chat',
  /** A message arrived on a conversation I own. One row per chat while unread; `count` says how many. */
  'new_message',
  /** A conversation was assigned to me (or to a team I am in). */
  'conversation_assigned',
  /** Someone mentioned me in a conversation note. */
  'mention',
  /**
   * An unassigned, open chat has had a customer message nobody answered for N minutes (BL-098): told once per waiting episode to the people
   * who may read and reply, by the worker's sweep (not by an outbox event).
   */
  'chat_waiting',
  // --- Phase 2 (BL-096): device, broadcast / campaign / scheduled outcomes, team chat ---------------------------------------
  /** A personal WhatsApp number came online. */
  'device_connected',
  /** A personal WhatsApp number dropped (network, WhatsApp, a silent worker). */
  'device_disconnected',
  /** WhatsApp ended the linked session: the number must be scanned again. */
  'device_logged_out',
  'broadcast_completed',
  'broadcast_failed',
  'campaign_completed',
  'campaign_failed',
  'scheduled_completed',
  'scheduled_failed',
  /** Someone @mentioned me in a team chat channel. */
  'teamchat_mention',
  /** A team chat direct message to me. */
  'teamchat_message',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Types other domains already wrote before this list existed (their wording lives in the row's English `title` / `body`): they are not
 * in `NOTIFICATION_TYPES`, so a client without their own copy falls back to the server text, but a person can still tune them.
 */
export const NOTIFICATION_LEGACY_TYPES = [
  'wallet_low_balance',
  'wallet_credited',
  'form_submission',
  'form_needs_review',
  'sales_doc_decided',
] as const;

/** Every type a person can set preferences for. */
export const NOTIFICATION_PREF_TYPES = [
  ...NOTIFICATION_TYPES,
  ...NOTIFICATION_LEGACY_TYPES,
] as const;
export type NotificationPrefType = (typeof NOTIFICATION_PREF_TYPES)[number];

/** The types that collapse into one unread row per chat. */
export const COLLAPSING_NOTIFICATION_TYPES = [
  'new_message',
] as const satisfies readonly NotificationType[];

/**
 * Which of the workspace owner's notification toggles (Settings, Notifications) gates a type. Only the conversation types are gated
 * (decision D3); a type that is absent here is delivered whatever the toggles say. `inapp=false` suppresses both the row and the live push.
 */
export const NOTIFICATION_TYPE_PREF_KEY: Partial<
  Record<NotificationPrefType, NotificationEventKey>
> = {
  new_chat: 'new_customer_reply',
  new_message: 'new_customer_reply',
  conversation_assigned: 'conversation_assigned',
  mention: 'mention_in_inbox',
  // The nudge is a follow-up to a customer's message the owner already governs with the same toggle (BL-098).
  chat_waiting: 'new_customer_reply',
  // Phase 2 (decision D3: the owner's toggles start to work for the new types and for the wallet alert).
  device_connected: 'device_connected',
  device_disconnected: 'device_disconnected',
  device_logged_out: 'device_disconnected',
  broadcast_completed: 'broadcast_completed',
  broadcast_failed: 'campaign_failed',
  campaign_completed: 'campaign_completed',
  campaign_failed: 'campaign_failed',
  teamchat_mention: 'mention_in_inbox',
  wallet_low_balance: 'wallet_low_balance',
};

/** What a row is about: lets a client mark rows read by subject and open the right screen. */
export const NOTIFICATION_SUBJECT_KINDS = [
  'conversation',
  'device',
  'broadcast',
  'campaign',
  'scheduled_message',
  'team_chat_channel',
] as const;
export const notificationSubjectKindSchema = z.enum(NOTIFICATION_SUBJECT_KINDS);
export type NotificationSubjectKind = z.infer<typeof notificationSubjectKindSchema>;

export const notificationSubjectSchema = z.object({
  /** A NotificationSubjectKind today; a plain string so a newer server's kind does not break an older client. */
  kind: z.string().min(1),
  id: uuidSchema,
});
export type NotificationSubject = z.infer<typeof notificationSubjectSchema>;

/**
 * The `data` of the conversation types (`new_chat`, `new_message`, `chat_waiting`, `conversation_assigned`, `mention`). Every field is optional for a
 * reader: a row written by an older server lacks the newer ones. `preview` is at most 80 characters of the customer's words and is
 * rendered as text, never HTML.
 */
export const conversationNotificationDataSchema = z.object({
  conversationId: uuidSchema,
  contactName: z.string().nullable().optional(),
  channelKind: z.string().nullable().optional(),
  preview: z.string().max(80).nullable().optional(),
  /** How many messages the (collapsed) row stands for. */
  count: z.number().int().min(1).optional(),
  /** `conversation_assigned`: who assigned it (a name, or null for the system), and whether it went to a team. */
  assignedByName: z.string().nullable().optional(),
  teamAssigned: z.boolean().optional(),
  /** `mention`: the author of the note and the note. */
  authorName: z.string().nullable().optional(),
  noteId: uuidSchema.optional(),
});
export type ConversationNotificationData = z.infer<typeof conversationNotificationDataSchema>;

export const notificationResponseSchema = z.object({
  id: uuidSchema,
  /** A NotificationType today; other values may appear as more domains start notifying. */
  type: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  /** App path to open (`/tasks`), never an absolute URL. */
  link: z.string().nullable(),
  data: z.record(z.unknown()).nullable(),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  /** How many events the row stands for (a collapsed chat: "3 new messages"). Absent on rows that never collapse. */
  count: z.number().int().min(1).optional(),
  /** What the row is about; null/absent for rows written before subjects existed. */
  subject: notificationSubjectSchema.nullable().optional(),
});
export type NotificationResponse = z.infer<typeof notificationResponseSchema>;

export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: cursorSchema.optional(),
  unreadOnly: queryBoolean().default(false),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

/** `meta.unread` is the true unread total for the caller (not just this page), so the badge needs no second call. */
export const notificationListResponseSchema = z.object({
  data: z.array(notificationResponseSchema),
  page: pageInfoSchema,
  meta: z.object({ unread: z.number().int().min(0) }),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

export const unreadCountResponseSchema = z.object({ unread: z.number().int().min(0) });
export type UnreadCountResponse = z.infer<typeof unreadCountResponseSchema>;

export const markAllReadResponseSchema = z.object({ updated: z.number().int().min(0) });
export type MarkAllReadResponse = z.infer<typeof markAllReadResponseSchema>;

/** `POST /v2/notifications/read-subject`: mark the caller's unread rows about one thing read (opening the conversation does this server-side too). */
export const readSubjectRequestSchema = z.object({
  kind: notificationSubjectKindSchema,
  id: uuidSchema,
});
export type ReadSubjectRequest = z.infer<typeof readSubjectRequestSchema>;

export const readSubjectResponseSchema = z.object({
  updated: z.number().int().min(0),
  unread: z.number().int().min(0),
});
export type ReadSubjectResponse = z.infer<typeof readSubjectResponseSchema>;
