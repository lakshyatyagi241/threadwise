import type {
  FieldDependencyResponse,
  FieldOptionDependencyResponse,
  FieldResponse,
} from '@crm/contracts';
import { attributesAfterChange, withCascadeChoices } from './cascade';
import {
  checkValue,
  emptyInput,
  inputKind,
  inputToValue,
  isCascadeLink,
  isEmptyInput,
  type InputValue,
  type ValueProblem,
} from './field-values';

/**
 * What the bulk update dialog does with each custom property. A property that is not in the map is on "Keep": no contact
 * is touched for it. One that is in the map is either set to the same value on every selected contact, or cleared on all.
 */
export type BulkPropertyChange = { mode: 'set'; value: InputValue } | { mode: 'clear' };
export type BulkPropertyChanges = Readonly<Record<string, BulkPropertyChange>>;

/** `empty`: a property was picked to be set but no value was given (give one, or choose Clear). */
export type BulkPropertyProblem = ValueProblem | 'empty';

/**
 * The built-in text properties a bulk update may set besides the workspace's own: they are offered in the same "Add property" list
 * (so a first name, a source or a memo is as easy to set on many contacts as a custom property). Each is shown with a synthetic
 * property row; a first or last name or a source travels as its own field of the request, the rest as reserved `customFields` keys.
 * Not offered: phone and email (each belongs to one person) and the properties that have their own control (stage, status, owner,
 * groups, opt-out, time zone).
 */
export const BULK_BUILT_INS = [
  { key: 'first_name', label: 'firstName', fieldType: 'text', required: true },
  { key: 'last_name', label: 'lastName', fieldType: 'text', required: false },
  { key: 'middle_name', label: 'middleName', fieldType: 'text', required: false },
  { key: 'language', label: 'language', fieldType: 'text', required: false },
  { key: 'source', label: 'source', fieldType: 'text', required: false },
  { key: 'address', label: 'address', fieldType: 'long_text', required: false },
  { key: 'memo', label: 'memo', fieldType: 'long_text', required: false },
] as const;

/** The built-ins that are fields of the request itself, not `customFields` keys. */
const OWN_REQUEST_FIELD: Readonly<Record<string, 'firstName' | 'lastName' | 'source'>> = {
  first_name: 'firstName',
  last_name: 'lastName',
  source: 'source',
};

/** The built-in properties as property rows (`label` is the translated name for each entry's `label` key). */
export function builtInFields(labelOf: (key: string) => string): FieldResponse[] {
  return BULK_BUILT_INS.map((b, i) => ({
    id: `builtin:${b.key}`,
    moduleKey: 'contacts',
    sectionId: null,
    key: b.key,
    label: labelOf(b.label),
    fieldType: b.fieldType,
    isRequired: b.required,
    isHidden: false,
    isReadOnly: false,
    isMasked: false,
    isUnique: false,
    isQuickCreate: false,
    isGlobalSearch: false,
    isSystem: false,
    isActive: true,
    position: -1000 + i,
    config: {},
    replacesFieldId: null,
    rowVersion: 1,
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
  })) as FieldResponse[];
}

/** The properties a bulk update may set: the workspace's own, active, shown on the form, and not read-only or computed. */
export const isBulkEditable = (f: FieldResponse): boolean =>
  f.isActive && !f.isSystem && !f.isHidden && !f.isReadOnly && f.fieldType !== 'formula';

/**
 * The properties the "Add property" picker offers: editable ones not already added whose label or key contains the search
 * text (any case), in the order of the properties screen.
 */
export function addableProperties(
  fields: readonly FieldResponse[],
  changes: BulkPropertyChanges,
  query: string,
): FieldResponse[] {
  const q = query.trim().toLowerCase();
  return fields
    .filter((f) => isBulkEditable(f) && !(f.key in changes))
    .filter((f) => q === '' || f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q))
    .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
}

/** The value a freshly added property starts with: a checkbox is ticked off, a multi-select is an empty list. */
export const startingChange = (field: Pick<FieldResponse, 'fieldType'>): BulkPropertyChange => ({
  mode: 'set',
  value: inputKind(field) === 'multiselect' ? [] : inputKind(field) === 'checkbox' ? 'false' : '',
});

/** What is wrong with one change, if anything. Clearing a required property is refused (the API refuses it too). */
export function bulkPropertyProblem(
  field: Pick<FieldResponse, 'fieldType' | 'isRequired'>,
  change: BulkPropertyChange,
): BulkPropertyProblem | null {
  if (change.mode === 'clear') return field.isRequired ? 'required' : null;
  // A checkbox always has an answer (ticked or not).
  if (inputKind(field) === 'checkbox') return null;
  const blank = Array.isArray(change.value)
    ? change.value.length === 0
    : change.value.trim() === '';
  if (blank) return 'empty';
  return checkValue({ ...field, isRequired: false }, change.value);
}

/** Every change that cannot be sent, by property key. Changes whose property is no longer in the registry are ignored. */
export function bulkPropertyProblems(
  changes: BulkPropertyChanges,
  fieldsByKey: ReadonlyMap<string, FieldResponse>,
): Record<string, BulkPropertyProblem> {
  const out: Record<string, BulkPropertyProblem> = {};
  for (const [key, change] of Object.entries(changes)) {
    const field = fieldsByKey.get(key);
    const problem = field ? bulkPropertyProblem(field, change) : null;
    if (problem) out[key] = problem;
  }
  return out;
}

/**
 * The `customFields` of the bulk update request: a set property in its stored type (number, boolean, list, text), a cleared
 * one as `null`. Properties on Keep are not in it. `undefined` when nothing was changed, so the field is left out of the body.
 */
export function bulkCustomFields(
  changes: BulkPropertyChanges,
  fieldsByKey: ReadonlyMap<string, FieldResponse>,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, change] of Object.entries(changes)) {
    const field = fieldsByKey.get(key);
    if (!field || key in OWN_REQUEST_FIELD) continue;
    out[key] = change.mode === 'clear' ? null : inputToValue(field, change.value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The built-in name and source changes as fields of the bulk request (`undefined` keys are left out). */
export function bulkBuiltInValues(
  changes: BulkPropertyChanges,
  fieldsByKey: ReadonlyMap<string, FieldResponse>,
): { firstName?: string; lastName?: string | null; source?: string | null } {
  const out: Record<string, string | null> = {};
  for (const [key, to] of Object.entries(OWN_REQUEST_FIELD)) {
    const change = changes[key];
    const field = fieldsByKey.get(key);
    if (!change || !field) continue;
    out[to] =
      change.mode === 'clear' ? null : String(inputToValue(field, change.value) ?? '').trim();
  }
  return out;
}

// --- cascading (dependent) properties ----------------------------------------------------------------------------------

/** The values the rows to set hold now (a cleared property holds none), the way the contact form's cascade reads them. */
export function setValuesOf(changes: BulkPropertyChanges): Record<string, InputValue> {
  const out: Record<string, InputValue> = {};
  for (const [key, change] of Object.entries(changes))
    if (change.mode === 'set') out[key] = change.value;
  return out;
}

/** The parents of a cascade child (the properties whose choices narrow its own). Empty for any other property. */
export function cascadeParents(
  field: Pick<FieldResponse, 'id'>,
  dependencies: readonly FieldDependencyResponse[],
  fields: readonly FieldResponse[],
): FieldResponse[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  return dependencies
    .filter((d) => d.fieldId === field.id && isCascadeLink(d))
    .flatMap((d) => byId.get(d.dependsOnFieldId) ?? []);
}

/**
 * The parents of a cascade child that have no value to set yet. While any is left the child is not offered: its choices come from
 * the parent's, so the parent is updated first (the list says which one).
 */
export function waitingParents(
  field: Pick<FieldResponse, 'id'>,
  dependencies: readonly FieldDependencyResponse[],
  fields: readonly FieldResponse[],
  changes: BulkPropertyChanges,
): FieldResponse[] {
  const values = setValuesOf(changes);
  return cascadeParents(field, dependencies, fields).filter((p) => isEmptyInput(p, values[p.key]));
}

/** The rows as the dialog draws them: a cascade child lists only the choices its parents' values allow. */
export function withBulkCascade(
  fields: readonly FieldResponse[],
  dependencies: readonly FieldDependencyResponse[],
  optionPairs: readonly FieldOptionDependencyResponse[],
  changes: BulkPropertyChanges,
): FieldResponse[] {
  return withCascadeChoices(fields, dependencies, optionPairs, setValuesOf(changes));
}

/**
 * The changes after one row's value moved: a child whose chosen value the new parent value no longer allows is emptied (the same rule
 * the contact form follows), and a child left without a parent to set is dropped, so nothing is sent for a choice that is not offered.
 */
export function changesAfter(
  changes: BulkPropertyChanges,
  key: string,
  change: BulkPropertyChange | null,
  fields: readonly FieldResponse[],
  dependencies: readonly FieldDependencyResponse[],
  optionPairs: readonly FieldOptionDependencyResponse[],
): BulkPropertyChanges {
  let next: Record<string, BulkPropertyChange> = { ...changes };
  if (change === null) delete next[key];
  else next[key] = change;
  const values = attributesAfterChange(
    setValuesOf(next),
    key,
    change?.mode === 'set'
      ? change.value
      : emptyInput(fields.find((f) => f.key === key) ?? { fieldType: 'text' }),
    fields,
    dependencies,
    optionPairs,
  );
  for (const f of fields) {
    const c = next[f.key];
    if (c?.mode === 'set' && values[f.key] !== undefined && values[f.key] !== c.value) {
      next = { ...next, [f.key]: { mode: 'set', value: values[f.key]! } };
    }
  }
  // A child whose parent is no longer in the list goes with it.
  for (let pass = 0; pass <= fields.length; pass++) {
    let dropped = false;
    for (const f of fields) {
      if (!(f.key in next)) continue;
      const parents = cascadeParents(f, dependencies, fields);
      if (parents.length > 0 && parents.every((p) => !(p.key in next))) {
        delete next[f.key];
        dropped = true;
      }
    }
    if (!dropped) break;
  }
  return next;
}
