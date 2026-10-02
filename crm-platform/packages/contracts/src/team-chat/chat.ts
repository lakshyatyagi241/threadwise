import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/** Limits taken from the behaviour of WaDesk (WD-TCHAT-004, 009, 010, 017). */
export const TCHAT_CHANNEL_NAME_MAX = 64;
export const TCHAT_CHANNEL_DESCRIPTION_MAX = 255;
export const TCHAT_MESSAGE_MAX = 8192;
export const TCHAT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const TCHAT_EDIT_WINDOW_MINUTES = 15;
export const TCHAT_HISTORY_MIN = 10;
export const TCHAT_HISTORY_MAX = 50;
export const TCHAT_EMOJI_MAX = 16;
export const TCHAT_INVITATIONS_LIMIT = 50;
export const TCHAT_SEARCH_LIMIT = 50;
/** `@[Display name](user uuid)`: the token the composer inserts and the server reads. */
export const TCHAT_MENTION_SOURCE = '@\\[([^\\]\\n]{1,100})\\]\\(([0-9a-fA-F-]{36})\\)';

export const tchatChannelTypeSchema = z.enum(['public', 'private', 'dm']);
export type TchatChannelType = z.infer<typeof tchatChannelTypeSchema>;

// --- channels ---------------------------------------------------------------------------------------------------------

export const tchatChannelResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  type: tchatChannelTypeSchema,
  description: z.string().nullable(),
  lastMessageAt: z.string().datetime().nullable(),
  /** Messages by other people newer than the caller's read pointer. */
  unread: z.number().int().nonnegative(),
  /** For a direct message: the other person, whose name is the channel title. */
  peer: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
});
export type TchatChannelResponse = z.infer<typeof tchatChannelResponseSchema>;

/** What the caller may do; the screen shows or hides controls from it, the server enforces it anyway. */
export const tchatMeSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  canManageChannels: z.boolean(),
  canDecideInvitations: z.boolean(),
  canModerate: z.boolean(),
});
export type TchatMe = z.infer<typeof tchatMeSchema>;

export const tchatChannelListResponseSchema = z.object({
  data: z.array(tchatChannelResponseSchema),
  me: tchatMeSchema,
});
export type TchatChannelListResponse = z.infer<typeof tchatChannelListResponseSchema>;

export const createTchatChannelSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(TCHAT_CHANNEL_NAME_MAX)
    .regex(
      /^[a-z0-9][a-z0-9_-]*$/i,
      'Lowercase letters, digits, dash and underscore; start with a letter or digit',
    ),
  description: z.string().trim().max(TCHAT_CHANNEL_DESCRIPTION_MAX).nullish(),
  type: z.enum(['public', 'private']),
});
export type CreateTchatChannelInput = z.infer<typeof createTchatChannelSchema>;

export const openTchatDirectSchema = z.object({ userId: uuidSchema });
export type OpenTchatDirectInput = z.infer<typeof openTchatDirectSchema>;

// --- people -----------------------------------------------------------------------------------------------------------

export const tchatMemberSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  email: z.string(),
});
export type TchatMember = z.infer<typeof tchatMemberSchema>;

export const tchatMemberListResponseSchema = z.object({ data: z.array(tchatMemberSchema) });
export type TchatMemberListResponse = z.infer<typeof tchatMemberListResponseSchema>;

export const tchatChannelMemberSchema = tchatMemberSchema.extend({
  role: z.enum(['admin', 'member']),
});
export type TchatChannelMember = z.infer<typeof tchatChannelMemberSchema>;

export const addTchatChannelMemberSchema = z.object({ userId: uuidSchema });
export type AddTchatChannelMemberInput = z.infer<typeof addTchatChannelMemberSchema>;

// --- messages ---------------------------------------------------------------------------------------------------------

export const tchatReactionSchema = z.object({
  emoji: z.string(),
  count: z.number().int().positive(),
  mine: z.boolean(),
});
export type TchatReaction = z.infer<typeof tchatReactionSchema>;

export const tchatMessageResponseSchema = z.object({
  id: uuidSchema,
  channelId: uuidSchema,
  /** Null when the author's account no longer exists; the name then reads "Unknown". */
  authorId: uuidSchema.nullable(),
  authorName: z.string(),
  body: z.string().nullable(),
  /** Users named by a valid mention token, as uuids. */
  mentions: z.array(uuidSchema),
  /** A short preview of the message replied to, so the quote works outside the loaded window. */
  replyTo: z.object({ id: uuidSchema, authorName: z.string(), snippet: z.string() }).nullable(),
  attachment: z
    .object({
      name: z.string(),
      mime: z.string().nullable(),
      url: z.string(),
      isImage: z.boolean(),
    })
    .nullable(),
  reactions: z.array(tchatReactionSchema),
  pinnedAt: z.string().datetime().nullable(),
  editedAt: z.string().datetime().nullable(),
  isMine: z.boolean(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
});
export type TchatMessageResponse = z.infer<typeof tchatMessageResponseSchema>;

/**
 * History: the newest `limit` messages in ascending order; `before` (the cursor in `page.nextCursor`) loads older ones; `after`
 * (a message id) returns only newer ones, oldest first, for the 3-second poll. `limit` is clamped to 10..50 like WaDesk.
 */
export const listTchatMessagesQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .default(TCHAT_HISTORY_MAX)
    .transform((n) => Math.min(TCHAT_HISTORY_MAX, Math.max(TCHAT_HISTORY_MIN, n))),
  before: z.string().min(1).max(512).optional(),
  after: uuidSchema.optional(),
});
export type ListTchatMessagesQuery = z.infer<typeof listTchatMessagesQuerySchema>;

export const tchatMessageListResponseSchema = z.object({
  data: z.array(tchatMessageResponseSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    limit: z.number().int(),
  }),
});
export type TchatMessageListResponse = z.infer<typeof tchatMessageListResponseSchema>;

/**
 * Sent as multipart/form-data (one optional `attachment` file) or JSON. Text is trimmed server side; with no text there must be a
 * file.
 */
export const postTchatMessageSchema = z.object({
  body: z.string().max(TCHAT_MESSAGE_MAX).optional(),
  replyToId: uuidSchema.optional(),
});
export type PostTchatMessageInput = z.infer<typeof postTchatMessageSchema>;

export const editTchatMessageSchema = z.object({
  body: z.string().trim().min(1).max(TCHAT_MESSAGE_MAX),
  rowVersion: z.number().int().positive(),
});
export type EditTchatMessageInput = z.infer<typeof editTchatMessageSchema>;

export const reactTchatMessageSchema = z.object({
  emoji: z.string().trim().min(1).max(TCHAT_EMOJI_MAX),
});
export type ReactTchatMessageInput = z.infer<typeof reactTchatMessageSchema>;

export const searchTchatMessagesQuerySchema = z.object({
  q: z.string().trim().min(2).max(191),
});
export type SearchTchatMessagesQuery = z.infer<typeof searchTchatMessagesQuerySchema>;

/** Moves the caller's read pointer; without `lastMessageId` it is the newest message of the channel. */
export const markTchatReadSchema = z.object({ lastMessageId: uuidSchema.optional() });
export type MarkTchatReadInput = z.infer<typeof markTchatReadSchema>;

export const tchatActivityResponseSchema = z.object({
  typing: z.array(uuidSchema),
  online: z.array(uuidSchema),
});
export type TchatActivityResponse = z.infer<typeof tchatActivityResponseSchema>;

// --- invitations ------------------------------------------------------------------------------------------------------

export const tchatInvitationStatusSchema = z.enum(['pending', 'approved', 'declined', 'expired']);
export type TchatInvitationStatus = z.infer<typeof tchatInvitationStatusSchema>;

export const createTchatInvitationSchema = z.object({
  inviteeEmail: z.string().trim().toLowerCase().email().max(191),
  inviteeName: z.string().trim().max(191).nullish(),
  note: z.string().trim().max(500).nullish(),
  channelId: uuidSchema.nullish(),
});
export type CreateTchatInvitationInput = z.infer<typeof createTchatInvitationSchema>;

export const tchatInvitationResponseSchema = z.object({
  id: uuidSchema,
  inviteeEmail: z.string().nullable(),
  inviteeName: z.string().nullable(),
  requesterName: z.string(),
  requesterEmail: z.string().nullable(),
  channel: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  status: tchatInvitationStatusSchema,
  note: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().datetime().nullable(),
  /** The person has no account in this workspace: approving records the decision but adds nobody. */
  needsAccount: z.boolean(),
  createdAt: z.string().datetime(),
});
export type TchatInvitationResponse = z.infer<typeof tchatInvitationResponseSchema>;

export const tchatInvitationListResponseSchema = z.object({
  isAdmin: z.boolean(),
  data: z.array(tchatInvitationResponseSchema),
  /** Pending rows among everything the caller can see (the badge), not just the page. */
  pendingCount: z.number().int().nonnegative(),
});
export type TchatInvitationListResponse = z.infer<typeof tchatInvitationListResponseSchema>;

export const createTchatInvitationResultSchema = z.object({
  id: uuidSchema,
  status: z.enum(['pending', 'approved']),
  message: z.string(),
});
export type CreateTchatInvitationResult = z.infer<typeof createTchatInvitationResultSchema>;
