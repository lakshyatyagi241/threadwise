import type {
  AssignmentRule,
  AssignmentRules,
  AssignmentSubject,
  ContactAssignmentStrategy,
  CreateAssignmentRuleInput,
  UpdateAssignmentRuleInput,
} from '@crm/contracts';

/** The rule form as the person edits it. The conditions live in the builder; this is everything else. */
export interface RuleDraft {
  name: string;
  description: string;
  subject: AssignmentSubject;
  strategy: ContactAssignmentStrategy;
  userIds: string[];
  teamIds: string[];
  skipOffline: boolean;
  reassignOnUpdate: boolean;
}

export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 500;

export function emptyDraft(subject: AssignmentSubject): RuleDraft {
  return {
    name: '',
    description: '',
    subject,
    strategy: 'round_robin',
    userIds: [],
    teamIds: [],
    skipOffline: true,
    reassignOnUpdate: false,
  };
}

export function draftOf(rule: AssignmentRule): RuleDraft {
  return {
    name: rule.name,
    description: rule.description,
    subject: rule.subject,
    strategy: rule.strategy,
    userIds: [...rule.userIds],
    teamIds: [...rule.teamIds],
    skipOffline: rule.skipOffline,
    reassignOnUpdate: rule.reassignOnUpdate,
  };
}

/** Changing the method: a specific-user rule names one person and no team, so the pool is cut down to fit. */
export function withStrategy(d: RuleDraft, strategy: ContactAssignmentStrategy): RuleDraft {
  return strategy === 'fixed'
    ? { ...d, strategy, userIds: d.userIds.slice(0, 1), teamIds: [] }
    : { ...d, strategy };
}

export type DraftProblem = 'name' | 'people' | 'fixedOne';

/** Why the form cannot be saved yet. */
export function draftProblems(d: RuleDraft): DraftProblem[] {
  const out: DraftProblem[] = [];
  const name = d.name.trim();
  if (name === '' || name.length > NAME_MAX) out.push('name');
  if (d.userIds.length + d.teamIds.length === 0) out.push('people');
  else if (d.strategy === 'fixed' && (d.userIds.length !== 1 || d.teamIds.length > 0))
    out.push('fixedOne');
  return out;
}

export function toCreateInput(
  d: RuleDraft,
  rules: AssignmentRules | null,
  isActive: boolean,
): CreateAssignmentRuleInput {
  return {
    name: d.name.trim(),
    description: d.description.trim(),
    subject: d.subject,
    rules,
    strategy: d.strategy,
    userIds: d.userIds,
    teamIds: d.teamIds,
    skipOffline: d.skipOffline,
    reassignOnUpdate: d.reassignOnUpdate,
    isActive,
  };
}

/** The module of a rule never changes, so an update does not carry it. `isActive` only when the save also (de)activates. */
export function toUpdateInput(
  d: RuleDraft,
  rules: AssignmentRules | null,
  rowVersion: number,
  isActive?: boolean,
): UpdateAssignmentRuleInput {
  return {
    rowVersion,
    name: d.name.trim(),
    description: d.description.trim(),
    rules,
    strategy: d.strategy,
    userIds: d.userIds,
    teamIds: d.teamIds,
    skipOffline: d.skipOffline,
    reassignOnUpdate: d.reassignOnUpdate,
    ...(isActive === undefined ? {} : { isActive }),
  };
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Has the form changed from what was loaded? (The unsaved-changes guard.) */
export function draftChanged(a: RuleDraft, b: RuleDraft): boolean {
  return (
    a.name !== b.name ||
    a.description !== b.description ||
    a.strategy !== b.strategy ||
    a.skipOffline !== b.skipOffline ||
    a.reassignOnUpdate !== b.reassignOnUpdate ||
    !same(a.userIds, b.userIds) ||
    !same(a.teamIds, b.teamIds)
  );
}
