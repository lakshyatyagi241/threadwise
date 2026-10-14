import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Auto-assignment of contacts and deals (BL-013, BL-112 phase 3). Priority-ordered rules give a NEW contact or deal that has no owner to
 * a person: a fixed one, or a rotation over people and teams (round robin, least busy by the owned records they hold now). People on
 * leave are never picked (a fixed person who is away is replaced by their delegate); offline people are skipped unless the rule says
 * otherwise. The switch is per workspace and OFF by default. An owner someone set is never replaced.
 *
 * Conditions are all optional and all must hold (an empty list means "any"); a rule with none is a catch-all.
 *  - contacts: `sources` (the contact's source text), `countryCodes` (its country field), `phonePrefixes` (digits the number starts with:
 *    country from phone), `lifecycleStages`, `tagIds` (has ANY of these tags), `origins` (how it arrived), `properties` (custom properties
 *    that equal a value, ALL of them);
 *  - deals: `pipelineIds`, `sources`, `valueMin` / `valueMax` (the deal's value in whole units of its own currency, two decimals assumed).
 */
export const ASSIGNMENT_SUBJECTS = ['contact', 'deal'] as const;
export const assignmentSubjectSchema = z.enum(ASSIGNMENT_SUBJECTS);
export type AssignmentSubject = z.infer<typeof assignmentSubjectSchema>;

export const CONTACT_ASSIGNMENT_STRATEGIES = ['fixed', 'round_robin', 'least_busy'] as const;
export const contactAssignmentStrategySchema = z.enum(CONTACT_ASSIGNMENT_STRATEGIES);
export type ContactAssignmentStrategy = z.infer<typeof contactAssignmentStrategySchema>;

/** How a record arrived, as the creating event reports it. */
export const ASSIGNMENT_ORIGINS = ['manual', 'import', 'inbound', 'form', 'lead', 'api'] as const;

const textList = z.array(z.string().trim().min(1).max(120)).max(50).default([]);

export const assignmentConditionsSchema = z.object({
  sources: textList,
  countryCodes: textList,
  phonePrefixes: z
    .array(z.string().regex(/^\d{1,6}$/))
    .max(50)
    .default([]),
  lifecycleStages: textList,
  tagIds: z.array(uuidSchema).max(50).default([]),
  origins: z.array(z.enum(ASSIGNMENT_ORIGINS)).max(10).default([]),
  properties: z
    .array(z.object({ key: z.string().trim().min(1).max(80), equals: z.string().max(500) }))
    .max(20)
    .default([]),
  pipelineIds: z.array(uuidSchema).max(50).default([]),
  valueMin: z.number().nonnegative().nullable().default(null),
  valueMax: z.number().nonnegative().nullable().default(null),
});
export type AssignmentConditions = z.infer<typeof assignmentConditionsSchema>;

const ruleBody = {
  name: z.string().trim().min(1).max(120),
  subject: assignmentSubjectSchema,
  conditions: assignmentConditionsSchema.default({}),
  strategy: contactAssignmentStrategySchema,
  userIds: z.array(uuidSchema).max(100).default([]),
  teamIds: z.array(uuidSchema).max(20).default([]),
  /** Skip people marked offline (default). Busy people are still picked: this is ownership, not a live chat. */
  skipOffline: z.boolean().default(true),
  isActive: z.boolean().default(true),
};

export const createAssignmentRuleSchema = z
  .object(ruleBody)
  .refine((v) => v.userIds.length + v.teamIds.length > 0, {
    message: 'Name at least one person or team',
    path: ['userIds'],
  })
  .refine((v) => v.strategy !== 'fixed' || (v.userIds.length === 1 && v.teamIds.length === 0), {
    message: 'A fixed rule names exactly one person',
    path: ['userIds'],
  });
export type CreateAssignmentRuleInput = z.infer<typeof createAssignmentRuleSchema>;

export const updateAssignmentRuleSchema = z.object({
  rowVersion: z.number().int().positive(),
  name: ruleBody.name.optional(),
  conditions: assignmentConditionsSchema.optional(),
  strategy: contactAssignmentStrategySchema.optional(),
  userIds: ruleBody.userIds.optional(),
  teamIds: ruleBody.teamIds.optional(),
  skipOffline: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateAssignmentRuleInput = z.infer<typeof updateAssignmentRuleSchema>;

export const reorderAssignmentRulesSchema = z.object({
  subject: assignmentSubjectSchema,
  ids: z.array(uuidSchema).min(1).max(200),
});
export type ReorderAssignmentRulesInput = z.infer<typeof reorderAssignmentRulesSchema>;

export const assignmentRuleSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  subject: assignmentSubjectSchema,
  conditions: assignmentConditionsSchema,
  strategy: contactAssignmentStrategySchema,
  userIds: z.array(uuidSchema),
  teamIds: z.array(uuidSchema),
  skipOffline: z.boolean(),
  isActive: z.boolean(),
  position: z.number().int(),
  firedCount: z.number().int(),
  lastFiredAt: z.string().datetime().nullable(),
  rowVersion: z.number().int(),
});
export type AssignmentRule = z.infer<typeof assignmentRuleSchema>;

export const assignmentSettingsSchema = z.object({
  enabled: z.boolean(),
  applyToImports: z.boolean(),
});
export type AssignmentSettings = z.infer<typeof assignmentSettingsSchema>;
export const updateAssignmentSettingsSchema = assignmentSettingsSchema.partial();
export type UpdateAssignmentSettingsInput = z.infer<typeof updateAssignmentSettingsSchema>;

/** `POST /assignment/test`: "which rule would take this, and who?", without assigning anything. Name a real record, or describe one. */
export const testAssignmentSchema = z
  .object({
    subject: assignmentSubjectSchema,
    recordId: uuidSchema.optional(),
    facts: z
      .object({
        source: z.string().nullable().optional(),
        countryCode: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        lifecycleStage: z.string().nullable().optional(),
        tagIds: z.array(uuidSchema).optional(),
        origin: z.enum(ASSIGNMENT_ORIGINS).optional(),
        properties: z.record(z.string()).optional(),
        pipelineId: uuidSchema.nullable().optional(),
        value: z.number().nullable().optional(),
      })
      .optional(),
  })
  .refine((v) => v.recordId !== undefined || v.facts !== undefined, {
    message: 'Name a record or describe one',
    path: ['recordId'],
  });
export type TestAssignmentInput = z.infer<typeof testAssignmentSchema>;

export const testAssignmentResponseSchema = z.object({
  enabled: z.boolean(),
  /** Why nothing would happen, when nothing would: the switch is off, the record already has an owner, no rule matches, nobody is available. */
  outcome: z.enum(['would_assign', 'disabled', 'has_owner', 'no_rule', 'nobody_available', 'plan']),
  rule: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  owner: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  /** Rules that matched but found nobody (everybody away or offline) before the one that would fire. */
  skipped: z.array(z.object({ id: uuidSchema, name: z.string() })),
});
export type TestAssignmentResponse = z.infer<typeof testAssignmentResponseSchema>;

export const CONTACT_AUTO_ASSIGNED = 'contact.auto_assigned';
export const DEAL_AUTO_ASSIGNED = 'deal.auto_assigned';
export const PERM_ASSIGNMENT_READ = 'crm.assignment.read';
export const PERM_ASSIGNMENT_MANAGE = 'crm.assignment.manage';
