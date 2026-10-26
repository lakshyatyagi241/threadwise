import { sql, type SQL } from 'drizzle-orm';
import { schema } from '@crm/db';
import {
  builtinFieldKind,
  checkConditionValue,
  collectConditions,
  companyFieldKey,
  customFieldKey,
  isCompanySegmentField,
  segmentKindForFieldType,
  type FieldType,
  type InvalidCondition,
  type SegmentCondition,
  type SegmentFieldKind,
  type SegmentGroup,
  type SegmentInvalidReason,
  type SegmentNode,
  type SegmentOperator,
} from '@crm/contracts';
import {
  contactLastActivity,
  contactPhoneDigits,
  minorCondition,
  searchCondition,
} from '../contacts/contact-conditions';
import {
  countryCodePredicate,
  datePredicate,
  groupsPredicate,
  numberPredicate,
  phonePredicate,
  tagsPredicate,
  textPredicate,
  type DateOperator,
  type NumberOperator,
  type SetOperator,
  type TextOperator,
} from '../contacts/contact-predicates';
import { operandStrings, propertyPredicate } from '../property-predicates';

const { contacts } = schema;

/**
 * What the rules point at, resolved against the workspace as it is right now. A reference that is
 * missing from here (a deleted tag, group, stage, status, user or property) is how a condition
 * becomes "invalid".
 */
export interface RuleContext {
  /** The workspace's own zone: a day in a date rule is a day here (a Waboo date is midnight in India, which is the day before in UTC). */
  timezone: string;
  tags: Map<string, number>;
  groups: Map<string, number>;
  users: Map<string, number>;
  stages: Set<string>;
  statuses: Set<string>;
  /** Active contact properties by key. */
  fields: Map<string, { type: FieldType }>;
  /** Active company properties by key (a `company.<key>` rule reads the contact's company). */
  companyFields: Map<string, { type: FieldType }>;
}

export const emptyRuleContext = (): RuleContext => ({
  timezone: 'UTC',
  tags: new Map(),
  groups: new Map(),
  users: new Map(),
  stages: new Set(),
  statuses: new Set(),
  fields: new Map(),
  companyFields: new Map(),
});

export interface CompiledRules {
  /** A condition over `contacts` (unaliased), to AND with the contact filter; the compiler adds no org or archive predicate. */
  where: SQL;
  invalid: InvalidCondition[];
}

/** Everything a rule tree mentions that must exist, for one batched lookup. */
export interface RuleRefs {
  tagUuids: Set<string>;
  groupUuids: Set<string>;
  userUuids: Set<string>;
  stageValues: Set<string>;
  statusValues: Set<string>;
  fieldKeys: Set<string>;
  companyFieldKeys: Set<string>;
}

export const emptyRuleRefs = (): RuleRefs => ({
  tagUuids: new Set(),
  groupUuids: new Set(),
  userUuids: new Set(),
  stageValues: new Set(),
  statusValues: new Set(),
  fieldKeys: new Set(),
  companyFieldKeys: new Set(),
});

/** Adds what `rules` points at to `into` (or to a new set). */
export function collectRuleRefs(rules: SegmentGroup, into?: RuleRefs): RuleRefs {
  const refs = into ?? emptyRuleRefs();
  for (const { condition: c } of collectConditions(rules)) {
    const values = valuesOf(c);
    switch (c.field) {
      case 'tags':
        values.forEach((v) => refs.tagUuids.add(v));
        break;
      case 'groups':
        values.forEach((v) => refs.groupUuids.add(v));
        break;
      case 'owner':
        values.forEach((v) => refs.userUuids.add(v));
        break;
      case 'lifecycleStage':
        values.forEach((v) => refs.stageValues.add(v));
        break;
      case 'status':
        values.forEach((v) => refs.statusValues.add(v));
        break;
      default:
        if (isCompanySegmentField(c.field)) refs.companyFieldKeys.add(companyFieldKey(c.field));
        else if (builtinFieldKind(c.field) === undefined)
          refs.fieldKeys.add(customFieldKey(c.field));
    }
  }
  return refs;
}

const valuesOf = (c: SegmentCondition): string[] => operandStrings(c.value);

type Verdict = { sql: SQL } | { invalid: SegmentInvalidReason; message: string; refs: string[] };

const invalid = (reason: SegmentInvalidReason, message: string, refs: string[] = []): Verdict => ({
  invalid: reason,
  message,
  refs,
});

/**
 * Turns a rule tree into one SQL condition over `contacts`, through the same predicates the contacts
 * list filter uses. Pure given the resolved context: no database access, which is what makes the SQL
 * shape testable on its own.
 *
 * A condition whose reference is gone compiles to `false` and is reported in `invalid`; it never
 * throws, so a segment referencing a deleted tag still lists, counts and exports (the rest of its
 * rules apply, and the broken condition matches nothing).
 */
export function compileRules(orgId: number, rules: SegmentGroup, rc: RuleContext): CompiledRules {
  const problems: InvalidCondition[] = [];

  const node = (n: SegmentNode, path: string): SQL => {
    if (n.type === 'condition') {
      const verdict = condition(n, rc, orgId);
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
    const parts = n.children.map((child, i) =>
      node(child, path ? `${path}.children.${i}` : `children.${i}`),
    );
    return sql`(${sql.join(parts, n.combinator === 'and' ? sql` AND ` : sql` OR `)})`;
  };

  return { where: node(rules, ''), invalid: problems };
}

const missing = (values: string[], known: { has(v: string): boolean }) =>
  values.filter((v) => !known.has(v));

function condition(c: SegmentCondition, rc: RuleContext, orgId: number): Verdict {
  const op: SegmentOperator = c.operator;
  const builtin = builtinFieldKind(c.field);

  const onCompany = isCompanySegmentField(c.field);
  let kind: SegmentFieldKind;
  let key = '';
  if (builtin !== undefined) {
    kind = builtin;
  } else {
    key = onCompany ? companyFieldKey(c.field) : customFieldKey(c.field);
    const def = (onCompany ? rc.companyFields : rc.fields).get(key);
    if (!def)
      return invalid(
        'field_deleted',
        `The ${onCompany ? 'company property' : 'property'} "${key}" does not exist (it may have been deleted).`,
        [onCompany ? c.field : key],
      );
    const k = segmentKindForFieldType(def.type);
    if (!k) {
      return invalid(
        'field_type_unsupported',
        `The property "${key}" is computed and cannot be filtered.`,
        [key],
      );
    }
    kind = k;
  }

  const problem = checkConditionValue(kind, op, c.value);
  if (problem) return invalid('operator_unsupported', problem);

  const values = valuesOf(c);
  const text = (col: SQL, exact = false): Verdict => ({
    sql: textPredicate(col, op as TextOperator, c.value, { exact }),
  });

  if (builtin === undefined) {
    // A company property is read off the contact's company: a contact with no company has no value (so "is empty" and the "not"
    // operators hold for it, as for a contact that has the property blank).
    const data = onCompany
      ? sql`(SELECT co.data FROM companies co WHERE co.org_id = ${contacts.orgId} AND co.id = ${contacts.companyId})`
      : sql`${contacts.data}`;
    const predicate = propertyPredicate(data, key, kind, op, c.value, rc.timezone);
    return predicate
      ? { sql: predicate }
      : invalid('operator_unsupported', `A ${kind} value cannot be used on a property.`);
  }

  switch (c.field) {
    case 'name':
      return text(sql`${contacts.name}`);
    case 'email':
      return text(sql`${contacts.email}`);
    case 'phone':
      // Typed the way the screen shows it ("+91 88751 37569"): compared on digits, not on the stored text.
      return {
        sql: phonePredicate(
          contactPhoneDigits,
          sql`${contacts.phone}`,
          op as TextOperator,
          c.value,
        ),
      };
    case 'countryCode':
      // "+91", "91" and "0091" are one code.
      return {
        sql: countryCodePredicate(sql`${contacts.countryCode}`, op as TextOperator, c.value),
      };
    case 'source':
      return text(sql`${contacts.source}`);
    case 'timezone':
      return text(sql`${contacts.timezone}`);
    case 'leadScore':
      return { sql: numberPredicate(sql`${contacts.leadScore}`, op as NumberOperator, c.value) };
    case 'lifecycleStage': {
      const gone = missing(values, rc.stages);
      if (gone.length > 0) {
        return invalid(
          'stage_deleted',
          `The stage "${gone.join('", "')}" does not exist (it may have been deleted).`,
          gone,
        );
      }
      return text(sql`${contacts.lifecycleStage}`, true);
    }
    case 'status': {
      const gone = missing(values, rc.statuses);
      if (gone.length > 0) {
        return invalid(
          'status_deleted',
          `The status "${gone.join('", "')}" does not exist (it may have been deleted).`,
          gone,
        );
      }
      return text(sql`${contacts.status}`, true);
    }
    case 'owner':
      return owner(op, values, rc);
    case 'tags': {
      const gone = missing(values, rc.tags);
      if (gone.length > 0)
        return invalid(
          'tag_deleted',
          'A tag used here does not exist (it may have been deleted).',
          gone,
        );
      const ids = values.map((v) => rc.tags.get(v)!);
      return { sql: tagsPredicate(orgId, sql`${contacts.id}`, op as SetOperator, ids) };
    }
    case 'groups': {
      const gone = missing(values, rc.groups);
      if (gone.length > 0) {
        return invalid(
          'group_deleted',
          'A group used here does not exist (it may have been deleted).',
          gone,
        );
      }
      const ids = values.map((v) => rc.groups.get(v)!);
      return { sql: groupsPredicate(orgId, sql`${contacts.id}`, op as SetOperator, ids) };
    }
    case 'unsubscribed':
      return {
        sql:
          op === 'is_true'
            ? sql`${contacts.isUnsubscribed} = true`
            : sql`${contacts.isUnsubscribed} = false`,
      };
    case 'imported':
      return {
        sql:
          op === 'is_true'
            ? sql`${contacts.importJobId} IS NOT NULL`
            : sql`${contacts.importJobId} IS NULL`,
      };
    case 'minor':
      return { sql: minorCondition(op === 'is_true') };
    case 'uncontacted':
      return {
        sql:
          op === 'is_true'
            ? sql`${contacts.uncontactedSince} IS NOT NULL`
            : sql`${contacts.uncontactedSince} IS NULL`,
      };
    case 'dateOfBirth':
      return {
        sql: datePredicate(
          sql`${contacts.dateOfBirth}::timestamptz`,
          op as DateOperator,
          c.value,
          rc.timezone,
        ),
      };
    case 'age':
      // Whole years on the earliest calendar date on Earth (UTC minus 12 hours), like the minor flag; no date, no age.
      return {
        sql: numberPredicate(
          sql`(CASE WHEN ${contacts.dateOfBirth} IS NULL THEN NULL ELSE EXTRACT(YEAR FROM age((timezone('UTC', now()) - interval '12 hours')::date, ${contacts.dateOfBirth}))::int END)`,
          op as NumberOperator,
          c.value,
        ),
      };
    case 'search':
      return { sql: searchCondition(String(c.value)) };
    case 'createdAt':
      return {
        sql: datePredicate(sql`${contacts.createdAt}`, op as DateOperator, c.value, rc.timezone),
      };
    case 'updatedAt':
      return {
        sql: datePredicate(sql`${contacts.updatedAt}`, op as DateOperator, c.value, rc.timezone),
      };
    case 'lastActivityAt':
      return { sql: datePredicate(contactLastActivity, op as DateOperator, c.value, rc.timezone) };
    default:
      return invalid('operator_unsupported', `Unknown field "${c.field}".`);
  }
}

function owner(op: SegmentOperator, values: string[], rc: RuleContext): Verdict {
  const col = sql`${contacts.ownerId}`;
  if (op === 'is_empty') return { sql: sql`${col} IS NULL` };
  if (op === 'is_not_empty') return { sql: sql`${col} IS NOT NULL` };
  const gone = missing(values, rc.users);
  if (gone.length > 0)
    return invalid(
      'user_deleted',
      'A user used here does not exist (they may have been removed).',
      gone,
    );
  const ids = sql.join(
    values.map((v) => sql`${rc.users.get(v)!}::bigint`),
    sql`, `,
  );
  switch (op) {
    case 'equals':
    case 'in':
      return { sql: sql`${col} IN (${ids})` };
    default:
      return { sql: sql`(${col} IS NULL OR ${col} NOT IN (${ids}))` };
  }
}
