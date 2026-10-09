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

/** What the template's header is. A media header carries only its format: the file is not stored with the message. */
export const messageTemplateHeaderSchema = z.object({
  format: z.enum(['text', 'image', 'video', 'document', 'location']),
  /** The header text of a `text` header; null for the other formats. */
  text: z.string().nullable().optional(),
});
export type MessageTemplateHeader = z.infer<typeof messageTemplateHeaderSchema>;

/** One button of the template as WhatsApp draws it. `other` is any kind the bubble has no icon for (a flow, an OTP...). */
export const messageTemplateButtonSchema = z.object({
  type: z.enum(['quick_reply', 'url', 'phone', 'copy_code', 'other']),
  text: z.string(),
});
export type MessageTemplateButton = z.infer<typeof messageTemplateButtonSchema>;

/**
 * The parts of the template around the body, read from the stored template when the thread is listed, so the bubble can be drawn
 * as WhatsApp shows it. Absent when the template is gone (deleted since) or the message was read from a realtime event.
 */
export const messageTemplatePreviewSchema = z.object({
  header: messageTemplateHeaderSchema.nullable(),
  footer: z.string().nullable(),
  buttons: z.array(messageTemplateButtonSchema),
});
export type MessageTemplatePreview = z.infer<typeof messageTemplatePreviewSchema>;

/** A template send. Kept as what was sent (name, language, resolved variables) so the bubble reads after the template is edited. */
export const messageTemplateSchema = z.object({
  templateId: uuidSchema.nullable(),
  name: z.string(),
  language: z.string().nullable(),
  variables: z.record(z.string()),
  preview: messageTemplatePreviewSchema.optional(),
});
export type MessageTemplate = z.infer<typeof messageTemplateSchema>;

/** A shared contact card (WhatsApp `contacts` message). Kept to what a bubble shows; the full card stays in the message meta. */
export const messageContactCardSchema = z.object({
  name: z.string().nullable(),
  phones: z.array(z.string()),
  emails: z.array(z.string()).optional(),
  org: z.string().nullable().optional(),
});
export type MessageContactCard = z.infer<typeof messageContactCardSchema>;

/** The customer's answer to a button or a list (or a template quick-reply button): what they picked. */
export const messageInteractiveSchema = z.object({
  type: z.enum(['button_reply', 'list_reply', 'button']),
  /** The button or row id we gave the customer; null for a template quick reply, which carries a payload instead. */
  id: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
});
export type MessageInteractive = z.infer<typeof messageInteractiveSchema>;

/** Where a first message came from when the customer tapped an ad or a link that opens WhatsApp (Meta `referral`). */
export const messageReferralSchema = z.object({
  sourceType: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  sourceId: z.string().nullable(),
  headline: z.string().nullable(),
  body: z.string().nullable(),
});
export type MessageReferral = z.infer<typeof messageReferralSchema>;

/**
 * `pending`: the message is stored and its file is still being copied from the provider (a background job, with retries): show a
 * placeholder, the file arrives by a later `inbox.message.new` for the same message. `ready`: the file is stored. `failed`: the
 * provider's file could not be fetched or was refused (the text, if any, is kept); `mediaFailure` says why and a Retry
 * (`POST /inbox/messages/:id/retry`) starts the download again.
 */
export const messageMediaStateSchema = z.enum(['pending', 'ready', 'failed']);
export type MessageMediaState = z.infer<typeof messageMediaStateSchema>;

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
  /** Channel-specific content. Always sent by the API; optional so a fixture built before they existed still parses. */
  contacts: z.array(messageContactCardSchema).nullable().optional(),
  interactive: messageInteractiveSchema.nullable().optional(),
  referral: messageReferralSchema.nullable().optional(),
  /** The customer sent something the channel cannot show (a poll, an unknown type): the body says so, the bubble marks it. */
  unsupported: z.boolean().optional(),
  /** The customer forwarded this message from another chat. */
  forwarded: z.boolean().optional(),
  /** Set for an inbound media message: whether its file could be stored. */
  mediaState: messageMediaStateSchema.nullable().optional(),
  /** Present while `mediaState` is `failed`: a stable code (`MEDIA_EXPIRED`, `MEDIA_TOO_LARGE`, ...) and a reason an agent can read. */
  mediaFailure: messageFailureSchema.nullable().optional(),
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
