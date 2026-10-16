import {
  EMPTY_WIZARD_DRAFT,
  WIZARD_STEP_COUNT,
  WIZARD_TEMPLATE_SEQUENCE_MAX,
  type WizardAudience,
  type WizardDraft,
  type WizardFollowUp,
  type WizardRetries,
  type WizardSequenceTemplate,
  type WizardSchedule,
  type WizardTemplate,
  type WizardVariableSource,
  type WizardVariables,
} from '@crm/contracts';

/** What a save sends: the keys of the draft that changed. */
export type DraftPatch = Partial<WizardDraft>;

export type WizardView = 1 | 2 | 3 | 4;

export interface WizardState {
  /** What the person has filled in. Held whole; the saver sends only what changed. */
  draft: WizardDraft;
  /** The step on screen. `draft.step` is the furthest one reached. */
  view: WizardView;
}

export type WizardAction =
  | { type: 'name'; name: string }
  | { type: 'template'; template: WizardTemplate | null }
  | { type: 'sender'; senderKey: string | null }
  | { type: 'audience'; patch: Partial<WizardAudience> }
  | { type: 'variable'; slot: string; source: WizardVariableSource | null }
  | { type: 'variables'; variables: WizardVariables }
  /** The campaign builder's options: A/B test and split, auto-end, Smart Delivery, link tracking. */
  | {
      type: 'options';
      patch: Partial<
        Pick<
          WizardDraft,
          'abTesting' | 'abSplit' | 'autoEnd' | 'pacing' | 'trackLinks' | 'retryFailed'
        >
      >;
    }
  /** Variant B of an A/B test: its template (its mapping keeps what still fits) and its variable mapping. */
  | { type: 'templateB'; template: WizardTemplate | null }
  | { type: 'variableB'; slot: string; source: WizardVariableSource | null }
  | { type: 'variablesB'; variables: WizardVariables }
  /**
   * The templates after the draft's own in a recurring broadcast, which the runs send in turn: add an empty one at the end, remove or
   * move one (it takes its variable mapping along), clear them all, pick one's template (its mapping keeps what still fits) and map
   * its variables.
   */
  | { type: 'sequenceAdd' }
  | { type: 'sequenceRemove'; index: number }
  | { type: 'sequenceMove'; index: number; by: -1 | 1 }
  | { type: 'sequenceClear' }
  | { type: 'sequenceTemplate'; index: number; template: WizardTemplate | null }
  | { type: 'sequenceVariable'; index: number; slot: string; source: WizardVariableSource | null }
  | { type: 'sequenceVariables'; index: number; variables: WizardVariables }
  | { type: 'schedule'; schedule: WizardSchedule }
  | { type: 'retries'; retries: WizardRetries }
  /** The follow-up steps after the campaign message, as the whole list (add, remove and edit build the next list). */
  | { type: 'followUps'; followUps: WizardFollowUp[] }
  | { type: 'go'; step: WizardView }
  | { type: 'hydrate'; draft: WizardDraft };

export const clampStep = (n: number): WizardView =>
  Math.min(WIZARD_STEP_COUNT, Math.max(1, Math.trunc(n) || 1)) as WizardView;

export function initialState(draft: WizardDraft = EMPTY_WIZARD_DRAFT): WizardState {
  return { draft, view: clampStep(draft.step) };
}

/** Variables that still have a placeholder in the new template (matched by slot key); the rest are dropped. */
export function keepMatchingVariables(
  variables: WizardVariables,
  template: Pick<WizardTemplate, 'slots'> | null,
): WizardVariables {
  if (!template) return {};
  const slots = new Set(template.slots.map((s) => s.slot));
  return Object.fromEntries(Object.entries(variables).filter(([k]) => slots.has(k)));
}

/** The sequence with the entry at `index` replaced (the same list when there is no such entry). */
function withEntry(
  list: readonly WizardSequenceTemplate[],
  index: number,
  change: (e: WizardSequenceTemplate) => WizardSequenceTemplate,
): WizardSequenceTemplate[] {
  return list.map((e, i) => (i === index ? change(e) : e));
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  const d = state.draft;
  switch (action.type) {
    case 'name':
      return action.name === d.name ? state : { ...state, draft: { ...d, name: action.name } };
    case 'template': {
      const templateId = action.template?.id ?? null;
      if (templateId === d.templateId) return state;
      return {
        ...state,
        draft: {
          ...d,
          templateId,
          variables: keepMatchingVariables(d.variables, action.template),
        },
      };
    }
    case 'sender':
      return action.senderKey === d.senderKey
        ? state
        : { ...state, draft: { ...d, senderKey: action.senderKey } };
    case 'audience':
      return { ...state, draft: { ...d, audience: { ...d.audience, ...action.patch } } };
    case 'variable': {
      const next = { ...d.variables };
      if (action.source) next[action.slot] = action.source;
      else delete next[action.slot];
      return { ...state, draft: { ...d, variables: next } };
    }
    case 'variables':
      return { ...state, draft: { ...d, variables: action.variables } };
    case 'options':
      return { ...state, draft: { ...d, ...action.patch } };
    case 'templateB': {
      const templateIdB = action.template?.id ?? null;
      if (templateIdB === d.templateIdB) return state;
      return {
        ...state,
        draft: {
          ...d,
          templateIdB,
          variablesB: keepMatchingVariables(d.variablesB, action.template),
        },
      };
    }
    case 'variableB': {
      const next = { ...d.variablesB };
      if (action.source) next[action.slot] = action.source;
      else delete next[action.slot];
      return { ...state, draft: { ...d, variablesB: next } };
    }
    case 'variablesB':
      return { ...state, draft: { ...d, variablesB: action.variables } };
    case 'sequenceAdd':
      return d.templateSequence.length >= WIZARD_TEMPLATE_SEQUENCE_MAX
        ? state
        : {
            ...state,
            draft: {
              ...d,
              templateSequence: [...d.templateSequence, { templateId: null, variables: {} }],
            },
          };
    case 'sequenceRemove':
      return action.index < 0 || action.index >= d.templateSequence.length
        ? state
        : {
            ...state,
            draft: {
              ...d,
              templateSequence: d.templateSequence.filter((_, i) => i !== action.index),
            },
          };
    case 'sequenceClear':
      return d.templateSequence.length === 0
        ? state
        : { ...state, draft: { ...d, templateSequence: [] } };
    case 'sequenceMove': {
      const to = action.index + action.by;
      const n = d.templateSequence.length;
      if (action.index < 0 || action.index >= n || to < 0 || to >= n) return state;
      const next = [...d.templateSequence];
      [next[action.index], next[to]] = [next[to]!, next[action.index]!];
      return { ...state, draft: { ...d, templateSequence: next } };
    }
    case 'sequenceTemplate': {
      const current = d.templateSequence[action.index];
      const templateId = action.template?.id ?? null;
      if (!current || current.templateId === templateId) return state;
      return {
        ...state,
        draft: {
          ...d,
          templateSequence: withEntry(d.templateSequence, action.index, (e) => ({
            templateId,
            variables: keepMatchingVariables(e.variables, action.template),
          })),
        },
      };
    }
    case 'sequenceVariable': {
      if (!d.templateSequence[action.index]) return state;
      return {
        ...state,
        draft: {
          ...d,
          templateSequence: withEntry(d.templateSequence, action.index, (e) => {
            const next = { ...e.variables };
            if (action.source) next[action.slot] = action.source;
            else delete next[action.slot];
            return { ...e, variables: next };
          }),
        },
      };
    }
    case 'sequenceVariables': {
      if (!d.templateSequence[action.index]) return state;
      return {
        ...state,
        draft: {
          ...d,
          templateSequence: withEntry(d.templateSequence, action.index, (e) => ({
            ...e,
            variables: action.variables,
          })),
        },
      };
    }
    case 'schedule':
      return { ...state, draft: { ...d, schedule: action.schedule } };
    case 'retries':
      return { ...state, draft: { ...d, retries: action.retries } };
    case 'followUps':
      return { ...state, draft: { ...d, followUps: action.followUps } };
    case 'go': {
      const step = Math.max(d.step, action.step);
      return {
        view: action.step,
        draft: step === d.step ? d : { ...d, step },
      };
    }
    case 'hydrate':
      return initialState(action.draft);
  }
}

const KEYS = Object.keys(EMPTY_WIZARD_DRAFT) as Array<keyof WizardDraft>;

/** The keys of the draft that differ between two states, as a save patch. Empty when nothing changed. */
export function draftPatch(prev: WizardDraft, next: WizardDraft): DraftPatch {
  const out: Record<string, unknown> = {};
  for (const k of KEYS) {
    if (prev[k] !== next[k] && JSON.stringify(prev[k]) !== JSON.stringify(next[k]))
      out[k] = next[k];
  }
  return out as DraftPatch;
}
