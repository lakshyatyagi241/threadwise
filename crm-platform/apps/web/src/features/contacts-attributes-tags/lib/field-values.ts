import type { FieldDependencyResponse, FieldResponse } from '@crm/contracts';

/**
 * How a contact's value for a registry property (a row of `/v2/fields`) is shown in a form, validated, stored in the
 * contact's `customFields`, and printed on the detail page. The form keeps every value as text (or a list of texts for
 * a multi-select); this file converts at the edges so the rest of the form stays one simple shape.
 */

export type InputValue = string | string[];

export type InputKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'tel';

type TypedField = Pick<FieldResponse, 'fieldType'>;

export function inputKind(field: TypedField): InputKind {
  switch (field.fieldType) {
    case 'long_text':
      return 'textarea';
    case 'integer':
    case 'big_integer':
    case 'decimal':
    case 'percentage':
    case 'currency':
    case 'rating':
      return 'number';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'select':
    case 'radio':
      return 'select';
    case 'multiselect':
      return 'multiselect';
    case 'checkbox':
    case 'boolean':
      return 'checkbox';
    case 'url':
      return 'url';
    case 'email':
      return 'email';
    case 'phone':
      return 'tel';
    default:
      return 'text';
  }
}

const isIntegerType = (t: string) => t === 'integer' || t === 'big_integer';

/** A stored value as the form's input state. */
export function valueToInput(field: TypedField, raw: unknown): InputValue {
  const kind = inputKind(field);
  if (kind === 'multiselect') {
    return Array.isArray(raw) ? raw.filter((v) => typeof v === 'string' || typeof v === 'number').map(String) : [];
  }
  if (raw === null || raw === undefined) return kind === 'checkbox' ? 'false' : '';
  if (kind === 'checkbox') return raw === true || raw === 'true' ? 'true' : 'false';
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return '';
}

/** The value the form holds for a property no contact has set yet. */
export const emptyInput = (field: TypedField): InputValue =>
  inputKind(field) === 'multiselect' ? [] : inputKind(field) === 'checkbox' ? 'false' : '';

export function isEmptyInput(field: TypedField, input: InputValue | undefined): boolean {
  if (input === undefined) return true;
  if (Array.isArray(input)) return input.length === 0;
  if (inputKind(field) === 'checkbox') return input !== 'true';
  return input.trim() === '';
}

/**
 * The input state as the value to store: `null` clears the key. Numbers become numbers, a checkbox a boolean, a
 * multi-select a list. An unparsable number is left as `null` (the form reports it before saving).
 */
export function inputToValue(field: TypedField, input: InputValue | undefined): unknown {
  const kind = inputKind(field);
  if (input === undefined) return null;
  if (kind === 'multiselect') {
    const list = Array.isArray(input) ? input : [input];
    return list.length ? list : null;
  }
  if (kind === 'checkbox') return input === 'true';
  const text = Array.isArray(input) ? (input[0] ?? '') : input.trim();
  if (text === '') return null;
  if (kind === 'number') {
    const n = Number(text);
    if (!Number.isFinite(n)) return null;
    return isIntegerType(field.fieldType) ? Math.trunc(n) : n;
  }
  return text;
}

export type ValueProblem = 'required' | 'number' | 'integer' | 'email' | 'url';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validUrl(text: string): boolean {
  try {
    const u = new URL(text);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** What is wrong with a value, if anything. An empty optional value is fine; an empty required one is not. */
export function checkValue(
  field: Pick<FieldResponse, 'fieldType' | 'isRequired'>,
  input: InputValue | undefined,
  /** The property is hidden by an unmet dependency: it cannot be required. */
  applicable = true,
): ValueProblem | null {
  if (!applicable) return null;
  if (isEmptyInput(field, input)) return field.isRequired && inputKind(field) !== 'checkbox' ? 'required' : null;
  const text = Array.isArray(input) ? '' : (input ?? '').trim();
  switch (inputKind(field)) {
    case 'number': {
      const n = Number(text);
      if (!Number.isFinite(n)) return 'number';
      return isIntegerType(field.fieldType) && !Number.isInteger(n) ? 'integer' : null;
    }
    case 'email':
      return EMAIL.test(text) ? null : 'email';
    case 'url':
      return validUrl(text) ? null : 'url';
    default:
      return null;
  }
}

/** Readable text of a stored value for the detail page: option labels for choices, Yes/No for a checkbox. */
export function displayValue(
  field: Pick<FieldResponse, 'fieldType' | 'options' | 'isMasked'>,
  raw: unknown,
  words: { yes: string; no: string },
): string {
  if (raw === null || raw === undefined || raw === '') return '';
  if (field.isMasked) return '••••••';
  const label = (v: unknown) => field.options?.find((o) => o.value === String(v))?.label ?? String(v);
  const kind = inputKind(field);
  if (kind === 'checkbox') return raw === true || raw === 'true' ? words.yes : words.no;
  if (Array.isArray(raw)) return raw.map(label).join(', ');
  if (kind === 'select' || kind === 'multiselect') return label(raw);
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return '';
}

/**
 * Whether a property is shown, given the values entered so far. A dependency is met when the property it depends on
 * holds the named option's value (or the named text); a property with several dependencies needs all of them.
 */
export function isFieldApplicable(
  field: Pick<FieldResponse, 'id'>,
  dependencies: readonly FieldDependencyResponse[],
  fieldsById: ReadonlyMap<string, FieldResponse>,
  values: Readonly<Record<string, InputValue | undefined>>,
): boolean {
  const own = dependencies.filter((d) => d.fieldId === field.id);
  return own.every((d) => {
    const parent = fieldsById.get(d.dependsOnFieldId);
    if (!parent) return true;
    const held = values[parent.key];
    const heldList = Array.isArray(held) ? held : held === undefined || held === '' ? [] : [held];
    const wanted =
      d.dependsOnValue ?? parent.options?.find((o) => o.id === d.dependsOnOptionId)?.value ?? null;
    return wanted !== null && heldList.includes(wanted);
  });
}
