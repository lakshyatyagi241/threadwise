import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import {
  messageDirectionSchema,
  messageKindSchema,
  messageSenderKindSchema,
  messageStatusSchema,
} from './enums';

/**
 * chat-conversations: the message as it crosses the wire (plan-inbox-chat.md sections 3.3 and 3.4).
 *
 * Ordering inside a thread is `seq` (gap-free, allocated under the conversation row lock); the id is the message `uuid`. A message
 * carries its media as a short-lived authenticated url minted per response, never the storage key.
 */

/** Longest free-form text a send accepts (WhatsApp's own text limit). */
export const MESSAGE_BODY_MAX = 4096;
export const MESSAGE_CAPTION_MAX = 1024;
/** Header every message-creating request carries, next to `clientMessageId` in the body. */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

// --- the message --------------------------------------------------------------------------------------------------------

export const messageSenderSchema = z.object({
  kind: messageSenderKindSchema,
  /** The staff member, for `kind: 'agent'`. Null when the user was removed. */
  userId: uuidSchema.nullable(),
  /** Display name at read time (the user's name, the bot's name); null when unknown. */
  name: z.string().nullable(),
});
export type MessageSender = z.infer<typeof messageSenderSchema>;

export const messageMediaSchema = z.object({
  /** Authenticated stream url, valid for minutes. Fetch it with the session; do not store it. */
  url: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  name: z.string().nullable(),
});
export type MessageMedia = z.infer<typeof messageMediaSchema>;

export const messageLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** Place name / address as the channel gave them (they live in the message meta). */
  name: z.string().nullable(),
  address: z.string().nullable(),
});
export type MessageLocation = z.infer<typeof messageLocationSchema>;

/** A template send. Kept as what was sent (name, language, resolved variables) so the bubble reads after the template is edited. */
export const messageTemplateSchema = z.object({
  templateId: uuidSchema.nullable(),
  name: z.string(),
  language: z.string().nullable(),
  variables: z.record(z.string()),
});
export type MessageTemplate = z.infer<typeof messageTemplateSchema>;

export const messageFailureSchema = z.object({
  /** Stable code (`SIM_REJECTED`, a Meta error code such as `131047`, a platform code such as `AUTH_SEND_HALTED`). */
  code: z.string().nullable(),
  reason: z.string().nullable(),
});
export type MessageFailure = z.infer<typeof messageFailureSchema>;

export const messageResponseSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  seq: z.number().int().positive(),
  direction: messageDirectionSchema,
  kind: messageKindSchema,
  sender: messageSenderSchema,
  /** Plain text: the body, or the caption of a media message. */
  body: z.string().nullable(),
  media: messageMediaSchema.nullable(),
  location: messageLocationSchema.nullable(),
  template: messageTemplateSchema.nullable(),
  status: messageStatusSchema,
  /** Present only while `status` is `failed`. */
  failure: messageFailureSchema.nullable(),
  /** The sender's own id; the client swaps its optimistic bubble for the stored row by this. Null for inbound. */
  clientMessageId: uuidSchema.nullable(),
  /** The message this one answers (its `id`). The quoted text is in the thread already; nothing joins on it. */
  replyToMessageId: uuidSchema.nullable(),
  reaction: z.string().nullable(),
  /** Translation (I18N): the reading of an inbound message, or the agent's original beside a translated reply. */
  isTranslated: z.boolean(),
  translatedBody: z.string().nullable(),
  detectedLanguage: z.string().nullable(),
  starred: z.boolean(),
  pinned: z.boolean(),
  editedAt: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
  /** When the channel says it happened (inbound) or accepted it (outbound). */
  providerAt: z.string().datetime().nullable(),
  sentAt: z.string().datetime().nullable(),
  deliveredAt: z.string().datetime().nullable(),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type MessageResponse = z.infer<typeof messageResponseSchema>;

// --- reading a thread ---------------------------------------------------------------------------------------------------

/**
 * The newest `limit` messages in ascending order when neither cursor is given; `before` (a `seq`) loads older ones, `afterSeq`
 * returns only newer ones, oldest first, for gap filling after a reconnect. Gap-free by construction: the client compares `seq`.
 */
export const listMessagesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.coerce.number().int().positive().optional(),
    afterSeq: z.coerce.number().int().nonnegative().optional(),
  })
  .refine((q) => q.before === undefined || q.afterSeq === undefined, {
    message: 'Use before or afterSeq, not both',
    path: ['afterSeq'],
  });
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

export const messageListResponseSchema = z.object({
  /** Ascending by `seq`. */
  data: z.array(messageResponseSchema),
  page: z.object({
    /** There are older messages than the first one returned. */
    hasMoreBefore: z.boolean(),
    /** There are newer messages than the last one returned (an `afterSeq` read that hit `limit`). */
    hasMoreAfter: z.boolean(),
    limit: z.number().int(),
  }),
});
export type MessageListResponse = z.infer<typeof messageListResponseSchema>;

// --- sending ------------------------------------------------------------------------------------------------------------

/**
 * A client-generated uuid for the message. The server stores it on the row and in the ledger, so a retried request (same
 * Idempotency-Key, same `clientMessageId`) returns the first message instead of sending twice.
 */
const clientMessageId = uuidSchema;

const sendBase = {
  clientMessageId,
  replyToMessageId: uuidSchema.optional(),
};

/**
 * `POST .../messages`. Answers 202 with the queued message. `text` and `media` are free-form and need an open service window on
 * channels that have one; `template` is always allowed. Media is uploaded first and referenced by the id the upload returned.
 */
export const sendMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    ...sendBase,
    kind: z.literal('text'),
    body: z.string().trim().min(1).max(MESSAGE_BODY_MAX),
  }),
  z.object({
    ...sendBase,
    kind: z.literal('media'),
    mediaId: uuidSchema,
    caption: z.string().trim().max(MESSAGE_CAPTION_MAX).optional(),
  }),
  z.object({
    ...sendBase,
    kind: z.literal('template'),
    templateId: uuidSchema,
    variables: z.record(z.string().max(1024)).default({}),
  }),
]);
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

// --- internal notes -----------------------------------------------------------------------------------------------------

export const NOTE_BODY_MAX = 4000;

/** A note is visible to staff only and never leaves the platform; it is not a message and never reaches a channel. */
export const conversationNoteSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  author: z.object({ userId: uuidSchema.nullable(), name: z.string().nullable() }),
  body: z.string(),
  /** Users mentioned with `@`, as user ids. */
  mentions: z.array(uuidSchema),
  isPinned: z.boolean(),
  editedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type ConversationNote = z.infer<typeof conversationNoteSchema>;

export const createConversationNoteSchema = z.object({
  body: z.string().trim().min(1).max(NOTE_BODY_MAX),
  mentions: z.array(uuidSchema).max(20).default([]),
});
export type CreateConversationNoteInput = z.infer<typeof createConversationNoteSchema>;
