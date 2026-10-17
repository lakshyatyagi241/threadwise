import type {
  CompanyCustomFields,
  CompanyCustomValue,
  FieldDependencyResponse,
  FieldResponse,
  FieldSectionResponse,
} from '@crm/contracts';
// The pure value rules of the shared property registry are imported from their own files, not from the contacts domain's index:
// that index re-exports the contact form, which imports this domain (the company picker), and a cycle of indexes is avoided.
import {
  checkValue,
  displayValue,
  emptyInput,
  inputToValue,
  isEmptyInput,
  isFieldApplicable,
  valueToInput,
  type InputValue,
  type ValueProblem,
} from '@/features/contacts-attributes-tags/lib/field-values';
import {
  groupBySection,
  type SectionGroup,
} from '@/features/contacts-attributes-tags/lib/property-model';

/**
 * A company's own properties (Settings, Company properties) on the company form and the company page. The values live in the
 * company's `customFields` by property key; the form holds each as the input shows it (text, or a list for a multi-select), exactly
 * as the contact form does, and these rules convert at the edges. Everything here is pure.
 */

export type PropertyInputs = Record<string, InputValue>;

/** The properties a person can see on the form and the page: active, the workspace's own (not system), not hidden. */
export const isShownProperty = (f: FieldResponse): boolean =>
  f.isActive && !f.isSystem && !f.isHidden;

/** What the form can write: shown and not read-only (a computed property is never writable). */
export const isWritableProperty = (f: FieldResponse): boolean =>
  isShownProperty(f) && !f.isReadOnly && f.fieldType !== 'formula';

const byId = (fields: readonly FieldResponse[]) => new Map(fields.map((f) => [f.id, f]));

/** The form's inputs for a company: every shown property, from what the company holds. */
export function inputsOf(
  fields: readonly FieldResponse[],
  stored: Readonly<Record<string, unknown>>,
): PropertyInputs {
  const out: PropertyInputs = {};
  for (const f of fields) if (isShownProperty(f)) out[f.key] = valueToInput(f, stored[f.key]);
  return out;
}

/** Whether a property is drawn: a "show only when" rule is met by the values entered so far. */
export function isApplicable(
  field: FieldResponse,
  fields: readonly FieldResponse[],
  dependencies: readonly FieldDependencyResponse[],
  inputs: PropertyInputs,
): boolean {
  return isFieldApplicable(field, dependencies, byId(fields), inputs);
}

/** What is wrong with each drawn, writable property's input (required and well-formed), by property key. */
export function propertyProblems(
  fields: readonly FieldResponse[],
  dependencies: readonly FieldDependencyResponse[],
  inputs: PropertyInputs,
): Record<string, ValueProblem> {
  const out: Record<string, ValueProblem> = {};
  for (const f of fields) {
    if (!isWritableProperty(f)) continue;
    const found = checkValue(f, inputs[f.key], isApplicable(f, fields, dependencies, inputs));
    if (found) out[f.key] = found;
  }
  return out;
}

/** The value a new company is created with: every drawn, writable property that has an answer (a blank one stores nothing). */
export function createValues(
  fields: readonly FieldResponse[],
  dependencies: readonly FieldDependencyResponse[],
  inputs: PropertyInputs,
): CompanyCustomFields {
  const out: CompanyCustomFields = {};
  for (const f of fields) {
    if (!isWritableProperty(f) || !isApplicable(f, fields, dependencies, inputs)) continue;
    const value = inputToValue(f, inputs[f.key]) as CompanyCustomValue;
    if (value !== null && value !== false) out[f.key] = value;
  }
  return out;
}

const norm = (v: unknown): string =>
  JSON.stringify(v === undefined || v === false || v === '' ? null : v);

/**
 * What an edit sends: only the properties whose answer changed from what the company holds, `null` clearing one. A property that is
 * not drawn (its "show only when" rule is unmet) or read-only is left alone. `null` when nothing changed.
 */
export function updateValues(
  fields: readonly FieldResponse[],
  dependencies: readonly FieldDependencyResponse[],
  inputs: PropertyInputs,
  stored: Readonly<Record<string, unknown>>,
): CompanyCustomFields | null {
  const out: CompanyCustomFields = {};
  for (const f of fields) {
    if (!isWritableProperty(f) || !isApplicable(f, fields, dependencies, inputs)) continue;
    const now = inputToValue(f, inputs[f.key]) as CompanyCustomValue;
    if (norm(now) === norm(stored[f.key])) continue;
    out[f.key] = now === false ? null : now;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** The input a property starts from on a new company. */
export const startingInput = (f: FieldResponse): InputValue => emptyInput(f);

export interface ShownValue {
  field: FieldResponse;
  text: string;
}

export interface ShownGroup {
  section: FieldSectionResponse | null;
  values: ShownValue[];
}

/**
 * The company page's properties card: the shown properties that hold a value, under their sections (sections and properties in
 * their saved order, properties with no section last), as the words a person reads (an option's label, Yes / No).
 */
export function shownGroups(
  fields: readonly FieldResponse[],
  sections: readonly FieldSectionResponse[],
  stored: Readonly<Record<string, unknown>>,
  words: { yes: string; no: string },
): ShownGroup[] {
  const holding = fields.filter(
    (f) =>
      isShownProperty(f) &&
      !isEmptyInput(f, valueToInput(f, stored[f.key])) &&
      displayValue(f, stored[f.key], words) !== '',
  );
  return groupBySection(sections, holding)
    .filter((g: SectionGroup) => g.fields.length > 0)
    .map((g) => ({
      section: g.section,
      values: g.fields.map((field) => ({
        field,
        text: displayValue(field, stored[field.key], words),
      })),
    }));
}
