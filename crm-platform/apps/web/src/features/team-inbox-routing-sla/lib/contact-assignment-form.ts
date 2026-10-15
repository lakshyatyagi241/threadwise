import {
  assignmentConditionsSchema,
  type AssignmentConditions,
  type AssignmentRule,
  type AssignmentSubject,
  type ContactAssignmentStrategy,
  type CreateAssignmentRuleInput,
} from '@crm/contracts';

/** The rule form's state: free text where a person types lists, so nothing is lost while editing. */
export interface AssignmentDraft {
  name: string;
  subject: AssignmentSubject;
  strategy: ContactAssignmentStrategy;
  userIds: string[];
  teamIds: string[];
  skipOffline: boolean;
  sources: string;
  countryCodes: string;
  phonePrefixes: string;
  lifecycleStages: string;
  origins: string[];
  /** One `key=value` per line. */
  properties: string;
  pipelineIds: string[];
  valueMin: string;
  valueMax: string;
}

export const emptyDraft = (subject: AssignmentSubject = 'contact'): AssignmentDraft => ({
  name: '',
  subject,
  strategy: 'round_robin',
  userIds: [],
  teamIds: [],
  skipOffline: true,
  sources: '',
  countryCodes: '',
  phonePrefixes: '',
  lifecycleStages: '',
  origins: [],
  properties: '',
  pipelineIds: [],
  valueMin: '',
  valueMax: '',
});

const list = (text: string): string[] => [
  ...new Set(
    text
      .split(/[,\n]/)
      .map((x) => x.trim())
      .filter(Boolean),
  ),
];

const props = (text: string): Array<{ key: string; equals: string }> =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('=');
      return i < 0
        ? { key: l, equals: '' }
        : { key: l.slice(0, i).trim(), equals: l.slice(i + 1).trim() };
    })
    .filter((p) => p.key !== '');

export function draftOf(r: AssignmentRule): AssignmentDraft {
  const c = r.conditions;
  return {
    name: r.name,
    subject: r.subject,
    strategy: r.strategy,
    userIds: r.userIds,
    teamIds: r.teamIds,
    skipOffline: r.skipOffline,
    sources: c.sources.join(', '),
    countryCodes: c.countryCodes.join(', '),
    phonePrefixes: c.phonePrefixes.join(', '),
    lifecycleStages: c.lifecycleStages.join(', '),
    origins: c.origins,
    properties: c.properties.map((p) => `${p.key}=${p.equals}`).join('\n'),
    pipelineIds: c.pipelineIds,
    valueMin: c.valueMin === null ? '' : String(c.valueMin),
    valueMax: c.valueMax === null ? '' : String(c.valueMax),
  };
}

export type DraftProblem = 'name' | 'people' | 'fixedOne' | 'prefix' | 'value';

export function toConditions(d: AssignmentDraft): AssignmentConditions | 'prefix' | 'value' {
  const prefixes = list(d.phonePrefixes).map((p) => p.replace(/^\+/, ''));
  if (prefixes.some((p) => !/^\d{1,6}$/.test(p))) return 'prefix';
  const num = (v: string): number | null | 'bad' => {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 'bad';
  };
  const min = num(d.valueMin);
  const max = num(d.valueMax);
  if (min === 'bad' || max === 'bad' || (min !== null && max !== null && max < min)) return 'value';
  return assignmentConditionsSchema.parse({
    sources: list(d.sources),
    countryCodes: list(d.countryCodes),
    phonePrefixes: prefixes,
    lifecycleStages: list(d.lifecycleStages),
    origins: d.origins,
    properties: props(d.properties),
    pipelineIds: d.pipelineIds,
    valueMin: min,
    valueMax: max,
  });
}

/** The draft as an API body, or the first thing wrong with it. The server checks everything again. */
export function toInput(
  d: AssignmentDraft,
): { ok: true; value: CreateAssignmentRuleInput } | { ok: false; problem: DraftProblem } {
  if (d.name.trim() === '') return { ok: false, problem: 'name' };
  if (d.userIds.length + d.teamIds.length === 0) return { ok: false, problem: 'people' };
  if (d.strategy === 'fixed' && (d.userIds.length !== 1 || d.teamIds.length !== 0)) {
    return { ok: false, problem: 'fixedOne' };
  }
  const conditions = toConditions(d);
  if (conditions === 'prefix' || conditions === 'value') return { ok: false, problem: conditions };
  return {
    ok: true,
    value: {
      name: d.name.trim(),
      subject: d.subject,
      conditions,
      strategy: d.strategy,
      userIds: d.userIds,
      teamIds: d.teamIds,
      skipOffline: d.skipOffline,
      isActive: true,
    },
  };
}

/** Which conditions a rule uses, as short tokens for the list row (the screen translates the labels). */
export function usedConditions(c: AssignmentConditions): string[] {
  const out: string[] = [];
  if (c.sources.length) out.push('sources');
  if (c.countryCodes.length) out.push('countryCodes');
  if (c.phonePrefixes.length) out.push('phonePrefixes');
  if (c.lifecycleStages.length) out.push('lifecycleStages');
  if (c.tagIds.length) out.push('tagIds');
  if (c.origins.length) out.push('origins');
  if (c.properties.length) out.push('properties');
  if (c.pipelineIds.length) out.push('pipelineIds');
  if (c.valueMin !== null || c.valueMax !== null) out.push('value');
  return out;
}
