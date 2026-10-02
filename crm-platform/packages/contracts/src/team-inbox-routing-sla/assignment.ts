import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { conversationSummarySchema } from '../chat-conversations/conversation';

/**
 * team-inbox-routing-sla: who a conversation is assigned to (plan-inbox-chat.md sections 3.7 and 4.2, Phase 1: manual assignment).
 *
 * `AssignmentService` is the only writer of the assignee columns. Phase 1 knows one strategy, `manual` (the caller names the person or
 * the team); round robin, least loaded and sticky arrive in Phase 3 as more members of `ASSIGNMENT_STRATEGIES`, with no change to the
 * request shape.
 */

/** An agent's availability. Routing strategies skip `busy` and `offline` people (Phase 3); the picker shows it from Phase 1. */
export const AGENT_AVAILABILITY = ['online', 'away', 'busy', 'offline'] as const;
export const agentAvailabilitySchema = z.enum(AGENT_AVAILABILITY);
export type AgentAvailability = z.infer<typeof agentAvailabilitySchema>;

export const ASSIGNMENT_STRATEGIES = ['manual'] as const;
export const assignmentStrategySchema = z.enum(ASSIGNMENT_STRATEGIES);
export type AssignmentStrategy = z.infer<typeof assignmentStrategySchema>;

/**
 * `POST /inbox/conversations/:id/assign`.
 *
 *  - `userId: <uuid>` assigns that person; their own id is a claim (the only form `inbox.conversation.assign_self` allows).
 *  - `userId: null` unassigns the person (the team, if any, stays: WaDesk has no way to remove a team, here `teamId: null` does).
 *  - `userId` omitted leaves the person alone, so a team can be set without touching the person.
 *  - `teamId` works the same way: omitted = unchanged, `null` = none, a uuid = that team.
 *
 * At least one of the two must be present. `rowVersion` is the version the caller last read; a stale one is `409 ROW_VERSION_CONFLICT`.
 */
export const assignConversationSchema = z
  .object({
    rowVersion: z.number().int().positive(),
    userId: uuidSchema.nullable().optional(),
    teamId: uuidSchema.nullable().optional(),
    strategy: assignmentStrategySchema.default('manual'),
  })
  .refine((v) => v.userId !== undefined || v.teamId !== undefined, {
    message: 'Name a user, a team, or null to clear one',
    path: ['userId'],
  });
export type AssignConversationInput = z.infer<typeof assignConversationSchema>;

/** The conversation as the list shows it after the change: the client replaces its row with this one. */
export const assignConversationResponseSchema = conversationSummarySchema;
export type AssignConversationResponse = z.infer<typeof assignConversationResponseSchema>;

// --- the picker ---------------------------------------------------------------------------------------------------------

export const inboxAssigneeSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  email: z.string(),
  availability: agentAvailabilitySchema,
  /** Open and pending conversations assigned to this person right now (a live count, not a stored counter). */
  openConversations: z.number().int().nonnegative(),
  /** The caller: the picker offers "Assign to me" for this one. */
  isMe: z.boolean(),
});
export type InboxAssignee = z.infer<typeof inboxAssigneeSchema>;

export const inboxAssigneeTeamSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  color: z.string().nullable(),
  memberCount: z.number().int().nonnegative(),
  /** The strategy the team will use once routing exists (Phase 3). Until then every assignment to a team is manual. */
  assignmentStrategy: z.string(),
});
export type InboxAssigneeTeam = z.infer<typeof inboxAssigneeTeamSchema>;

/**
 * `GET /inbox/assignees`: the staff a conversation can be given to (active members who may read the inbox) and the workspace's teams.
 * What the caller may actually do with them is in their permissions: `inbox.conversation.assign` anyone, `assign_self` only themselves.
 */
export const inboxAssigneesResponseSchema = z.object({
  users: z.array(inboxAssigneeSchema),
  teams: z.array(inboxAssigneeTeamSchema),
});
export type InboxAssigneesResponse = z.infer<typeof inboxAssigneesResponseSchema>;
