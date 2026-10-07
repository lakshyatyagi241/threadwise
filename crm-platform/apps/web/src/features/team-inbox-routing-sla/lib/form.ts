import {
  ROUTING_DESCRIPTION_MAX,
  ROUTING_KEYWORDS_MAX,
  ROUTING_NAME_MAX,
  type CreateRoutingRuleInput,
  type RoutingConditions,
  type RoutingRule,
  type RoutingStrategy,
  type SegmentGroup,
} from '@crm/contracts';
import { kindLookup, type FieldDef } from '@/features/segments/lib/fields';
import { emptyRoot, pruneIncomplete, type Group } from '@/features/segments/lib/model';
import { fromWire, parseRules, toWire } from '@/features/segments/lib/wire';

/** The rule form as the person edits it. Text fields stay text until save; the contact conditions are the segments builder's own tree. */
export interface RuleForm {
  name: string;
  description: string;
  contact: Group;
  channelKinds: string[];
  keywords: string;
  keywordMode: 'any' | 'all';
  languages: string;
  businessHours: 'any' | 'inside' | 'outside';
  strategy: RoutingStrategy;
  userIds: string[];
  teamIds: string[];
  stopOnMatch: boolean;
  isFallback: boolean;
}

export const emptyForm = (): RuleForm => ({
  name: '',
  description: '',
  contact: emptyRoot(),
  channelKinds: [],
  keywords: '',
  keywordMode: 'any',
  languages: '',
  businessHours: 'any',
  strategy: 'round_robin',
  userIds: [],
  teamIds: [],
  stopOnMatch: true,
  isFallback: false,
});

/** Words split on commas and line breaks, trimmed, each once (case-insensitively). */
export function splitWords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,;،]/)) {
    const w = raw.trim();
    if (w && !seen.has(w.toLocaleLowerCase())) {
      seen.add(w.toLocaleLowerCase());
      out.push(w);
    }
  }
  return out;
}

export function formFromRule(rule: RoutingRule): RuleForm {
  const c = rule.conditions;
  return {
    name: rule.name,
    description: rule.description,
    contact: fromWire(c.contact as SegmentGroup | null),
    channelKinds: [...c.channelKinds],
    keywords: c.keywords ? c.keywords.words.join(', ') : '',
    keywordMode: c.keywords?.mode ?? 'any',
    languages: c.languages.join(', '),
    businessHours: c.businessHours,
    strategy: rule.assign.strategy,
    userIds: [...rule.assign.userIds],
    teamIds: [...rule.assign.teamIds],
    stopOnMatch: rule.stopOnMatch,
    isFallback: rule.isFallback,
  };
}

/** The contact conditions the contract accepts: the finished ones only; null when there are none. */
function contactRules(root: Group, catalog: readonly FieldDef[]): SegmentGroup | null {
  const wire = toWire(root, catalog);
  return wire.children.length === 0 ? null : (parseRules(wire) as SegmentGroup | null);
}

export function conditionsFromForm(f: RuleForm, catalog: readonly FieldDef[]): RoutingConditions {
  const words = splitWords(f.keywords);
  return {
    contact: contactRules(f.contact, catalog) as RoutingConditions['contact'],
    channelKinds: f.channelKinds as RoutingConditions['channelKinds'],
    keywords: words.length > 0 ? { mode: f.keywordMode, words } : null,
    languages: splitWords(f.languages).map((l) => l.toLowerCase()),
    businessHours: f.businessHours,
  };
}

export type FormProblem =
  | 'name'
  | 'nameLong'
  | 'descriptionLong'
  | 'conditions'
  | 'contactIncomplete'
  | 'keywordsMany'
  | 'targets'
  | 'specific';

/** What stops a save, in the order the form shows it (the same checks the API makes, so a clean form is not refused). */
export function problemsOf(f: RuleForm, catalog: readonly FieldDef[]): FormProblem[] {
  const out: FormProblem[] = [];
  if (f.name.trim() === '') out.push('name');
  else if (f.name.trim().length > ROUTING_NAME_MAX) out.push('nameLong');
  if (f.description.trim().length > ROUTING_DESCRIPTION_MAX) out.push('descriptionLong');
  if (pruneIncomplete(f.contact, kindLookup(catalog)).dropped > 0) out.push('contactIncomplete');
  if (splitWords(f.keywords).length > ROUTING_KEYWORDS_MAX) out.push('keywordsMany');
  const c = conditionsFromForm(f, catalog);
  const any =
    c.contact !== null ||
    c.channelKinds.length > 0 ||
    c.keywords !== null ||
    c.languages.length > 0 ||
    c.businessHours !== 'any';
  if (!any && !f.isFallback) out.push('conditions');
  if (f.userIds.length + f.teamIds.length === 0) out.push('targets');
  else if (f.strategy === 'specific' && (f.userIds.length !== 1 || f.teamIds.length > 0)) {
    out.push('specific');
  }
  return out;
}

export function payloadFromForm(
  f: RuleForm,
  catalog: readonly FieldDef[],
  isActive: boolean,
): CreateRoutingRuleInput {
  return {
    name: f.name.trim(),
    description: f.description.trim(),
    conditions: conditionsFromForm(f, catalog),
    assign: { strategy: f.strategy, userIds: f.userIds, teamIds: f.teamIds },
    stopOnMatch: f.stopOnMatch,
    isFallback: f.isFallback,
    isActive,
  };
}

/** What a person can edit, for telling "somebody changed this rule" from "the engine used it" (which only moves counters and the version). */
export const editableOf = (r: RoutingRule): string =>
  JSON.stringify([
    r.name,
    r.description,
    r.conditions,
    r.assign,
    r.stopOnMatch,
    r.isFallback,
    r.isActive,
  ]);

/** The list with the item at `from` moved to `to` (the up and down buttons of the priority list). */
export const moveId = <T>(list: readonly T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return [...list];
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
};

export const toggleId = (ids: readonly string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
