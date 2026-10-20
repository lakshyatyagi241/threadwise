import { z } from 'zod';

/**
 * `GET /v2/workspace/teams/:id/usage` (BL-380): what deleting a team changes, as counts, so the delete confirmation can say it before
 * the click instead of after. Neutral on purpose: a team is used by conversation routing AND by record scope, assignment rules and
 * shared segments, so the answer lists all of them and not the inbox alone.
 */
export const wspTeamDeletePreviewSchema = z.object({
  /** People in the team now. */
  members: z.number().int().nonnegative(),
  /** Routing rules that name the team as a target: the team is removed from them (a rule left with nothing to do is switched off). */
  routingRules: z.number().int().nonnegative(),
  /** Record assignment rules that name the team in their pool: the team is removed from the pool. */
  assignmentRules: z.number().int().nonnegative(),
  /** Segments shared with the team: the share goes with the team. */
  segmentShares: z.number().int().nonnegative(),
  /** Conversations assigned to the team: they stay, with no team. */
  conversationsAssigned: z.number().int().nonnegative(),
  /** Team members who would no longer share a team with a colleague they share one with now, so what they see through "team records" shrinks. */
  peopleWithReachChange: z.number().int().nonnegative(),
});
export type WspTeamDeletePreview = z.infer<typeof wspTeamDeletePreviewSchema>;
