import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Conversation tags (TW-TIB1-036, 037). ONE concept, ONE word: the reference product calls them tags, and the earlier name "labels"
 * was ours and is retired. The workspace tag library is the `tags` table the contacts domain also uses, so a tag created here is a
 * tag on contacts and the other way round; the plan's `tags` limit counts both. A contact tag describes the person (VIP, lead,
 * region); a conversation tag describes this thread (billing, refund, urgent). Routes: `/v2/inbox/tags*` (library, `inbox.tag.manage`
 * to change) and `/v2/inbox/conversations/:id/tags*` (`inbox.conversation.tag`); the original `/labels*` routes stay as aliases.
 */

export const INBOX_TAG_NAME_MAX = 64;
/** Same shapes as Reference: a hex colour, or a short name/function; checked again before it reaches a style attribute. */
export const INBOX_TAG_COLOR_PATTERN = /^#?[0-9A-Za-z_-]{1,16}$/;

const colorSchema = z.string().trim().regex(INBOX_TAG_COLOR_PATTERN);

export const inboxTagSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  color: z.string().nullable(),
  description: z.string().nullable(),
  /** Conversations (of any workspace member's view: the count is workspace-wide) that carry it. */
  conversationCount: z.number().int().nonnegative(),
  rowVersion: z.number().int().positive(),
});
export type InboxTag = z.infer<typeof inboxTagSchema>;

export const inboxTagListSchema = z.object({ data: z.array(inboxTagSchema) });
export type InboxTagList = z.infer<typeof inboxTagListSchema>;

export const createInboxTagSchema = z.object({
  name: z.string().trim().min(1).max(INBOX_TAG_NAME_MAX),
  color: colorSchema.optional(),
  description: z.string().trim().max(255).optional(),
});
export type CreateInboxTagInput = z.infer<typeof createInboxTagSchema>;

export const updateInboxTagSchema = z.object({
  rowVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(INBOX_TAG_NAME_MAX).optional(),
  color: colorSchema.nullish(),
  description: z.string().trim().max(255).nullish(),
});
export type UpdateInboxTagInput = z.infer<typeof updateInboxTagSchema>;

/** Put a tag on a thread: an existing one by id, or by name (found ignoring case, created when new, which needs `inbox.tag.manage`). */
export const applyConversationTagSchema = z
  .object({
    tagId: uuidSchema.optional(),
    name: z.string().trim().min(1).max(INBOX_TAG_NAME_MAX).optional(),
  })
  .refine((v) => (v.tagId === undefined) !== (v.name === undefined), {
    message: 'Name a tag by id or by name, not both and not neither',
    path: ['tagId'],
  });
export type ApplyConversationTagInput = z.infer<typeof applyConversationTagSchema>;
