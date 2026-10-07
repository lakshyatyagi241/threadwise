import type { FieldResponse } from '@crm/contracts';
import {
  checkValue,
  inputKind,
  inputToValue,
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
    if (!field) continue;
    out[key] = change.mode === 'clear' ? null : inputToValue(field, change.value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
