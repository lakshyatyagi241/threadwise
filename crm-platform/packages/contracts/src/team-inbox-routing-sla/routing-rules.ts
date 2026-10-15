import { z } from 'zod';
import { channelKindSchema } from '../chat-conversations/channels';
import { pageInfoSchema } from '../common/pagination';
import { uuidSchema } from '../common/ids';
import { segmentRulesSchema } from '../segments/rules';

/**
 * team-inbox-routing-sla: routing rules, the auto-assignment of a new conversation (TW-TIB2-004 to 011, 020).
 *
 * A rule is "when a conversation matches these conditions, give it to one of these agents". Rules are tried in `sort` order; the first
 * match wins unless it says `stopOnMatch: false`; the one rule marked `isFallback` runs only when no other rule matched.
 *
 * Storage (no new table): `routing_rules.conditions` holds `routingConditionsSchema`, `routing_rules.actions` holds a list of action
 * dicts (Reference's shape): one `{ type: 'assign', ... }`, an optional `{ type: 'trigger_flow', flowId }` (start a flow for the conversation)
 * and an optional `{ type: 'note', description }` for the rule's description.
 * The round robin cursor (`rrCursor`, the internal id of the agent who got the last one) lives in the assign action and never leaves
 * the server. Port additions beyond the inventory (marked "addition" in the inventory file): `least_busy`/`specific` strategies on a
 * set of agents, the `contact` condition (the shared segment rule tree), `keywords`, `languages`, `channelKinds`, and the
 * "keep returning contacts with their agent" setting.
 */

/**
 * The outbox event a firing rule writes (in the transaction that fires it) when it starts a flow. The flow runtime's worker consumes it
 * by name (modules do not import each other's internals): payload `conversationId`, `flowId` (uuids), `ruleId`, `ruleName`,
 * `messageUuid` (the inbound message that made the conversation, the idempotency key of the start).
 */
export const ROUTING_FLOW_REQUESTED = 'routing.flow_requested';

/**
 * Written when routing could not give a new conversation to anybody because the people it wanted are on leave and nobody (delegate or team)
 * took their place (BL-112). The leads are told, with a link to the conversation.
 */
export const ROUTING_BLOCKED_BY_LEAVE = 'routing.blocked_by_leave';

export const ROUTING_STRATEGIES = ['round_robin', 'least_busy', 'specific'] as const;
export const routingStrategySchema = z.enum(ROUTING_STRATEGIES);
export type RoutingStrategy = z.infer<typeof routingStrategySchema>;

export const ROUTING_NAME_MAX = 128;
export const ROUTING_DESCRIPTION_MAX = 500;
export const ROUTING_KEYWORDS_MAX = 20;
export const ROUTING_TARGETS_MAX = 50;
export const ROUTING_LIST_MAX = 100;

/** When a rule applies. Every part that is set must hold (AND); an empty part is not a condition. A rule with no condition is a catch-all. */
export const routingConditionsSchema = z
  .object({
    /** Fields of the customer's contact, evaluated with the segments rule engine (AND/OR groups, tags, owner, custom fields). */
    contact: segmentRulesSchema.nullable().default(null),
    /** The channel the customer wrote on. */
    channelKinds: z.array(channelKindSchema).max(10).default([]),
    /** Words in the customer's first message (case-insensitive substring): any of them, or all of them. */
    keywords: z
      .object({
        mode: z.enum(['any', 'all']).default('any'),
        words: z.array(z.string().trim().min(1).max(100)).min(1).max(ROUTING_KEYWORDS_MAX),
      })
      .strict()
      .nullable()
      .default(null),
    /** The customer's language (`en`, `ar`, ...), as the translation reading stored it; unknown language never matches. */
    languages: z.array(z.string().trim().min(2).max(16)).max(20).default([]),
    /** Whether the message arrives inside or outside the workspace's business hours. */
    businessHours: z.enum(['any', 'inside', 'outside']).default('any'),
  })
  .strict();
export type RoutingConditions = z.infer<typeof routingConditionsSchema>;

/**
 * The action: hand the conversation to one agent of this set (people, plus the members of the listed teams). `round_robin` goes
 * around the set in turn (the cursor is kept per rule), `least_busy` picks who holds the fewest open conversations, `specific` is
 * the one person named. Only active members who can open the inbox and are not marked offline or busy are picked; when nobody in
 * the set is available and a team is listed, the conversation goes to that team's queue (no person) instead.
 */
export const routingAssignSchema = z
  .object({
    strategy: routingStrategySchema,
    userIds: z.array(uuidSchema).max(ROUTING_TARGETS_MAX).default([]),
    teamIds: z.array(uuidSchema).max(ROUTING_TARGETS_MAX).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.userIds).size !== v.userIds.length) {
      ctx.addIssue({ code: 'custom', path: ['userIds'], message: 'Each agent once' });
    }
    if (v.userIds.length + v.teamIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['userIds'],
        message: 'Choose at least one agent or team',
      });
    }
    if (v.strategy === 'specific' && (v.userIds.length !== 1 || v.teamIds.length > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['userIds'],
        message: 'Choose exactly one agent for "specific"',
      });
    }
  });
export type RoutingAssign = z.infer<typeof routingAssignSchema>;

const nameSchema = z.string().trim().min(1).max(ROUTING_NAME_MAX);
const descriptionSchema = z.string().trim().max(ROUTING_DESCRIPTION_MAX);

/**
 * The flow a rule starts for the conversation (TW-TIB2-017, Reference's `trigger_flow` action). The flow is chosen by its uuid; the name
 * and the switch are read when the rule is shown, so a rule pointing at a flow that was paused or deleted says so (`null` name: gone).
 */
export const routingTriggerFlowSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  isActive: z.boolean(),
});
export type RoutingTriggerFlow = z.infer<typeof routingTriggerFlowSchema>;

export const routingRuleSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string(),
  conditions: routingConditionsSchema,
  assign: routingAssignSchema,
  /** Also start this flow for the conversation when the rule fires. The flow only has to be switched on (publishing is not required). */
  triggerFlow: routingTriggerFlowSchema.nullable(),
  stopOnMatch: z.boolean(),
  isActive: z.boolean(),
  /** The one rule that runs when no other rule matched. */
  isFallback: z.boolean(),
  /** Position in the order rules are tried (1 = first). */
  position: z.number().int().positive(),
  firedCount: z.number().int().nonnegative(),
  lastFiredAt: z.string().datetime().nullable(),
  /** Agents or teams of the action that no longer exist or can no longer take conversations (the rule skips them). */
  unavailableTargets: z.number().int().nonnegative(),
  rowVersion: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RoutingRule = z.infer<typeof routingRuleSchema>;

/** `GET /inbox/routing/rules`: search by name, page with the cursor. Ordered by priority. */
export const listRoutingRulesQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(ROUTING_LIST_MAX).default(50),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListRoutingRulesQuery = z.infer<typeof listRoutingRulesQuerySchema>;

export const routingRuleListResponseSchema = z.object({
  data: z.array(routingRuleSchema),
  page: pageInfoSchema,
  /** All rules of the workspace, for "n of limit". `limit` null = unlimited. */
  total: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative().nullable(),
});
export type RoutingRuleListResponse = z.infer<typeof routingRuleListResponseSchema>;

const conditionsRefine = (
  v: { conditions?: RoutingConditions; isFallback?: boolean },
  ctx: z.RefinementCtx,
) => {
  if (v.conditions && !v.isFallback && !hasRoutingConditions(v.conditions)) {
    ctx.addIssue({
      code: 'custom',
      path: ['conditions'],
      message: 'Add at least one condition, or mark this rule as the fallback.',
    });
  }
};

/** Whether any part of the conditions is set. A rule with none is only valid as the fallback. */
export function hasRoutingConditions(c: RoutingConditions): boolean {
  return (
    c.contact !== null ||
    c.channelKinds.length > 0 ||
    c.keywords !== null ||
    c.languages.length > 0 ||
    c.businessHours !== 'any'
  );
}

/** `POST /inbox/routing/rules`. `activate: true` is the form's "Save and Activate"; the default saves it switched off. */
export const createRoutingRuleSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema.default(''),
    conditions: routingConditionsSchema.default({}),
    assign: routingAssignSchema,
    triggerFlowId: uuidSchema.nullable().default(null),
    stopOnMatch: z.boolean().default(true),
    isFallback: z.boolean().default(false),
    isActive: z.boolean().default(false),
  })
  .strict()
  .superRefine(conditionsRefine);
export type CreateRoutingRuleInput = z.infer<typeof createRoutingRuleSchema>;

/** `PATCH /inbox/routing/rules/:id`: any subset, with the row version read. A body of only `isActive` is the list's toggle. */
export const updateRoutingRuleSchema = z
  .object({
    rowVersion: z.number().int().positive(),
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    conditions: routingConditionsSchema.optional(),
    assign: routingAssignSchema.optional(),
    triggerFlowId: uuidSchema.nullable().optional(),
    stopOnMatch: z.boolean().optional(),
    isFallback: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine(conditionsRefine);
export type UpdateRoutingRuleInput = z.infer<typeof updateRoutingRuleSchema>;

/**
 * `POST /inbox/routing/rules/reorder`: the rules listed take the priority slots they hold now, in this order; rules not listed keep
 * theirs. Dragging inside one loaded page therefore never disturbs rules on other pages.
 */
export const reorderRoutingRulesSchema = z
  .object({ ids: z.array(uuidSchema).min(2).max(ROUTING_LIST_MAX) })
  .strict()
  .refine((v) => new Set(v.ids).size === v.ids.length, {
    message: 'Each rule once',
    path: ['ids'],
  });
export type ReorderRoutingRulesInput = z.infer<typeof reorderRoutingRulesSchema>;

/** `GET/PUT /inbox/routing/settings`. */
export const routingSettingsSchema = z.object({
  /**
   * "Keep returning contacts with their agent": a new or reopened conversation of a contact who already has an agent goes to that
   * agent first (the contact's owner, else whoever handled their last conversation), as long as they are still an active agent;
   * otherwise the rules run as usual.
   */
  keepContactAgent: z.boolean(),
});
export type RoutingSettings = z.infer<typeof routingSettingsSchema>;
export const updateRoutingSettingsSchema = routingSettingsSchema.strict();
export type UpdateRoutingSettingsInput = z.infer<typeof updateRoutingSettingsSchema>;
