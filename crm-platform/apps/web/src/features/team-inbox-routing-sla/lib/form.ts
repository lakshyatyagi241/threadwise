import {
  ROUTING_AUTO_REPLY_MAX,
  ROUTING_DESCRIPTION_MAX,
  ROUTING_TAGS_MAX,
  ROUTING_KEYWORDS_MAX,
  ROUTING_NAME_MAX,
  type ConversationPriority,
  type CreateRoutingRuleInput,
  hasRoutingConditions,
  type RoutingConditions,
  type RoutingRule,
  type RoutingStrategy,
  type SegmentGroup,
} from '@crm/contracts';
import { kindLookup, type FieldDef } from '@/features/segments/lib/fields';
import { emptyRoot, pruneIncomplete, type Group } from '@/features/segments/lib/model';
import { fromWire, parseRules, toWire } from '@/features/segments/lib/wire';

/**
 * The conditions a rule can have, as the editor's "Add a condition" menu offers them. Only the ones in `RuleForm.added` are shown;
 * a rule starts with none (H13/H14). Contact details come last in the menu: they only match what is already saved on the contact.
 */
export const CONDITION_KEYS = [
  'contactKind',
  'channel',
  'keywords',
  'language',
  'hours',
  'contact',
] as const;
export type ConditionKey = (typeof CONDITION_KEYS)[number];

/** The rule form as the person edits it. Text fields stay text until save; the contact conditions are the segments builder's own tree. */
export interface RuleForm {
  name: string;
  description: string;
  /** "Only for conversations that match...": off (the default) means the rule applies to every new conversation. */
  onlyWhen: boolean;
  /** The condition cards shown, in the order they were added. A condition not listed here is empty. */
  added: ConditionKey[];
  contactKind: 'any' | 'new' | 'returning';
  contact: Group;
  channelKinds: string[];
  keywords: string;
  keywordMode: 'any' | 'all';
  languages: string;
  businessHours: 'any' | 'inside' | 'outside';
  /** Whether the rule assigns the conversation (the agents and teams below); off for a rule that only marks spam or starts a flow. */
  assigns: boolean;
  strategy: RoutingStrategy;
  userIds: string[];
  teamIds: string[];
  /** "Everyone Else" only: every agent who can open the inbox (the lists above are then empty). */
  everyone: boolean;
  /** Whether the rule marks the conversation as spam (Reference's mark_spam). */
  markSpam: boolean;
  /** The priority to set, or '' to leave it as it is. */
  priority: '' | ConversationPriority;
  /** The tags to add, comma or line separated (each is found by name or created). */
  tags: string;
  /** Whether the rule schedules an escalation when nobody replies in time. */
  escalates: boolean;
  /** Minutes until the escalation (text until checked). */
  escalateMinutes: string;
  /** Whether the escalation reassigns the conversation to this rule's agents. */
  escalateReassign: boolean;
  /** The priority the escalation sets, or '' for none. */
  escalatePriority: '' | ConversationPriority;
  /** Whether the rule sends an automatic reply to the customer. */
  autoReplies: boolean;
  /** The automatic reply's text. */
  autoReplyBody: string;
  /** The flow to start as well (its uuid), or '' for none. */
  triggerFlowId: string;
  stopOnMatch: boolean;
  isFallback: boolean;
}

export const emptyForm = (): RuleForm => ({
  name: '',
  description: '',
  onlyWhen: false,
  added: [],
  contactKind: 'any',
  contact: emptyRoot(),
  channelKinds: [],
  keywords: '',
  keywordMode: 'any',
  languages: '',
  businessHours: 'any',
  assigns: true,
  strategy: 'round_robin',
  userIds: [],
  teamIds: [],
  everyone: false,
  markSpam: false,
  priority: '',
  tags: '',
  escalates: false,
  escalateMinutes: '30',
  escalateReassign: true,
  escalatePriority: '',
  autoReplies: false,
  autoReplyBody: '',
  triggerFlowId: '',
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

/** The condition cards a stored rule needs: every part that has a value. */
export function addedOf(c: RoutingConditions): ConditionKey[] {
  const out: ConditionKey[] = [];
  if (c.contactKind !== 'any') out.push('contactKind');
  if (c.channelKinds.length > 0) out.push('channel');
  if (c.keywords) out.push('keywords');
  if (c.languages.length > 0) out.push('language');
  if (c.businessHours !== 'any') out.push('hours');
  if (c.contact) out.push('contact');
  return out;
}

export function formFromRule(rule: RoutingRule): RuleForm {
  const c = rule.conditions;
  const added = addedOf(c);
  return {
    name: rule.name,
    description: rule.description,
    // A rule shows "Only for conversations that match" on unless it applies to every conversation. An old catch-all fallback
    // (no conditions, not flagged) is also "every conversation".
    onlyWhen: !rule.appliesToAll && (added.length > 0 || !rule.isFallback),
    added,
    contactKind: c.contactKind,
    contact: fromWire(c.contact as SegmentGroup | null),
    channelKinds: [...c.channelKinds],
    keywords: c.keywords ? c.keywords.words.join(', ') : '',
    keywordMode: c.keywords?.mode ?? 'any',
    languages: c.languages.join(', '),
    businessHours: c.businessHours,
    assigns: rule.assign !== null,
    strategy: rule.assign?.strategy ?? 'round_robin',
    userIds: [...(rule.assign?.userIds ?? [])],
    teamIds: [...(rule.assign?.teamIds ?? [])],
    everyone: rule.assign?.everyone ?? false,
    markSpam: rule.markSpam,
    priority: rule.priority ?? '',
    tags: rule.addTags.map((t) => t.name).join(', '),
    escalates: rule.escalation !== null,
    escalateMinutes: String(rule.escalation?.minutes ?? 30),
    escalateReassign: rule.escalation?.reassign ?? true,
    escalatePriority: rule.escalation?.priority ?? '',
    autoReplies: rule.autoReply !== null,
    autoReplyBody: rule.autoReply?.body ?? '',
    triggerFlowId: rule.triggerFlow?.id ?? '',
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
    contactKind: f.contactKind,
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
  | 'specific'
  | 'actions'
  | 'tagsMany'
  | 'escalationMinutes'
  | 'escalationAction'
  | 'escalationAgents'
  | 'autoReplyEmpty'
  | 'autoReplyLong';

/** What stops a save, in the order the form shows it (the same checks the API makes, so a clean form is not refused). */
export function problemsOf(f: RuleForm, catalog: readonly FieldDef[]): FormProblem[] {
  const out: FormProblem[] = [];
  if (f.name.trim() === '') out.push('name');
  else if (f.name.trim().length > ROUTING_NAME_MAX) out.push('nameLong');
  if (f.description.trim().length > ROUTING_DESCRIPTION_MAX) out.push('descriptionLong');
  if (pruneIncomplete(f.contact, kindLookup(catalog)).dropped > 0) out.push('contactIncomplete');
  if (splitWords(f.keywords).length > ROUTING_KEYWORDS_MAX) out.push('keywordsMany');
  const c = conditionsFromForm(f, catalog);
  // "Only for conversations that match" is on, so at least one condition is needed or the rule would never match.
  if (f.onlyWhen && !f.isFallback && !hasRoutingConditions(c)) out.push('conditions');
  const tagNames = splitWords(f.tags);
  if (tagNames.length > ROUTING_TAGS_MAX) out.push('tagsMany');
  if (f.escalates) {
    const minutes = Number(f.escalateMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) out.push('escalationMinutes');
    if (!f.escalateReassign && f.escalatePriority === '') out.push('escalationAction');
    if (f.escalateReassign && !f.assigns) out.push('escalationAgents');
  }
  const scheduled = f.escalates && (f.escalateReassign || f.escalatePriority !== '');
  if (f.autoReplies) {
    const body = f.autoReplyBody.trim();
    if (body === '') out.push('autoReplyEmpty');
    else if (body.length > ROUTING_AUTO_REPLY_MAX) out.push('autoReplyLong');
  }
  if (
    !f.assigns &&
    !f.markSpam &&
    f.priority === '' &&
    tagNames.length === 0 &&
    f.triggerFlowId === '' &&
    !scheduled &&
    !f.autoReplies
  ) {
    out.push('actions');
  }
  if (f.assigns && !f.everyone && f.userIds.length + f.teamIds.length === 0) out.push('targets');
  else if (
    f.assigns &&
    !f.everyone &&
    f.strategy === 'specific' &&
    (f.userIds.length !== 1 || f.teamIds.length > 0)
  ) {
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
    assign: f.assigns
      ? {
          strategy: f.strategy,
          userIds: f.everyone ? [] : f.userIds,
          teamIds: f.everyone ? [] : f.teamIds,
          everyone: f.everyone,
        }
      : null,
    markSpam: f.markSpam,
    priority: f.priority === '' ? null : f.priority,
    addTags: splitWords(f.tags).map((name) => ({ name, color: null })),
    autoReply: f.autoReplies ? { body: f.autoReplyBody.trim() } : null,
    escalation: f.escalates
      ? {
          minutes: Number(f.escalateMinutes),
          reassign: f.escalateReassign,
          priority: f.escalatePriority === '' ? null : f.escalatePriority,
        }
      : null,
    triggerFlowId: f.triggerFlowId === '' ? null : f.triggerFlowId,
    stopOnMatch: f.stopOnMatch,
    isFallback: f.isFallback,
    // Off: the rule applies to every conversation and its conditions (kept) are ignored.
    appliesToAll: !f.onlyWhen,
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
    r.markSpam,
    r.priority,
    r.addTags,
    r.escalation,
    r.autoReply,
    r.triggerFlow?.id ?? null,
    r.stopOnMatch,
    r.isFallback,
    r.appliesToAll,
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
