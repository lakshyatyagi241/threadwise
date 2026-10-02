import {
  SEGMENT_DESCRIPTION_MAX,
  SEGMENT_NAME_MAX,
  type CreateSegmentInput,
  type Segment,
  type SegmentVisibility,
} from '../api/schemas';
import { kindLookup, type FieldDef } from './fields';
import {
  MAX_CONDITIONS,
  MAX_DEPTH,
  conditionsOf,
  countConditions,
  emptyRoot,
  signature,
  treeDepth,
  valueProblem,
  type Group,
  type ValueProblem,
} from './model';
import { fromWire, parseRules, toWire } from './wire';

/** The builder's form: the segment's details plus its rule tree, with the checks that run before saving. */

export const SEGMENT_COLORS = ['#7C3AED', '#22C55E', '#E87A5D', '#E5A04E', '#13478A', '#0F766E'] as const;

export interface SegmentForm {
  name: string;
  description: string;
  color: string;
  visibility: SegmentVisibility;
  rules: Group;
}

export function blankForm(): SegmentForm {
  return {
    name: '',
    description: '',
    color: SEGMENT_COLORS[0],
    visibility: 'private',
    rules: emptyRoot(),
  };
}

export function formFromSegment(s: Pick<Segment, 'name' | 'description' | 'color' | 'visibility' | 'rules'>): SegmentForm {
  return {
    name: s.name,
    description: s.description ?? '',
    color: s.color || SEGMENT_COLORS[0],
    visibility: s.visibility,
    rules: fromWire(s.rules),
  };
}

/** The body of a create or update (the caller adds `rowVersion` for an update); null when the rules are not valid yet. */
export function formToInput(form: SegmentForm, catalog: readonly FieldDef[]): CreateSegmentInput | null {
  const rules = parseRules(toWire(form.rules, catalog));
  if (!rules) return null;
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    color: form.color,
    visibility: form.visibility,
    rules,
  };
}

/** Same details and same rules (local ids do not count): the unsaved-changes guard compares with this. */
export function formSignature(form: SegmentForm): string {
  return JSON.stringify([
    form.name.trim(),
    form.description.trim(),
    form.color,
    form.visibility,
    signature(form.rules),
  ]);
}

export type RulesProblem = 'empty' | 'incomplete' | 'tooMany' | 'tooDeep' | 'invalid';

export interface FormProblems {
  name?: 'required' | 'tooLong';
  description?: 'tooLong';
  rules?: RulesProblem;
  /** Per condition id: what is wrong with its value. */
  conditions: Record<string, ValueProblem | 'field'>;
}

export const hasProblems = (p: FormProblems): boolean =>
  Boolean(p.name || p.description || p.rules || Object.keys(p.conditions).length > 0);

export function validateForm(form: SegmentForm, catalog: readonly FieldDef[]): FormProblems {
  const out: FormProblems = { conditions: {} };
  const name = form.name.trim();
  if (!name) out.name = 'required';
  else if (name.length > SEGMENT_NAME_MAX) out.name = 'tooLong';
  if (form.description.trim().length > SEGMENT_DESCRIPTION_MAX) out.description = 'tooLong';

  const kindOf = kindLookup(catalog);
  const all = conditionsOf(form.rules);
  for (const c of all) {
    const kind = kindOf(c.field);
    if (kind === null) out.conditions[c.id] = 'field';
    else {
      const problem = valueProblem(c, kind);
      if (problem) out.conditions[c.id] = problem;
    }
  }
  if (all.length === 0) out.rules = 'empty';
  else if (countConditions(form.rules) > MAX_CONDITIONS) out.rules = 'tooMany';
  else if (treeDepth(form.rules) > MAX_DEPTH) out.rules = 'tooDeep';
  else if (Object.keys(out.conditions).length > 0) out.rules = 'incomplete';
  // The contract has the last word: whatever it would refuse is refused here, before the call.
  else if (!parseRules(toWire(form.rules, catalog))) out.rules = 'invalid';
  return out;
}

// --- the server's validation answer, mapped onto the form -------------------------------------------------------

export interface ServerProblems {
  name?: string;
  description?: string;
  color?: string;
  visibility?: string;
  rules?: string;
  /** Per condition id. */
  conditions: Record<string, string>;
}

/** Index path of a rule position in a problem path: `rules.children.1.children.0.value` is `[1, 0]`. */
export function indexPathOf(path: string): number[] | null {
  if (!/^rules(\.|\[|$)/.test(path)) return null;
  const out: number[] = [];
  for (const m of path.matchAll(/children(?:\.|\[)(\d+)\]?/g)) out.push(Number(m[1]));
  return out;
}

function nodeAt(root: Group, indexes: readonly number[]) {
  let node: Group | Group['children'][number] = root;
  for (const i of indexes) {
    if (node.kind !== 'group') return null;
    const next: Group['children'][number] | undefined = node.children[i];
    if (!next) return null;
    node = next;
  }
  return node;
}

/**
 * Field errors from a problem+json `errors[]` (`{path, message}`), placed on the form field or the condition they name.
 * An error on `rules` itself, or on a path that matches no condition, lands on the rules as a whole.
 */
export function mapServerProblems(
  errors: ReadonlyArray<{ path: string; message: string }>,
  root: Group,
): ServerProblems {
  const out: ServerProblems = { conditions: {} };
  for (const e of errors) {
    const head = e.path.split(/[.[]/)[0] ?? '';
    if (head === 'name' || head === 'description' || head === 'color' || head === 'visibility') {
      out[head] ??= e.message;
      continue;
    }
    const indexes = indexPathOf(e.path);
    if (indexes === null) continue;
    const node = indexes.length > 0 ? nodeAt(root, indexes) : null;
    if (node && node.kind === 'condition') out.conditions[node.id] ??= e.message;
    else out.rules ??= e.message;
  }
  return out;
}

export const hasServerProblems = (p: ServerProblems): boolean =>
  Boolean(p.name || p.description || p.color || p.visibility || p.rules || Object.keys(p.conditions).length);
