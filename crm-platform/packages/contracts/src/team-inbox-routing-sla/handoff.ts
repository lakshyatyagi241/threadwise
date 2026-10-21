import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { conversationSummarySchema } from '../chat-conversations/conversation';
import { conversationPrioritySchema } from '../chat-conversations/enums';

/**
 * Conversation handoff and assignment (BL-396..BL-404, docs/specs/conversation-handoff-and-assignment.md).
 *
 * ONE action says "a person must take this conversation": the flow's Human handoff node, the AI agent, a customer's "talk to a person"
 * keyword, a bot that failed and a person's "send to queue" all call `HandoffService.handoff`. It sets an explicit handling state, mutes
 * the bot, writes the handoff card the agent reads, finds the person (a named one, a team's queue, or the workspace's rules when the plan
 * has them) and records why, step by step, in a trace.
 */

// --- the handling state ---------------------------------------------------------------------------------------------------

/**
 * Who handles the thread. `null` on the wire = not tracked (no handoff ever touched it): it behaves as it always did. `waiting` = in a
 * queue, nobody holds it; `with_person` = a person holds it; `with_bot` = a bot answers (set when a person gives it back).
 */
export const HANDLING_STATES = ['with_bot', 'waiting', 'with_person'] as const;
export const handlingSchema = z.enum(HANDLING_STATES);
export type Handling = z.infer<typeof handlingSchema>;

/** Who set the current assignee. The owner sync only ever moves a thread an AUTOMATIC source assigned, never one a person took. */
export const ASSIGNED_SOURCES = [
  'manual',
  'claim',
  'handoff_named',
  'rule',
  'owner',
  'sticky',
  'sync',
  'system',
] as const;
export const assignedSourceSchema = z.enum(ASSIGNED_SOURCES);
export type AssignedSource = z.infer<typeof assignedSourceSchema>;
/** Sources a person (or an author who named the person) decided: never moved by an automatic rule or by the owner sync. */
export const HUMAN_ASSIGNED_SOURCES: readonly AssignedSource[] = [
  'manual',
  'claim',
  'handoff_named',
];

// --- the request ----------------------------------------------------------------------------------------------------------

export const HANDOFF_SOURCES = ['flow', 'ai_agent', 'keyword', 'bot_failure', 'manual'] as const;
export const handoffSourceSchema = z.enum(HANDOFF_SOURCES);
export type HandoffSource = z.infer<typeof handoffSourceSchema>;

/** The reason picklist; the free text goes next to it. Labels are translated by the web (vocabulary layer). */
export const HANDOFF_REASONS = [
  'customer_asked',
  'bot_could_not_help',
  'sensitive_topic',
  'sales_lead',
  'complaint',
  'other',
] as const;
export const handoffReasonSchema = z.enum(HANDOFF_REASONS);
export type HandoffReason = z.infer<typeof handoffReasonSchema>;

/** `rules` = the workspace's routing rules (needs the plan feature `inbox_routing`; without it the conversation waits in the queue). */
export const handoffDestinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('person'), userId: uuidSchema, teamId: uuidSchema.optional() }),
  z.object({ kind: z.literal('team'), teamId: uuidSchema }),
  z.object({ kind: z.literal('rules') }),
]);
export type HandoffDestination = z.infer<typeof handoffDestinationSchema>;

/** The three exits of the Human handoff node. */
export const HANDOFF_OUTCOMES = ['assigned', 'waiting', 'unavailable'] as const;
export const handoffOutcomeSchema = z.enum(HANDOFF_OUTCOMES);
export type HandoffOutcome = z.infer<typeof handoffOutcomeSchema>;
/** Output port of the flow node per outcome (port 1 is also what the legacy Assign agent node leaves by). */
export const HANDOFF_PORTS: Record<HandoffOutcome, number> = {
  assigned: 1,
  waiting: 2,
  unavailable: 3,
};

export const HANDOFF_ANSWERS_MAX_KEYS = 20;
export const HANDOFF_ANSWER_MAX_CHARS = 500;

/** `POST /v2/inbox/conversations/:id/handoff`: a person sends a conversation to the queue (or to a person, team or the rules). */
export const requestHandoffSchema = z.object({
  reason: handoffReasonSchema.default('other'),
  reasonText: z.string().trim().max(500).optional(),
  summary: z.string().trim().max(2000).optional(),
  destination: handoffDestinationSchema.default({ kind: 'rules' }),
  priority: conversationPrioritySchema.optional(),
});
export type RequestHandoffInput = z.infer<typeof requestHandoffSchema>;

export const claimConversationSchema = z.object({ rowVersion: z.number().int().positive() });
export type ClaimConversationInput = z.infer<typeof claimConversationSchema>;

export const returnToBotSchema = z.object({ note: z.string().trim().max(500).optional() });
export type ReturnToBotInput = z.infer<typeof returnToBotSchema>;

// --- the card and the trace -----------------------------------------------------------------------------------------------

/** One line of the trace: who was considered, who was skipped and why, who was chosen. */
export const HANDOFF_TRACE_RESULTS = ['chosen', 'skipped', 'info'] as const;
export const handoffTraceLineSchema = z.object({
  step: z.string(),
  who: z.string().nullable().optional(),
  result: z.enum(HANDOFF_TRACE_RESULTS),
  why: z.string().optional(),
});
export type HandoffTraceLine = z.infer<typeof handoffTraceLineSchema>;

export const HANDOFF_STATUSES = [
  'waiting',
  'assigned',
  'returned',
  'resolved',
  'cancelled',
] as const;

export const handoffCardSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  source: handoffSourceSchema,
  reason: handoffReasonSchema,
  reasonText: z.string().nullable(),
  summary: z.string().nullable(),
  /** The flow variables the author chose to pass on. */
  answers: z.record(z.string()),
  destination: z.object({
    kind: z.enum(['person', 'team', 'rules']),
    user: z.object({ id: uuidSchema, name: z.string().nullable() }).nullable(),
    team: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  }),
  priority: conversationPrioritySchema.nullable(),
  status: z.enum(HANDOFF_STATUSES),
  outcome: handoffOutcomeSchema,
  assignedTo: z.object({
    user: z.object({ id: uuidSchema, name: z.string().nullable() }).nullable(),
    team: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  }),
  trace: z.array(handoffTraceLineSchema),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type HandoffCard = z.infer<typeof handoffCardSchema>;

/** `GET /v2/inbox/conversations/:id/handoff`: the latest handoff of the thread (live first), or null. */
export const conversationHandoffResponseSchema = z.object({
  handoff: handoffCardSchema.nullable(),
});
export type ConversationHandoffResponse = z.infer<typeof conversationHandoffResponseSchema>;

/** What a handoff, claim or return answers: the conversation as the list shows it, and the outcome. */
export const handoffResultSchema = z.object({
  conversation: conversationSummarySchema,
  outcome: handoffOutcomeSchema,
  handoff: handoffCardSchema.nullable(),
});
export type HandoffResult = z.infer<typeof handoffResultSchema>;

/** Outbox event written when a handoff is recorded; payload `conversationId`, `handoffId`, `source`, `reason`, `outcome`, `toUserId`, `toTeamId` (uuids). */
export const CONVERSATION_HANDOFF_REQUESTED = 'conversation.handoff_requested';
/** Realtime hint to the audience of the queue: a conversation entered or left it. Ids only. */
export const REALTIME_HANDOFF_EVENT = 'inbox.handoff';

// --- settings -------------------------------------------------------------------------------------------------------------

export const OWNER_MODES = ['independent', 'owner_first', 'keep_in_sync'] as const;
export const ownerModeSchema = z.enum(OWNER_MODES);
export type OwnerMode = z.infer<typeof ownerModeSchema>;

/**
 * The plan feature each capability checks, in ONE place, so the owner can move a capability between plans in plan management without a
 * code change (the key is the only thing that decides). `claim`, the queue and manual assignment need no plan: they are not listed.
 * The sticky capabilities also need `inbox_routing` (a plan without routing has no automatic assignment of any kind).
 */
export const HANDOFF_GATES = {
  autoAssign: 'inbox_routing',
  ownerFirst: 'inbox_assignment_sticky',
  keepInSync: 'inbox_assignment_sticky',
  continuityWindow: 'inbox_assignment_sticky',
  promptOwnerOnReassign: 'inbox_assignment_sticky',
} as const;
export type HandoffGate = keyof typeof HANDOFF_GATES;

export const handoffSettingsSchema = z.object({
  /** Automatic assignment on or off (arrival routing and the "assignment rules" destination). Default on = today. */
  autoAssign: z.boolean(),
  /** A claim makes the claimer the contact's owner when the contact has none (all plans). */
  claimSetsOwner: z.boolean(),
  ownerMode: ownerModeSchema,
  /** Days a returning contact keeps the person who handled the last conversation; null = no limit (today). */
  continuityDays: z.number().int().min(1).max(365).nullable(),
  /** Manual reassignment of a chat offers "also make X the contact owner?". */
  promptOwnerOnReassign: z.boolean(),
  notifyQueue: z.boolean(),
  /** Per capability: false when the plan does not include it (the UI shows a lock and an upgrade hint, never a silent no-op). */
  available: z.object({
    autoAssign: z.boolean(),
    ownerFirst: z.boolean(),
    keepInSync: z.boolean(),
    continuityWindow: z.boolean(),
    promptOwnerOnReassign: z.boolean(),
  }),
});
export type HandoffSettings = z.infer<typeof handoffSettingsSchema>;

export const updateHandoffSettingsSchema = handoffSettingsSchema
  .omit({ available: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });
export type UpdateHandoffSettingsInput = z.infer<typeof updateHandoffSettingsSchema>;

// --- owner events ---------------------------------------------------------------------------------------------------------

/**
 * Where a contact-owner change came from, carried in the audit row and the outbox event so two systems never fight: the sync consumer
 * ignores `chat_claim` and `owner_sync` (its own writes), and the record engine never moves an owner somebody stamped.
 */
export const OWNER_CHANGE_SOURCES = [
  'manual',
  'bulk',
  'import',
  'engine',
  'chat_claim',
  'owner_sync',
] as const;
export type OwnerChangeSource = (typeof OWNER_CHANGE_SOURCES)[number];
