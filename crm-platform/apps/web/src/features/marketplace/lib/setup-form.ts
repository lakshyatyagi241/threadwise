import type { MarketInstallation, RecipeSetupView } from '@crm/contracts';

/**
 * The setup form of an integration, generated from the listing's `setup.authFields` (the admin's fields: `secret`, `text`, `select`).
 * Credentials are write-only: the API returns `{ isSet, hint }` and never a value, so
 *  - on install every required field must be given;
 *  - on edit a blank secret means "keep the stored one", typing replaces it, and the Clear control (optional fields only) removes it.
 *
 * The listing's field view carries no `pattern` (the API checks it on save and answers 422); a field object that does have one is
 * checked here first, so the screen is ready for the day the setup view exposes it.
 */

export type SetupField = RecipeSetupView['authFields'][number] & { pattern?: string | null };
export type CredentialState = MarketInstallation['credentials'][number];
export type FieldValues = Record<string, string>;
export type FieldProblem = 'required' | 'pattern' | 'option';
export type FormMode = 'install' | 'edit';

export const fieldId = (prefix: string, key: string): string => `${prefix}-${key}`;

const stateOf = (states: readonly CredentialState[] | undefined, key: string) =>
  states?.find((s) => s.key === key);

/** The text a plain field currently holds: the API's hint for a set text or select field, nothing for anything else. */
export function currentValue(
  field: SetupField,
  states: readonly CredentialState[] | undefined,
): string {
  if (field.kind === 'secret') return '';
  const s = stateOf(states, field.key);
  return s?.isSet && s.hint ? s.hint : '';
}

/** Install starts empty. Edit starts with the stored text of plain fields and always empty secrets (they are never sent back). */
export function initialValues(
  fields: readonly SetupField[],
  states?: readonly CredentialState[],
): FieldValues {
  const out: FieldValues = {};
  for (const f of fields) out[f.key] = currentValue(f, states);
  return out;
}

function matchesPattern(pattern: string | null | undefined, value: string): boolean {
  if (!pattern) return true;
  try {
    return new RegExp(pattern).test(value);
  } catch {
    // The API refuses a recipe with a bad pattern when it is saved; a screen must not block on one it cannot read.
    return true;
  }
}

export interface ValidateOptions {
  mode: FormMode;
  states?: readonly CredentialState[];
  /** Fields whose stored value the person chose to clear (edit only). */
  cleared?: ReadonlySet<string>;
}

/** Problems by field key. Empty means the form may be sent. */
export function validateFields(
  fields: readonly SetupField[],
  values: FieldValues,
  opts: ValidateOptions,
): Record<string, FieldProblem> {
  const problems: Record<string, FieldProblem> = {};
  for (const f of fields) {
    if (opts.cleared?.has(f.key)) {
      if (f.required) problems[f.key] = 'required';
      continue;
    }
    const v = (values[f.key] ?? '').trim();
    const stored = opts.mode === 'edit' && stateOf(opts.states, f.key)?.isSet === true;
    if (v === '') {
      // A blank plain text field in edit mode is a deliberate "empty it", which a required field cannot be.
      const keepsStored = stored && f.kind === 'secret';
      if (f.required && !keepsStored) problems[f.key] = 'required';
      continue;
    }
    if (f.kind === 'select' && !(f.options ?? []).some((o) => o.value === v)) {
      problems[f.key] = 'option';
      continue;
    }
    if (f.kind !== 'select' && !matchesPattern(f.pattern, v)) problems[f.key] = 'pattern';
  }
  return problems;
}

/** `credentials` of the install request: only what was filled in, trimmed. Nothing here is kept after the call. */
export function buildInstallCredentials(
  fields: readonly SetupField[],
  values: FieldValues,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = (values[f.key] ?? '').trim();
    if (v !== '') out[f.key] = v;
  }
  return out;
}

export interface CredentialPatch {
  credentials: Record<string, string>;
  clearCredentials: string[];
  /** Nothing to send: the form is as stored. */
  empty: boolean;
}

/** `credentials` and `clearCredentials` of the PATCH. A blank secret is left out so the stored one stays. */
export function buildCredentialPatch(
  fields: readonly SetupField[],
  values: FieldValues,
  states: readonly CredentialState[] | undefined,
  cleared: ReadonlySet<string> = new Set(),
): CredentialPatch {
  const credentials: Record<string, string> = {};
  const clearCredentials: string[] = [];
  for (const f of fields) {
    const v = (values[f.key] ?? '').trim();
    const state = stateOf(states, f.key);
    if (cleared.has(f.key)) {
      if (state?.isSet) clearCredentials.push(f.key);
      continue;
    }
    if (f.kind === 'secret') {
      if (v !== '') credentials[f.key] = v;
      continue;
    }
    const current = currentValue(f, states);
    if (v === '' && current !== '' && !f.required) clearCredentials.push(f.key);
    else if (v !== '' && v !== current) credentials[f.key] = v;
  }
  return {
    credentials,
    clearCredentials,
    empty: Object.keys(credentials).length === 0 && clearCredentials.length === 0,
  };
}

export type CredentialDisplay =
  | { kind: 'notSet' }
  /** A secret that is set: only its last characters, which the API words as `ends in ####`. */
  | { kind: 'endsIn'; last: string }
  /** A set field whose hint is not of that form: shown as the API sent it (plain text fields hold their value there). */
  | { kind: 'value'; value: string }
  | { kind: 'setNoHint' };

/** `ends in 9f2a` (the API's wording for the tail of a secret) gives `9f2a`; any other hint gives null. */
export function parseEndsIn(hint: string | null | undefined): string | null {
  const m = hint ? /^ends in (.+)$/i.exec(hint.trim()) : null;
  return m ? m[1]! : null;
}

/** What to say under a credential field about what is stored. Never a secret's value: the API does not send one. */
export function credentialDisplay(state: CredentialState | undefined): CredentialDisplay {
  if (!state || !state.isSet) return { kind: 'notSet' };
  if (state.kind === 'secret') {
    const last = parseEndsIn(state.hint);
    return last ? { kind: 'endsIn', last } : { kind: 'setNoHint' };
  }
  return state.hint ? { kind: 'value', value: state.hint } : { kind: 'setNoHint' };
}

/** Fields the person may clear: set, optional. A required credential can be replaced but not emptied. */
export function canClear(
  field: SetupField,
  states: readonly CredentialState[] | undefined,
): boolean {
  return !field.required && stateOf(states, field.key)?.isSet === true;
}

/** Keys the setup form has but the installation holds no state for: the listing grew a field since the install. */
export function newFields(
  fields: readonly SetupField[],
  states: readonly CredentialState[] | undefined,
): SetupField[] {
  return fields.filter((f) => !stateOf(states, f.key));
}
