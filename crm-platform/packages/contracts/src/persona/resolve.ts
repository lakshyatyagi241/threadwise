import type { NounForms, PersonaDefinition, PersonaNoun } from './definition';
import type { Visibility } from './module-ids';
import type { OperatorOverrides, WorkspaceOverrides } from './overrides';

/**
 * `resolvePersona`: the one place that merges a persona with the two override layers (docs/specs/persona-profiles.md, section 6).
 * Pure, with no I/O and no clock, so the API, the web app and the console's live preview all run the very same function and cannot
 * drift apart.
 *
 * What it decides is only what is DRAWN. It never reads a permission, a plan or an add-on and it never grants anything: the gates
 * that exist today (role, channel, app, plan feature) are applied AFTER it and win (spec 6.2).
 *
 * Precedence for one module id, first match wins:
 *   1. an operator override with `locked: true`          (beats the workspace and beats "Show more modules")
 *   2. a workspace override
 *   3. "Show more modules" (`showAll`), if the item would otherwise be hidden
 *   4. an operator override
 *   5. the persona's explicit entry, else the persona's default
 * Silence at a layer falls through to the next one. A workspace value that a lock overrides stays in storage (an unlock restores it)
 * and is merely ignored here; `explainModule` reports that.
 */

export type VisibilitySource = 'persona' | 'operator' | 'workspace' | 'show_all';

export interface ResolveInput {
  definition: PersonaDefinition;
  operator?: OperatorOverrides | null;
  workspace?: WorkspaceOverrides | null;
  /** The workspace's "Show more modules" switch. */
  showAll?: boolean;
}

/** The effective answer for one id, with what each layer said (the console's "effective view" row). */
export interface ModuleExplanation {
  id: string;
  /** What the persona says: its explicit entry, else its default. */
  persona: Visibility;
  operator: Visibility | null;
  workspace: Visibility | null;
  operatorLocked: boolean;
  visible: boolean;
  source: VisibilitySource;
  /** The workspace set a value that an operator lock overrides. */
  workspaceIgnored: boolean;
}

export function explainModule(id: string, input: ResolveInput): ModuleExplanation {
  const persona: Visibility = input.definition.modules.ids[id] ?? input.definition.modules.default;
  const op = input.operator?.modules[id];
  const ws = input.workspace?.modules[id];
  const base = {
    id,
    persona,
    operator: op?.state ?? null,
    workspace: ws?.state ?? null,
    operatorLocked: op?.locked === true,
  };

  if (op?.locked === true) {
    return {
      ...base,
      visible: op.state === 'show',
      source: 'operator',
      workspaceIgnored: ws !== undefined,
    };
  }
  if (ws) {
    return { ...base, visible: ws.state === 'show', source: 'workspace', workspaceIgnored: false };
  }
  const below: { visible: boolean; source: VisibilitySource } = op
    ? { visible: op.state === 'show', source: 'operator' }
    : { visible: persona === 'show', source: 'persona' };
  if (input.showAll === true && !below.visible) {
    return { ...base, visible: true, source: 'show_all', workspaceIgnored: false };
  }
  return { ...base, ...below, workspaceIgnored: false };
}

export interface ModuleDecision {
  visible: boolean;
  /** Set by the operator with `locked`: the workspace cannot change it ("set by your account team"). */
  locked: boolean;
}

/** The shape the web needs to hide things: a default and the ids that differ from it. Serialisable, small for a deny-list persona. */
export interface ResolvedVisibility {
  /** What every id not in `modules` is. */
  defaultVisibility: Visibility;
  /** Only the ids whose decision differs from the default, or that are locked. */
  modules: Record<string, ModuleDecision>;
  /** Ids named by a layer that the catalog does not have. They are dropped here (never an error) and listed for the console. */
  unknownIds: string[];
}

export function resolvePersona(
  input: ResolveInput,
  /** Every module id the app has. When given, ids outside it are ignored. */
  catalog?: ReadonlySet<string>,
): ResolvedVisibility {
  const defaultVisibility: Visibility =
    input.showAll === true ? 'show' : input.definition.modules.default;
  const named = new Set<string>([
    ...Object.keys(input.definition.modules.ids),
    ...Object.keys(input.operator?.modules ?? {}),
    ...Object.keys(input.workspace?.modules ?? {}),
  ]);

  const modules: Record<string, ModuleDecision> = {};
  const unknownIds: string[] = [];
  for (const id of [...named].sort()) {
    if (catalog && !catalog.has(id)) {
      unknownIds.push(id);
      continue;
    }
    const e = explainModule(id, input);
    const differs = e.visible !== (defaultVisibility === 'show');
    if (differs || e.operatorLocked) modules[id] = { visible: e.visible, locked: e.operatorLocked };
  }
  return { defaultVisibility, modules, unknownIds };
}

/**
 * Every module id a persona definition names (its explicit entries and the screens its checklist opens). Publish refuses a definition
 * with an id outside the generated catalog, and a test holds the seeded personas to the same rule (spec risk 3: ids drift).
 */
export function referencedModuleIds(definition: PersonaDefinition): string[] {
  const ids = new Set(Object.keys(definition.modules.ids));
  for (const step of definition.checklist) if (step.moduleId) ids.add(step.moduleId);
  return [...ids].sort();
}

/**
 * Whether an id is hidden by the persona layers. `null` (the view is unknown: the call failed, or the server has no view) hides
 * nothing: "nothing is hidden on a guess", the same stance the entitlement gates take.
 */
export function isModuleHidden(
  view: Pick<ResolvedVisibility, 'defaultVisibility' | 'modules'> | null | undefined,
  id: string,
): boolean {
  if (!view) return false;
  const decision = view.modules[id];
  return decision ? !decision.visible : view.defaultVisibility === 'hide';
}

/** The ids of `catalog` that are hidden: what the web puts in `Capabilities.hidden`. `null` view means none. */
export function hiddenModuleIds(
  view: Pick<ResolvedVisibility, 'defaultVisibility' | 'modules'> | null | undefined,
  catalog: Iterable<string>,
): Set<string> {
  const out = new Set<string>();
  for (const id of catalog) if (isModuleHidden(view, id)) out.add(id);
  return out;
}

/**
 * Words (spec 6.1): `workspace > operator > persona > default wording`, per noun and locale. The persona layer is all-or-nothing per
 * locale: if any noun it renames lacks forms in that locale, the persona contributes nothing there, so a screen is never half renamed.
 * A noun with no entry is absent from the result, which means "use the default wording".
 */
export function resolveNouns(
  input: ResolveInput,
  locale: string,
): Partial<Record<PersonaNoun, NounForms>> {
  const personaNouns = input.definition.vocabulary.nouns;
  const personaComplete = Object.values(personaNouns).every(
    (byLocale) => byLocale[locale] !== undefined,
  );
  const out: Partial<Record<PersonaNoun, NounForms>> = {};
  const keys = new Set<string>([
    ...(personaComplete ? Object.keys(personaNouns) : []),
    ...Object.keys(input.operator?.vocab ?? {}),
    ...Object.keys(input.workspace?.vocab ?? {}),
  ]);
  for (const key of keys) {
    const forms =
      input.workspace?.vocab[key]?.[locale] ??
      input.operator?.vocab[key]?.[locale] ??
      (personaComplete ? personaNouns[key]?.[locale] : undefined);
    if (forms) out[key as PersonaNoun] = forms;
  }
  return out;
}
