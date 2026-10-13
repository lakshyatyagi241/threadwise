import { z } from 'zod';
import { conversationPrioritySchema } from '../chat-conversations/enums';
import { uuidSchema } from '../common/ids';

/**
 * Priority, snooze and bulk actions on the conversation list (BL-036, inbox phase 3). Single routes: `POST /inbox/conversations/:id/priority`
 * and `.../snooze`; the bulk route is `POST /inbox/conversations/bulk`. Routes: docs/specs/inbox-phase3-slice.md.
 */

/** A snooze is at least a minute and at most a year ahead: shorter is a mis-click, longer is a status the agent forgot. */
export const SNOOZE_MIN_MINUTES = 1;
export const SNOOZE_MAX_DAYS = 365;

const snoozeUntilSchema = z
  .string()
  .datetime({ offset: true })
  .superRefine((value, ctx) => {
    const at = Date.parse(value);
    const now = Date.now();
    if (at < now + SNOOZE_MIN_MINUTES * 60_000) {
      ctx.addIssue({ code: 'custom', message: 'The wake-up time must be in the future' });
    } else if (at > now + SNOOZE_MAX_DAYS * 86_400_000) {
      ctx.addIssue({ code: 'custom', message: `At most ${SNOOZE_MAX_DAYS} days ahead` });
    }
  });

export const setConversationPrioritySchema = z.object({
  rowVersion: z.number().int().positive(),
  priority: conversationPrioritySchema,
});
export type SetConversationPriorityInput = z.infer<typeof setConversationPrioritySchema>;

export const snoozeConversationSchema = z.object({
  rowVersion: z.number().int().positive(),
  until: snoozeUntilSchema,
});
export type SnoozeConversationInput = z.infer<typeof snoozeConversationSchema>;

// --- bulk -----------------------------------------------------------------------------------------------------------------

/** One request names at most this many conversations. A larger selection is sent in several requests by the client. */
export const BULK_MAX_CONVERSATIONS = 200;

export const BULK_STATUS_TARGETS = ['open', 'pending', 'resolved', 'closed'] as const;

/** What a bulk request does to every conversation it names. `reopen` is `status: open`. */
export const bulkConversationActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), status: z.enum(BULK_STATUS_TARGETS) }),
  z.object({
    type: z.literal('assign'),
    /** A person, `null` to unassign them. An omitted field is left alone, as on the single route. */
    userId: uuidSchema.nullable().optional(),
    teamId: uuidSchema.nullable().optional(),
  }),
  z.object({ type: z.literal('mark_read') }),
  z.object({ type: z.literal('priority'), priority: conversationPrioritySchema }),
  z.object({ type: z.literal('snooze'), until: snoozeUntilSchema }),
]);
export type BulkConversationAction = z.infer<typeof bulkConversationActionSchema>;

export const bulkConversationsSchema = z
  .object({
    ids: z.array(uuidSchema).min(1).max(BULK_MAX_CONVERSATIONS),
    action: bulkConversationActionSchema,
  })
  .refine((v) => new Set(v.ids).size === v.ids.length, {
    message: 'A conversation is named once',
    path: ['ids'],
  })
  .refine(
    (v) =>
      v.action.type !== 'assign' || v.action.userId !== undefined || v.action.teamId !== undefined,
    { message: 'Name a user, a team, or null to clear one', path: ['action', 'userId'] },
  );
export type BulkConversationsInput = z.infer<typeof bulkConversationsSchema>;

export const BULK_OUTCOMES = ['done', 'unchanged', 'failed'] as const;
export const bulkItemResultSchema = z.object({
  id: uuidSchema,
  outcome: z.enum(BULK_OUTCOMES),
  /** The problem `code` of a failure (CONVERSATION_NOT_FOUND, FORBIDDEN, CONVERSATION_STATUS_INVALID, ...). */
  code: z.string().optional(),
});
export type BulkItemResult = z.infer<typeof bulkItemResultSchema>;

export const bulkConversationsResponseSchema = z.object({
  requested: z.number().int(),
  done: z.number().int(),
  unchanged: z.number().int(),
  failed: z.number().int(),
  results: z.array(bulkItemResultSchema),
});
export type BulkConversationsResponse = z.infer<typeof bulkConversationsResponseSchema>;
