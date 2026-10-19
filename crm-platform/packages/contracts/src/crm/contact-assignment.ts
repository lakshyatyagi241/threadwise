import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import {
  SEGMENT_BUILTIN_FIELDS,
  SEGMENT_COMPANY_PREFIX,
  SEGMENT_CUSTOM_PREFIX,
  SEGMENT_MAX_CONDITIONS,
  SEGMENT_MAX_GROUP_CHILDREN,
  SEGMENT_VALUE_SHAPE,
  checkConditionValue,
  collectConditions,
  segmentOperatorSchema,
  segmentValueSchema,
  type SegmentFieldKind,
  type SegmentGroup,
  type SegmentOperator,
} from '../segments/rules';

/**
 * Record auto-assignment (BL-013, BL-112 phase 3, BL-340..345): priority-ordered rules give a NEW (or, when asked, UPDATED) contact,
 * company or deal that has no owner to a person: a specific one, or a rotation over people and teams (round robin, or the least open
 * workload). People on leave are never picked (a specific person who is away is replaced by their delegate); offline people are skipped
 * unless the rule says otherwise. The switch is per workspace and OFF by default, and the whole feature is a plan feature
 * (`record_assignment`). An owner somebody set is never replaced.
 *
 * The conditions are the segment rule tree (AND / OR groups, three levels) over the fields of the rule's module: every built-in field
 * of the module, the workspace's custom properties (contacts and companies) and, for contacts, the properties of their company. A rule
 * with no condition matches everything and runs AFTER every rule that has conditions (the fallback), whatever its place in the list.
 */
export const ASSIGNMENT_SUBJECTS = ['contact', 'company', 'deal'] as const;
export const assignmentSubjectSchema = z.enum(ASSIGNMENT_SUBJECTS);
export type AssignmentSubject = z.infer<typeof assignmentSubjectSchema>;

/** `fixed` is "a specific single user". */
export const CONTACT_ASSIGNMENT_STRATEGIES = ['fixed', 'round_robin', 'least_busy'] as const;
export const contactAssignmentStrategySchema = z.enum(CONTACT_ASSIGNMENT_STRATEGIES);
export type ContactAssignmentStrategy = z.infer<typeof contactAssignmentStrategySchema>;

/** How a record arrived, as the creating event reports it. */
export const ASSIGNMENT_ORIGINS = ['manual', 'import', 'inbound', 'form', 'lead', 'api'] as const;
export type AssignmentOrigin = (typeof ASSIGNMENT_ORIGINS)[number];

export const DEAL_STATUSES_FOR_ASSIGNMENT = ['open', 'won', 'lost'] as const;

// --- the fields a rule can test -------------------------------------------------------------------------------------------------

const { owner: _owner, search: _search, ...CONTACT_FIELDS } = SEGMENT_BUILTIN_FIELDS;
void _owner;
void _search;

/**
 * The built-in fields per module and how each behaves (`SegmentFieldKind`: it decides the operators and the value control).
 * `origin` is how the record arrived (not stored on it, known when the rule runs). Contacts and companies also take
 * `custom.<property key>`; contacts also `company.<property key>`; deals have no custom properties.
 */
export const ASSIGNMENT_FIELDS = {
  contact: { ...CONTACT_FIELDS, origin: 'option' },
  company: {
    name: 'text',
    email: 'text',
    phone: 'text',
    domain: 'text',
    industry: 'text',
    sizeRange: 'text',
    address: 'text',
    status: 'text',
    createdAt: 'date',
    updatedAt: 'date',
    origin: 'option',
  },
  deal: {
    title: 'text',
    value: 'number',
    currency: 'text',
    pipeline: 'option',
    stage: 'option',
    status: 'option',
    source: 'text',
    expectedCloseDate: 'date',
    createdAt: 'date',
    hasContact: 'boolean',
    hasCompany: 'boolean',
    origin: 'option',
  },
} as const satisfies Record<AssignmentSubject, Record<string, SegmentFieldKind>>;

export const assignmentBuiltinKind = (
  subject: AssignmentSubject,
  field: string,
): SegmentFieldKind | undefined => {
  const fields: Record<string, SegmentFieldKind> = ASSIGNMENT_FIELDS[subject];
  return Object.prototype.hasOwnProperty.call(fields, field) ? fields[field] : undefined;
};

const CUSTOM_FIELD = /^custom\.[a-z][a-z0-9_]{0,99}$/;
const COMPANY_FIELD = /^company\.[a-z][a-z0-9_]{0,99}$/;
const BUILTIN_FIELD = /^[A-Za-z][A-Za-z0-9]{0,60}$/;

/** Does the subject take this custom (`custom.x`) or company (`company.x`) field at all? */
export const assignmentTakesCustom = (subject: AssignmentSubject, field: string): boolean =>
  (CUSTOM_FIELD.test(field) && subject !== 'deal') ||
  (COMPANY_FIELD.test(field) && subject === 'contact');

// --- the rule tree --------------------------------------------------------------------------------------------------------------

const conditionShape = z
  .object({
    type: z.literal('condition'),
    field: z
      .string()
      .max(110)
      .refine((f) => BUILTIN_FIELD.test(f) || CUSTOM_FIELD.test(f) || COMPANY_FIELD.test(f), {
        message: 'unknown field',
      }),
    operator: segmentOperatorSchema,
    value: segmentValueSchema.optional(),
  })
  .strict();

const combinator = z.enum(['and', 'or']);
const kids = <T extends z.ZodTypeAny>(item: T) =>
  z.array(item).min(1).max(SEGMENT_MAX_GROUP_CHILDREN);

// Structural depth limit (three levels, no recursion), as for segments.
const groupLevel3 = z
  .object({ type: z.literal('group'), combinator, children: kids(conditionShape) })
  .strict();
const groupLevel2 = z
  .object({
    type: z.literal('group'),
    combinator,
    children: kids(z.discriminatedUnion('type', [conditionShape, groupLevel3])),
  })
  .strict();
const groupLevel1 = z
  .object({
    type: z.literal('group'),
    combinator,
    children: kids(z.discriminatedUnion('type', [conditionShape, groupLevel2])),
  })
  .strict();

export const assignmentRulesSchema = groupLevel1.superRefine((rules, ctx) => {
  if (collectConditions(rules as SegmentGroup).length > SEGMENT_MAX_CONDITIONS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `at most ${SEGMENT_MAX_CONDITIONS} conditions per rule`,
    });
  }
});
export type AssignmentRules = z.infer<typeof assignmentRulesSchema>;

/** Custom and company fields: any operator, with a value of the right shape (the kind-specific check needs the property registry). */
function checkCustomShape(operator: SegmentOperator, value: unknown): string | null {
  const shape = SEGMENT_VALUE_SHAPE[operator];
  if (shape === 'none') return value === undefined ? null : `"${operator}" takes no value`;
  if (value === undefined) return `"${operator}" needs a value`;
  if (shape === 'scalar')
    return Array.isArray(value) || (typeof value === 'object' && value !== null)
      ? `"${operator}" takes a single value`
      : null;
  if (shape === 'list') return Array.isArray(value) ? null : `"${operator}" takes a list of values`;
  if (shape === 'range')
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? null
      : '"between" takes { from, to }';
  return typeof value === 'number' ? null : `"${operator}" takes a number of days`;
}

export interface AssignmentRuleIssue {
  path: string;
  message: string;
}

/**
 * Checks a tree against ONE module: every field must exist for it, every operator must suit the field's kind and every value must have
 * the operator's shape. Custom properties are only shape-checked here (their type lives in the workspace registry; the API checks that).
 */
export function checkAssignmentRules(
  subject: AssignmentSubject,
  rules: AssignmentRules,
): AssignmentRuleIssue[] {
  const issues: AssignmentRuleIssue[] = [];
  for (const { path, condition: c } of collectConditions(rules as SegmentGroup)) {
    const where = path ? `rules.${path}` : 'rules';
    const kind = assignmentBuiltinKind(subject, c.field);
    if (kind !== undefined) {
      const problem = checkConditionValue(kind, c.operator, c.value);
      if (problem) issues.push({ path: `${where}.value`, message: problem });
    } else if (assignmentTakesCustom(subject, c.field)) {
      const problem = checkCustomShape(c.operator, c.value);
      if (problem) issues.push({ path: `${where}.value`, message: problem });
    } else {
      issues.push({
        path: `${where}.field`,
        message: `"${c.field}" is not a field of ${subject}s`,
      });
    }
  }
  return issues;
}

export const isCustomAssignmentField = (field: string): boolean =>
  field.startsWith(SEGMENT_CUSTOM_PREFIX);
export const isCompanyAssignmentField = (field: string): boolean =>
  field.startsWith(SEGMENT_COMPANY_PREFIX);

// --- the rule -------------------------------------------------------------------------------------------------------------------

const ruleBody = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  subject: assignmentSubjectSchema,
  /** `null` (or no condition) = matches every record; such a rule is the fallback and runs after all the others. */
  rules: assignmentRulesSchema.nullable().default(null),
  strategy: contactAssignmentStrategySchema,
  userIds: z.array(uuidSchema).max(100).default([]),
  /** The teams whose members take work (Freshsales' "territory" role; here a team is a pool of people, records do not belong to a team). */
  teamIds: z.array(uuidSchema).max(20).default([]),
  /** Skip people marked offline (default). Busy people are still picked: this is ownership, not a live chat. */
  skipOffline: z.boolean().default(true),
  /**
   * Off (default): a record is assigned once, while it has no owner. On: when an edit makes this rule start to match a record the
   * engine itself assigned (nobody changed the owner since), the record moves to this rule's pick.
   */
  reassignOnUpdate: z.boolean().default(false),
  /** Active rules are prioritised; an inactive (paused or draft) rule never runs. */
  isActive: z.boolean().default(true),
};

export const createAssignmentRuleSchema = z
  .object(ruleBody)
  .refine((v) => v.userIds.length + v.teamIds.length > 0, {
    message: 'Name at least one person or team',
    path: ['userIds'],
  })
  .refine((v) => v.strategy !== 'fixed' || (v.userIds.length === 1 && v.teamIds.length === 0), {
    message: 'A specific-user rule names exactly one person',
    path: ['userIds'],
  });
export type CreateAssignmentRuleInput = z.infer<typeof createAssignmentRuleSchema>;

export const updateAssignmentRuleSchema = z.object({
  rowVersion: z.number().int().positive(),
  name: ruleBody.name.optional(),
  description: z.string().trim().max(500).optional(),
  rules: assignmentRulesSchema.nullable().optional(),
  strategy: contactAssignmentStrategySchema.optional(),
  userIds: ruleBody.userIds.optional(),
  teamIds: ruleBody.teamIds.optional(),
  skipOffline: z.boolean().optional(),
  reassignOnUpdate: z.boolean().optional(),
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
  description: z.string(),
  subject: assignmentSubjectSchema,
  rules: assignmentRulesSchema.nullable(),
  strategy: contactAssignmentStrategySchema,
  userIds: z.array(uuidSchema),
  teamIds: z.array(uuidSchema),
  skipOffline: z.boolean(),
  reassignOnUpdate: z.boolean(),
  isActive: z.boolean(),
  /** True when the rule has no condition: it matches everything and runs last. */
  isFallback: z.boolean(),
  /** Place in the list of its module (drag order, every rule). */
  position: z.number().int(),
  /** Priority among the ACTIVE rules of its module (1 = runs first, fallbacks last); null for an inactive rule. */
  priority: z.number().int().nullable(),
  firedCount: z.number().int(),
  lastFiredAt: z.string().datetime().nullable(),
  /** Conditions that point at something deleted (a removed property, tag or person): they match nothing until fixed. */
  brokenConditions: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastModifiedBy: z.object({ id: uuidSchema, name: z.string() }).nullable(),
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

// --- test box and run log -------------------------------------------------------------------------------------------------------

/** `POST /assignment/test`: "which rule would take this record, and who?", for a real record, without changing anything. */
export const testAssignmentSchema = z.object({
  subject: assignmentSubjectSchema,
  recordId: uuidSchema,
});
export type TestAssignmentInput = z.infer<typeof testAssignmentSchema>;

export const ASSIGNMENT_REASONS = [
  /** A rule matched and gave the record to someone. */
  'matched',
  /** The record already has an owner (or someone cleared it on purpose): never replaced. */
  'has_owner',
  /** The workspace has active rules for this module but none matches. */
  'no_rule',
  /** Rules matched but everyone they name is on leave, offline or gone. */
  'nobody_available',
  /** The owner changed under the engine while it worked. */
  'raced',
  /** Reassign on update: the record is already with the right rule. */
  'unchanged',
] as const;
export const assignmentReasonSchema = z.enum(ASSIGNMENT_REASONS);
export type AssignmentReason = z.infer<typeof assignmentReasonSchema>;

export const assignmentTraceEntrySchema = z.object({
  ruleId: uuidSchema,
  name: z.string(),
  /** Did the conditions hold for the record. */
  matched: z.boolean(),
  /** A matching rule that found nobody to take the record. */
  nobody: z.boolean().default(false),
  /** A rule with a condition pointing at something deleted. */
  broken: z.boolean().default(false),
});
export type AssignmentTraceEntry = z.infer<typeof assignmentTraceEntrySchema>;

export const testAssignmentResponseSchema = z.object({
  enabled: z.boolean(),
  outcome: z.enum([
    'would_assign',
    'disabled',
    'has_owner',
    'no_rule',
    'nobody_available',
    'plan',
    'not_found',
  ]),
  record: z.object({ id: uuidSchema, label: z.string() }).nullable(),
  rule: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  owner: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  /** Every active rule in the order it was tried, with what happened to it. */
  trace: z.array(assignmentTraceEntrySchema),
  /** Rules that matched but found nobody before the one that would fire. */
  skipped: z.array(z.object({ id: uuidSchema, name: z.string() })),
});
export type TestAssignmentResponse = z.infer<typeof testAssignmentResponseSchema>;

export const ASSIGNMENT_RUN_OUTCOMES = ['assigned', 'reassigned', 'skipped'] as const;
export const assignmentRunSchema = z.object({
  id: uuidSchema,
  subject: assignmentSubjectSchema,
  /** The record as it is called now; null when it has been deleted since. */
  record: z.object({ id: uuidSchema, label: z.string() }).nullable(),
  ruleId: uuidSchema.nullable(),
  ruleName: z.string().nullable(),
  outcome: z.enum(ASSIGNMENT_RUN_OUTCOMES),
  reason: assignmentReasonSchema,
  owner: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  method: contactAssignmentStrategySchema.nullable(),
  origin: z.string(),
  trigger: z.enum(['created', 'updated']),
  trace: z.array(assignmentTraceEntrySchema),
  createdAt: z.string().datetime(),
});
export type AssignmentRun = z.infer<typeof assignmentRunSchema>;

export const listAssignmentRunsQuerySchema = z.object({
  subject: assignmentSubjectSchema.optional(),
  ruleId: uuidSchema.optional(),
  recordId: uuidSchema.optional(),
  outcome: z.enum(ASSIGNMENT_RUN_OUTCOMES).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListAssignmentRunsQuery = z.infer<typeof listAssignmentRunsQuerySchema>;

export const assignmentRunPageSchema = z.object({
  data: z.array(assignmentRunSchema),
  nextCursor: z.string().nullable(),
});
export type AssignmentRunPage = z.infer<typeof assignmentRunPageSchema>;

/** How long a run is kept (days). */
export const ASSIGNMENT_RUN_RETENTION_DAYS = 90;

/**
 * The flat conditions older rules were saved with (before the field-by-field builder). Rules saved so keep working: they are read as the
 * tree `legacyConditionsToRules` makes of them, and are replaced by a tree the first time they are edited.
 */
export const legacyAssignmentConditionsSchema = z.object({
  sources: z.array(z.string()).default([]),
  countryCodes: z.array(z.string()).default([]),
  phonePrefixes: z.array(z.string()).default([]),
  lifecycleStages: z.array(z.string()).default([]),
  tagIds: z.array(z.string()).default([]),
  origins: z.array(z.string()).default([]),
  properties: z.array(z.object({ key: z.string(), equals: z.string() })).default([]),
  pipelineIds: z.array(z.string()).default([]),
  valueMin: z.number().nullable().default(null),
  valueMax: z.number().nullable().default(null),
});
export type LegacyAssignmentConditions = z.infer<typeof legacyAssignmentConditionsSchema>;

/** The tree for flat legacy conditions (all of them must hold), or null when none is set. */
export function legacyConditionsToRules(raw: unknown): AssignmentRules | null {
  const c = legacyAssignmentConditionsSchema.safeParse(raw ?? {});
  if (!c.success) return null;
  const v = c.data;
  type Node = AssignmentRules['children'][number];
  const cond = (field: string, operator: SegmentOperator, value?: unknown): Node =>
    ({ type: 'condition', field, operator, ...(value === undefined ? {} : { value }) }) as Node;
  const list = (field: string, operator: SegmentOperator, values: string[]): Node[] =>
    values.length > 0 ? [cond(field, operator, values)] : [];
  const children: Node[] = [
    ...list('source', 'in', v.sources),
    ...list('countryCode', 'in', v.countryCodes),
    ...(v.phonePrefixes.length > 0
      ? [
          {
            type: 'group',
            combinator: 'or',
            children: v.phonePrefixes.map((p) => cond('phone', 'starts_with', p)),
          } as Node,
        ]
      : []),
    ...list('lifecycleStage', 'in', v.lifecycleStages),
    ...list('tags', 'has_any', v.tagIds),
    ...list('origin', 'in', v.origins),
    ...v.properties
      .filter((p) => /^[a-z][a-z0-9_]{0,99}$/.test(p.key) && p.equals !== '')
      .map((p) => cond(`custom.${p.key}`, 'equals', p.equals)),
    ...list('pipeline', 'in', v.pipelineIds),
    ...(v.valueMin !== null ? [cond('value', 'gte', v.valueMin)] : []),
    ...(v.valueMax !== null ? [cond('value', 'lte', v.valueMax)] : []),
  ];
  return children.length === 0 ? null : { type: 'group', combinator: 'and', children };
}

export const CONTACT_AUTO_ASSIGNED = 'contact.auto_assigned';
export const DEAL_AUTO_ASSIGNED = 'deal.auto_assigned';
export const COMPANY_AUTO_ASSIGNED = 'company.auto_assigned';
export const PERM_ASSIGNMENT_READ = 'crm.assignment.read';
export const PERM_ASSIGNMENT_MANAGE = 'crm.assignment.manage';
/** The plan feature that gates the whole area (higher plans only; see the migration that seeds it). */
export const RECORD_ASSIGNMENT_FEATURE = 'record_assignment';
