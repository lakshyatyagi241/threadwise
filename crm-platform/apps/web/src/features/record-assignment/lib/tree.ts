import {
  assignmentRulesSchema,
  checkAssignmentRules,
  type AssignmentRuleIssue,
  type AssignmentRules,
  type AssignmentSubject,
} from '@crm/contracts';
import {
  conditionAtPath,
  conditionsOf,
  emptyRoot,
  fromWire,
  kindLookup,
  toWire,
  valueProblem,
  type FieldDef,
  type Group,
  type ValueProblem,
} from '@/features/segments';

/**
 * The condition tree the rule builder edits <-> the `rules` of an assignment rule on the wire. The wire is the segments rule tree, so
 * the segments conversion does the work; this file adds the checks the contract makes for ONE module and the mapping of the server's
 * validation messages back onto conditions.
 */

/** A rule with no condition (`rules: null`) is the fallback: the builder starts from an empty root. */
export function groupFromRules(rules: AssignmentRules | null | undefined): Group {
  return rules ? fromWire(rules as Parameters<typeof fromWire>[0]) : emptyRoot();
}

export type ConditionProblems = Record<string, 'field' | ValueProblem>;

/** What is wrong with each condition (unknown field, missing or malformed value), by condition id. */
export function conditionProblems(root: Group, catalog: readonly FieldDef[]): ConditionProblems {
  const kindOf = kindLookup(catalog);
  const out: ConditionProblems = {};
  for (const c of conditionsOf(root)) {
    const kind = kindOf(c.field);
    if (kind === null) out[c.id] = 'field';
    else {
      const p = valueProblem(c, kind);
      if (p) out[c.id] = p;
    }
  }
  return out;
}

export type RulesResult =
  | { ok: true; rules: AssignmentRules | null }
  | { ok: false; reason: 'incomplete' }
  | { ok: false; reason: 'invalid'; issues: AssignmentRuleIssue[] };

/** The rules to send: null for no condition (fallback), or the validated tree. Nothing is sent while a condition is incomplete. */
export function rulesFromGroup(
  subject: AssignmentSubject,
  root: Group,
  catalog: readonly FieldDef[],
): RulesResult {
  if (conditionsOf(root).length === 0) return { ok: true, rules: null };
  if (Object.keys(conditionProblems(root, catalog)).length > 0)
    return { ok: false, reason: 'incomplete' };
  const parsed = assignmentRulesSchema.safeParse(toWire(root, catalog));
  if (!parsed.success)
    return {
      ok: false,
      reason: 'invalid',
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  const issues = checkAssignmentRules(subject, parsed.data);
  return issues.length > 0
    ? { ok: false, reason: 'invalid', issues }
    : { ok: true, rules: parsed.data };
}

export interface ServerProblems {
  /** Messages on conditions, by condition id. */
  conditions: Record<string, string>;
  /** Messages on other parts of the rule, by field name (`name`, `userIds`, `rules`). */
  fields: Record<string, string>;
}

/** Maps the API's validation errors (`rules.children.0.value`, `userIds`) onto the builder's conditions and the form's fields. */
export function serverProblemsOf(
  root: Group,
  errors: ReadonlyArray<{ path: string; message: string }>,
): ServerProblems {
  const out: ServerProblems = { conditions: {}, fields: {} };
  for (const e of errors) {
    if (e.path === 'rules' || e.path.startsWith('rules.')) {
      const inner = e.path === 'rules' ? '' : e.path.slice('rules.'.length);
      const at = inner.replace(/\.(value|field|operator|type)$/, '');
      const condition = at.includes('children') ? conditionAtPath(root, at) : null;
      if (condition) out.conditions[condition.id] ??= e.message;
      else out.fields['rules'] ??= e.message;
    } else {
      out.fields[e.path.split('.')[0] ?? e.path] ??= e.message;
    }
  }
  return out;
}
