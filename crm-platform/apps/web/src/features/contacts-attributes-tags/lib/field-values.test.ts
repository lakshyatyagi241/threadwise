import { describe, expect, it } from 'vitest';
import type { FieldDependencyResponse, FieldResponse } from '@crm/contracts';
import {
  checkValue,
  displayValue,
  emptyInput,
  inputKind,
  inputToValue,
  isEmptyInput,
  isFieldApplicable,
  valueToInput,
} from './field-values';

const f = (fieldType: FieldResponse['fieldType'], over: Partial<FieldResponse> = {}) =>
  ({ fieldType, isRequired: false, isMasked: false, options: undefined, ...over }) as FieldResponse;

describe('inputKind', () => {
  it('maps registry types onto the control the form draws', () => {
    expect(inputKind(f('text'))).toBe('text');
    expect(inputKind(f('long_text'))).toBe('textarea');
    expect(inputKind(f('integer'))).toBe('number');
    expect(inputKind(f('decimal'))).toBe('number');
    expect(inputKind(f('date'))).toBe('date');
    expect(inputKind(f('select'))).toBe('select');
    expect(inputKind(f('radio'))).toBe('select');
    expect(inputKind(f('multiselect'))).toBe('multiselect');
    expect(inputKind(f('checkbox'))).toBe('checkbox');
    expect(inputKind(f('boolean'))).toBe('checkbox');
    expect(inputKind(f('phone'))).toBe('tel');
    expect(inputKind(f('formula'))).toBe('text');
  });
});

describe('stored value <-> input', () => {
  it('reads stored values as form text', () => {
    expect(valueToInput(f('integer'), 42)).toBe('42');
    expect(valueToInput(f('checkbox'), true)).toBe('true');
    expect(valueToInput(f('checkbox'), undefined)).toBe('false');
    expect(valueToInput(f('text'), null)).toBe('');
    expect(valueToInput(f('multiselect'), ['a', 'b'])).toEqual(['a', 'b']);
    expect(valueToInput(f('multiselect'), 'nonsense')).toEqual([]);
    expect(valueToInput(f('text'), { nested: 1 })).toBe('');
  });

  it('stores form text as the right type, and an empty value as null (which clears the key)', () => {
    expect(inputToValue(f('text'), '  hi ')).toBe('hi');
    expect(inputToValue(f('text'), '   ')).toBeNull();
    expect(inputToValue(f('integer'), '12.9')).toBe(12);
    expect(inputToValue(f('decimal'), '12.5')).toBe(12.5);
    expect(inputToValue(f('integer'), 'abc')).toBeNull();
    expect(inputToValue(f('checkbox'), 'true')).toBe(true);
    expect(inputToValue(f('checkbox'), 'false')).toBe(false);
    expect(inputToValue(f('multiselect'), ['a'])).toEqual(['a']);
    expect(inputToValue(f('multiselect'), [])).toBeNull();
    expect(inputToValue(f('select'), undefined)).toBeNull();
  });

  it('knows what an empty input is', () => {
    expect(isEmptyInput(f('text'), ' ')).toBe(true);
    expect(isEmptyInput(f('text'), 'x')).toBe(false);
    expect(isEmptyInput(f('multiselect'), [])).toBe(true);
    expect(isEmptyInput(f('checkbox'), 'false')).toBe(true);
    expect(isEmptyInput(f('checkbox'), 'true')).toBe(false);
    expect(emptyInput(f('multiselect'))).toEqual([]);
    expect(emptyInput(f('checkbox'))).toBe('false');
    expect(emptyInput(f('text'))).toBe('');
  });
});

describe('checkValue', () => {
  it('requires a value only for a required property that applies', () => {
    expect(checkValue(f('text', { isRequired: true }), '')).toBe('required');
    expect(checkValue(f('text', { isRequired: true }), '', false)).toBeNull();
    expect(checkValue(f('text'), '')).toBeNull();
    expect(checkValue(f('multiselect', { isRequired: true }), [])).toBe('required');
    // an unchecked required checkbox is a valid "no"
    expect(checkValue(f('checkbox', { isRequired: true }), 'false')).toBeNull();
  });

  it('checks numbers, emails and links', () => {
    expect(checkValue(f('integer'), '3.5')).toBe('integer');
    expect(checkValue(f('integer'), 'x')).toBe('number');
    expect(checkValue(f('decimal'), '3.5')).toBeNull();
    expect(checkValue(f('email'), 'nope')).toBe('email');
    expect(checkValue(f('email'), 'a@b.co')).toBeNull();
    expect(checkValue(f('url'), 'example.com')).toBe('url');
    expect(checkValue(f('url'), 'https://example.com')).toBeNull();
    expect(checkValue(f('url'), 'javascript:alert(1)')).toBe('url');
  });
});

describe('displayValue', () => {
  const words = { yes: 'Yes', no: 'No' };
  const options = [
    { id: '1', fieldId: 'f', value: 'in', label: 'India', position: 0, isHidden: false, rowVersion: 1 },
    { id: '2', fieldId: 'f', value: 'ae', label: 'UAE', position: 1, isHidden: false, rowVersion: 1 },
  ];
  it('prints option labels, Yes/No and plain text; hides masked values; skips empties', () => {
    expect(displayValue(f('select', { options }), 'in', words)).toBe('India');
    expect(displayValue(f('multiselect', { options }), ['in', 'ae', 'zz'], words)).toBe('India, UAE, zz');
    expect(displayValue(f('checkbox'), true, words)).toBe('Yes');
    expect(displayValue(f('checkbox'), false, words)).toBe('No');
    expect(displayValue(f('integer'), 7, words)).toBe('7');
    expect(displayValue(f('text', { isMasked: true }), 'secret', words)).toBe('••••••');
    expect(displayValue(f('text'), '', words)).toBe('');
    expect(displayValue(f('text'), null, words)).toBe('');
  });
});

describe('isFieldApplicable', () => {
  const country = f('select', {
    id: 'country',
    key: 'country',
    options: [
      { id: 'o-in', fieldId: 'country', value: 'in', label: 'India', position: 0, isHidden: false, rowVersion: 1 },
    ],
  });
  const state = f('text', { id: 'state', key: 'state' });
  const byId = new Map([[country.id, country], [state.id, state]]);
  const dep = (over: Partial<FieldDependencyResponse>): FieldDependencyResponse => ({
    id: 'd',
    fieldId: 'state',
    dependsOnFieldId: 'country',
    dependsOnOptionId: 'o-in',
    dependsOnValue: null,
    createdAt: '',
    ...over,
  });

  it('is always applicable with no dependency', () => {
    expect(isFieldApplicable(state, [], byId, {})).toBe(true);
  });

  it('shows the property only while the option it waits for is chosen', () => {
    expect(isFieldApplicable(state, [dep({})], byId, { country: 'in' })).toBe(true);
    expect(isFieldApplicable(state, [dep({})], byId, { country: 'ae' })).toBe(false);
    expect(isFieldApplicable(state, [dep({})], byId, {})).toBe(false);
  });

  it('works with a multi-select parent and a plain value', () => {
    expect(isFieldApplicable(state, [dep({})], byId, { country: ['ae', 'in'] })).toBe(true);
    expect(
      isFieldApplicable(state, [dep({ dependsOnOptionId: null, dependsOnValue: 'true' })], byId, { country: 'true' }),
    ).toBe(true);
  });

  it('needs every dependency, and ignores a dependency on a property that is gone', () => {
    expect(isFieldApplicable(state, [dep({}), dep({ id: 'e', dependsOnFieldId: 'gone' })], byId, { country: 'in' })).toBe(true);
    expect(isFieldApplicable(state, [dep({}), dep({ id: 'e', dependsOnOptionId: null, dependsOnValue: 'x' })], byId, { country: 'in' })).toBe(false);
  });
});
