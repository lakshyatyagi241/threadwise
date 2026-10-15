import { z } from 'zod';

/**
 * Conversation counts of one scope (the workspace, or one person). Conversations created in the window. `open` includes snoozed,
 * `closed` includes resolved, spam is left out; `total` is open + pending + closed. `assigned` / `unassigned` split the same
 * conversations by whether a person of the team holds them; `unattended` is an open conversation a person holds but has not answered yet.
 */
export const conversationStatusCountsSchema = z.object({
  open: z.number().int(),
  pending: z.number().int(),
  closed: z.number().int(),
  total: z.number().int(),
  assigned: z.number().int(),
  unassigned: z.number().int(),
  unattended: z.number().int(),
});
export type ConversationStatusCounts = z.infer<typeof conversationStatusCountsSchema>;

export const analyticsConversationsSchema = z.object({
  counts: conversationStatusCountsSchema,
  /** Mean minutes from creation to resolution over the resolved conversations of the scope; null when none were resolved. */
  avgResolutionMin: z.number().nullable(),
  /** Mean minutes from creation to the last message over the conversations of the scope that had one; null when none had. */
  avgDurationMin: z.number().nullable(),
  /** One row per person who holds a conversation of the window, busiest first; always the whole team, whatever `agent` asked. */
  agents: z.array(
    z.object({
      userUuid: z.string().uuid(),
      name: z.string(),
      counts: conversationStatusCountsSchema,
    }),
  ),
});
export type AnalyticsConversations = z.infer<typeof analyticsConversationsSchema>;
