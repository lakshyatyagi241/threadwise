import { z } from 'zod';
import { parseDateValue } from '../common/dates';
import { uuidSchema } from '../common/ids';
import type { FieldType } from '../common/enums';

/**
 * Segment rules: a tree of AND / OR groups over contact fields. ONE definition shared by the API
 * (which turns it into SQL with the same condition builder the contacts list uses) and the web rule
 * builder (which renders it), so a rule the builder can draw is a rule the API accepts and the other
 * way round.
 *
 * Strictness is the point: unknown fields, unknown operators, unknown keys, oversized lists and
 * trees deeper than SEGMENT_MAX_DEPTH are refused here, before anything reaches SQL.
 */
export const SEGMENT_RULES_VERSION = 1;
/** Root group = depth 1; a group inside it = 2; a group inside that = 3. Nothing deeper. */
export const SEGMENT_MAX_DEPTH = 3;
export const SEGMENT_MAX_CONDITIONS = 50;
export const SEGMENT_MAX_GROUP_CHILDREN = 50;
/** Values in one `in` / `has_any` list. */
export const SEGMENT_LIST_MAX = 100;
export const SEGMENT_TEXT_MAX = 255;
export const SEGMENT_SEARCH_MAX = 200;
export const SEGMENT_DAYS_MAX = 3650;

// --- fields -------------------------------------------------------------------------------------

/** How a field behaves: which operators it has and what its value looks like. */
export const SEGMENT_FIELD_KINDS = [
  'text',
  'number',
  'date',
  'option',
  'user',
  'tags',
  'groups',
  'multi',
  'boolean',
  'search',
] as const;
export type SegmentFieldKind = (typeof SEGMENT_FIELD_KINDS)[number];

/** The contact's own fields a rule can use. Anything else must be `custom.<key>`. */
export const SEGMENT_BUILTIN_FIELDS = {
  name: 'text',
  email: 'text',
  phone: 'text',
  source: 'text',
  leadScore: 'number',
  lifecycleStage: 'option',
  status: 'option',
  owner: 'user',
  tags: 'tags',
  groups: 'groups',
  unsubscribed: 'boolean',
  imported: 'boolean',
  search: 'search',
  createdAt: 'date',
  updatedAt: 'date',
  lastActivityAt: 'date',
} as const satisfies Record<string, SegmentFieldKind>;
export type SegmentBuiltinField = keyof typeof SEGMENT_BUILTIN_FIELDS;

export const SEGMENT_CUSTOM_PREFIX = 'custom.';
const CUSTOM_FIELD = /^custom\.[a-z][a-z0-9_]{0,99}$/;

export const segmentFieldSchema = z
  .string()
  .max(110)
  .refine(
    (f) => Object.prototype.hasOwnProperty.call(SEGMENT_BUILTIN_FIELDS, f) || CUSTOM_FIELD.test(f),
    'unknown field: use a contact field or custom.<property key>',
  );

export const isCustomSegmentField = (field: string): boolean =>
  field.startsWith(SEGMENT_CUSTOM_PREFIX);
export const customFieldKey = (field: string): string => field.slice(SEGMENT_CUSTOM_PREFIX.length);

/** The kind of a built-in field; undefined for custom fields (the registry decides those). */
export function builtinFieldKind(field: string): SegmentFieldKind | undefined {
  return Object.prototype.hasOwnProperty.call(SEGMENT_BUILTIN_FIELDS, field)
    ? SEGMENT_BUILTIN_FIELDS[field as SegmentBuiltinField]
    : undefined;
}

/**
 * How a custom property's registry type is filtered. `undefined` = not filterable (a formula is
 * computed, never stored on the contact).
 */
export function segmentKindForFieldType(fieldType: FieldType): SegmentFieldKind | undefined {
  switch (fieldType) {
    case 'text':
    case 'long_text':
    case 'url':
    case 'email':
    case 'phone':
    case 'timezone':
    case 'lookup':
      return 'text';
    case 'integer':
    case 'big_integer':
    case 'decimal':
    case 'percentage':
    case 'currency':
    case 'rating':
      return 'number';
    case 'boolean':
    case 'checkbox':
      return 'boolean';
    case 'date':
    case 'datetime':
      return 'date';
    case 'select':
    case 'radio':
      return 'option';
    case 'multiselect':
      return 'multi';
    case 'formula':
      return undefined;
  }
}

// --- operators ----------------------------------------------------------------------------------

export const SEGMENT_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'in',
  'not_in',
  'is_empty',
  'is_not_empty',
  'before',
  'after',
  'on_or_before',
  'on_or_after',
  'in_last_days',
  'more_than_days_ago',
  'has_any',
  'has_all',
  'has_none',
  'is_true',
  'is_false',
  'matches',
] as const;
export type SegmentOperator = (typeof SEGMENT_OPERATORS)[number];
export const segmentOperatorSchema = z.enum(SEGMENT_OPERATORS);

export const SEGMENT_OPERATORS_BY_KIND: Record<SegmentFieldKind, readonly SegmentOperator[]> = {
  text: [
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'starts_with',
    'in',
    'not_in',
    'is_empty',
    'is_not_empty',
  ],
  number: [
    'equals',
    'not_equals',
    'gt',
    'gte',
    'lt',
    'lte',
    'between',
    'in',
    'not_in',
    'is_empty',
    'is_not_empty',
  ],
  date: [
    'equals',
    'before',
    'after',
    'on_or_before',
    'on_or_after',
    'between',
    'in_last_days',
    'more_than_days_ago',
    'is_empty',
    'is_not_empty',
  ],
  option: ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  user: ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  tags: ['has_any', 'has_all', 'has_none', 'is_empty', 'is_not_empty'],
  groups: ['has_any', 'has_all', 'has_none', 'is_empty', 'is_not_empty'],
  multi: ['has_any', 'has_all', 'has_none', 'is_empty', 'is_not_empty'],
  boolean: ['is_true', 'is_false'],
  search: ['matches'],
};

/** What shape of `value` an operator takes. */
export type SegmentValueShape = 'none' | 'scalar' | 'list' | 'range' | 'days';

export const SEGMENT_VALUE_SHAPE: Record<SegmentOperator, SegmentValueShape> = {
  equals: 'scalar',
  not_equals: 'scalar',
  contains: 'scalar',
  not_contains: 'scalar',
  starts_with: 'scalar',
  gt: 'scalar',
  gte: 'scalar',
  lt: 'scalar',
  lte: 'scalar',
  before: 'scalar',
  after: 'scalar',
  on_or_before: 'scalar',
  on_or_after: 'scalar',
  matches: 'scalar',
  between: 'range',
  in: 'list',
  not_in: 'list',
  has_any: 'list',
  has_all: 'list',
  has_none: 'list',
  in_last_days: 'days',
  more_than_days_ago: 'days',
  is_empty: 'none',
  is_not_empty: 'none',
  is_true: 'none',
  is_false: 'none',
};

// --- the tree -----------------------------------------------------------------------------------

const scalarValue = z.union([z.string().min(1).max(SEGMENT_TEXT_MAX), z.number().finite()]);

/** The raw `value` of a condition. What is legal for a given operator and field is checked by the tree refinement. */
export const segmentValueSchema = z.union([
  scalarValue,
  z.array(scalarValue).min(1).max(SEGMENT_LIST_MAX),
  z.object({ from: scalarValue, to: scalarValue }).strict(),
]);
export type SegmentValue = z.infer<typeof segmentValueSchema>;

const conditionShape = z
  .object({
    type: z.literal('condition'),
    field: segmentFieldSchema,
    operator: segmentOperatorSchema,
    value: segmentValueSchema.optional(),
  })
  .strict();
export type SegmentCondition = z.infer<typeof conditionShape>;

const combinator = z.enum(['and', 'or']);
export type SegmentCombinator = z.infer<typeof combinator>;

const children = <T extends z.ZodTypeAny>(item: T) =>
  z.array(item).min(1).max(SEGMENT_MAX_GROUP_CHILDREN);

// The depth limit is structural: three explicit levels, no recursion, so a 10,000-deep payload
// fails on its fourth level instead of exhausting the stack.
const groupLevel3 = z
  .object({ type: z.literal('group'), combinator, children: children(conditionShape) })
  .strict();
const groupLevel2 = z
  .object({
    type: z.literal('group'),
    combinator,
    children: children(z.discriminatedUnion('type', [conditionShape, groupLevel3])),
  })
  .strict();
const groupLevel1 = z
  .object({
    type: z.literal('group'),
    combinator,
    children: children(z.discriminatedUnion('type', [conditionShape, groupLevel2])),
  })
  .strict();

export interface SegmentGroup {
  type: 'group';
  combinator: SegmentCombinator;
  children: SegmentNode[];
}
export type SegmentNode = SegmentCondition | SegmentGroup;

/** Path of a node inside the rules: `children.1.children.0`. The root is the empty string. */
export type RulePath = string;

export interface WalkedCondition {
  path: RulePath;
  condition: SegmentCondition;
}

/** Every condition of a tree with its path, depth first. Iterative: safe on any depth. */
export function collectConditions(root: SegmentGroup): WalkedCondition[] {
  const out: WalkedCondition[] = [];
  const stack: Array<{ node: SegmentNode; path: string }> = [{ node: root, path: '' }];
  while (stack.length > 0) {
    const { node, path } = stack.pop()!;
    if (node.type === 'condition') {
      out.push({ path, condition: node });
      continue;
    }
    // Reverse so the first child is popped first and the order matches the document.
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({
        node: node.children[i]!,
        path: path ? `${path}.children.${i}` : `children.${i}`,
      });
    }
  }
  return out;
}

/**
 * The value-shape rule for one condition, given the field's kind. Returns the problem, or null when
 * the condition is fine. Shared by the schema (built-in fields, whose kind is known statically) and
 * the API (custom fields, whose kind comes from the property registry).
 */
export function checkConditionValue(
  kind: SegmentFieldKind,
  operator: SegmentOperator,
  value: unknown,
): string | null {
  if (!SEGMENT_OPERATORS_BY_KIND[kind].includes(operator)) {
    return `operator "${operator}" is not available for a ${kind} field`;
  }
  const shape = SEGMENT_VALUE_SHAPE[operator];
  if (shape === 'none') return value === undefined ? null : `"${operator}" takes no value`;
  if (value === undefined) return `"${operator}" needs a value`;

  const item = (v: unknown): string | null => {
    switch (kind) {
      case 'number':
        return typeof v === 'number' ? null : 'a number is required';
      case 'date':
        return parseDateValue(v) ? null : 'a date (YYYY-MM-DD) or ISO date-time is required';
      case 'user':
      case 'tags':
      case 'groups':
        return typeof v === 'string' && uuidSchema.safeParse(v).success
          ? null
          : 'an id (uuid) is required';
      case 'search':
        return typeof v === 'string' && v.trim().length > 0 && v.length <= SEGMENT_SEARCH_MAX
          ? null
          : `text of 1 to ${SEGMENT_SEARCH_MAX} characters is required`;
      default:
        return typeof v === 'string' && v.trim().length > 0 ? null : 'text is required';
    }
  };

  switch (shape) {
    case 'scalar':
      return Array.isArray(value) || (typeof value === 'object' && value !== null)
        ? `"${operator}" takes a single value`
        : item(value);
    case 'list': {
      if (!Array.isArray(value)) return `"${operator}" takes a list of values`;
      for (const v of value) {
        const problem = item(v);
        if (problem) return problem;
      }
      return null;
    }
    case 'range': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return '"between" takes { from, to }';
      }
      const { from, to } = value as { from?: unknown; to?: unknown };
      const problem = item(from) ?? item(to);
      if (problem) return problem;
      if (kind === 'number' && (from as number) > (to as number)) return '"from" is after "to"';
      if (kind === 'date') {
        const a = parseDateValue(from)!;
        const b = parseDateValue(to)!;
        if (new Date(a.iso).getTime() > new Date(b.iso).getTime()) return '"from" is after "to"';
      }
      return null;
    }
    case 'days':
      return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= SEGMENT_DAYS_MAX
        ? null
        : `a whole number of days from 0 to ${SEGMENT_DAYS_MAX} is required`;
  }
}

export const segmentRulesSchema = groupLevel1.superRefine((rules, ctx) => {
  const all = collectConditions(rules as SegmentGroup);
  if (all.length > SEGMENT_MAX_CONDITIONS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `at most ${SEGMENT_MAX_CONDITIONS} conditions per segment`,
    });
    return;
  }
  for (const { path, condition } of all) {
    // Custom fields are checked against their registry type by the API; here only their shape.
    const kind = builtinFieldKind(condition.field);
    const problem =
      kind !== undefined
        ? checkConditionValue(kind, condition.operator, condition.value)
        : checkCustomShape(condition.operator, condition.value);
    if (problem) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: problem,
        path: [
          ...(path ? path.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : []),
          'value',
        ],
      });
    }
  }
});
export type SegmentRules = z.infer<typeof segmentRulesSchema>;

/** Custom fields: any operator that exists, with a value of the right shape; the kind-specific check is the API's. */
function checkCustomShape(operator: SegmentOperator, value: unknown): string | null {
  const shape = SEGMENT_VALUE_SHAPE[operator];
  if (shape === 'none') return value === undefined ? null : `"${operator}" takes no value`;
  if (value === undefined) return `"${operator}" needs a value`;
  if (shape === 'scalar') {
    return Array.isArray(value) || (typeof value === 'object' && value !== null)
      ? `"${operator}" takes a single value`
      : null;
  }
  if (shape === 'list') return Array.isArray(value) ? null : `"${operator}" takes a list of values`;
  if (shape === 'range') {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? null
      : '"between" takes { from, to }';
  }
  return typeof value === 'number' ? null : `"${operator}" takes a number of days`;
}

/** Why a condition cannot match anything right now (a thing it points at is gone). */
export const SEGMENT_INVALID_REASONS = [
  'field_deleted',
  'field_type_unsupported',
  'operator_unsupported',
  'tag_deleted',
  'group_deleted',
  'stage_deleted',
  'status_deleted',
  'user_deleted',
] as const;
export const segmentInvalidReasonSchema = z.enum(SEGMENT_INVALID_REASONS);
export type SegmentInvalidReason = z.infer<typeof segmentInvalidReasonSchema>;

/**
 * A condition that points at something that no longer exists (a deleted tag, group, stage, status,
 * user or custom property). It is kept in the rules, evaluates to "matches nothing", and is reported
 * here so the screen can flag it and the owner can fix or remove it.
 */
export const invalidConditionSchema = z.object({
  /** Where it sits in the rules (`children.1.children.0`). */
  path: z.string(),
  field: z.string(),
  reason: segmentInvalidReasonSchema,
  message: z.string(),
  /** The missing ids / keys / values. */
  refs: z.array(z.string()),
});
export type InvalidCondition = z.infer<typeof invalidConditionSchema>;
