import { sql, type SQL } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import {
  ASSIGNMENT_ORIGINS,
  assignmentBuiltinKind,
  assignmentTakesCustom,
  checkConditionValue,
  collectConditions,
  customFieldKey,
  fieldTypeSchema,
  isCustomAssignmentField,
  segmentKindForFieldType,
  type AssignmentRules,
  type AssignmentSubject,
  type FieldType,
  type InvalidCondition,
  type SegmentCondition,
  type SegmentFieldKind,
  type SegmentGroup,
  type SegmentInvalidReason,
  type SegmentNode,
  type SegmentOperator,
} from '@crm/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import {
  datePredicate,
  numberPredicate,
  textPredicate,
  type DateOperator,
  type NumberOperator,
  type TextOperator,
} from '../contacts/contact-predicates';
import { operandStrings, propertyPredicate } from '../property-predicates';
import {
  collectRuleRefs,
  compileRules,
  emptyRuleContext,
  type RuleContext,
} from '../segments/segment-compiler';
import { loadRuleContext } from '../segments/segment-rule-context';

const { companies, deals, fields, pipelines, pipelineStages } = schema;

/**
 * Everything a rule tree points at, resolved: the segment context (tags, stages, people, custom properties) plus the pipelines and stages
 * deals can be tested against. A reference missing from here was deleted, and its condition matches nothing.
 */
export interface AssignmentContext extends RuleContext {
  pipelines: Map<string, number>;
  dealStages: Map<string, number>;
}

export interface AssignmentCompiled {
  /** A condition over the module's own table (`contacts`, `companies` or `deals`, unaliased). */
  where: SQL;
  invalid: InvalidCondition[];
}

type Verdict = { sql: SQL } | { invalid: SegmentInvalidReason; message: string; refs: string[] };
const invalidOf = (
  reason: SegmentInvalidReason,
  message: string,
  refs: string[] = [],
): Verdict => ({
  invalid: reason,
  message,
  refs,
});

/** A rule list's trees, as one list of nodes (null / absent = no condition). */
export type RuleTree = AssignmentRules | null;

const asGroup = (t: AssignmentRules) => t as unknown as SegmentGroup;

/** Looks up, in one batch, everything the given trees of one module point at. */
export async function loadAssignmentContext(
  tx: Tx,
  orgId: number,
  subject: AssignmentSubject,
  trees: ReadonlyArray<RuleTree>,
): Promise<AssignmentContext> {
  const present = trees.filter((t): t is AssignmentRules => t !== null);
  const base = emptyRuleContext();
  const pipelineUuids = new Set<string>();
  const stageUuids = new Set<string>();
  const customKeys = new Set<string>();
  let rc: RuleContext = base;

  if (subject === 'contact') {
    const refs = collectRuleRefs({
      type: 'group',
      combinator: 'and',
      children: [],
    } as unknown as SegmentGroup);
    for (const t of present) collectRuleRefs(asGroup(t), refs);
    rc = await loadRuleContext(tx, orgId, refs);
  } else {
    for (const t of present) {
      for (const { condition: c } of collectConditions(asGroup(t))) {
        if (subject === 'deal' && c.field === 'pipeline')
          operandStrings(c.value).forEach((v) => pipelineUuids.add(v));
        else if (subject === 'deal' && c.field === 'stage')
          operandStrings(c.value).forEach((v) => stageUuids.add(v));
        else if (isCustomAssignmentField(c.field)) customKeys.add(customFieldKey(c.field));
      }
    }
    if (customKeys.size > 0 && subject === 'company') {
      const rows = await tx
        .select({ key: fields.key, type: fields.fieldType })
        .from(fields)
        .where(
          and(
            eq(fields.orgId, orgId),
            eq(fields.moduleKey, 'companies'),
            eq(fields.isActive, true),
            inArray(fields.key, [...customKeys]),
          ),
        );
      for (const r of rows) {
        const type = fieldTypeSchema.safeParse(r.type);
        if (type.success) base.fields.set(r.key, { type: type.data as FieldType });
      }
    }
  }

  const pipelineMap = new Map<string, number>();
  const stageMap = new Map<string, number>();
  if (pipelineUuids.size > 0) {
    const rows = await tx
      .select({ id: pipelines.id, uuid: pipelines.uuid })
      .from(pipelines)
      .where(and(eq(pipelines.orgId, orgId), inArray(pipelines.uuid, [...pipelineUuids])));
    for (const r of rows) pipelineMap.set(r.uuid, r.id);
  }
  if (stageUuids.size > 0) {
    const rows = await tx
      .select({ id: pipelineStages.id, uuid: pipelineStages.uuid })
      .from(pipelineStages)
      .where(and(eq(pipelineStages.orgId, orgId), inArray(pipelineStages.uuid, [...stageUuids])));
    for (const r of rows) stageMap.set(r.uuid, r.id);
  }
  return Object.assign(rc, {
    pipelines: pipelineMap,
    dealStages: stageMap,
  }) as unknown as AssignmentContext;
}

/**
 * Turns one rule tree into SQL over the module's own table. Contacts go through the segment compiler (one leaf at a time, so the
 * built-in contact fields behave exactly as in a segment); companies and deals have their own field switch below, on the same
 * predicates. `origin` (how the record arrived) is the one field no table holds: it is known when the rule runs and bound as a value.
 * Never throws: a condition whose reference is gone compiles to `false` and is reported in `invalid`.
 */
export function compileAssignment(
  subject: AssignmentSubject,
  orgId: number,
  tree: AssignmentRules,
  ctx: AssignmentContext,
  origin: string,
): AssignmentCompiled {
  const problems: InvalidCondition[] = [];
  const node = (n: SegmentNode, path: string): SQL => {
    if (n.type === 'condition') {
      const verdict = leaf(subject, orgId, n, ctx, origin);
      if ('sql' in verdict) return verdict.sql;
      problems.push({
        path,
        field: n.field,
        reason: verdict.invalid,
        message: verdict.message,
        refs: verdict.refs,
      });
      return sql`false`;
    }
    const parts = n.children.map((c, i) =>
      node(c, path ? `${path}.children.${i}` : `children.${i}`),
    );
    return sql`(${sql.join(parts, n.combinator === 'and' ? sql` AND ` : sql` OR `)})`;
  };
  return { where: node(asGroup(tree), ''), invalid: problems };
}

function leaf(
  subject: AssignmentSubject,
  orgId: number,
  c: SegmentCondition,
  ctx: AssignmentContext,
  origin: string,
): Verdict {
  if (c.field === 'origin') {
    const problem = checkConditionValue('option', c.operator, c.value);
    if (problem) return invalidOf('operator_unsupported', problem);
    const known = operandStrings(c.value).every((v) =>
      (ASSIGNMENT_ORIGINS as readonly string[]).includes(v),
    );
    if (!known)
      return invalidOf(
        'field_type_unsupported',
        'Unknown way a record arrives.',
        operandStrings(c.value),
      );
    return {
      sql: textPredicate(sql`${origin}::text`, c.operator as TextOperator, c.value, {
        exact: true,
      }),
    };
  }
  if (!assignmentBuiltinKind(subject, c.field) && !assignmentTakesCustom(subject, c.field)) {
    return invalidOf('operator_unsupported', `Unknown field "${c.field}".`);
  }
  if (subject === 'contact') {
    // The segment compiler reads `contacts` exactly like a segment does; a one-condition group keeps its paths out of ours.
    const out = compileRules(orgId, { type: 'group', combinator: 'and', children: [c] }, ctx);
    const bad = out.invalid[0];
    return bad ? invalidOf(bad.reason, bad.message, bad.refs) : { sql: out.where };
  }
  return subject === 'company' ? companyLeaf(c, ctx) : dealLeaf(orgId, c, ctx);
}

const missing = (values: string[], known: { has(v: string): boolean }) =>
  values.filter((v) => !known.has(v));

function companyLeaf(c: SegmentCondition, ctx: AssignmentContext): Verdict {
  const op: SegmentOperator = c.operator;
  if (isCustomAssignmentField(c.field)) {
    const key = customFieldKey(c.field);
    const def = ctx.fields.get(key);
    if (!def)
      return invalidOf(
        'field_deleted',
        `The company property "${key}" does not exist (it may have been deleted).`,
        [key],
      );
    const kind = segmentKindForFieldType(def.type);
    if (!kind)
      return invalidOf(
        'field_type_unsupported',
        `The property "${key}" is computed and cannot be tested.`,
        [key],
      );
    const problem = checkConditionValue(kind, op, c.value);
    if (problem) return invalidOf('operator_unsupported', problem);
    const predicate = propertyPredicate(sql`${companies.data}`, key, kind, op, c.value);
    return predicate
      ? { sql: predicate }
      : invalidOf('operator_unsupported', `A ${kind} value cannot be used on a property.`);
  }
  const kind = assignmentBuiltinKind('company', c.field) as SegmentFieldKind;
  const problem = checkConditionValue(kind, op, c.value);
  if (problem) return invalidOf('operator_unsupported', problem);
  const text = (col: SQL) => ({ sql: textPredicate(col, op as TextOperator, c.value) });
  switch (c.field) {
    case 'name':
      return text(sql`${companies.name}`);
    case 'email':
      return text(sql`${companies.email}`);
    case 'phone':
      return text(sql`${companies.phone}`);
    case 'domain':
      return text(sql`${companies.domain}`);
    case 'industry':
      return text(sql`${companies.industry}`);
    case 'sizeRange':
      return text(sql`${companies.sizeRange}`);
    case 'address':
      return text(sql`${companies.address}`);
    case 'status':
      return text(sql`${companies.status}`);
    case 'createdAt':
      return { sql: datePredicate(sql`${companies.createdAt}`, op as DateOperator, c.value) };
    case 'updatedAt':
      return { sql: datePredicate(sql`${companies.updatedAt}`, op as DateOperator, c.value) };
    default:
      return invalidOf('operator_unsupported', `Unknown field "${c.field}".`);
  }
}

function dealLeaf(orgId: number, c: SegmentCondition, ctx: AssignmentContext): Verdict {
  const op: SegmentOperator = c.operator;
  const kind = assignmentBuiltinKind('deal', c.field) as SegmentFieldKind;
  const problem = checkConditionValue(kind, op, c.value);
  if (problem) return invalidOf('operator_unsupported', problem);
  const values = operandStrings(c.value);
  const text = (col: SQL, exact = false) => ({
    sql: textPredicate(col, op as TextOperator, c.value, { exact }),
  });
  const idIn = (col: SQL, ids: number[]): Verdict => {
    if (op === 'is_empty') return { sql: sql`${col} IS NULL` };
    if (op === 'is_not_empty') return { sql: sql`${col} IS NOT NULL` };
    const list = sql.join(
      ids.map((i) => sql`${i}::bigint`),
      sql`, `,
    );
    return op === 'equals' || op === 'in'
      ? { sql: sql`${col} IN (${list})` }
      : { sql: sql`(${col} IS NULL OR ${col} NOT IN (${list}))` };
  };
  switch (c.field) {
    case 'title':
      return text(sql`${deals.title}`);
    case 'value':
      // Whole units of the deal's own currency, two decimals assumed (value_minor / 100).
      return {
        sql: numberPredicate(sql`(${deals.valueMinor} / 100.0)`, op as NumberOperator, c.value),
      };
    case 'currency':
      return text(sql`${deals.currency}`, true);
    case 'source':
      return text(sql`${deals.source}`);
    case 'status':
      return text(sql`${deals.status}`, true);
    case 'pipeline': {
      const gone = op === 'is_empty' || op === 'is_not_empty' ? [] : missing(values, ctx.pipelines);
      if (gone.length > 0)
        return invalidOf(
          'field_deleted',
          'A pipeline used here does not exist (it may have been deleted).',
          gone,
        );
      return idIn(
        sql`${deals.pipelineId}`,
        values.map((v) => ctx.pipelines.get(v)!).filter((x) => x !== undefined),
      );
    }
    case 'stage': {
      const gone =
        op === 'is_empty' || op === 'is_not_empty' ? [] : missing(values, ctx.dealStages);
      if (gone.length > 0)
        return invalidOf(
          'stage_deleted',
          'A stage used here does not exist (it may have been deleted).',
          gone,
        );
      return idIn(
        sql`${deals.stageId}`,
        values.map((v) => ctx.dealStages.get(v)!).filter((x) => x !== undefined),
      );
    }
    case 'expectedCloseDate':
      return {
        sql: datePredicate(
          sql`${deals.expectedCloseDate}::timestamptz`,
          op as DateOperator,
          c.value,
        ),
      };
    case 'createdAt':
      return { sql: datePredicate(sql`${deals.createdAt}`, op as DateOperator, c.value) };
    case 'hasContact':
      return {
        sql:
          op === 'is_true' ? sql`${deals.contactId} IS NOT NULL` : sql`${deals.contactId} IS NULL`,
      };
    case 'hasCompany':
      return {
        sql:
          op === 'is_true' ? sql`${deals.companyId} IS NOT NULL` : sql`${deals.companyId} IS NULL`,
      };
    default:
      void orgId;
      return invalidOf('operator_unsupported', `Unknown field "${c.field}".`);
  }
}

/** Does this tree contain at least one condition? (A rule without one is the fallback.) */
export const hasConditions = (t: RuleTree): boolean => t !== null && t.children.length > 0;
