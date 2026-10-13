import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Conversation labels (TW-TIB1-036, 037): the workspace label library is the `tags` table the contacts domain also uses (Reference shares
 * it too), so a label created here is a tag on contacts and the other way round; the plan's `tags` limit counts both. Routes:
 * `/v2/inbox/labels*` (library, `inbox.tag.manage` to change) and `/v2/inbox/conversations/:id/labels*` (`inbox.conversation.tag`).
 */

export const LABEL_NAME_MAX = 64;
/** Same shapes as Reference: a hex colour, or a short name/function; checked again before it reaches a style attribute. */
export const LABEL_COLOR_PATTERN = /^#?[0-9A-Za-z_-]{1,16}$/;

const colorSchema = z.string().trim().regex(LABEL_COLOR_PATTERN);

export const inboxLabelSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  color: z.string().nullable(),
  description: z.string().nullable(),
  /** Conversations (of any workspace member's view: the count is workspace-wide) that carry it. */
  conversationCount: z.number().int().nonnegative(),
  rowVersion: z.number().int().positive(),
});
export type InboxLabel = z.infer<typeof inboxLabelSchema>;

export const inboxLabelListSchema = z.object({ data: z.array(inboxLabelSchema) });
export type InboxLabelList = z.infer<typeof inboxLabelListSchema>;

export const createInboxLabelSchema = z.object({
  name: z.string().trim().min(1).max(LABEL_NAME_MAX),
  color: colorSchema.optional(),
  description: z.string().trim().max(255).optional(),
});
export type CreateInboxLabelInput = z.infer<typeof createInboxLabelSchema>;

export const updateInboxLabelSchema = z.object({
  rowVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(LABEL_NAME_MAX).optional(),
  color: colorSchema.nullish(),
  description: z.string().trim().max(255).nullish(),
});
export type UpdateInboxLabelInput = z.infer<typeof updateInboxLabelSchema>;

/** Put a label on a thread: an existing one by id, or by name (found ignoring case, created when new, which needs `inbox.tag.manage`). */
export const applyConversationLabelSchema = z
  .object({
    tagId: uuidSchema.optional(),
    name: z.string().trim().min(1).max(LABEL_NAME_MAX).optional(),
  })
  .refine((v) => (v.tagId === undefined) !== (v.name === undefined), {
    message: 'Name a label by id or by name, not both and not neither',
    path: ['tagId'],
  });
export type ApplyConversationLabelInput = z.infer<typeof applyConversationLabelSchema>;
