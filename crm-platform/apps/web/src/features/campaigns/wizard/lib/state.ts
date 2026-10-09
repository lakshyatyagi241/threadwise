import {
  EMPTY_WIZARD_DRAFT,
  WIZARD_STEP_COUNT,
  type WizardAudience,
  type WizardDraft,
  type WizardRetries,
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
        Pick<WizardDraft, 'abTesting' | 'abSplit' | 'autoEnd' | 'pacing' | 'trackLinks'>
      >;
    }
  /** Variant B of an A/B test: its template (its mapping keeps what still fits) and its variable mapping. */
  | { type: 'templateB'; template: WizardTemplate | null }
  | { type: 'variableB'; slot: string; source: WizardVariableSource | null }
  | { type: 'variablesB'; variables: WizardVariables }
  | { type: 'schedule'; schedule: WizardSchedule }
  | { type: 'retries'; retries: WizardRetries }
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
    case 'schedule':
      return { ...state, draft: { ...d, schedule: action.schedule } };
    case 'retries':
      return { ...state, draft: { ...d, retries: action.retries } };
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
