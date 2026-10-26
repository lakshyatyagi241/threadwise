import { z } from 'zod';
import { channelKindSchema } from '../chat-conversations/channels';
import { conversationPrioritySchema } from '../chat-conversations/enums';
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
 * dicts (Reference's shape): an optional `{ type: 'assign', ... }`, an optional `{ type: 'mark_spam' }` (the thread becomes spam), an
 * optional `{ type: 'trigger_flow', flowId }` (start a flow for the conversation) and an optional `{ type: 'note', description }` for the
 * rule's description. A rule has at least one of assign, mark_spam, trigger_flow.
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

/**
 * "New contact" / "Returning contact" (a condition that is known at arrival): a contact is RETURNING when it has another conversation, or was
 * saved more than this many minutes before the conversation. A contact the very message created is NEW. Spec decision H16.
 */
export const ROUTING_NEW_CONTACT_GRACE_MINUTES = 10;
export const ROUTING_CONTACT_KINDS = ['any', 'new', 'returning'] as const;
export const routingContactKindSchema = z.enum(ROUTING_CONTACT_KINDS);
export type RoutingContactKind = z.infer<typeof routingContactKindSchema>;

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
    /** Whether the customer is a new or a returning contact. Known at arrival, unlike the saved details below. */
    contactKind: routingContactKindSchema.default('any'),
    /**
     * Fields of the customer's contact that are ALREADY SAVED, evaluated with the segments rule engine (AND/OR groups, tags, owner, custom
     * fields). A contact created by this very message has nothing saved yet (stage "new", no tags, no owner, no custom field), so a condition
     * on a saved detail matches only contacts that already have it.
     */
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
    /**
     * "Distribute evenly among all agents" (the "Everyone else" row): the pool is every active member who can open the inbox (the lists above
     * must then be empty). Only available agents are picked: not offline or busy, not on leave, under their chat limit.
     */
    everyone: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.everyone) {
      if (v.userIds.length + v.teamIds.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['everyone'],
          message: 'Everyone cannot be combined with a list of agents or teams',
        });
      }
      if (v.strategy === 'specific') {
        ctx.addIssue({
          code: 'custom',
          path: ['strategy'],
          message: 'Choose round robin or least busy for everyone',
        });
      }
      return;
    }
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

/** Whether a rule does anything when it fires: an assignment, marking the thread as spam, or starting a flow. */
export function hasRoutingActions(v: {
  assign?: RoutingAssign | null;
  markSpam?: boolean;
  priority?: string | null;
  addTags?: unknown[];
  escalation?: unknown | null;
  autoReply?: unknown | null;
  triggerFlowId?: string | null;
}): boolean {
  return (
    v.assign != null ||
    v.markSpam === true ||
    (v.priority ?? null) !== null ||
    (v.addTags ?? []).length > 0 ||
    (v.escalation ?? null) !== null ||
    (v.autoReply ?? null) !== null ||
    (v.triggerFlowId ?? null) !== null
  );
}

export const ROUTING_ESCALATION_MAX_MINUTES = 1440;

/**
 * A deferred action (Reference's set_escalation): when the conversation is still open with no reply from us this many minutes after the
 * rule fired, it is reassigned (by this rule's agents, as they are when it fired) and/or its priority is set. A reply from us before that
 * cancels it.
 */
export const routingEscalationSchema = z
  .object({
    minutes: z.number().int().min(1).max(ROUTING_ESCALATION_MAX_MINUTES),
    reassign: z.boolean(),
    priority: conversationPrioritySchema.nullable(),
  })
  .strict()
  .refine((v) => v.reassign || v.priority !== null, {
    message: 'Reassign it, set a priority, or both.',
    path: ['reassign'],
  });
export type RoutingEscalation = z.infer<typeof routingEscalationSchema>;

export const ROUTING_AUTO_REPLY_MAX = 1024;

/**
 * An automatic reply the rule sends to the customer (Reference's `auto_reply`, free text). It runs for the customer's message that matched
 * (the new conversation's first message, and each later message of a live conversation that matches the rule). Sent as the business, so
 * the channel's rules apply: outside the 24 hour window a free-form reply is refused and the message is not sent.
 */
export const routingAutoReplySchema = z.object({
  body: z.string().trim().min(1).max(ROUTING_AUTO_REPLY_MAX),
});
export type RoutingAutoReply = z.infer<typeof routingAutoReplySchema>;

export const ROUTING_TAG_NAME_MAX = 100;
export const ROUTING_TAGS_MAX = 5;

/** A tag the rule adds: found by name (case-insensitive, as the tag library is), created with this colour when it is new. */
export const routingTagSchema = z.object({
  name: z.string().trim().min(1).max(ROUTING_TAG_NAME_MAX),
  color: z.string().trim().max(20).nullable(),
});
export type RoutingTag = z.infer<typeof routingTagSchema>;

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
  /** Hand the conversation to one of these agents. Null when the rule only marks spam or starts a flow. */
  assign: routingAssignSchema.nullable(),
  /** Mark the conversation as spam when the rule fires (Reference's `mark_spam`); it leaves the open list. */
  markSpam: z.boolean(),
  /** Set the conversation's priority when the rule fires (Reference's `set_priority`); null leaves it alone. */
  priority: conversationPrioritySchema.nullable(),
  /** Tags to add when the rule fires (Reference's `add_tag`). */
  addTags: z.array(routingTagSchema),
  /** A deferred reassignment or priority, if no one replies in time (Reference's `set_escalation`). */
  escalation: routingEscalationSchema.nullable(),
  /** An automatic reply to the customer (Reference's `auto_reply`); null for none. */
  autoReply: routingAutoReplySchema.nullable(),
  /** Also start this flow for the conversation when the rule fires. The flow only has to be switched on (publishing is not required). */
  triggerFlow: routingTriggerFlowSchema.nullable(),
  stopOnMatch: z.boolean(),
  isActive: z.boolean(),
  /** The one rule that runs when no other rule matched. */
  isFallback: z.boolean(),
  /** "Only for conversations that match" is off: the rule applies to every conversation and `conditions` (kept) are ignored. */
  appliesToAll: z.boolean(),
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
  v: { conditions?: RoutingConditions; isFallback?: boolean; appliesToAll?: boolean },
  ctx: z.RefinementCtx,
) => {
  if (v.conditions && !v.isFallback && !v.appliesToAll && !hasRoutingConditions(v.conditions)) {
    ctx.addIssue({
      code: 'custom',
      path: ['conditions'],
      message: 'Add at least one condition, or let the rule apply to every conversation.',
    });
  }
};

/** Whether any part of the conditions is set. A rule with none needs `appliesToAll` (or to be the fallback) to ever match. */
export function hasRoutingConditions(c: RoutingConditions): boolean {
  return (
    c.contact !== null ||
    c.contactKind !== 'any' ||
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
    assign: routingAssignSchema.nullable().default(null),
    markSpam: z.boolean().default(false),
    priority: conversationPrioritySchema.nullable().default(null),
    addTags: z.array(routingTagSchema).max(ROUTING_TAGS_MAX).default([]),
    escalation: routingEscalationSchema.nullable().default(null),
    autoReply: routingAutoReplySchema.nullable().default(null),
    triggerFlowId: uuidSchema.nullable().default(null),
    stopOnMatch: z.boolean().default(true),
    isFallback: z.boolean().default(false),
    /** Default false: an API client that sends no conditions and no flag is still refused, as before. The screen sends true for "every conversation". */
    appliesToAll: z.boolean().default(false),
    isActive: z.boolean().default(false),
  })
  .strict()
  .superRefine(conditionsRefine)
  .superRefine((v, ctx) => {
    if (!hasRoutingActions(v)) {
      ctx.addIssue({
        code: 'custom',
        path: ['assign'],
        message: 'Choose what the rule does: assign it, mark it as spam, or start a flow.',
      });
    }
  });
export type CreateRoutingRuleInput = z.infer<typeof createRoutingRuleSchema>;

/** `PATCH /inbox/routing/rules/:id`: any subset, with the row version read. A body of only `isActive` is the list's toggle. */
export const updateRoutingRuleSchema = z
  .object({
    rowVersion: z.number().int().positive(),
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    conditions: routingConditionsSchema.optional(),
    assign: routingAssignSchema.nullable().optional(),
    markSpam: z.boolean().optional(),
    priority: conversationPrioritySchema.nullable().optional(),
    addTags: z.array(routingTagSchema).max(ROUTING_TAGS_MAX).optional(),
    escalation: routingEscalationSchema.nullable().optional(),
    autoReply: routingAutoReplySchema.nullable().optional(),
    triggerFlowId: uuidSchema.nullable().optional(),
    stopOnMatch: z.boolean().optional(),
    isFallback: z.boolean().optional(),
    appliesToAll: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
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

// --- "Try it": the dry run ---------------------------------------------------------------------------------------------------

/**
 * `POST /inbox/routing/test`: which step of the arrival pipeline would decide for this contact, channel and message, and why. It runs the
 * engine's own decision code in a read-only transaction: nothing is assigned, counted, moved or sent. Needs `inbox.settings.read`.
 */
export const routingTestRequestSchema = z
  .object({
    /** The contact (uuid) the sample conversation belongs to; omitted = a brand-new contact nobody knows yet. */
    contactId: uuidSchema.nullable().default(null),
    channelKind: channelKindSchema,
    messageText: z.string().trim().max(2000).default(''),
    /** The customer's language, when the sample should have one. */
    language: z.string().trim().min(2).max(16).nullable().default(null),
    /** Pretend the message arrives inside/outside business hours; null = decide from the clock and the saved hours now. */
    outsideHours: z.boolean().nullable().default(null),
  })
  .strict();
export type RoutingTestRequest = z.infer<typeof routingTestRequestSchema>;

export const ROUTING_TEST_PARTS = [
  'contactKind',
  'contact',
  'channel',
  'keywords',
  'languages',
  'businessHours',
] as const;
export const routingTestPartSchema = z.enum(ROUTING_TEST_PARTS);
export type RoutingTestPart = z.infer<typeof routingTestPartSchema>;

export const routingTestConditionSchema = z.object({
  part: routingTestPartSchema,
  matched: z.boolean(),
  /** A machine code the screen words: `no_saved_value`, `no_contact`, `not_same_kind`, `channel_differs`, `no_word`, `language_differs`, `hours_differ`. */
  why: z.string().nullable(),
});
export type RoutingTestCondition = z.infer<typeof routingTestConditionSchema>;

export const ROUTING_TEST_STEP_KINDS = [
  'switch',
  'sticky',
  'rule',
  'everyone_else',
  'queue',
] as const;
export const routingTestStepSchema = z.object({
  kind: z.enum(ROUTING_TEST_STEP_KINDS),
  /** `decided`: this step gave the conversation away. `passed`: it looked and moved on. `info`: a note. */
  result: z.enum(['decided', 'passed', 'info']),
  ruleId: uuidSchema.nullable(),
  ruleName: z.string().nullable(),
  /** A machine code: `auto_assign_off`, `owner`, `last_handler`, `no_owner`, `no_previous_handler`, `conditions_failed`, `nobody_available`, ... */
  why: z.string(),
  conditions: z.array(routingTestConditionSchema),
});
export type RoutingTestStep = z.infer<typeof routingTestStepSchema>;

export const routingTestResponseSchema = z.object({
  /** The step that decided. `queue`: nobody took it, it waits for a claim. `off`: automatic assignment is switched off. */
  outcome: z.enum(['sticky', 'rule', 'everyone_else', 'queue', 'off']),
  ruleId: uuidSchema.nullable(),
  ruleName: z.string().nullable(),
  assigneeUserId: uuidSchema.nullable(),
  assigneeTeamId: uuidSchema.nullable(),
  /** The strategy that picked (`round_robin`, `least_busy`, `specific`, `owner`, `contact_agent`), null when nobody was picked. */
  how: z.string().nullable(),
  steps: z.array(routingTestStepSchema),
  /** Who was left out and why (on leave, offline or at their chat limit), the same lines a handoff records. */
  trace: z.array(
    z.object({
      step: z.string(),
      who: z.string().nullable().optional(),
      result: z.string(),
      why: z.string().nullable().optional(),
    }),
  ),
  contact: z.object({
    found: z.boolean(),
    kind: z.enum(['new', 'returning']).nullable(),
    stage: z.string().nullable(),
    hasOwner: z.boolean(),
    tagCount: z.number().int().nonnegative(),
  }),
  /** Whether the sample counted as outside business hours. */
  outsideHours: z.boolean(),
});
export type RoutingTestResponse = z.infer<typeof routingTestResponseSchema>;
