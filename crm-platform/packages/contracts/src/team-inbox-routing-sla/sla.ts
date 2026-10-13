import { z } from 'zod';
import { conversationPrioritySchema } from '../chat-conversations/enums';
import { uuidSchema } from '../common/ids';

/**
 * SLA policies (TW-TIB2-024 to 028, BL-036): response targets for conversations. A policy says how long a customer may wait for a first
 * human answer and how long a conversation may stay unresolved, optionally counting only business hours and with a different target per
 * priority. Routes: `/v2/inbox/sla/policies*` (plan feature `inbox_sla`; read with `inbox.settings.read`, change with `inbox.sla.manage`).
 */

export const SLA_FIRST_RESPONSE_MAX_MINUTES = 100_000;
export const SLA_RESOLUTION_MAX_MINUTES = 1_000_000;

const firstResponseSchema = z.number().int().min(1).max(SLA_FIRST_RESPONSE_MAX_MINUTES);
const resolutionSchema = z.number().int().min(1).max(SLA_RESOLUTION_MAX_MINUTES);

/** Per priority, either or both targets replace the policy's own (an absent key keeps the policy's value). */
export const slaPriorityOverrideSchema = z
  .object({
    firstResponseMinutes: firstResponseSchema.optional(),
    resolutionMinutes: resolutionSchema.optional(),
  })
  .strict();
export type SlaPriorityOverride = z.infer<typeof slaPriorityOverrideSchema>;

export const slaPriorityOverridesSchema = z
  .object({
    low: slaPriorityOverrideSchema.optional(),
    normal: slaPriorityOverrideSchema.optional(),
    high: slaPriorityOverrideSchema.optional(),
    urgent: slaPriorityOverrideSchema.optional(),
  })
  .strict();
export type SlaPriorityOverrides = z.infer<typeof slaPriorityOverridesSchema>;

export const inboxSlaPolicySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  firstResponseMinutes: z.number().int().nullable(),
  resolutionMinutes: z.number().int().nullable(),
  /** Do not count (or flag) the time a conversation waits on the customer (status pending). */
  pauseWhenWaitingOnCustomer: z.boolean(),
  /** Count only the workspace's business hours (Settings, business hours). */
  respectBusinessHours: z.boolean(),
  priorityOverrides: slaPriorityOverridesSchema,
  isDefault: z.boolean(),
  /** Conversations whose current clock came from this policy. */
  conversationCount: z.number().int().nonnegative(),
  rowVersion: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type InboxSlaPolicy = z.infer<typeof inboxSlaPolicySchema>;

export const inboxSlaPolicyListSchema = z.object({ data: z.array(inboxSlaPolicySchema) });
export type InboxSlaPolicyList = z.infer<typeof inboxSlaPolicyListSchema>;

export const createInboxSlaPolicySchema = z.object({
  name: z.string().trim().min(1).max(128),
  firstResponseMinutes: firstResponseSchema.nullish(),
  resolutionMinutes: resolutionSchema.nullish(),
  pauseWhenWaitingOnCustomer: z.boolean().default(true),
  respectBusinessHours: z.boolean().default(true),
  priorityOverrides: slaPriorityOverridesSchema.default({}),
  isDefault: z.boolean().default(false),
});
export type CreateInboxSlaPolicyInput = z.infer<typeof createInboxSlaPolicySchema>;

export const updateInboxSlaPolicySchema = z.object({
  rowVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(128).optional(),
  firstResponseMinutes: firstResponseSchema.nullish(),
  resolutionMinutes: resolutionSchema.nullish(),
  pauseWhenWaitingOnCustomer: z.boolean().optional(),
  respectBusinessHours: z.boolean().optional(),
  priorityOverrides: slaPriorityOverridesSchema.optional(),
  isDefault: z.boolean().optional(),
});
export type UpdateInboxSlaPolicyInput = z.infer<typeof updateInboxSlaPolicySchema>;

/** Which clock a conversation is on. */
export const SLA_KINDS = ['first_response', 'resolution'] as const;
export const slaKindSchema = z.enum(SLA_KINDS);
export type SlaKind = z.infer<typeof slaKindSchema>;

/** `ok` has time left, `at_risk` is within `SLA_AT_RISK_MINUTES` of its due time, `breached` is past it (flagged or about to be). */
export const SLA_STATES = ['ok', 'at_risk', 'breached'] as const;
export const slaStateSchema = z.enum(SLA_STATES);
export type SlaState = z.infer<typeof slaStateSchema>;
export const SLA_AT_RISK_MINUTES = 30;

/** What the list row and the thread header show: the clock that matters now. Null when the conversation has no running clock. */
export const slaStatusSchema = z.object({
  state: slaStateSchema,
  kind: slaKindSchema,
  dueAt: z.string().datetime(),
});
export type SlaStatus = z.infer<typeof slaStatusSchema>;
